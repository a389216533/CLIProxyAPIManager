package repository

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"CLIProxyAPIManager/internal/config"
	"CLIProxyAPIManager/internal/entities"

	"gorm.io/gorm"
)

func TestSyncCPAAPIKeysCreatesRowsWithDisplayKeyAndEmptyAlias(t *testing.T) {
	db := openCPAAPIKeyTestDatabase(t)
	syncedAt := time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)

	if err := SyncCPAAPIKeys(db, []string{"sk-alpha123456"}, syncedAt); err != nil {
		t.Fatalf("SyncCPAAPIKeys returned error: %v", err)
	}

	var row entities.CPAAPIKey
	if err := db.Where("api_key = ?", "sk-alpha123456").First(&row).Error; err != nil {
		t.Fatalf("expected synced key row: %v", err)
	}
	if row.DisplayKey != "sk-*********123456" || row.KeyAlias != "" || row.IsDeleted {
		t.Fatalf("unexpected row after sync: %+v", row)
	}
	if row.LastSyncedAt == nil || !row.LastSyncedAt.Equal(syncedAt) {
		t.Fatalf("unexpected last synced at: %+v", row.LastSyncedAt)
	}
}

func TestSyncCPAAPIKeysPreservesAliasAndMarksMissingRowsDeleted(t *testing.T) {
	db := openCPAAPIKeyTestDatabase(t)
	firstSync := time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)
	secondSync := firstSync.Add(time.Hour)

	if err := SyncCPAAPIKeys(db, []string{"sk-alpha123456", "sk-beta654321"}, firstSync); err != nil {
		t.Fatalf("initial sync returned error: %v", err)
	}
	if err := UpdateCPAAPIKeyAlias(db, 1, "Primary Key"); err != nil {
		t.Fatalf("UpdateCPAAPIKeyAlias returned error: %v", err)
	}
	if err := SyncCPAAPIKeys(db, []string{"sk-alpha123456"}, secondSync); err != nil {
		t.Fatalf("second sync returned error: %v", err)
	}

	var active entities.CPAAPIKey
	if err := db.Where("api_key = ?", "sk-alpha123456").First(&active).Error; err != nil {
		t.Fatalf("expected active key: %v", err)
	}
	if active.KeyAlias != "Primary Key" || active.IsDeleted {
		t.Fatalf("expected alias to be preserved on active row, got %+v", active)
	}

	var deleted entities.CPAAPIKey
	if err := db.Where("api_key = ?", "sk-beta654321").First(&deleted).Error; err != nil {
		t.Fatalf("expected deleted key: %v", err)
	}
	if !deleted.IsDeleted {
		t.Fatalf("expected missing key to be marked deleted: %+v", deleted)
	}
}

func TestSyncCPAAPIKeysKeepsMissingRowsWithUsageEventsActive(t *testing.T) {
	db := openCPAAPIKeyTestDatabase(t)
	firstSync := time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)
	secondSync := firstSync.Add(time.Hour)

	if err := SyncCPAAPIKeys(db, []string{"sk-active123456", "agt_codex_history123456"}, firstSync); err != nil {
		t.Fatalf("initial sync returned error: %v", err)
	}
	if err := db.Create(&entities.UsageEvent{
		EventKey:    "history-event",
		APIGroupKey: "agt_codex_history123456",
		Timestamp:   firstSync,
		Model:       "gpt-5",
		TotalTokens: 10,
	}).Error; err != nil {
		t.Fatalf("create usage event returned error: %v", err)
	}

	if err := SyncCPAAPIKeys(db, []string{"sk-active123456"}, secondSync); err != nil {
		t.Fatalf("second sync returned error: %v", err)
	}

	var historical entities.CPAAPIKey
	if err := db.Where("api_key = ?", "agt_codex_history123456").First(&historical).Error; err != nil {
		t.Fatalf("expected historical key: %v", err)
	}
	if historical.IsDeleted {
		t.Fatalf("expected historical key with usage events to remain active: %+v", historical)
	}
}

