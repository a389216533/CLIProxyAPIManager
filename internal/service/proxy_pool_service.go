package service

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"CLIProxyAPIManager/internal/entities"
	"CLIProxyAPIManager/internal/repository"

	"gorm.io/gorm"
)

var ErrProxyPoolValidation = errors.New("proxy pool validation failed")

type ProxyPoolProvider interface {
	ListProxyPools(context.Context) ([]entities.ProxyPool, error)
	CreateProxyPool(context.Context, ProxyPoolInput) (entities.ProxyPool, error)
	UpdateProxyPool(context.Context, int64, ProxyPoolInput) (entities.ProxyPool, error)
	DeleteProxyPool(context.Context, int64) error
	TestProxyPool(context.Context, int64) (ProxyPoolTestResult, error)
}

type ProxyPoolInput struct {
	Name     string
	ProxyURL string
}

type ProxyPoolTestResult struct {
	IP         string
	Address    string
	Country    string
	Region     string
	City       string
	Org        string
	CheckedAt  time.Time
	DurationMS int64
	Targets    ProxyPoolTestTargets
}

type proxyPoolService struct {
	db *gorm.DB
}

type ProxyPoolTargetResult struct {
	OK         bool
	DurationMS int64
	StatusCode int
	Error      string
	URL        string
}

type ProxyPoolTestTargets struct {
	Latency ProxyPoolTargetResult
	GPT     ProxyPoolTargetResult
	Claude  ProxyPoolTargetResult
}

type proxyPoolTargetKey string

const (
	proxyPoolTargetLatency proxyPoolTargetKey = "latency"
	proxyPoolTargetGPT     proxyPoolTargetKey = "gpt"
	proxyPoolTargetClaude  proxyPoolTargetKey = "claude"
)

type proxyPoolProbeTarget struct {
	key                 proxyPoolTargetKey
	url                 string
	headers             map[string]string
	reachableStatusCode map[int]struct{}
}

type proxyPoolProbeOptions struct {
	targets []proxyPoolProbeTarget
	client  *http.Client
	timeout time.Duration
}

var defaultProxyPoolProbeTargets = []proxyPoolProbeTarget{
	{key: proxyPoolTargetLatency, url: "https://www.gstatic.com/generate_204"},
	{key: proxyPoolTargetGPT, url: "https://api.openai.com/v1/models", reachableStatusCode: map[int]struct{}{http.StatusUnauthorized: {}}},
	{key: proxyPoolTargetClaude, url: "https://api.anthropic.com/v1/models", headers: map[string]string{"anthropic-version": "2023-06-01"}, reachableStatusCode: map[int]struct{}{http.StatusUnauthorized: {}}},
}

func NewProxyPoolService(db *gorm.DB) ProxyPoolProvider {
	return &proxyPoolService{db: db}
}

func (s *proxyPoolService) ListProxyPools(ctx context.Context) ([]entities.ProxyPool, error) {
	return repository.ListProxyPools(ctx, s.db)
}

func (s *proxyPoolService) CreateProxyPool(ctx context.Context, input ProxyPoolInput) (entities.ProxyPool, error) {
	pool, err := validateProxyPoolInput(input)
	if err != nil {
		return entities.ProxyPool{}, err
	}
	return repository.CreateProxyPool(ctx, s.db, pool)
}

func (s *proxyPoolService) UpdateProxyPool(ctx context.Context, id int64, input ProxyPoolInput) (entities.ProxyPool, error) {
	if id <= 0 {
		return entities.ProxyPool{}, ErrInvalidID
	}
	pool, err := validateProxyPoolInput(input)
	if err != nil {
		return entities.ProxyPool{}, err
	}
	return repository.UpdateProxyPool(ctx, s.db, id, pool)
}

func (s *proxyPoolService) DeleteProxyPool(ctx context.Context, id int64) error {
	if id <= 0 {
		return ErrInvalidID
	}
	return repository.DeleteProxyPool(ctx, s.db, id)
}

func (s *proxyPoolService) TestProxyPool(ctx context.Context, id int64) (ProxyPoolTestResult, error) {
	if id <= 0 {
		return ProxyPoolTestResult{}, ErrInvalidID
	}
	pool, err := repository.FindProxyPoolByID(ctx, s.db, id)
	if err != nil {
		return ProxyPoolTestResult{}, err
	}
	return testProxyURL(ctx, pool.ProxyURL)
}

