package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"CLIProxyAPIManager/internal/service"
)

type authFileCooldownProviderStub struct {
	startRequest    service.AuthFileCooldownStartRequest
	restoreRequest  service.AuthFileCooldownRestoreRequest
	listResponse    service.AuthFileCooldownListResponse
	startResponse   service.AuthFileCooldownResponse
	restoreResponse service.AuthFileCooldownResponse
	startErr        error
	restoreErr      error
}

func (s *authFileCooldownProviderStub) ListAuthFileCooldowns(ctx context.Context) (service.AuthFileCooldownListResponse, error) {
	_ = ctx
	return s.listResponse, nil
}

func (s *authFileCooldownProviderStub) StartAuthFileCooldown(ctx context.Context, request service.AuthFileCooldownStartRequest) (service.AuthFileCooldownResponse, error) {
	_ = ctx
	s.startRequest = request
	if s.startErr != nil {
		return service.AuthFileCooldownResponse{}, s.startErr
	}
	return s.startResponse, nil
}

func (s *authFileCooldownProviderStub) RestoreAuthFileCooldown(ctx context.Context, request service.AuthFileCooldownRestoreRequest) (service.AuthFileCooldownResponse, error) {
	_ = ctx
	s.restoreRequest = request
	if s.restoreErr != nil {
		return service.AuthFileCooldownResponse{}, s.restoreErr
	}
	return s.restoreResponse, nil
}

func TestAuthFileCooldownRoutesStartAndRestore(t *testing.T) {
	provider := &authFileCooldownProviderStub{
		startResponse:   service.AuthFileCooldownResponse{ID: 1, AuthIndex: "auth-1", FileName: "codex.json", Status: "active", RestoreAt: time.Date(2026, 7, 2, 15, 0, 0, 0, time.UTC)},
		restoreResponse: service.AuthFileCooldownResponse{ID: 1, AuthIndex: "auth-1", FileName: "codex.json", Status: "restored"},
	}
	router := NewRouter(nil, nil, nil, nil, AuthConfig{}, nil, "", OptionalProviders{AuthCooldowns: provider})

	startReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth-files/cooldowns", strings.NewReader(`{"auth_index":"auth-1","file_name":"codex.json"}`))
	startReq.Header.Set("Content-Type", "application/json")
	startResp := httptest.NewRecorder()
	router.ServeHTTP(startResp, startReq)
	if startResp.Code != http.StatusOK {
		t.Fatalf("expected start status 200, got %d body=%s", startResp.Code, startResp.Body.String())
	}
	if provider.startRequest.AuthIndex != "auth-1" || provider.startRequest.FileName != "codex.json" || provider.startRequest.Duration != service.AuthFileCooldownDefaultDuration {
		t.Fatalf("unexpected start request: %+v", provider.startRequest)
	}

	restoreReq := httptest.NewRequest(http.MethodPost, "/api/v1/auth-files/cooldowns/restore", strings.NewReader(`{"auth_index":"auth-1"}`))
	restoreReq.Header.Set("Content-Type", "application/json")
	restoreResp := httptest.NewRecorder()
	router.ServeHTTP(restoreResp, restoreReq)
	if restoreResp.Code != http.StatusOK {
		t.Fatalf("expected restore status 200, got %d body=%s", restoreResp.Code, restoreResp.Body.String())
	}
	if provider.restoreRequest.AuthIndex != "auth-1" {
		t.Fatalf("unexpected restore request: %+v", provider.restoreRequest)
	}
}
