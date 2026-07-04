package service

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"
)

type authFilesManagementClientStub struct {
	mu              sync.Mutex
	imports         []authFilesManagementImportCall
	statusCalls     []authFilesManagementStatusCall
	noteCalls       []authFilesManagementNoteCall
	deleteNames     []string
	statusErrByName map[string]error
	active          int
	maxActive       int
	delay           time.Duration
}

type authFilesManagementImportCall struct {
	name    string
	payload map[string]any
}

type authFilesManagementStatusCall struct {
	name     string
	disabled bool
}

type authFilesManagementNoteCall struct {
	name string
	note *string
}

func (s *authFilesManagementClientStub) ImportAuthFile(ctx context.Context, name string, payload map[string]any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.imports = append(s.imports, authFilesManagementImportCall{name: name, payload: payload})
	return nil
}

func (s *authFilesManagementClientStub) UpdateAuthFileStatus(ctx context.Context, name string, disabled bool) error {
	s.mu.Lock()
	s.statusCalls = append(s.statusCalls, authFilesManagementStatusCall{name: name, disabled: disabled})
	s.active++
	if s.active > s.maxActive {
		s.maxActive = s.active
	}
	s.mu.Unlock()

	if s.delay > 0 {
		time.Sleep(s.delay)
	}

	s.mu.Lock()
	s.active--
	err := s.statusErrByName[name]
	s.mu.Unlock()
	return err
}

func (s *authFilesManagementClientStub) UpdateAuthFileProxyURL(ctx context.Context, name string, proxyURL *string) error {
	return nil
}

func (s *authFilesManagementClientStub) UpdateAuthFileNote(ctx context.Context, name string, note *string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.noteCalls = append(s.noteCalls, authFilesManagementNoteCall{name: name, note: note})
	return nil
}

func (s *authFilesManagementClientStub) DeleteAuthFiles(ctx context.Context, names []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleteNames = append([]string(nil), names...)
	return nil
}

func TestAuthFilesManagementServiceDisablesWithFiveWorkers(t *testing.T) {
	client := &authFilesManagementClientStub{delay: 10 * time.Millisecond}
	service := NewAuthFilesManagementService(client)
	names := []string{"a.json", "b.json", "c.json", "d.json", "e.json", "f.json", "g.json"}

	response, err := service.SetAuthFilesDisabled(context.Background(), names, true)
	if err != nil {
		t.Fatalf("SetAuthFilesDisabled returned error: %v", err)
	}

	if response.Affected != len(names) {
		t.Fatalf("expected affected=%d, got %+v", len(names), response)
	}
	if client.maxActive > 10 {
		t.Fatalf("expected at most 10 concurrent status updates, got %d", client.maxActive)
	}
	if client.maxActive <= 1 {
		t.Fatalf("expected status updates to run concurrently, got maxActive=%d", client.maxActive)
	}
	if len(client.statusCalls) != len(names) {
		t.Fatalf("expected one status call per name, got %+v", client.statusCalls)
	}
	for _, call := range client.statusCalls {
		if !call.disabled {
			t.Fatalf("expected disabled=true for all calls, got %+v", client.statusCalls)
		}
	}
}

func TestAuthFilesManagementServiceTrimsAndDedupesNames(t *testing.T) {
	client := &authFilesManagementClientStub{}
	service := NewAuthFilesManagementService(client)

	response, err := service.DeleteAuthFiles(context.Background(), []string{" a.json ", "a.json", "b.json"})
	if err != nil {
		t.Fatalf("DeleteAuthFiles returned error: %v", err)
	}

	if strings.Join(response.Names, ",") != "a.json,b.json" || strings.Join(client.deleteNames, ",") != "a.json,b.json" {
		t.Fatalf("expected trimmed unique names, response=%+v client=%+v", response, client.deleteNames)
	}
}

