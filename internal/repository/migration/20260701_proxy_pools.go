package migration

import (
	"fmt"

	"CLIProxyAPIManager/internal/entities"

	"gorm.io/gorm"
)

func addProxyPoolsMigration(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&entities.ProxyPool{}) {
		if err := tx.Migrator().CreateTable(&entities.ProxyPool{}); err != nil {
			return fmt.Errorf("create proxy_pools table: %w", err)
		}
	}
	if tx.Migrator().HasTable(&entities.UsageIdentity{}) && !tx.Migrator().HasColumn(&entities.UsageIdentity{}, "proxy_url") {
		if err := tx.Migrator().AddColumn(&entities.UsageIdentity{}, "ProxyURL"); err != nil {
			return fmt.Errorf("add usage_identities.proxy_url column: %w", err)
		}
	}
	return nil
}
