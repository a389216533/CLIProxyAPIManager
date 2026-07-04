package api

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"CLIProxyAPIManager/internal/service"
)

type authFileManagementProviderStub struct {
	statusNames    []string
	statusDisabled bool
	statusResponse service.AuthFilesManagementResponse
	statusErr      error
	noteNames      []string
	noteValue      *string
	noteResponse   service.AuthFilesManagementResponse
	noteErr        error
	importContent  string
	importResponse service.AuthFilesManagementResponse
	importErr      error
	deleteNames    []string
	deleteResponse service.AuthFilesManagementResponse
	deleteErr      error
}

func (s *authFileManagementProviderStub) ImportAuthFiles(ctx context.Context, content string) (service.AuthFilesManagementResponse, error) {
	s.importContent = content
	if s.importErr != nil {
		return service.AuthFilesManagementResponse{}, s.importErr
	}
	return s.importResponse, nil
}

func (s *authFileManagementProviderStub) SetAuthFilesDisabled(ctx context.Context, names []string, disabled bool) (service.AuthFilesManagementResponse, error) {
	s.statusNames = names
	s.statusDisabled = disabled
	if s.statusErr != nil {
		return service.AuthFilesManagementResponse{}, s.statusErr
	}
	return s.statusResponse, nil
}

func (s *authFileManagementProviderStub) SetAuthFilesProxyURL(ctx context.Context, names []string, proxyURL *string) (service.AuthFilesManagementResponse, error) {
	return service.AuthFilesManagementResponse{Names: names, Affected: len(names)}, nil
}

func (s *authFileManagementProviderStub) SetAuthFilesNote(ctx context.Context, names []string, note *string) (service.AuthFilesManagementResponse, error) {
	s.noteNames = names
	s.noteValue = note
	if s.noteErr != nil {
		return service.AuthFilesManagementResponse{}, s.noteErr
	}
	return s.noteResponse, nil
}

func (s *authFileManagementProviderStub) DeleteAuthFiles(ctx context.Context, names []string) (service.AuthFilesManagementResponse, error) {
	s.deleteNames = names
	if s.deleteErr != nil {
		return service.AuthFilesManagementResponse{}, s.deleteErr
	}
	return s.deleteResponse, nil
}

func TestAuthFilesStatusRouteDisablesSelectedNames(t *testing.T) {
	provider := &authFileManagementProviderStub{statusResponse: service.AuthFilesManagementResponse{Names: []string{"a.json", "b.json"}, Affected: 2}}
	router := NewRouter(nil, nil, nil, nil, AuthConfig{}, nil, "", OptionalProviders{AuthFiles: provider})

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/auth-files/status", strings.NewReader(`{"names":[" a.json ","b.json"],"disabled":true}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if strings.Join(provider.statusNames, ",") != " a.json ,b.json" || !provider.statusDisabled {
		t.Fatalf("unexpected provider request: names=%+v disabled=%v", provider.statusNames, provider.statusDisabled)
	}
	body := resp.Body.String()
	if !contains(body, `"affected":2`) || !contains(body, `"names":["`) || !contains(body, `"a.json"`) {
		t.Fatalf("unexpected response body: %s", body)
	}
}

func TestAuthFilesNoteRouteUpdatesSelectedNames(t *testing.T) {
	provider := &authFileManagementProviderStub{noteResponse: service.AuthFilesManagementResponse{Names: []string{"a.json"}, Affected: 1}}
	router := NewRouter(nil, nil, nil, nil, AuthConfig{}, nil, "", OptionalProviders{AuthFiles: provider})

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/auth-files/note", strings.NewReader(`{"names":["a.json"],"note":"Team A"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if strings.Join(provider.noteNames, ",") != "a.json" || provider.noteValue == nil || *provider.noteValue != "Team A" {
		t.Fatalf("unexpected provider note request: names=%+v note=%v", provider.noteNames, provider.noteValue)
	}
	if body := resp.Body.String(); !contains(body, `"affected":1`) || !contains(body, `"a.json"`) {
		t.Fatalf("unexpected response body: %s", body)
	}
}