func TestAuthFilesManagementServiceDeleteCallsOnChanged(t *testing.T) {
	client := &authFilesManagementClientStub{}
	changed := 0
	service := NewAuthFilesManagementServiceWithOnChanged(client, func(context.Context) error {
		changed++
		return nil
	})

	if _, err := service.DeleteAuthFiles(context.Background(), []string{"a.json"}); err != nil {
		t.Fatalf("DeleteAuthFiles returned error: %v", err)
	}
	if changed != 1 {
		t.Fatalf("expected delete to trigger one sync, got %d", changed)
	}
}

func TestAuthFilesManagementServiceSetsNoteAndCallsOnChanged(t *testing.T) {
	client := &authFilesManagementClientStub{}
	changed := 0
	service := NewAuthFilesManagementServiceWithOnChanged(client, func(context.Context) error {
		changed++
		return nil
	})

	response, err := service.SetAuthFilesNote(context.Background(), []string{" a.json ", "a.json", "b.json"}, strPtr(" Team A "))
	if err != nil {
		t.Fatalf("SetAuthFilesNote returned error: %v", err)
	}

	if response.Affected != 2 || changed != 1 {
		t.Fatalf("expected two affected and one sync, response=%+v changed=%d", response, changed)
	}
	if len(client.noteCalls) != 2 {
		t.Fatalf("expected two note calls, got %+v", client.noteCalls)
	}
	if client.noteCalls[0].name != "a.json" || client.noteCalls[0].note == nil || *client.noteCalls[0].note != "Team A" {
		t.Fatalf("unexpected first note call: %+v", client.noteCalls[0])
	}
}

func TestAuthFilesManagementServiceClearsBlankNote(t *testing.T) {
	client := &authFilesManagementClientStub{}
	service := NewAuthFilesManagementService(client)

	if _, err := service.SetAuthFilesNote(context.Background(), []string{"a.json"}, strPtr(" ")); err != nil {
		t.Fatalf("SetAuthFilesNote returned error: %v", err)
	}
	if len(client.noteCalls) != 1 || client.noteCalls[0].note != nil {
		t.Fatalf("expected blank note to clear metadata, got %+v", client.noteCalls)
	}
}

