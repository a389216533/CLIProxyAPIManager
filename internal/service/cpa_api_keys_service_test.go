package service

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"CLIProxyAPIManager/internal/config"
	"CLIProxyAPIManager/internal/repository"

	"gorm.io/gorm"
)

func TestFindActiveCPAAPIKeyByValueTrimsInputAndQueriesActiveRow(t *testing.T) {
	db, err := repository.OpenDatabase(config.Config{SQLitePath: filepath.Join(t.TempDir(), "api-keys-service.db")})
	if err != nil {
		t.Fatalf("OpenDatabase returned error: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	if err := repository.SyncCPAAPIKeys(db, []string{"sk-alpha123456", "sk-beta123456"}, time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("seed API keys: %v", err)
	}
	provider := NewCPAAPIKeyService(db)

	row, err := provider.FindActiveCPAAPIKeyByValue(context.Background(), "  sk-beta123456  ")
	if err != nil {
		t.Fatalf("FindActiveCPAAPIKeyByValue returned error: %v", err)
	}
	if row.ID != 2 || row.DisplayKey == "" || row.APIKey != "sk-beta123456" {
		t.Fatalf("unexpected matched row: %+v", row)
	}
}

func TestFindActiveCPAAPIKeyByValueRejectsEmptyAndMissingAsNotFound(t *testing.T) {
	db, err := repository.OpenDatabase(config.Config{SQLitePath: filepath.Join(t.TempDir(), "api-keys-service.db")})
	if err != nil {
		t.Fatalf("OpenDatabase returned error: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	if err := repository.SyncCPAAPIKeys(db, []string{"sk-alpha123456"}, time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("seed API keys: %v", err)
	}
	provider := NewCPAAPIKeyService(db)

	for _, apiKey := range []string{"   ", "sk-missing"} {
		if _, err := provider.FindActiveCPAAPIKeyByValue(context.Background(), apiKey); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("expected ErrRecordNotFound for %q, got %v", apiKey, err)
		}
	}
}

func TestFindActiveCPAAPIKeyByIDReturnsOnlyActiveRows(t *testing.T) {
	db, err := repository.OpenDatabase(config.Config{SQLitePath: filepath.Join(t.TempDir(), "api-keys-service.db")})
	if err != nil {
		t.Fatalf("OpenDatabase returned error: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	if err := repository.SyncCPAAPIKeys(db, []string{"sk-alpha123456", "sk-beta123456"}, time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("seed API keys: %v", err)
	}
	if err := repository.SyncCPAAPIKeys(db, []string{"sk-alpha123456"}, time.Date(2026, 5, 13, 11, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("mark stale API key deleted: %v", err)
	}
	provider := NewCPAAPIKeyService(db)

	row, err := provider.FindActiveCPAAPIKeyByID(context.Background(), 1)
	if err != nil {
		t.Fatalf("FindActiveCPAAPIKeyByID active row returned error: %v", err)
	}
	if row.ID != 1 {
		t.Fatalf("expected row 1, got %+v", row)
	}
	if _, err := provider.FindActiveCPAAPIKeyByID(context.Background(), 2); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected deleted row to return ErrRecordNotFound, got %v", err)
	}
}

func TestUpdateCPAAPIKeyAliasAcceptsParsedInt64ID(t *testing.T) {
	db, err := repository.OpenDatabase(config.Config{SQLitePath: filepath.Join(t.TempDir(), "api-keys-service.db")})
	if err != nil {
		t.Fatalf("OpenDatabase returned error: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	if err := repository.SyncCPAAPIKeys(db, []string{"sk-alpha123456"}, time.Date(2026, 5, 13, 10, 0, 0, 0, time.UTC)); err != nil {
		t.Fatalf("seed API keys: %v", err)
	}
	provider := NewCPAAPIKeyService(db)

	row, err := provider.UpdateCPAAPIKeyAlias(context.Background(), int64(1), "Primary Key")
	if err != nil {
		t.Fatalf("UpdateCPAAPIKeyAlias returned error: %v", err)
	}
	if row.ID != 1 || row.KeyAlias != "Primary Key" {
		t.Fatalf("unexpected updated row: %+v", row)
	}
}

func TestCreateUpdateDeleteCPAAPIKey(t *testing.T) {
	db, err := repository.OpenDatabase(config.Config{SQLitePath: filepath.Join(t.TempDir(), "api-keys-service.db")})
	if err != nil {
		t.Fatalf("OpenDatabase returned error: %v", err)
	}
	t.Cleanup(func() {
		sqlDB, err := db.DB()
		if err == nil {
			_ = sqlDB.Close()
		}
	})
	provider := NewCPAAPIKeyService(db)

	row, err := provider.CreateCPAAPIKey(context.Background(), "Manual Key", "  sk-manual123456  ")
	if err != nil {
		t.Fatalf("CreateCPAAPIKey returned error: %v", err)
	}
	if row.APIKey != "sk-manual123456" || row.KeyAlias != "Manual Key" {
		t.Fatalf("unexpected created row: %+v", row)
	}
	if _, err := provider.CreateCPAAPIKey(context.Background(), "Duplicate", "sk-manual123456"); !errors.Is(err, ErrDuplicateCPAAPIKey) {
		t.Fatalf("expected duplicate error, got %v", err)
	}
	if _, err := provider.CreateCPAAPIKey(context.Background(), "Empty", " "); !errors.Is(err, ErrInvalidCPAAPIKey) {
		t.Fatalf("expected invalid api key error, got %v", err)
	}

	updated, err := provider.UpdateCPAAPIKey(context.Background(), row.ID, "Renamed", "sk-renamed654321")
	if err != nil {
		t.Fatalf("UpdateCPAAPIKey returned error: %v", err)
	}
	if updated.APIKey != "sk-renamed654321" || updated.KeyAlias != "Renamed" {
		t.Fatalf("unexpected updated row: %+v", updated)
	}
	if err := provider.DeleteCPAAPIKey(context.Background(), row.ID); err != nil {
		t.Fatalf("DeleteCPAAPIKey returned error: %v", err)
	}
	if _, err := provider.FindActiveCPAAPIKeyByID(context.Background(), row.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("expected deleted row to be hidden, got %v", err)
	}
}