func TestAuthFilesDeleteRouteDeletesSelectedNames(t *testing.T) {
	provider := &authFileManagementProviderStub{deleteResponse: service.AuthFilesManagementResponse{Names: []string{"a.json", "b.json"}, Affected: 2}}
	router := NewRouter(nil, nil, nil, nil, AuthConfig{}, nil, "", OptionalProviders{AuthFiles: provider})

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/auth-files", strings.NewReader(`{"names":["a.json"," b.json "]}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if strings.Join(provider.deleteNames, ",") != "a.json, b.json " {
		t.Fatalf("unexpected provider request: names=%+v", provider.deleteNames)
	}
	if body := resp.Body.String(); !contains(body, `"affected":2`) || !contains(body, `"b.json"`) {
		t.Fatalf("unexpected response body: %s", body)
	}
}

func TestAuthFilesImportRouteImportsTokenContent(t *testing.T) {
	provider := &authFileManagementProviderStub{importResponse: service.AuthFilesManagementResponse{Names: []string{"codex-user.json"}, Affected: 1}}
	router := NewRouter(nil, nil, nil, nil, AuthConfig{}, nil, "", OptionalProviders{AuthFiles: provider})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth-files/import", strings.NewReader(`{"content":"token-content"}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d body=%s", resp.Code, resp.Body.String())
	}
	if provider.importContent != "token-content" {
		t.Fatalf("unexpected provider import content: %q", provider.importContent)
	}
	if body := resp.Body.String(); !contains(body, `"affected":1`) || !contains(body, `"codex-user.json"`) {
		t.Fatalf("unexpected response body: %s", body)
	}
}

func TestAuthFilesManagementRoutesRejectEmptyNames(t *testing.T) {
	provider := &authFileManagementProviderStub{
		statusErr: service.ErrAuthFilesManagementValidation,
		noteErr:   service.ErrAuthFilesManagementValidation,
		deleteErr: service.ErrAuthFilesManagementValidation,
		importErr: service.ErrAuthFilesManagementValidation,
	}
	router := NewRouter(nil, nil, nil, nil, AuthConfig{}, nil, "", OptionalProviders{AuthFiles: provider})

	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodPatch, path: "/api/v1/auth-files/status", body: `{"names":[" "],"disabled":true}`},
		{method: http.MethodPatch, path: "/api/v1/auth-files/note", body: `{"names":[" "],"note":"Team A"}`},
		{method: http.MethodDelete, path: "/api/v1/auth-files", body: `{"names":[]}`},
		{method: http.MethodPost, path: "/api/v1/auth-files/import", body: `{"content":" "}`},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)

		if resp.Code != http.StatusBadRequest {
			t.Fatalf("%s %s: expected status 400, got %d body=%s", tc.method, tc.path, resp.Code, resp.Body.String())
		}
		if body := resp.Body.String(); !contains(body, `"names are required"`) && !contains(body, `"invalid import content"`) {
			t.Fatalf("%s %s: unexpected response body: %s", tc.method, tc.path, body)
		}
	}
}

func TestAuthFilesManagementRoutesMapValidationErrors(t *testing.T) {
	provider := &authFileManagementProviderStub{statusErr: service.ErrAuthFilesManagementValidation, deleteErr: service.ErrAuthFilesManagementValidation}
	router := NewRouter(nil, nil, nil, nil, AuthConfig{}, nil, "", OptionalProviders{AuthFiles: provider})

	for _, tc := range []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodPatch, path: "/api/v1/auth-files/status", body: `{"names":["a.json"],"disabled":true}`},
		{method: http.MethodDelete, path: "/api/v1/auth-files", body: `{"names":["a.json"]}`},
	} {
		req := httptest.NewRequest(tc.method, tc.path, strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		resp := httptest.NewRecorder()
		router.ServeHTTP(resp, req)

		if resp.Code != http.StatusBadRequest {
			t.Fatalf("%s %s: expected status 400, got %d body=%s", tc.method, tc.path, resp.Code, resp.Body.String())
		}
	}
}

func TestAuthFilesManagementRoutesReturnInternalError(t *testing.T) {
	provider := &authFileManagementProviderStub{statusErr: errors.New("upstream failed")}
	router := NewRouter(nil, nil, nil, nil, AuthConfig{}, nil, "", OptionalProviders{AuthFiles: provider})

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/auth-files/status", strings.NewReader(`{"names":["a.json"],"disabled":true}`))
	req.Header.Set("Content-Type", "application/json")
	resp := httptest.NewRecorder()
	router.ServeHTTP(resp, req)

	if resp.Code != http.StatusInternalServerError {
		t.Fatalf("expected status 500, got %d body=%s", resp.Code, resp.Body.String())
	}
}
