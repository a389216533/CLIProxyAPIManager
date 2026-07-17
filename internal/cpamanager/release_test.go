package cpamanager

import (
	"context"
	"io"
	"net/http"
	"runtime"
	"strings"
	"testing"
)

func TestReleaseClientLatestIncludesReleaseNotesAndURL(t *testing.T) {
	arch := runtime.GOARCH
	if arch == "arm64" {
		arch = "aarch64"
	}
	if arch != "amd64" && arch != "aarch64" {
		t.Skipf("unsupported test architecture: %s", runtime.GOARCH)
	}

	client := &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.Path != "/repos/router-for-me/CLIProxyAPI/releases/latest" {
			t.Fatalf("unexpected release path: %s", req.URL.Path)
		}
		body := `{
			"tag_name":"v1.2.3",
			"body":"## Changes\n- Added update dialog",
			"html_url":"https://github.com/router-for-me/CLIProxyAPI/releases/tag/v1.2.3",
			"assets":[
				{"name":"checksums.txt","browser_download_url":"https://example.com/checksums.txt"},
				{"name":"CLIProxyAPI_1.2.3_windows_` + arch + `.zip","browser_download_url":"https://example.com/cpa.zip"}
			]
		}`
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: http.Header{}}, nil
	})}

	release, err := newReleaseClient("router-for-me/CLIProxyAPI", client).Latest(context.Background())
	if err != nil {
		t.Fatalf("Latest returned error: %v", err)
	}
	if release.Version != "v1.2.3" || release.Notes != "## Changes\n- Added update dialog" {
		t.Fatalf("unexpected release metadata: %+v", release)
	}
	if release.URL != "https://github.com/router-for-me/CLIProxyAPI/releases/tag/v1.2.3" {
		t.Fatalf("unexpected release URL: %q", release.URL)
	}
	if release.ZipURL != "https://example.com/cpa.zip" || release.ChecksumURL != "https://example.com/checksums.txt" {
		t.Fatalf("unexpected release assets: %+v", release)
	}
}
