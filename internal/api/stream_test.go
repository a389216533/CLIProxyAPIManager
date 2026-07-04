package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"CLIProxyAPIManager/internal/service"
	servicedto "CLIProxyAPIManager/internal/service/dto"
)

type usageEventStreamProviderStub struct {
	records []servicedto.UsageEventRecord
	ids     []int64
	filter  servicedto.UsageFilter
}

func (s *usageEventStreamProviderStub) GetUsageOverview(context.Context, servicedto.UsageFilter) (*servicedto.UsageOverviewSnapshot, error) {
	return nil, nil
}

func (s *usageEventStreamProviderStub) GetUsageOverviewRealtime(context.Context, servicedto.UsageFilter) (*servicedto.UsageOverviewRealtime, error) {
	return nil, nil
}

func (s *usageEventStreamProviderStub) ListUsageEvents(context.Context, servicedto.UsageFilter) (*servicedto.UsageEventsPage, error) {
	return nil, nil
}

func (s *usageEventStreamProviderStub) StreamUsageEvents(context.Context, servicedto.UsageFilter, func(servicedto.UsageEventRecord) error) error {
	return nil
}

func (s *usageEventStreamProviderStub) ListUsageEventFilterOptions(context.Context, servicedto.UsageFilter) (*servicedto.UsageEventFilterOptions, error) {
	return nil, nil
}

func (s *usageEventStreamProviderStub) GetAnalysis(context.Context, servicedto.UsageFilter) (*servicedto.AnalysisSnapshot, error) {
	return nil, nil
}

func (s *usageEventStreamProviderStub) ListUsageEventsByIDs(_ context.Context, filter servicedto.UsageFilter, ids []int64) ([]servicedto.UsageEventRecord, error) {
	s.filter = filter
	s.ids = append([]int64(nil), ids...)
	return s.records, nil
}

func TestUsageEventsStreamReplaysBufferedUsageEvent(t *testing.T) {
	hub := service.NewUsageEventHub(100)
	notification := hub.PublishUsageEventID(42)
	provider := &usageEventStreamProviderStub{records: []servicedto.UsageEventRecord{{
		ID:          42,
		Timestamp:   time.Now(),
		Model:       "claude-sonnet",
		Source:      "auth-user@example.com",
		AuthIndex:   "auth-1",
		LatencyMS:   120,
		TotalTokens: 30,
	}}}
	router := NewRouter(nil, nil, provider, nil, AuthConfig{}, nil, "", OptionalProviders{UsageEventsHub: hub})
	recorder := serveStreamingRequest(t, router, "/api/v1/usage/events/stream?range=24h", "")
	body := recorder.Body.String()

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d %s", recorder.Code, body)
	}
	if contentType := recorder.Header().Get("Content-Type"); !strings.HasPrefix(contentType, "text/event-stream") {
		t.Fatalf("expected event-stream content type, got %q", contentType)
	}
	if !strings.Contains(body, "id: "+strconvFormatInt(notification.Sequence)) || !strings.Contains(body, "event: usage_event") {
		t.Fatalf("expected usage_event SSE frame, got %q", body)
	}
	if !strings.Contains(body, `"id":"42"`) || !strings.Contains(body, `"model":"claude-sonnet"`) {
		t.Fatalf("expected usage event payload, got %q", body)
	}
	if len(provider.ids) != 1 || provider.ids[0] != 42 {
		t.Fatalf("expected provider to hydrate event id 42, got %+v", provider.ids)
	}
}

func TestUsageEventsStreamSendsSyncRequiredWhenLastEventIDFallsOutOfBuffer(t *testing.T) {
	hub := service.NewUsageEventHub(1)
	first := hub.PublishUsageEventID(1)
	hub.PublishUsageEventID(2)
	hub.PublishUsageEventID(3)
	provider := &usageEventStreamProviderStub{}
	router := NewRouter(nil, nil, provider, nil, AuthConfig{}, nil, "", OptionalProviders{UsageEventsHub: hub})
	recorder := serveStreamingRequest(t, router, "/api/v1/usage/events/stream?range=24h", strconvFormatInt(first.Sequence))
	body := recorder.Body.String()

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d %s", recorder.Code, body)
	}
	if !strings.Contains(body, "event: sync_required") {
		t.Fatalf("expected sync_required event, got %q", body)
	}
	if len(provider.ids) != 0 {
		t.Fatalf("expected no partial replay hydration, got %+v", provider.ids)
	}
}

func serveStreamingRequest(t *testing.T, router http.Handler, target string, lastEventID string) *httptest.ResponseRecorder {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	req := httptest.NewRequest(http.MethodGet, target, nil).WithContext(ctx)
	if lastEventID != "" {
		req.Header.Set("Last-Event-ID", lastEventID)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, req)
	return recorder
}

func strconvFormatInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
