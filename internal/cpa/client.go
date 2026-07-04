package cpa

import (
	"bytes"
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"CLIProxyAPIManager/internal/cpa/dto/apicall"
	"CLIProxyAPIManager/internal/cpa/dto/authfiles"
	"CLIProxyAPIManager/internal/cpa/dto/providerconfig"
	"CLIProxyAPIManager/internal/cpa/dto/response"
)

type Client struct {
	baseURL       string
	managementKey string
	httpClient    *http.Client
}

type authFileStatusRequest struct {
	Name     string `json:"name"`
	Disabled bool   `json:"disabled"`
}

type authFilesDeleteRequest struct {
	Names []string `json:"names"`
}

type authFileProxyURLRequest struct {
	Name     string  `json:"name"`
	ProxyURL *string `json:"proxy_url"`
}

type authFileNoteRequest struct {
	Name string  `json:"name"`
	Note *string `json:"note"`
}

func (c *Client) doJSONRequest(ctx context.Context, path string, target any, kind string, configure func(*http.Request)) (int, []byte, error) {
	return c.doJSONRequestWithBody(ctx, http.MethodGet, path, nil, target, kind, configure)
}

func (c *Client) doJSONRequestWithBody(ctx context.Context, method string, path string, body []byte, target any, kind string, configure func(*http.Request)) (int, []byte, error) {
	if c == nil {
		return 0, nil, fmt.Errorf("cpa client is nil")
	}
	if c.baseURL == "" {
		return 0, nil, fmt.Errorf("cpa base url is required")
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(body))
	if err != nil {
		return 0, nil, fmt.Errorf("build %s request: %w", kind, err)
	}
	if configure != nil {
		configure(req)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return 0, nil, fmt.Errorf("request %s: %w", kind, err)
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, fmt.Errorf("read %s response: %w", kind, err)
	}

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return resp.StatusCode, responseBody, fmt.Errorf("%s request returned status %d", kind, resp.StatusCode)
	}
	if target == nil || isBlankJSONResponseBody(responseBody) {
		return resp.StatusCode, responseBody, nil
	}
	if err := json.Unmarshal(responseBody, target); err != nil {
		return resp.StatusCode, responseBody, fmt.Errorf("decode %s json: %w", kind, err)
	}
	return resp.StatusCode, responseBody, nil
}

func isBlankJSONResponseBody(body []byte) bool {
	return len(bytes.TrimSpace(body)) == 0
}

func (c *Client) doManagementJSONRequest(ctx context.Context, path string, target any, kind string) (int, []byte, error) {
	if c == nil {
		return 0, nil, fmt.Errorf("cpa client is nil")
	}
	if c.managementKey == "" {
		return 0, nil, fmt.Errorf("cpa management key is required")
	}
	return c.doJSONRequest(ctx, path, target, "management "+kind, func(req *http.Request) {
		req.Header.Set("Authorization", "Bearer "+c.managementKey)
	})
}

func (c *Client) doManagementJSONPostRequest(ctx context.Context, path string, requestBody any, target any, kind string) (int, []byte, error) {
	return c.doManagementJSONRequestWithBody(ctx, http.MethodPost, path, requestBody, target, kind)
}

func (c *Client) doManagementJSONRequestWithBody(ctx context.Context, method string, path string, requestBody any, target any, kind string) (int, []byte, error) {
	if c == nil {
		return 0, nil, fmt.Errorf("cpa client is nil")
	}
	if c.managementKey == "" {
		return 0, nil, fmt.Errorf("cpa management key is required")
	}
	body, err := json.Marshal(requestBody)
	if err != nil {
		return 0, nil, fmt.Errorf("encode management %s json: %w", kind, err)
	}
	return c.doJSONRequestWithBody(ctx, method, path, body, target, "management "+kind, func(req *http.Request) {
		req.Header.Set("Authorization", "Bearer "+c.managementKey)
		req.Header.Set("Content-Type", "application/json")
	})
}

func NewClient(baseURL, managementKey string, timeout time.Duration, tlsSkipVerify bool) *Client {
	httpClient := &http.Client{
		Timeout: timeout,
	}
	if tlsSkipVerify {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
		httpClient.Transport = transport
	}
	return &Client{
		baseURL:       strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		managementKey: strings.TrimSpace(managementKey),
		httpClient:    httpClient,
	}
}

func (c *Client) FetchManagementAPIKeys(ctx context.Context) (*response.ManagementAPIKeysResult, error) {
	result := &response.ManagementAPIKeysResult{}
	statusCode, body, err := c.doManagementJSONRequest(ctx, cpaManagementAPIKeysEndpoint, &result.Payload, "api keys")
	result.StatusCode = statusCode
	result.Body = body
	if err != nil {
		return result, err
	}
	return result, nil
}

