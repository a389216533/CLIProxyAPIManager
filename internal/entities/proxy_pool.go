package entities

import "time"

// ProxyPool 是 Keeper 本地维护的代理池配置，用于批量给 CPA auth file 写入 proxy_url。
type ProxyPool struct {
	ID        int64     `gorm:"primaryKey"`
	Name      string    `gorm:"not null;uniqueIndex:uniq_proxy_pools_name"`
	ProxyURL  string    `gorm:"not null;column:proxy_url"`
	CreatedAt time.Time `gorm:"serializer:storageTime"`
	UpdatedAt time.Time `gorm:"serializer:storageTime"`

	BoundAuthFileCount int64  `gorm:"-"`
	AverageLatencyMS   *int64 `gorm:"-"`
	LatencySource      string `gorm:"-"`
}