func validateProxyPoolInput(input ProxyPoolInput) (entities.ProxyPool, error) {
	name := strings.TrimSpace(input.Name)
	proxyURL := strings.TrimSpace(input.ProxyURL)
	if name == "" {
		return entities.ProxyPool{}, fmt.Errorf("%w: name is required", ErrProxyPoolValidation)
	}
	if proxyURL == "" {
		return entities.ProxyPool{}, fmt.Errorf("%w: proxy_url is required", ErrProxyPoolValidation)
	}
	if !looksLikeProxyURL(proxyURL) {
		return entities.ProxyPool{}, fmt.Errorf("%w: proxy_url is invalid", ErrProxyPoolValidation)
	}
	return entities.ProxyPool{Name: name, ProxyURL: proxyURL}, nil
}

func looksLikeProxyURL(proxyURL string) bool {
	if strings.ContainsAny(proxyURL, " \t\r\n") {
		return false
	}
	scheme, rest, ok := strings.Cut(proxyURL, "://")
	if !ok || strings.TrimSpace(scheme) == "" || strings.TrimSpace(rest) == "" {
		return false
	}
	return true
}

func testProxyURL(ctx context.Context, rawProxyURL string) (ProxyPoolTestResult, error) {
	return testProxyURLWithOptions(ctx, rawProxyURL, proxyPoolProbeOptions{})
}

func testProxyURLWithOptions(ctx context.Context, rawProxyURL string, options proxyPoolProbeOptions) (ProxyPoolTestResult, error) {
	parsedProxyURL, err := url.Parse(strings.TrimSpace(rawProxyURL))
	if err != nil || parsedProxyURL.Scheme == "" || parsedProxyURL.Host == "" {
		return ProxyPoolTestResult{}, fmt.Errorf("%w: proxy_url is invalid", ErrProxyPoolValidation)
	}
	targets := options.targets
	if len(targets) == 0 {
		targets = defaultProxyPoolProbeTargets
	}
	timeout := options.timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	client := options.client
	if client == nil {
		client = &http.Client{
			Timeout: timeout,
			Transport: &http.Transport{
				Proxy: http.ProxyURL(parsedProxyURL),
			},
		}
	}

	type probeResult struct {
		key    proxyPoolTargetKey
		result ProxyPoolTargetResult
	}
	results := make(chan probeResult, len(targets))
	var wg sync.WaitGroup
	for _, target := range targets {
		target := target
		wg.Add(1)
		go func() {
			defer wg.Done()
			results <- probeResult{key: target.key, result: probeProxyTarget(ctx, client, target, timeout)}
		}()
	}
	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
		close(results)
	}()

	select {
	case <-ctx.Done():
		return ProxyPoolTestResult{}, ctx.Err()
	case <-done:
	}

	result := ProxyPoolTestResult{CheckedAt: time.Now()}
	for item := range results {
		switch item.key {
		case proxyPoolTargetLatency:
			result.Targets.Latency = item.result
		case proxyPoolTargetGPT:
			result.Targets.GPT = item.result
		case proxyPoolTargetClaude:
			result.Targets.Claude = item.result
		}
	}
	if result.Targets.Latency.OK {
		result.DurationMS = result.Targets.Latency.DurationMS
	}
	return result, nil
}

func probeProxyTarget(ctx context.Context, client *http.Client, target proxyPoolProbeTarget, timeout time.Duration) ProxyPoolTargetResult {
	result := ProxyPoolTargetResult{URL: target.url}
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestCtx, http.MethodGet, target.url, nil)
	if err != nil {
		result.Error = fmt.Sprintf("build request: %v", err)
		return result
	}
	for key, value := range target.headers {
		req.Header.Set(key, value)
	}
	startedAt := time.Now()
	resp, err := client.Do(req)
	result.DurationMS = elapsedMilliseconds(startedAt)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	defer resp.Body.Close()
	result.StatusCode = resp.StatusCode
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 512))
	if !isProxyProbeReachableStatus(target, resp.StatusCode) {
		result.Error = fmt.Sprintf("status %d", resp.StatusCode)
		return result
	}
	result.OK = true
	return result
}

func isProxyProbeReachableStatus(target proxyPoolProbeTarget, statusCode int) bool {
	if statusCode >= http.StatusOK && statusCode < http.StatusBadRequest {
		return true
	}
	_, ok := target.reachableStatusCode[statusCode]
	return ok
}

func elapsedMilliseconds(startedAt time.Time) int64 {
	durationMS := time.Since(startedAt).Milliseconds()
	if durationMS <= 0 {
		return 1
	}
	return durationMS
}
