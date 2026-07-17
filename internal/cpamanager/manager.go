package cpamanager

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"gopkg.in/yaml.v3"
)

type Manager struct {
	cfg     Config
	client  *http.Client
	release *releaseClient

	mu     sync.Mutex
	cmd    *exec.Cmd
	events []UpdateEvent
}

func New(cfg Config) *Manager {
	timeout := cfg.RequestTimeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	client := &http.Client{Timeout: timeout}
	return &Manager{
		cfg:     cfg,
		client:  client,
		release: newReleaseClient(cfg.ReleaseRepo, client),
	}
}

func (m *Manager) EnsureInstalled(ctx context.Context) error {
	if m == nil || !m.cfg.Enabled {
		return nil
	}
	if err := os.MkdirAll(m.cfg.WorkDir, 0755); err != nil {
		return err
	}
	if err := m.ensureConfig(); err != nil {
		return err
	}
	if err := m.syncConfig(); err != nil {
		return err
	}
	if _, err := os.Stat(m.cfg.ExePath); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	m.addEvent("download", "CPA executable is missing, downloading latest release", false)
	release, err := m.release.Latest(ctx)
	if err != nil {
		return err
	}
	return m.installRelease(ctx, release)
}

func (m *Manager) Start(ctx context.Context) error {
	if m == nil || !m.cfg.Enabled {
		return fmt.Errorf("CPA manager is disabled")
	}
	if err := m.EnsureInstalled(ctx); err != nil {
		return err
	}
	m.mu.Lock()
	if m.isRunningLocked() {
		m.mu.Unlock()
		return nil
	}
	m.mu.Unlock()
	if m.isManagementEndpointRunning(ctx) {
		return nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if m.isRunningLocked() {
		return nil
	}
	cmd := exec.CommandContext(context.Background(), m.cfg.ExePath, "-config", m.cfg.ConfigPath)
	cmd.Dir = m.cfg.WorkDir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return err
	}
	m.cmd = cmd
	go func() {
		_ = cmd.Wait()
		m.mu.Lock()
		if m.cmd == cmd {
			m.cmd = nil
		}
		m.mu.Unlock()
	}()
	return nil
}

func (m *Manager) Stop(ctx context.Context) error {
	if m == nil || !m.cfg.Enabled {
		return fmt.Errorf("CPA manager is disabled")
	}
	m.mu.Lock()
	cmd := m.cmd
	m.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	if err := cmd.Process.Signal(os.Interrupt); err != nil {
		_ = cmd.Process.Kill()
	}
	deadline := time.NewTimer(5 * time.Second)
	ticker := time.NewTicker(100 * time.Millisecond)
	defer deadline.Stop()
	defer ticker.Stop()
	killed := false
	for {
		m.mu.Lock()
		stopped := m.cmd != cmd
		m.mu.Unlock()
		if stopped {
			return nil
		}
		select {
		case <-ticker.C:
		case <-deadline.C:
			if !killed {
				_ = cmd.Process.Kill()
				killed = true
			}
		case <-ctx.Done():
			_ = cmd.Process.Kill()
			return ctx.Err()
		}
	}
}

func (m *Manager) Restart(ctx context.Context) error {
	if err := m.Stop(ctx); err != nil {
		return err
	}
	return m.Start(ctx)
}

func (m *Manager) Status(ctx context.Context) RuntimeStatus {
	if m == nil {
		return RuntimeStatus{Enabled: false}
	}
	currentVersion := m.CurrentVersion(ctx)
	latestVersion := ""
	releaseNotes := ""
	releaseURL := ""
	updateAvailable := false
	canCompare := false
	message := ""
	if m.cfg.Enabled {
		if release, err := m.release.Latest(ctx); err == nil {
			latestVersion = release.Version
			releaseNotes = release.Notes
			releaseURL = release.URL
			if currentVersion != "" {
				if comparison, ok := CompareVersions(currentVersion, latestVersion); ok {
					canCompare = true
					updateAvailable = comparison < 0
				}
			}
		} else {
			message = err.Error()
		}
	}
	pid := 0
	m.mu.Lock()
	running := m.isRunningLocked()
	if running && m.cmd != nil && m.cmd.Process != nil {
		pid = m.cmd.Process.Pid
	}
	m.mu.Unlock()
	if !running {
		running = m.isManagementEndpointRunning(ctx)
	}
	return RuntimeStatus{
		Enabled:             m.cfg.Enabled,
		Running:             running,
		PID:                 pid,
		ExePath:             m.cfg.ExePath,
		ConfigPath:          m.cfg.ConfigPath,
		CurrentVersion:      currentVersion,
		LatestVersion:       latestVersion,
		ReleaseNotes:        releaseNotes,
		ReleaseURL:          releaseURL,
		UpdateAvailable:     updateAvailable,
		CanCompare:          canCompare,
		Message:             message,
		UpdateCheckInterval: m.cfg.UpdateCheckInterval,
	}
}

