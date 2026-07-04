package api

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"CLIProxyAPIManager/internal/config"
	"golang.org/x/crypto/bcrypt"
)

func TestConfigDiagnosticsRoutesReturnLoadedConfigState(t *testing.T) {
	tempDir := t.TempDir()
	cpaDir := filepath.Join(tempDir, "cpa")
	if err := os.MkdirAll(cpaDir, 0o755); err != nil {
		t.Fatalf("mkdir cpa dir: %v", err)
	}
	envPath := filepath.Join(tempDir, ".env")
	sqlitePath := filepath.Join(tempDir, "app.db")
	cpaExePath := filepath.Join(cpaDir, "cli-proxy-api.exe")
	cpaConfigPath := filepath.Join(cpaDir, "config.yaml")
	if err := os.WriteFile(envPath, []byte("APP_PORT=18217\n"), 0o600); err != nil {
		t.Fatalf("write env: %v", err)
	}
	if err := os.WriteFile(sqlitePath, []byte("db"), 0o600); err != nil {
		t.Fatalf("write sqlite: %v", err)
	}
	if err := os.WriteFile(cpaExePath, []byte("exe"), 0o600); err != nil {
		t.Fatalf("write cpa exe: %v", err)
	}
	secretHash, err := bcrypt.GenerateFromPassword([]byte("management-secret"), bcrypt.MinCost)
	if err != nil {
		t.Fatalf("hash secret: %v", err)
	}
	cpaConfig := "api-keys:\n  - replace-with-your-client-api-key\nport: 18218\nusage-statistics-enabled: true\nlogging-to-file: true\nauth-dir: " + filepath.ToSlash(filepath.Join(cpaDir, "auths")) + "\nremote-management:\n  secret-key: " + string(secretHash) + "\nrouting:\n  strategy: fill-first\n"
	if err := os.WriteFile(cpaConfigPath, []byte(cpaConfig), 0o600); err != nil {
		t.Fatalf("write cpa config: %v", err)
	}

	cfg := &config.Config{
		AppPort:           "18217",
		WebHost:           "0.0.0.0",
		CPABaseURL:        "http://127.0.0.1:18218",
		CPAManagementKey:  "management-secret",
		AuthEnabled:       true,
		LoginPassword:     "manager-secret",
		CPAManagedEnabled: true,
		CPAAutoStart:      true,
		EnvFile:           envPath,
		WorkDir:           tempDir,
		SQLitePath:        sqlitePath,
		CPAWorkDir:        cpaDir,
		CPAExePath:        cpaExePath,
		CPAConfigPath:     cpaConfigPath,
	}
	router := NewRouter(nil, nil, nil, nil, AuthConfig{}, nil, "", OptionalProviders{Config: cfg})

	statusResp := httptest.NewRecorder()
	router.ServeHTTP(statusResp, httptest.NewRequest(http.MethodGet, "/api/v1/config/status", nil))
	if statusResp.Code != http.StatusOK || !strings.Contains(statusResp.Body.String(), `"ok":true`) || !strings.Contains(statusResp.Body.String(), `"status":"正常"`) {
		t.Fatalf("unexpected status response: %d %s", statusResp.Code, statusResp.Body.String())
	}

	diagnosticsResp := httptest.NewRecorder()
	router.ServeHTTP(diagnosticsResp, httptest.NewRequest(http.MethodGet, "/api/v1/config/diagnostics", nil))
	body := diagnosticsResp.Body.String()
	if diagnosticsResp.Code != http.StatusOK || !strings.Contains(body, `"code":"cpa.config.management_key"`) || !strings.Contains(body, `"code":"cpa.config.usage_statistics"`) {
		t.Fatalf("unexpected diagnostics response: %d %s", diagnosticsResp.Code, body)
	}
	if strings.Contains(body, "management-secret") || strings.Contains(body, string(secretHash)) || strings.Contains(body, "manager-secret") {
		t.Fatalf("diagnostics response leaked a secret: %s", body)
	}
}

func TestConfigDiagnosticsDetectsCPAConfigMismatch(t *testing.T) {
	tempDir := t.TempDir()
	cpaConfigPath := filepath.Join(tempDir, "config.yaml")
	if err := os.WriteFile(cpaConfigPath, []byte("port: 18219\nusage-statistics-enabled: false\nremote-management:\n  secret-key: wrong-secret\n"), 0o600); err != nil {
		t.Fatalf("write cpa config: %v", err)
	}
	cfg := &config.Config{
		AppPort:           "18217",
		WebHost:           "0.0.0.0",
		CPABaseURL:        "http://127.0.0.1:18218",
		CPAManagementKey:  "management-secret",
		AuthEnabled:       true,
		LoginPassword:     "manager-secret",
		CPAManagedEnabled: true,
		CPAAutoStart:      true,
		WorkDir:           tempDir,
		CPAWorkDir:        tempDir,
		CPAConfigPath:     cpaConfigPath,
		AuthSessionTTL:    time.Hour,
	}

	diagnostics := buildConfigDiagnostics(cfg)
	if diagnostics.OK || diagnostics.Status != "异常" {
		t.Fatalf("expected unhealthy diagnostics, got %+v", diagnostics)
	}
	foundPortMismatch := false
	foundSecretMismatch := false
	for _, check := range diagnostics.Checks {
		if check.Code == "cpa.config.port" && !check.OK {
			foundPortMismatch = true
		}
		if check.Code == "cpa.config.management_key" && !check.OK {
			foundSecretMismatch = true
		}
	}
	if !foundPortMismatch || !foundSecretMismatch {
		t.Fatalf("expected port and secret mismatch checks, got %+v", diagnostics.Checks)
	}
}
