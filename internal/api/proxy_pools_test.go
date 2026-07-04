package api

import (
	"testing"
	"time"

	"CLIProxyAPIManager/internal/entities"
	"CLIProxyAPIManager/internal/service"
)

func TestMapProxyPoolResponseIncludesStats(t *testing.T) {
	latency := int64(238)
	response := mapProxyPoolResponse(entities.ProxyPool{
		ID:                 7,
		Name:               "Proxy A",
		ProxyURL:           "socks5://127.0.0.1:1080",
		CreatedAt:          time.Date(2026, 7, 3, 10, 0, 0, 0, time.UTC),
		UpdatedAt:          time.Date(2026, 7, 3, 11, 0, 0, 0, time.UTC),
		BoundAuthFileCount: 3,
		AverageLatencyMS:   &latency,
		LatencySource:      "recent_usage",
	})

	if response.BoundAuthFileCount != 3 {
		t.Fatalf("expected bound auth file count 3, got %d", response.BoundAuthFileCount)
	}
	if response.AverageLatencyMS == nil || *response.AverageLatencyMS != 238 {
		t.Fatalf("expected average latency 238ms, got %#v", response.AverageLatencyMS)
	}
	if response.LatencySource != "recent_usage" {
		t.Fatalf("expected latency source recent_usage, got %q", response.LatencySource)
	}
}

func TestMapProxyPoolTestResponseIncludesTargetsAndCompatibleDuration(t *testing.T) {
	response := mapProxyPoolTestResponse(service.ProxyPoolTestResult{
		CheckedAt:  time.Date(2026, 7, 3, 10, 0, 0, 0, time.UTC),
		DurationMS: 123,
		Targets: service.ProxyPoolTestTargets{
			Latency: service.ProxyPoolTargetResult{
				OK:         true,
				DurationMS: 123,
				StatusCode: 204,
				URL:        "https://www.gstatic.com/generate_204",
			},
			GPT: service.ProxyPoolTargetResult{
				OK:         false,
				DurationMS: 45,
				StatusCode: 503,
				Error:      "status 503",
				URL:        "https://chatgpt.com",
			},
			Claude: service.ProxyPoolTargetResult{
				OK:         true,
				DurationMS: 67,
				StatusCode: 200,
				URL:        "https://claude.ai",
			},
		},
	})

	if response.DurationMS != 123 {
		t.Fatalf("expected compatible duration_ms 123, got %d", response.DurationMS)
	}
	if !response.Targets.Latency.OK || response.Targets.Latency.StatusCode != 204 {
		t.Fatalf("expected latency target mapping, got %+v", response.Targets.Latency)
	}
	if response.Targets.GPT.OK || response.Targets.GPT.Error != "status 503" {
		t.Fatalf("expected failed gpt target mapping, got %+v", response.Targets.GPT)
	}
	if !response.Targets.Claude.OK || response.Targets.Claude.URL != "https://claude.ai" {
		t.Fatalf("expected claude target mapping, got %+v", response.Targets.Claude)
	}
}