func (m *Manager) CurrentVersion(ctx context.Context) string {
	if m == nil || m.cfg.ExePath == "" {
		return ""
	}
	if _, err := os.Stat(m.cfg.ExePath); err != nil {
		return ""
	}
	output, err := exec.CommandContext(ctx, m.cfg.ExePath, "--help").CombinedOutput()
	if err != nil && len(output) == 0 {
		return ""
	}
	return ParseVersionOutput(string(output))
}

func (m *Manager) Update(ctx context.Context) (RuntimeStatus, error) {
	if m == nil || !m.cfg.Enabled {
		return RuntimeStatus{Enabled: false}, fmt.Errorf("CPA manager is disabled")
	}
	m.addEvent("check", "checking latest CPA release", false)
	release, err := m.release.Latest(ctx)
	if err != nil {
		m.addEvent("check", err.Error(), true)
		return m.Status(ctx), err
	}
	currentVersion := m.CurrentVersion(ctx)
	if currentVersion != "" {
		if comparison, ok := CompareVersions(currentVersion, release.Version); ok && comparison >= 0 {
			m.addEvent("check", "CPA is already on the latest version", false)
			return m.Status(ctx), nil
		}
	}
	m.addEvent("download", "downloading CPA "+release.Version, false)
	if err := m.downloadAndReplace(ctx, release); err != nil {
		m.addEvent("update", err.Error(), true)
		return m.Status(ctx), err
	}
	m.addEvent("restart", "restarting CPA", false)
	if err := m.Start(ctx); err != nil {
		m.addEvent("restart", err.Error(), true)
		return m.Status(ctx), err
	}
	m.addEvent("done", "CPA updated to "+release.Version, false)
	return m.Status(ctx), nil
}

func (m *Manager) Events() []UpdateEvent {
	if m == nil {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]UpdateEvent, len(m.events))
	copy(result, m.events)
	return result
}

func (m *Manager) isRunningLocked() bool {
	return m.cmd != nil && m.cmd.Process != nil && m.cmd.ProcessState == nil
}

func (m *Manager) isManagementEndpointRunning(ctx context.Context) bool {
	if m == nil || !m.cfg.Enabled {
		return false
	}
	port := strings.TrimSpace(m.cfg.Port)
	if port == "" {
		port = "18218"
	}
	requestCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%s/v0/management/auth-files", port), nil)
	if err != nil {
		return false
	}
	if key := strings.TrimSpace(m.cfg.ManagementKey); key != "" {
		req.Header.Set("Authorization", "Bearer "+key)
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode < http.StatusInternalServerError
}

func (m *Manager) ensureConfig() error {
	if _, err := os.Stat(m.cfg.ConfigPath); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(m.cfg.ConfigPath), 0755); err != nil {
		return err
	}
	port := strings.TrimSpace(m.cfg.Port)
	if port == "" {
		port = "18218"
	}
	content := fmt.Sprintf(`host: ""
port: %s
remote-management:
  allow-remote: false
  secret-key: "%s"
  disable-control-panel: false
auth-dir: "%s"
api-keys:
  - "replace-with-your-client-api-key"
usage-statistics-enabled: true
logging-to-file: true
`, port, strings.ReplaceAll(m.cfg.ManagementKey, `"`, `\"`), filepath.ToSlash(filepath.Join(m.cfg.WorkDir, "auths")))
	return os.WriteFile(m.cfg.ConfigPath, []byte(content), 0600)
}

