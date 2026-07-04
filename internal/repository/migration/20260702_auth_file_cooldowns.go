package migration

import (
	"fmt"

	"CLIProxyAPIManager/internal/entities"

	"gorm.io/gorm"
)

func createAuthFileCooldownsMigration(tx *gorm.DB) error {
	if tx.Migrator().HasTable(&entities.AuthFileCooldown{}) {
		return nil
	}
	if err := tx.Migrator().CreateTable(&entities.AuthFileCooldown{}); err != nil {
		return fmt.Errorf("create auth_file_cooldowns table: %w", err)
	}
	return nil
}
