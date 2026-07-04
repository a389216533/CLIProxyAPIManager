package repository

import (
	"errors"
	"strings"
	"time"

	"CLIProxyAPIManager/internal/entities"
	"CLIProxyAPIManager/internal/helper"

	"gorm.io/gorm"
)

var ErrCPAAPIKeyAlreadyExists = errors.New("cpa api key already exists")

func SyncCPAAPIKeys(db *gorm.DB, keys []string, syncedAt time.Time) error {
	seen := make(map[string]struct{}, len(keys))
	uniqueKeys := make([]string, 0, len(keys))
	for _, key := range keys {
		key = strings.TrimSpace(key)
		if key == "" {
			continue
		}
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		uniqueKeys = append(uniqueKeys, key)
	}

	return db.Transaction(func(tx *gorm.DB) error {
		var existingRows []struct {
			ID           int64
			APIKey       string
			IsDeleted    bool
			LastSyncedAt *time.Time
		}
		if err := tx.Model(&entities.CPAAPIKey{}).Select("id, api_key, is_deleted, last_synced_at").Find(&existingRows).Error; err != nil {
			return err
		}

		existingByKey := make(map[string]struct {
			ID        int64
			IsDeleted bool
		}, len(existingRows))
		for _, row := range existingRows {
			existingByKey[row.APIKey] = struct {
				ID        int64
				IsDeleted bool
			}{ID: row.ID, IsDeleted: row.IsDeleted}
		}

		incoming := make(map[string]struct{}, len(uniqueKeys))
		toCreate := make([]entities.CPAAPIKey, 0)
		for _, key := range uniqueKeys {
			incoming[key] = struct{}{}
			if existing, ok := existingByKey[key]; ok {
				updates := map[string]any{
					"display_key":    helper.RedactSensitiveValue(key),
					"is_deleted":     false,
					"last_synced_at": &syncedAt,
					"updated_at":     syncedAt,
				}
				if err := tx.Model(&entities.CPAAPIKey{}).Where("id = ?", existing.ID).Updates(updates).Error; err != nil {
					return err
				}
				continue
			}
			toCreate = append(toCreate, entities.CPAAPIKey{
				APIKey:       key,
				DisplayKey:   helper.RedactSensitiveValue(key),
				IsDeleted:    false,
				LastSyncedAt: &syncedAt,
			})
		}
		if len(toCreate) > 0 {
			if err := tx.Create(&toCreate).Error; err != nil {
				return err
			}
		}

		staleCandidates := make([]struct {
			ID     int64
			APIKey string
		}, 0)
		for _, row := range existingRows {
			if row.IsDeleted {
				continue
			}
			if row.LastSyncedAt == nil {
				continue
			}
			if _, ok := incoming[row.APIKey]; ok {
				continue
			}
			staleCandidates = append(staleCandidates, struct {
				ID     int64
				APIKey string
			}{ID: row.ID, APIKey: row.APIKey})
		}
		if len(staleCandidates) == 0 {
			return nil
		}

		staleKeys := make([]string, 0, len(staleCandidates))
		for _, row := range staleCandidates {
			staleKeys = append(staleKeys, row.APIKey)
		}
		keysWithUsage, err := findCPAAPIKeysWithUsageEvents(tx, staleKeys)
		if err != nil {
			return err
		}

		staleIDs := make([]int64, 0, len(staleCandidates))
		for _, row := range staleCandidates {
			if _, ok := keysWithUsage[row.APIKey]; ok {
				continue
			}
			staleIDs = append(staleIDs, row.ID)
		}
		if len(staleIDs) == 0 {
			return nil
		}
		return tx.Model(&entities.CPAAPIKey{}).Where("id IN ?", staleIDs).Updates(map[string]any{"is_deleted": true, "updated_at": syncedAt}).Error
	})
}

func findCPAAPIKeysWithUsageEvents(tx *gorm.DB, keys []string) (map[string]struct{}, error) {
	if len(keys) == 0 {
		return map[string]struct{}{}, nil
	}

	var rows []struct {
		APIGroupKey string
	}
	if err := tx.Model(&entities.UsageEvent{}).
		Select("api_group_key").
		Where("api_group_key IN ?", keys).
		Group("api_group_key").
		Find(&rows).Error; err != nil {
		return nil, err
	}

	result := make(map[string]struct{}, len(rows))
	for _, row := range rows {
		result[row.APIGroupKey] = struct{}{}
	}
	return result, nil
}

