package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"CLIProxyAPIManager/internal/cpamanager"
	"github.com/gin-gonic/gin"
)

type cpaManagerStub struct {
	status cpamanager.RuntimeStatus
}

func (s *cpaManagerStub) Status(context.Context) cpamanager.RuntimeStatus {
	return s.status
}

func (s *cpaManagerStub) Start(context.Context) error {
	s.status.Running = true
	return nil
}

func (s *cpaManagerStub) Stop(context.Context) error {
	s.status.Running = false
	return nil
}

func (s *cpaManagerStub) Restart(context.Context) error {
	s.status.Running = true
	return nil
}

func (s *cpaManagerStub) Update(context.Context) (cpamanager.RuntimeStatus, error) {
	s.status.CurrentVersion = s.status.LatestVersion
	s.status.UpdateAvailable = false
	return s.status, nil
}

func (s *cpaManagerStub) Events() []cpamanager.UpdateEvent {
	return []cpamanager.UpdateEvent{{Time: time.Unix(1, 0), Stage: "done", Message: "ok"}}
}

func TestCPAManagerRoutesRequireAdminWhenAuthEnabled(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := NewRouter(nil, nil, nil, nil, AuthConfig{Enabled: true, LoginPassword: "secret", SessionTTL: time.Hour}, nil, "", OptionalProviders{
		CPAManager: &cpaManagerStub{status: cpamanager.RuntimeStatus{Enabled: true}},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cpa/runtime", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusUnauthorized {
		t.Fatalf("expected CPA runtime route to require auth, got %d", resp.Code)
	}
}

func TestCPAManagerRuntimeRouteReturnsStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	router := NewRouter(nil, nil, nil, nil, AuthConfig{}, nil, "", OptionalProviders{
		CPAManager: &cpaManagerStub{status: cpamanager.RuntimeStatus{Enabled: true, Running: true, PID: 123, CurrentVersion: "v1.2.3"}},
	})

	req := httptest.NewRequest(http.MethodGet, "/api/v1/cpa/runtime", nil)
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", resp.Code)
	}
	if body := resp.Body.String(); body == "" || !containsAll(body, `"enabled":true`, `"running":true`, `"pid":123`) {
		t.Fatalf("unexpected response body: %s", body)
	}
}

func containsAll(value string, parts ...string) bool {
	for _, part := range parts {
		if !strings.Contains(value, part) {
			return false
		}
	}
	return true
}