func TestSyncCPAAPIKeysRestoresDeletedRowsAndDeduplicatesInput(t *testing.T) {
	db := openCPAAPIKeyTestDatabase(t)

	if err := SyncCPAAPIKeys(db, []string{"sk-alpha123456"}, time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("initial sync returned error: %v", err)
	}
	if err := UpdateCPAAPIKeyAlias(db, 1, "Primary Key"); err != nil {
		t.Fatalf("UpdateCPAAPIKeyAlias returned error: %v", err)
	}
	if err := SyncCPAAPIKeys(db, nil, time.Date(2026, 5, 13, 11, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("empty sync returned error: %v", err)
	}
	if err := SyncCPAAPIKeys(db, []string{"sk-alpha123456", "sk-alpha123456"}, time.Date(2026, 5, 13, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("restore sync returned error: %v", err)
	}

	var rows []entities.CPAAPIKey
	if err := db.Where("api_key = ?", "sk-alpha123456").Find(&rows).Error; err != nil {
		t.Fatalf("query rows returned error: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected deduplicated row count 1, got %d", len(rows))
	}
	if rows[0].IsDeleted || rows[0].KeyAlias != "Primary Key" {
		t.Fatalf("expected restored row to preserve alias, got %+v", rows[0])
	}
}

func TestManualCPAAPIKeyRowsCanBeCreatedUpdatedDeletedAndSurviveSync(t *testing.T) {
	db := openCPAAPIKeyTestDatabase(t)

	row, err := CreateCPAAPIKey(db, "Manual Key", "  sk-manual123456  ")
	if err != nil {
		t.Fatalf("CreateCPAAPIKey returned error: %v", err)
	}
	if row.ID == 0 || row.APIKey != "sk-manual123456" || row.KeyAlias != "Manual Key" || row.DisplayKey != "sk-*********123456" || row.IsDeleted || row.LastSyncedAt != nil {
		t.Fatalf("unexpected created row: %+v", row)
	}
	if _, err := CreateCPAAPIKey(db, "Duplicate", "sk-manual123456"); !errors.Is(err, ErrCPAAPIKeyAlreadyExists) {
		t.Fatalf("expected duplicate create error, got %v", err)
	}

	if err := SyncCPAAPIKeys(db, []string{"sk-synced654321"}, time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("SyncCPAAPIKeys returned error: %v", err)
	}
	manual, err := FindActiveCPAAPIKeyByID(db, row.ID)
	if err != nil {
		t.Fatalf("manual key should remain active after sync: %v", err)
	}
	if manual.APIKey != "sk-manual123456" {
		t.Fatalf("unexpected manual row after sync: %+v", manual)
	}

	updated, err := UpdateCPAAPIKey(db, row.ID, "Renamed", "sk-renamed654321")
	if err != nil {
		t.Fatalf("UpdateCPAAPIKey returned error: %v", err)
	}
	if updated.APIKey != "sk-renamed654321" || updated.KeyAlias != "Renamed" || updated.DisplayKey != "sk-*********654321" || updated.LastSyncedAt != nil {
		t.Fatalf("unexpected updated row: %+v", updated)
	}
	if err := DeleteCPAAPIKey(db, row.ID); err != nil {
		t.Fatalf("DeleteCPAAPIKey returned error: %v", err)
	}
	if _, err := FindActiveCPAAPIKeyByID(db, row.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected deleted row to be hidden, got %v", err)
	}

	restored, err := CreateCPAAPIKey(db, "Restored", "sk-renamed654321")
	if err != nil {
		t.Fatalf("CreateCPAAPIKey should restore deleted row: %v", err)
	}
	if restored.ID != row.ID || restored.KeyAlias != "Restored" || restored.IsDeleted {
		t.Fatalf("unexpected restored row: %+v", restored)
	}
}

func TestCPAAPIKeyQueriesFilterDeletedRows(t *testing.T) {
	db := openCPAAPIKeyTestDatabase(t)

	if err := SyncCPAAPIKeys(db, []string{"sk-alpha123456", "sk-beta654321"}, time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("sync returned error: %v", err)
	}
	if err := SyncCPAAPIKeys(db, []string{"sk-alpha123456"}, time.Date(2026, 5, 13, 11, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("second sync returned error: %v", err)
	}

	rows, err := ListActiveCPAAPIKeys(db)
	if err != nil {
		t.Fatalf("ListActiveCPAAPIKeys returned error: %v", err)
	}
	if len(rows) != 1 || rows[0].APIKey != "sk-alpha123456" {
		t.Fatalf("unexpected active rows: %+v", rows)
	}

	_, err = FindActiveCPAAPIKeyByID(db, 2)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected deleted id to be hidden, got %v", err)
	}

	row, err := FindActiveCPAAPIKeyByValue(db, "sk-alpha123456")
	if err != nil || row.ID != 1 {
		t.Fatalf("expected active key lookup by value to return row 1, got %+v err=%v", row, err)
	}
	_, err = FindActiveCPAAPIKeyByValue(db, "sk-beta654321")
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected deleted value lookup to be hidden, got %v", err)
	}
}

func TestSyncCPAAPIKeysDoesNotConsumeIDsForExistingKeys(t *testing.T) {
	db := openCPAAPIKeyTestDatabase(t)

	if err := SyncCPAAPIKeys(db, []string{"sk-alpha123456"}, time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("initial sync returned error: %v", err)
	}
	for i := 0; i < 5; i++ {
		if err := SyncCPAAPIKeys(db, []string{"sk-alpha123456"}, time.Date(2026, 5, 13, 11, i, 0, 0, time.UTC)); err != nil {
			t.Fatalf("repeat sync returned error: %v", err)
		}
	}
	if err := SyncCPAAPIKeys(db, []string{"sk-alpha123456", "sk-beta654321"}, time.Date(2026, 5, 13, 12, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("new key sync returned error: %v", err)
	}

	var row entities.CPAAPIKey
	if err := db.Where("api_key = ?", "sk-beta654321").First(&row).Error; err != nil {
		t.Fatalf("expected new key row: %v", err)
	}
	if row.ID != 2 {
		t.Fatalf("expected second key id to be 2 without upsert sequence burn, got %d", row.ID)
	}
}

func openCPAAPIKeyTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := OpenDatabase(config.Config{SQLitePath: filepath.Join(t.TempDir(), "cpa-api-key.db")})
	if err != nil {
		t.Fatalf("OpenDatabase returned error: %v", err)
	}
	closeTestDatabase(t, db)
	return db
}