func TestAuthFilesManagementServiceRejectsEmptyNames(t *testing.T) {
	client := &authFilesManagementClientStub{}
	service := NewAuthFilesManagementService(client)

	_, err := service.DeleteAuthFiles(context.Background(), []string{" "})
	if !errors.Is(err, ErrAuthFilesManagementValidation) {
		t.Fatalf("expected validation error, got %v", err)
	}

	_, err = service.SetAuthFilesDisabled(context.Background(), nil, true)
	if !errors.Is(err, ErrAuthFilesManagementValidation) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestAuthFilesManagementServiceReturnsStatusUpdateErrors(t *testing.T) {
	client := &authFilesManagementClientStub{statusErrByName: map[string]error{"b.json": errors.New("upstream rejected")}}
	service := NewAuthFilesManagementService(client)

	_, err := service.SetAuthFilesDisabled(context.Background(), []string{"a.json", "b.json"}, true)
	if err == nil || !strings.Contains(err.Error(), "b.json") {
		t.Fatalf("expected named status update error, got %v", err)
	}
}

func TestAuthFilesManagementServiceImportsSessionJSON(t *testing.T) {
	now := time.Date(2026, 7, 2, 10, 30, 0, 0, time.UTC)
	accessToken := testAuthFileImportJWT(t, map[string]any{
		"email": "User@Example.com",
		"exp":   float64(1790000000),
		"https://api.openai.com/auth": map[string]any{
			"chatgpt_account_id": "acct_123",
			"chatgpt_user_id":    "user_123",
			"chatgpt_plan_type":  "plus",
		},
	})
	content := `{"accessToken":"` + accessToken + `","sessionToken":"sess_123","user":{"email":"user@example.com"}}`

	files, err := buildAuthFileImportsFromTokenContentAt(content, now)
	if err != nil {
		t.Fatalf("buildAuthFileImportsFromTokenContentAt returned error: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("expected one import file, got %+v", files)
	}
	file := files[0]
	if file.Name != "codex-user-example-com-2026-07-02_10-30-00.json" {
		t.Fatalf("unexpected file name %q", file.Name)
	}
	if file.Payload["type"] != "codex" || file.Payload["account_id"] != "acct_123" || file.Payload["chatgpt_plan_type"] != "plus" {
		t.Fatalf("unexpected payload: %#v", file.Payload)
	}
	if file.Payload["session_token"] != "sess_123" || file.Payload["expired"] != "2026-09-21T14:13:20Z" {
		t.Fatalf("expected session token and expiry, got %#v", file.Payload)
	}
	if file.Payload["id_token_synthetic"] != true {
		t.Fatalf("expected synthetic id token marker, got %#v", file.Payload["id_token_synthetic"])
	}
	idToken, ok := file.Payload["id_token"].(string)
	if !ok || !strings.HasSuffix(idToken, ".synthetic") {
		t.Fatalf("expected synthetic id token, got %#v", file.Payload["id_token"])
	}
}

func TestAuthFilesManagementServiceImportsRawAccessToken(t *testing.T) {
	now := time.Date(2026, 7, 2, 11, 0, 0, 0, time.UTC)
	accessToken := testAuthFileImportJWT(t, map[string]any{
		"email": "raw@example.com",
		"https://api.openai.com/auth": map[string]any{
			"chatgpt_account_id": "acct_raw",
		},
	})

	files, err := buildAuthFileImportsFromTokenContentAt(accessToken, now)
	if err != nil {
		t.Fatalf("buildAuthFileImportsFromTokenContentAt returned error: %v", err)
	}
	if len(files) != 1 || files[0].Payload["access_token"] != accessToken || files[0].Payload["email"] != "raw@example.com" {
		t.Fatalf("unexpected raw token import: %+v", files)
	}
}

func TestAuthFilesManagementServiceImportCallsClientAndOnChanged(t *testing.T) {
	client := &authFilesManagementClientStub{}
	changed := 0
	service := NewAuthFilesManagementServiceWithOnChanged(client, func(context.Context) error {
		changed++
		return nil
	})
	accessToken := testAuthFileImportJWT(t, map[string]any{"email": "sync@example.com"})

	response, err := service.ImportAuthFiles(context.Background(), accessToken)
	if err != nil {
		t.Fatalf("ImportAuthFiles returned error: %v", err)
	}
	if response.Affected != 1 || len(client.imports) != 1 || changed != 1 {
		t.Fatalf("expected one import and one sync, response=%+v imports=%+v changed=%d", response, client.imports, changed)
	}
}

func TestAuthFilesManagementServiceRejectsInvalidImportContent(t *testing.T) {
	_, err := buildAuthFileImportsFromTokenContentAt(`{"foo":"bar"}`, time.Date(2026, 7, 2, 0, 0, 0, 0, time.UTC))
	if !errors.Is(err, ErrAuthFilesManagementValidation) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestJoinAuthFilesManagementErrorDedupesContextCancellation(t *testing.T) {
	var joined error

	joined = joinAuthFilesManagementError(joined, context.Canceled)
	joined = joinAuthFilesManagementError(joined, context.Canceled)

	if !errors.Is(joined, context.Canceled) {
		t.Fatalf("expected joined error to contain context cancellation, got %v", joined)
	}
	if strings.Count(joined.Error(), context.Canceled.Error()) != 1 {
		t.Fatalf("expected context cancellation to appear once, got %q", joined.Error())
	}
}

func TestJoinAuthFilesManagementErrorReturnsFirstErrorDirectly(t *testing.T) {
	first := errors.New("first failure")

	if joined := joinAuthFilesManagementError(nil, first); joined != first {
		t.Fatalf("expected first error to be returned directly, got %T %[1]v", joined)
	}
}

func testAuthFileImportJWT(t *testing.T, payload map[string]any) string {
	t.Helper()
	encode := func(value any) string {
		raw, err := json.Marshal(value)
		if err != nil {
			t.Fatalf("marshal jwt part: %v", err)
		}
		return base64.RawURLEncoding.EncodeToString(raw)
	}
	return encode(map[string]any{"alg": "none", "typ": "JWT"}) + "." + encode(payload) + ".sig"
}