func (c *Client) FetchUsageQueue(ctx context.Context, count int) (*response.UsageQueueResult, error) {
	result := &response.UsageQueueResult{}
	if count <= 0 {
		return result, fmt.Errorf("usage queue count must be positive")
	}
	queryPath := cpaManagementUsageQueueEndpoint + "?count=" + url.QueryEscape(strconv.Itoa(count))
	statusCode, body, err := c.doManagementJSONRequest(ctx, queryPath, &result.Payload, "usage queue")
	result.StatusCode = statusCode
	result.Body = body
	if err != nil {
		return result, err
	}
	return result, nil
}

func (c *Client) FetchModels(ctx context.Context) (*response.ModelsResult, error) {
	apiKeys, err := c.FetchManagementAPIKeys(ctx)
	if err != nil {
		return &response.ModelsResult{}, err
	}
	apiKey := firstNonEmptyString(apiKeys.Payload.APIKeys)
	if apiKey == "" {
		return &response.ModelsResult{}, fmt.Errorf("cpa api keys are required")
	}

	result := &response.ModelsResult{}
	statusCode, body, err := c.doJSONRequest(ctx, cpaModelsEndpoint, &result.Payload, "models", func(req *http.Request) {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	})
	result.StatusCode = statusCode
	result.Body = body
	if err != nil {
		return result, err
	}
	return result, nil
}

func (c *Client) FetchAuthFiles(ctx context.Context) (*response.AuthFilesResult, error) {
	result := &response.AuthFilesResult{}
	statusCode, body, err := c.doManagementJSONRequest(ctx, cpaManagementAuthFilesEndpoint, &result.Payload, "auth files")
	result.StatusCode = statusCode
	result.Body = body
	if err != nil {
		return result, err
	}
	c.enrichLocalAuthFileMetadata(&result.Payload)
	return result, nil
}

func (c *Client) enrichLocalAuthFileMetadata(payload *authfiles.AuthFilesResponse) {
	if payload == nil || !isLocalBaseURL(c.baseURL) {
		return
	}
	for i := range payload.Files {
		enrichLocalAuthFile(&payload.Files[i])
	}
}

func enrichLocalAuthFile(file *authfiles.AuthFile) {
	if file == nil || strings.TrimSpace(file.Path) == "" {
		return
	}
	info, err := os.Stat(file.Path)
	if err != nil || info.IsDir() || info.Size() > 1024*1024 {
		return
	}
	data, err := os.ReadFile(file.Path)
	if err != nil {
		return
	}
	var local authfiles.AuthFile
	if err := json.Unmarshal(data, &local); err != nil {
		return
	}
	if file.AccountID == "" {
		file.AccountID = local.AccountID
	}
	if file.PlanType == "" {
		file.PlanType = local.PlanType
	}
	if file.WorkspaceName == "" {
		file.WorkspaceName = local.WorkspaceName
	}
	if file.WorkspaceNameCamel == "" {
		file.WorkspaceNameCamel = local.WorkspaceNameCamel
	}
	if file.TeamName == "" {
		file.TeamName = local.TeamName
	}
	if file.TeamNameCamel == "" {
		file.TeamNameCamel = local.TeamNameCamel
	}
	if file.OrganizationName == "" {
		file.OrganizationName = local.OrganizationName
	}
	if file.OrganizationNameCamel == "" {
		file.OrganizationNameCamel = local.OrganizationNameCamel
	}
	if file.OrgName == "" {
		file.OrgName = local.OrgName
	}
	if file.OrgNameCamel == "" {
		file.OrgNameCamel = local.OrgNameCamel
	}
	if file.ProxyURL == "" {
		file.ProxyURL = local.ProxyURL
	}
	if file.CodexAuthMetadata.AccountID == nil {
		file.CodexAuthMetadata.AccountID = local.CodexAuthMetadata.AccountID
	}
	if file.CodexAuthMetadata.AccountIDCamel == nil {
		file.CodexAuthMetadata.AccountIDCamel = local.CodexAuthMetadata.AccountIDCamel
	}
	if file.CodexAuthMetadata.ActiveStart == nil {
		file.CodexAuthMetadata.ActiveStart = local.CodexAuthMetadata.ActiveStart
	}
	if file.CodexAuthMetadata.ActiveStartCamel == nil {
		file.CodexAuthMetadata.ActiveStartCamel = local.CodexAuthMetadata.ActiveStartCamel
	}
	if file.CodexAuthMetadata.ActiveUntil == nil {
		file.CodexAuthMetadata.ActiveUntil = local.CodexAuthMetadata.ActiveUntil
	}
	if file.CodexAuthMetadata.ActiveUntilCamel == nil {
		file.CodexAuthMetadata.ActiveUntilCamel = local.CodexAuthMetadata.ActiveUntilCamel
	}
	if file.CodexAuthMetadata.PlanType == nil {
		file.CodexAuthMetadata.PlanType = local.CodexAuthMetadata.PlanType
	}
	if file.CodexAuthMetadata.PlanTypeCamel == nil {
		file.CodexAuthMetadata.PlanTypeCamel = local.CodexAuthMetadata.PlanTypeCamel
	}
}

func isLocalBaseURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func (c *Client) UpdateAuthFileStatus(ctx context.Context, name string, disabled bool) error {
	_, _, err := c.doManagementJSONRequestWithBody(ctx, http.MethodPatch, cpaManagementAuthFilesStatusEndpoint, authFileStatusRequest{
		Name:     name,
		Disabled: disabled,
	}, nil, "auth file status")
	return err
}

func (c *Client) DeleteAuthFiles(ctx context.Context, names []string) error {
	_, _, err := c.doManagementJSONRequestWithBody(ctx, http.MethodDelete, cpaManagementAuthFilesEndpoint, authFilesDeleteRequest{Names: names}, nil, "auth files delete")
	return err
}

func (c *Client) ImportAuthFile(ctx context.Context, name string, payload map[string]any) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("auth file name is required")
	}
	if len(payload) == 0 {
		return fmt.Errorf("auth file payload is required")
	}
	path := cpaManagementAuthFilesEndpoint + "?name=" + url.QueryEscape(name)
	_, _, err := c.doManagementJSONRequestWithBody(ctx, http.MethodPost, path, payload, nil, "auth file import")
	return err
}

func (c *Client) UpdateAuthFileProxyURL(ctx context.Context, name string, proxyURL *string) error {
	if c == nil {
		return fmt.Errorf("cpa client is nil")
	}
	if isLocalBaseURL(c.baseURL) {
		return c.updateLocalAuthFileProxyURL(ctx, name, proxyURL)
	}
	_, _, err := c.doManagementJSONRequestWithBody(ctx, http.MethodPatch, cpaManagementAuthFilesProxyEndpoint, authFileProxyURLRequest{
		Name:     name,
		ProxyURL: proxyURL,
	}, nil, "auth file proxy url")
	return err
}

func (c *Client) UpdateAuthFileNote(ctx context.Context, name string, note *string) error {
	if c == nil {
		return fmt.Errorf("cpa client is nil")
	}
	if isLocalBaseURL(c.baseURL) {
		return c.updateLocalAuthFileNote(ctx, name, note)
	}
	_, _, err := c.doManagementJSONRequestWithBody(ctx, http.MethodPatch, cpaManagementAuthFilesNoteEndpoint, authFileNoteRequest{
		Name: name,
		Note: note,
	}, nil, "auth file note")
	return err
}

func (c *Client) updateLocalAuthFileProxyURL(ctx context.Context, name string, proxyURL *string) error {
	result, err := c.FetchAuthFiles(ctx)
	if err != nil {
		return err
	}
	targetName := strings.TrimSpace(name)
	for _, file := range result.Payload.Files {
		if authFileMatchesName(file, targetName) {
			return updateAuthFileJSONStringField(file.Path, "proxy_url", proxyURL)
		}
	}
	return fmt.Errorf("auth file %q not found", targetName)
}

func (c *Client) updateLocalAuthFileNote(ctx context.Context, name string, note *string) error {
	result, err := c.FetchAuthFiles(ctx)
	if err != nil {
		return err
	}
	targetName := strings.TrimSpace(name)
	for _, file := range result.Payload.Files {
		if authFileMatchesName(file, targetName) {
			return updateAuthFileJSONStringField(file.Path, "note", note)
		}
	}
	return fmt.Errorf("auth file %q not found", targetName)
}

func authFileMatchesName(file authfiles.AuthFile, name string) bool {
	if name == "" {
		return false
	}
	return strings.TrimSpace(file.Name) == name || strings.TrimSpace(file.AuthIndex) == name || strings.TrimSpace(file.Path) == name
}

