package cpamanager

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestChecksumForAsset(t *testing.T) {
	checksums := "abc123  CLIProxyAPI_1.2.3_windows_amd64.zip\nignored  other.zip\n"
	if got := checksumForAsset(checksums, "CLIProxyAPI_1.2.3_windows_amd64.zip"); got != "abc123" {
		t.Fatalf("expected checksum abc123, got %q", got)
	}
}

func TestExtractCPAExecutable(t *testing.T) {
	var buf bytes.Buffer
	writer := zip.NewWriter(&buf)
	file, err := writer.Create("cli-proxy-api.exe")
	if err != nil {
		t.Fatalf("create zip entry: %v", err)
	}
	if _, err := file.Write([]byte("exe")); err != nil {
		t.Fatalf("write zip entry: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	got, err := extractCPAExecutable(buf.Bytes())
	if err != nil {
		t.Fatalf("extract executable: %v", err)
	}
	if string(got) != "exe" {
		t.Fatalf("expected exe payload, got %q", string(got))
	}
}

func TestChecksumForReleasePayload(t *testing.T) {
	payload := []byte("payload")
	sum := sha256.Sum256(payload)
	checksums := hex.EncodeToString(sum[:]) + " *asset.zip\n"
	if got := checksumForAsset(checksums, "asset.zip"); got != hex.EncodeToString(sum[:]) {
		t.Fatalf("expected matching checksum, got %q", got)
	}
}

func TestEnsureConfigUsesConfiguredPortAndManagementKey(t *testing.T) {
	dir := t.TempDir()
	manager := New(Config{
		Enabled:       true,
		WorkDir:       dir,
		ConfigPath:    filepath.Join(dir, "config.yaml"),
		ManagementKey: "cpa-secret-123",
		Port:          "18218",
	})

	if err := manager.ensureConfig(); err != nil {
		t.Fatalf("ensureConfig returned error: %v", err)
	}

	content, err := os.ReadFile(filepath.Join(dir, "config.yaml"))
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	text := string(content)
	for _, expected := range []string{"port: 18218", `secret-key: "cpa-secret-123"`, "usage-statistics-enabled: true", "logging-to-file: true"} {
		if !strings.Contains(text, expected) {
			t.Fatalf("expected config to contain %q, got:\n%s", expected, text)
		}
	}
}

func TestSyncConfigUpdatesExistingPortAndManagementKey(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(configPath, []byte("port: 8317\nremote-management:\n  secret-key: old-secret\nusage-statistics-enabled: true\n"), 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	manager := New(Config{
		Enabled:       true,
		WorkDir:       dir,
		ConfigPath:    configPath,
		ManagementKey: "new-secret",
		Port:          "18218",
	})

	if err := manager.syncConfig(); err != nil {
		t.Fatalf("syncConfig returned error: %v", err)
	}

	content, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	text := string(content)
	if !strings.Contains(text, "port: 18218") || !strings.Contains(text, "secret-key: new-secret") {
		t.Fatalf("expected synced config, got:\n%s", text)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read dir: %v", err)
	}
	hasBackup := false
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "config.yaml.bak-") {
			hasBackup = true
		}
	}
	if !hasBackup {
		t.Fatal("expected config backup to be created")
	}
}

func TestStatusTreatsReachableManagementEndpointAsRunning(t *testing.T) {
	manager := New(Config{Enabled: true, Port: "18218", ManagementKey: "secret"})
	manager.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Hostname() == "127.0.0.1" {
			if req.URL.Path != "/v0/management/auth-files" {
				t.Fatalf("unexpected management path: %s", req.URL.Path)
			}
			if got := req.Header.Get("Authorization"); got != "Bearer secret" {
				t.Fatalf("unexpected authorization header: %q", got)
			}
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"files":[]}`)), Header: http.Header{}}, nil
		}
		return &http.Response{StatusCode: http.StatusForbidden, Body: io.NopCloser(strings.NewReader("forbidden")), Header: http.Header{}}, nil
	})}
	manager.release.client = manager.client

	status := manager.Status(context.Background())
	if !status.Running {
		t.Fatalf("expected reachable management endpoint to mark CPA running: %+v", status)
	}
	if status.PID != 0 {
		t.Fatalf("expected no tracked pid for externally running CPA, got %d", status.PID)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}
