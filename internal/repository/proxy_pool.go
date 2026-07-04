package repository

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"CLIProxyAPIManager/internal/entities"
	"CLIProxyAPIManager/internal/timeutil"

	"gorm.io/gorm"
)

func ListProxyPools(ctx context.Context, db *gorm.DB, anchors ...time.Time) ([]entities.ProxyPool, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	var pools []entities.ProxyPool
	if err := db.WithContext(ctx).Order("LOWER(name) ASC, id ASC").Find(&pools).Error; err != nil {
		return nil, fmt.Errorf("list proxy pools: %w", err)
	}
	anchor := time.Now()
	if len(anchors) > 0 && !anchors[0].IsZero() {
		anchor = anchors[0]
	}
	if err := attachProxyPoolStats(ctx, db, pools, anchor); err != nil {
		return nil, err
	}
	return pools, nil
}

func attachProxyPoolStats(ctx context.Context, db *gorm.DB, pools []entities.ProxyPool, anchor time.Time) error {
	if len(pools) == 0 {
		return nil
	}
	proxyURLs := make([]string, 0, len(pools))
	indexByProxyURL := make(map[string]int, len(pools))
	for index, pool := range pools {
		proxyURL := strings.TrimSpace(pool.ProxyURL)
		if proxyURL == "" {
			continue
		}
		proxyURLs = append(proxyURLs, proxyURL)
		indexByProxyURL[proxyURL] = index
	}
	if len(proxyURLs) == 0 {
		return nil
	}

	var boundRows []struct {
		ProxyURL string
		Count    int64
	}
	if err := db.WithContext(ctx).
		Model(&entities.UsageIdentity{}).
		Select("proxy_url, COUNT(*) AS count").
		Where("auth_type = ? AND is_deleted = ? AND proxy_url IN ?", entities.UsageIdentityAuthTypeAuthFile, false, proxyURLs).
		Group("proxy_url").
		Scan(&boundRows).Error; err != nil {
		return fmt.Errorf("load proxy pool bound auth file counts: %w", err)
	}
	for _, row := range boundRows {
		if index, ok := indexByProxyURL[row.ProxyURL]; ok {
			pools[index].BoundAuthFileCount = row.Count
		}
	}

	var latencyRows []struct {
		ProxyURL  string
		AverageMS float64
	}
	if err := db.WithContext(ctx).
		Table("usage_events").
		Select("usage_identities.proxy_url AS proxy_url, AVG(usage_events.ttft_ms) AS average_ms").
		Joins("JOIN usage_identities ON usage_identities.identity = usage_events.auth_index").
		Where("usage_identities.auth_type = ? AND usage_identities.is_deleted = ? AND usage_identities.proxy_url IN ?", entities.UsageIdentityAuthTypeAuthFile, false, proxyURLs).
		Where("usage_events.timestamp >= ? AND usage_events.ttft_ms > 0", timeutil.FormatStorageTime(anchor.Add(-24*time.Hour))).
		Group("usage_identities.proxy_url").
		Scan(&latencyRows).Error; err != nil {
		return fmt.Errorf("load proxy pool recent latency: %w", err)
	}
	for _, row := range latencyRows {
		if index, ok := indexByProxyURL[row.ProxyURL]; ok {
			averageMS := int64(math.Round(row.AverageMS))
			pools[index].AverageLatencyMS = &averageMS
			pools[index].LatencySource = "recent_usage"
		}
	}

	return nil
}

func CreateProxyPool(ctx context.Context, db *gorm.DB, pool entities.ProxyPool) (entities.ProxyPool, error) {
	if db == nil {
		return entities.ProxyPool{}, fmt.Errorf("database is nil")
	}
	pool.ID = 0
	pool.Name = strings.TrimSpace(pool.Name)
	pool.ProxyURL = strings.TrimSpace(pool.ProxyURL)
	if err := db.WithContext(ctx).Create(&pool).Error; err != nil {
		return entities.ProxyPool{}, fmt.Errorf("create proxy pool: %w", err)
	}
	return pool, nil
}

func UpdateProxyPool(ctx context.Context, db *gorm.DB, id int64, pool entities.ProxyPool) (entities.ProxyPool, error) {
	if db == nil {
		return entities.ProxyPool{}, fmt.Errorf("database is nil")
	}
	updates := map[string]any{
		"name":      strings.TrimSpace(pool.Name),
		"proxy_url": strings.TrimSpace(pool.ProxyURL),
	}
	result := db.WithContext(ctx).Model(&entities.ProxyPool{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return entities.ProxyPool{}, fmt.Errorf("update proxy pool: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return entities.ProxyPool{}, gorm.ErrRecordNotFound
	}
	var updated entities.ProxyPool
	if err := db.WithContext(ctx).First(&updated, id).Error; err != nil {
		return entities.ProxyPool{}, fmt.Errorf("load proxy pool: %w", err)
	}
	return updated, nil
}

func DeleteProxyPool(ctx context.Context, db *gorm.DB, id int64) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	result := db.WithContext(ctx).Delete(&entities.ProxyPool{}, id)
	if result.Error != nil {
		return fmt.Errorf("delete proxy pool: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func FindProxyPoolByID(ctx context.Context, db *gorm.DB, id int64) (entities.ProxyPool, error) {
	if db == nil {
		return entities.ProxyPool{}, fmt.Errorf("database is nil")
	}
	var pool entities.ProxyPool
	if err := db.WithContext(ctx).First(&pool, id).Error; err != nil {
		return entities.ProxyPool{}, fmt.Errorf("find proxy pool: %w", err)
	}
	return pool, nil
}