func ListActiveCPAAPIKeys(db *gorm.DB) ([]entities.CPAAPIKey, error) {
	var rows []entities.CPAAPIKey
	err := db.Where("is_deleted = ?", false).Order("id asc").Find(&rows).Error
	return rows, err
}

func FindActiveCPAAPIKeyByID(db *gorm.DB, id int64) (entities.CPAAPIKey, error) {
	var row entities.CPAAPIKey
	err := db.Where("id = ? AND is_deleted = ?", id, false).First(&row).Error
	return row, err
}

func FindActiveCPAAPIKeyByValue(db *gorm.DB, apiKey string) (entities.CPAAPIKey, error) {
	var row entities.CPAAPIKey
	err := db.Where("api_key = ? AND is_deleted = ?", apiKey, false).First(&row).Error
	return row, err
}

func CreateCPAAPIKey(db *gorm.DB, keyAlias string, apiKey string) (entities.CPAAPIKey, error) {
	keyAlias = strings.TrimSpace(keyAlias)
	apiKey = strings.TrimSpace(apiKey)
	var row entities.CPAAPIKey
	err := db.Where("api_key = ?", apiKey).First(&row).Error
	if err == nil {
		if !row.IsDeleted {
			return entities.CPAAPIKey{}, ErrCPAAPIKeyAlreadyExists
		}
		updates := map[string]any{
			"key_alias":      keyAlias,
			"display_key":    helper.RedactSensitiveValue(apiKey),
			"is_deleted":     false,
			"last_synced_at": nil,
		}
		if err := db.Model(&entities.CPAAPIKey{}).Where("id = ?", row.ID).Updates(updates).Error; err != nil {
			return entities.CPAAPIKey{}, err
		}
		return FindActiveCPAAPIKeyByID(db, row.ID)
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return entities.CPAAPIKey{}, err
	}

	row = entities.CPAAPIKey{
		APIKey:     apiKey,
		DisplayKey: helper.RedactSensitiveValue(apiKey),
		KeyAlias:   keyAlias,
		IsDeleted:  false,
	}
	if err := db.Create(&row).Error; err != nil {
		return entities.CPAAPIKey{}, err
	}
	return row, nil
}

func UpdateCPAAPIKey(db *gorm.DB, id int64, keyAlias string, apiKey string) (entities.CPAAPIKey, error) {
	keyAlias = strings.TrimSpace(keyAlias)
	apiKey = strings.TrimSpace(apiKey)
	var updated entities.CPAAPIKey
	err := db.Transaction(func(tx *gorm.DB) error {
		var row entities.CPAAPIKey
		if err := tx.Where("id = ? AND is_deleted = ?", id, false).First(&row).Error; err != nil {
			return err
		}
		if row.APIKey != apiKey {
			var duplicate entities.CPAAPIKey
			err := tx.Where("api_key = ?", apiKey).First(&duplicate).Error
			if err == nil && duplicate.ID != row.ID {
				return ErrCPAAPIKeyAlreadyExists
			}
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}

		updates := map[string]any{
			"key_alias":   keyAlias,
			"api_key":     apiKey,
			"display_key": helper.RedactSensitiveValue(apiKey),
		}
		if row.APIKey != apiKey {
			updates["last_synced_at"] = nil
		}
		if err := tx.Model(&entities.CPAAPIKey{}).Where("id = ? AND is_deleted = ?", id, false).Updates(updates).Error; err != nil {
			return err
		}
		return tx.Where("id = ? AND is_deleted = ?", id, false).First(&updated).Error
	})
	return updated, err
}

func UpdateCPAAPIKeyAlias(db *gorm.DB, id int64, keyAlias string) error {
	result := db.Model(&entities.CPAAPIKey{}).Where("id = ? AND is_deleted = ?", id, false).Update("key_alias", strings.TrimSpace(keyAlias))
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func DeleteCPAAPIKey(db *gorm.DB, id int64) error {
	result := db.Model(&entities.CPAAPIKey{}).Where("id = ? AND is_deleted = ?", id, false).Update("is_deleted", true)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
