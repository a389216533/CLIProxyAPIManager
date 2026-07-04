package service

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

func TestProxyPoolURLProbeReturnsThreeSuccessfulTargets(t *testing.T) {
	result, err := testProxyURLWithOptions(context.Background(), "socks5://127.0.0.1:1080", proxyPoolProbeOptions{
		targets: proxyPoolProbeTestTargets(),
		client: proxyPoolProbeHTTPClient(map[string]int{
			"https://latency.test": 204,
			"https://gpt.test":     302,
			"https://claude.test":  200,
		}),
		timeout: time.Second,
	})
	if err != nil {
		t.Fatalf("testProxyURLWithOptions returned error: %v", err)
	}

	if result.DurationMS <= 0 {
		t.Fatalf("expected compatible duration_ms from latency target, got %d", result.DurationMS)
	}
	if !result.Targets.Latency.OK || result.Targets.Latency.StatusCode != 204 {
		t.Fatalf("expected latency target success, got %+v", result.Targets.Latency)
	}
	if !result.Targets.GPT.OK || result.Targets.GPT.StatusCode != 302 {
		t.Fatalf("expected gpt target success, got %+v", result.Targets.GPT)
	}
	if !result.Targets.Claude.OK || result.Targets.Claude.StatusCode != 200 {
		t.Fatalf("expected claude target success, got %+v", result.Targets.Claude)
	}
}

func TestProxyPoolURLProbeUsesAPIReachabilityTargets(t *testing.T) {
	result, err := testProxyURLWithOptions(context.Background(), "socks5://127.0.0.1:1080", proxyPoolProbeOptions{
		client: proxyPoolProbeHTTPClient(map[string]int{
			"https://www.gstatic.com/generate_204": 204,
			"https://api.openai.com/v1/models":     401,
			"https://api.anthropic.com/v1/models":  401,
		}),
		timeout: time.Second,
	})
	if err != nil {
		t.Fatalf("testProxyURLWithOptions returned error: %v", err)
	}

	if !result.Targets.GPT.OK || result.Targets.GPT.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected OpenAI API 401 to prove GPT reachability, got %+v", result.Targets.GPT)
	}
	if !result.Targets.Claude.OK || result.Targets.Claude.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected Anthropic API 401 to prove Claude reachability, got %+v", result.Targets.Claude)
	}
}

func TestProxyPoolURLProbeKeepsOverallSuccessWhenOneTargetFails(t *testing.T) {
	result, err := testProxyURLWithOptions(context.Background(), "socks5://127.0.0.1:1080", proxyPoolProbeOptions{
		targets: proxyPoolProbeTestTargets(),
		client: proxyPoolProbeHTTPClient(map[string]int{
			"https://latency.test": 204,
			"https://gpt.test":     503,
			"https://claude.test":  200,
		}),
		timeout: time.Second,
	})
	if err != nil {
		t.Fatalf("testProxyURLWithOptions returned error: %v", err)
	}

	if result.DurationMS <= 0 {
		t.Fatalf("expected compatible duration_ms from latency target, got %d", result.DurationMS)
	}
	if result.Targets.GPT.OK {
		t.Fatalf("expected gpt target failure, got %+v", result.Targets.GPT)
	}
	if result.Targets.GPT.StatusCode != 503 || !strings.Contains(result.Targets.GPT.Error, "status 503") {
		t.Fatalf("expected gpt target status error, got %+v", result.Targets.GPT)
	}
	if !result.Targets.Latency.OK || !result.Targets.Claude.OK {
		t.Fatalf("expected other targets to remain successful, got %+v", result.Targets)
	}
}

func TestProxyPoolURLProbeReturnsTargetResultsWhenAllTargetsFail(t *testing.T) {
	result, err := testProxyURLWithOptions(context.Background(), "socks5://127.0.0.1:1080", proxyPoolProbeOptions{
		targets: proxyPoolProbeTestTargets(),
		client: proxyPoolProbeHTTPClient(map[string]int{
			"https://latency.test": 500,
			"https://gpt.test":     429,
			"https://claude.test":  403,
		}),
		timeout: time.Second,
	})
	if err != nil {
		t.Fatalf("testProxyURLWithOptions returned error: %v", err)
	}

	if result.DurationMS != 0 {
		t.Fatalf("expected compatible duration_ms 0 when latency target fails, got %d", result.DurationMS)
	}
	if result.Targets.Latency.OK || result.Targets.GPT.OK || result.Targets.Claude.OK {
		t.Fatalf("expected all targets to fail, got %+v", result.Targets)
	}
	if result.Targets.Latency.StatusCode != 500 || result.Targets.GPT.StatusCode != 429 || result.Targets.Claude.StatusCode != 403 {
		t.Fatalf("expected failed status codes to be preserved, got %+v", result.Targets)
	}
}

func TestProxyPoolURLProbeRejectsInvalidProxyURL(t *testing.T) {
	_, err := testProxyURLWithOptions(context.Background(), "not-a-proxy-url", proxyPoolProbeOptions{
		targets: proxyPoolProbeTestTargets(),
		client:  proxyPoolProbeHTTPClient(nil),
		timeout: time.Second,
	})
	if !errors.Is(err, ErrProxyPoolValidation) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func proxyPoolProbeTestTargets() []proxyPoolProbeTarget {
	return []proxyPoolProbeTarget{
		{key: proxyPoolTargetLatency, url: "https://latency.test"},
		{key: proxyPoolTargetGPT, url: "https://gpt.test"},
		{key: proxyPoolTargetClaude, url: "https://claude.test"},
	}
}

func proxyPoolProbeHTTPClient(statusByURL map[string]int) *http.Client {
	return &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		statusCode, ok := statusByURL[req.URL.String()]
		if !ok {
			return nil, errors.New("unexpected target URL: " + req.URL.String())
		}
		return &http.Response{
			StatusCode: statusCode,
			Body:       io.NopCloser(strings.NewReader("ok")),
			Header:     make(http.Header),
			Request:    req,
		}, nil
	})}
}
