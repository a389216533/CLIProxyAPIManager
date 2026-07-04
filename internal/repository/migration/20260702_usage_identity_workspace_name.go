package migration

import (
	"fmt"

	"CLIProxyAPIManager/internal/entities"

	"gorm.io/gorm"
)

func addUsageIdentityWorkspaceNameMigration(tx *gorm.DB) error {
	if !tx.Migrator().HasTable(&entities.UsageIdentity{}) {
		return nil
	}
	if tx.Migrator().HasColumn(&entities.UsageIdentity{}, "workspace_name") {
		return nil
	}
	if err := tx.Exec("ALTER TABLE usage_identities ADD COLUMN workspace_name TEXT").Error; err != nil {
		return fmt.Errorf("add usage_identities.workspace_name column: %w", err)
	}
	return nil
}