func updateAuthFileJSONStringField(path string, key string, value *string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("auth file path is empty")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read auth file: %w", err)
	}
	var payload map[string]any
	if err := json.Unmarshal(data, &payload); err != nil {
		return fmt.Errorf("decode auth file json: %w", err)
	}
	if value == nil || strings.TrimSpace(*value) == "" {
		delete(payload, key)
	} else {
		payload[key] = strings.TrimSpace(*value)
	}
	encoded, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("encode auth file json: %w", err)
	}
	encoded = append(encoded, '\n')
	if err := os.WriteFile(path, encoded, 0o600); err != nil {
		return fmt.Errorf("write auth file: %w", err)
	}
	return nil
}

func (c *Client) CallManagementAPI(ctx context.Context, request apicall.Request) (*apicall.Response, error) {
	result := &apicall.Response{}
	_, _, err := c.doManagementJSONPostRequest(ctx, cpaManagementAPICallEndpoint, request, result, "api call")
	if err != nil {
		return result, err
	}
	return result, nil
}

func (c *Client) FetchGeminiAPIKeys(ctx context.Context) (*response.ProviderKeyConfigResult, error) {
	return c.fetchProviderKeyConfig(ctx, cpaManagementGeminiAPIKeyEndpoint, "gemini-api-key", "gemini api keys")
}

func (c *Client) FetchClaudeAPIKeys(ctx context.Context) (*response.ProviderKeyConfigResult, error) {
	return c.fetchProviderKeyConfig(ctx, cpaManagementClaudeAPIKeyEndpoint, "claude-api-key", "claude api keys")
}

func (c *Client) FetchCodexAPIKeys(ctx context.Context) (*response.ProviderKeyConfigResult, error) {
	return c.fetchProviderKeyConfig(ctx, cpaManagementCodexAPIKeyEndpoint, "codex-api-key", "codex api keys")
}

func (c *Client) FetchVertexAPIKeys(ctx context.Context) (*response.ProviderKeyConfigResult, error) {
	return c.fetchProviderKeyConfig(ctx, cpaManagementVertexAPIKeyEndpoint, "vertex-api-key", "vertex api keys")
}

func (c *Client) fetchProviderKeyConfig(ctx context.Context, path string, payloadKey string, kind string) (*response.ProviderKeyConfigResult, error) {
	result := &response.ProviderKeyConfigResult{}
	var raw json.RawMessage
	statusCode, body, err := c.doManagementJSONRequest(ctx, path, &raw, kind)
	result.StatusCode = statusCode
	result.Body = body
	if err != nil {
		return result, err
	}
	payload, err := decodeProviderKeyConfigPayload(raw, payloadKey)
	if err != nil {
		return result, fmt.Errorf("decode management %s json: %w", kind, err)
	}
	result.Payload = payload
	return result, nil
}

func (c *Client) FetchOpenAICompatibility(ctx context.Context) (*response.OpenAICompatibilityResult, error) {
	result := &response.OpenAICompatibilityResult{}
	var raw json.RawMessage
	statusCode, body, err := c.doManagementJSONRequest(ctx, cpaManagementOpenAICompatibilityEndpoint, &raw, "openai compatibility")
	result.StatusCode = statusCode
	result.Body = body
	if err != nil {
		return result, err
	}
	payload, err := decodeOpenAICompatibilityPayload(raw, "openai-compatibility")
	if err != nil {
		return result, fmt.Errorf("decode management openai compatibility json: %w", err)
	}
	result.Payload = payload
	return result, nil
}

func decodeProviderKeyConfigPayload(raw json.RawMessage, payloadKey string) ([]providerconfig.ProviderKeyConfig, error) {
	var direct []providerconfig.ProviderKeyConfig
	if err := json.Unmarshal(raw, &direct); err == nil {
		return direct, nil
	}
	var wrapped map[string]json.RawMessage
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, err
	}
	payloadRaw, ok := wrapped[payloadKey]
	if !ok {
		return nil, fmt.Errorf("missing %s payload", payloadKey)
	}
	if err := json.Unmarshal(payloadRaw, &direct); err != nil {
		return nil, err
	}
	return direct, nil
}

func decodeOpenAICompatibilityPayload(raw json.RawMessage, payloadKey string) ([]providerconfig.OpenAICompatibilityConfig, error) {
	var direct []providerconfig.OpenAICompatibilityConfig
	if err := json.Unmarshal(raw, &direct); err == nil {
		return direct, nil
	}
	var wrapped map[string]json.RawMessage
	if err := json.Unmarshal(raw, &wrapped); err != nil {
		return nil, err
	}
	payloadRaw, ok := wrapped[payloadKey]
	if !ok {
		return nil, fmt.Errorf("missing %s payload", payloadKey)
	}
	if err := json.Unmarshal(payloadRaw, &direct); err != nil {
		return nil, err
	}
	return direct, nil
}

func firstNonEmptyString(values []string) string {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
