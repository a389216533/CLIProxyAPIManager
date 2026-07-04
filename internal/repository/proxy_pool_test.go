package repository

import (
	"context"
	"testing"
	"time"

	"CLIProxyAPIManager/internal/entities"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestListProxyPoolsIncludesBindingCountAndRecentLatency(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := db.AutoMigrate(&entities.ProxyPool{}, &entities.UsageIdentity{}, &entities.UsageEvent{}); err != nil {
		t.Fatalf("migrate test database: %v", err)
	}

	now := time.Date(2026, 7, 3, 12, 0, 0, 0, time.UTC)
	proxyURL := "socks5://127.0.0.1:1080"
	otherProxyURL := "socks5://127.0.0.1:2080"
	pools := []entities.ProxyPool{
		{Name: "Proxy A", ProxyURL: proxyURL},
		{Name: "Proxy B", ProxyURL: otherProxyURL},
	}
	if err := db.Create(&pools).Error; err != nil {
		t.Fatalf("seed proxy pools: %v", err)
	}
	identities := []entities.UsageIdentity{
		{Name: "auth-a", AuthType: entities.UsageIdentityAuthTypeAuthFile, Identity: "auth-a", ProxyURL: &proxyURL},
		{Name: "auth-b", AuthType: entities.UsageIdentityAuthTypeAuthFile, Identity: "auth-b", ProxyURL: &proxyURL},
		{Name: "auth-c", AuthType: entities.UsageIdentityAuthTypeAuthFile, Identity: "auth-c", ProxyURL: &otherProxyURL},
	}
	if err := db.Create(&identities).Error; err != nil {
		t.Fatalf("seed identities: %v", err)
	}
	ttft90 := int64(90)
	ttft230 := int64(230)
	ttftOld := int64(80)
	ttftZero := int64(0)
	ttftOtherProxy := int64(700)
	events := []entities.UsageEvent{
		{EventKey: "recent-a", AuthIndex: "auth-a", Timestamp: now.Add(-time.Hour), LatencyMS: 100, TTFTMS: &ttft90},
		{EventKey: "recent-b", AuthIndex: "auth-b", Timestamp: now.Add(-2 * time.Hour), LatencyMS: 300, TTFTMS: &ttft230},
		{EventKey: "old-a", AuthIndex: "auth-a", Timestamp: now.Add(-25 * time.Hour), LatencyMS: 900, TTFTMS: &ttftOld},
		{EventKey: "zero-ttft-a", AuthIndex: "auth-a", Timestamp: now.Add(-30 * time.Minute), LatencyMS: 500, TTFTMS: &ttftZero},
		{EventKey: "missing-ttft-a", AuthIndex: "auth-a", Timestamp: now.Add(-20 * time.Minute), LatencyMS: 800},
		{EventKey: "other-proxy", AuthIndex: "auth-c", Timestamp: now.Add(-time.Hour), LatencyMS: 700, TTFTMS: &ttftOtherProxy},
	}
	if err := db.Create(&events).Error; err != nil {
		t.Fatalf("seed events: %v", err)
	}

	result, err := ListProxyPools(context.Background(), db, now)
	if err != nil {
		t.Fatalf("ListProxyPools returned error: %v", err)
	}
	if len(result) != 2 {
		t.Fatalf("expected 2 proxy pools, got %d", len(result))
	}
	if result[0].BoundAuthFileCount != 2 {
		t.Fatalf("expected Proxy A bound count 2, got %d", result[0].BoundAuthFileCount)
	}
	if result[0].AverageLatencyMS == nil {
		t.Fatal("expected Proxy A average first response latency 160ms, got nil")
	}
	if *result[0].AverageLatencyMS != 160 {
		t.Fatalf("expected Proxy A average first response latency 160ms, got %d", *result[0].AverageLatencyMS)
	}
	if result[0].LatencySource != "recent_usage" {
		t.Fatalf("expected Proxy A latency source recent_usage, got %q", result[0].LatencySource)
	}
	if result[1].BoundAuthFileCount != 1 {
		t.Fatalf("expected Proxy B bound count 1, got %d", result[1].BoundAuthFileCount)
	}
}
