package cpamanager

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"runtime"
	"strings"
)

const githubAPIBaseURL = "https://api.github.com"

type releaseClient struct {
	repo   string
	client *http.Client
}

type githubRelease struct {
	TagName string `json:"tag_name"`
	Body    string `json:"body"`
	HTMLURL string `json:"html_url"`
	Assets  []struct {
		Name string `json:"name"`
		URL  string `json:"browser_download_url"`
	} `json:"assets"`
}

func newReleaseClient(repo string, client *http.Client) *releaseClient {
	if strings.TrimSpace(repo) == "" {
		repo = "router-for-me/CLIProxyAPI"
	}
	if client == nil {
		client = http.DefaultClient
	}
	return &releaseClient{repo: strings.TrimSpace(repo), client: client}
}

func (c *releaseClient) Latest(ctx context.Context) (ReleaseInfo, error) {
	url := fmt.Sprintf("%s/repos/%s/releases/latest", githubAPIBaseURL, c.repo)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return ReleaseInfo{}, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "CLIProxyAPIManager")
	resp, err := c.client.Do(req)
	if err != nil {
		return ReleaseInfo{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return ReleaseInfo{}, fmt.Errorf("github release request failed: %d", resp.StatusCode)
	}
	var payload githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return ReleaseInfo{}, err
	}
	arch := runtime.GOARCH
	if arch == "arm64" {
		arch = "aarch64"
	}
	if arch != "amd64" && arch != "aarch64" {
		return ReleaseInfo{}, fmt.Errorf("unsupported windows architecture: %s", runtime.GOARCH)
	}
	assetSuffix := fmt.Sprintf("windows_%s.zip", arch)
	var result ReleaseInfo
	result.Version = strings.TrimSpace(payload.TagName)
	result.Notes = strings.TrimSpace(payload.Body)
	result.URL = strings.TrimSpace(payload.HTMLURL)
	for _, asset := range payload.Assets {
		if strings.EqualFold(asset.Name, "checksums.txt") {
			result.ChecksumURL = asset.URL
			continue
		}
		if strings.HasSuffix(strings.ToLower(asset.Name), assetSuffix) {
			result.AssetName = asset.Name
			result.ZipURL = asset.URL
		}
	}
	if result.Version == "" || result.ZipURL == "" {
		return ReleaseInfo{}, fmt.Errorf("matching CPA windows asset not found")
	}
	return result, nil
}