func (m *Manager) syncConfig() error {
	if m == nil || m.cfg.ConfigPath == "" {
		return nil
	}
	raw, err := os.ReadFile(m.cfg.ConfigPath)
	if err != nil {
		return err
	}
	var data map[string]any
	if err := yaml.Unmarshal(raw, &data); err != nil {
		return err
	}
	changed := false
	port := strings.TrimSpace(m.cfg.Port)
	if port == "" {
		port = "18218"
	}
	if fmt.Sprint(data["port"]) != port {
		if parsedPort, err := strconv.Atoi(port); err == nil {
			data["port"] = parsedPort
		} else {
			data["port"] = port
		}
		changed = true
	}
	remote, _ := data["remote-management"].(map[string]any)
	if remote == nil {
		remote = map[string]any{}
		data["remote-management"] = remote
		changed = true
	}
	if remote["secret-key"] != m.cfg.ManagementKey {
		remote["secret-key"] = m.cfg.ManagementKey
		changed = true
	}
	if !changed {
		return nil
	}
	backupPath := fmt.Sprintf("%s.bak-%s", m.cfg.ConfigPath, time.Now().Format("20060102150405"))
	_ = os.WriteFile(backupPath, raw, 0600)
	next, err := yaml.Marshal(data)
	if err != nil {
		return err
	}
	return os.WriteFile(m.cfg.ConfigPath, next, 0600)
}

func (m *Manager) installRelease(ctx context.Context, release ReleaseInfo) error {
	zipBytes, err := m.download(ctx, release.ZipURL)
	if err != nil {
		return err
	}
	if err := m.verifyChecksum(ctx, release, zipBytes); err != nil {
		return err
	}
	exeBytes, err := extractCPAExecutable(zipBytes)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(m.cfg.ExePath), 0755); err != nil {
		return err
	}
	return os.WriteFile(m.cfg.ExePath, exeBytes, 0755)
}

func (m *Manager) downloadAndReplace(ctx context.Context, release ReleaseInfo) error {
	zipBytes, err := m.download(ctx, release.ZipURL)
	if err != nil {
		return err
	}
	if err := m.verifyChecksum(ctx, release, zipBytes); err != nil {
		return err
	}
	exeBytes, err := extractCPAExecutable(zipBytes)
	if err != nil {
		return err
	}
	wasRunning := m.Status(ctx).Running
	if err := m.Stop(ctx); err != nil {
		return err
	}
	backupPath := fmt.Sprintf("%s.bak-%s", m.cfg.ExePath, time.Now().Format("20060102150405"))
	if _, err := os.Stat(m.cfg.ExePath); err == nil {
		if err := os.Rename(m.cfg.ExePath, backupPath); err != nil {
			return err
		}
	}
	if err := os.WriteFile(m.cfg.ExePath, exeBytes, 0755); err != nil {
		_ = os.Remove(m.cfg.ExePath)
		if backupPath != "" {
			_ = os.Rename(backupPath, m.cfg.ExePath)
		}
		if wasRunning {
			_ = m.Start(context.Background())
		}
		return err
	}
	return nil
}

func (m *Manager) download(ctx context.Context, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "CLIProxyAPIManager")
	resp, err := m.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("download failed: %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func (m *Manager) verifyChecksum(ctx context.Context, release ReleaseInfo, payload []byte) error {
	if release.ChecksumURL == "" {
		return fmt.Errorf("checksums.txt asset not found")
	}
	checksumBytes, err := m.download(ctx, release.ChecksumURL)
	if err != nil {
		return err
	}
	expected := checksumForAsset(string(checksumBytes), release.AssetName)
	if expected == "" {
		return fmt.Errorf("checksum for %s not found", release.AssetName)
	}
	sum := sha256.Sum256(payload)
	actual := hex.EncodeToString(sum[:])
	if !strings.EqualFold(expected, actual) {
		return fmt.Errorf("checksum mismatch for %s", release.AssetName)
	}
	return nil
}

func checksumForAsset(checksums, assetName string) string {
	for _, line := range strings.Split(checksums, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		if strings.TrimPrefix(fields[len(fields)-1], "*") == assetName {
			return fields[0]
		}
	}
	return ""
}

func extractCPAExecutable(zipBytes []byte) ([]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(zipBytes), int64(len(zipBytes)))
	if err != nil {
		return nil, err
	}
	for _, file := range reader.File {
		if strings.EqualFold(filepath.Base(file.Name), "cli-proxy-api.exe") {
			rc, err := file.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()
			return io.ReadAll(rc)
		}
	}
	return nil, fmt.Errorf("cli-proxy-api.exe not found in release zip")
}

func (m *Manager) addEvent(stage, message string, isError bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.events = append(m.events, UpdateEvent{Time: time.Now(), Stage: stage, Message: message, Error: isError})
	if len(m.events) > 100 {
		m.events = m.events[len(m.events)-100:]
	}
}
