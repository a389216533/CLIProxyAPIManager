package service

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"CLIProxyAPIManager/internal/config"
	"CLIProxyAPIManager/internal/entities"
	"CLIProxyAPIManager/internal/repository"
	"gorm.io/gorm"
)

func TestAuthFileCooldownServiceStartsAndExtendsActiveCooldown(t *testing.T) {
	db := openAuthFileCooldownTestDatabase(t)
	client := &authFilesManagementClientStub{}
	service := NewAuthFileCooldownService(db, client, nil)
	firstNow := time.Date(2026, 7, 2, 10, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return firstNow }

	first, err := service.StartAuthFileCooldown(context.Background(), AuthFileCooldownStartRequest{AuthIndex: " auth-1 ", FileName: " codex.json ", Source: "manual", Reason: "manual"})
	if err != nil {
		t.Fatalf("StartAuthFileCooldown returned error: %v", err)
	}
	if first.AuthIndex != "auth-1" || first.FileName != "codex.json" || first.Status != entities.AuthFileCooldownStatusActive {
		t.Fatalf("unexpected first cooldown response: %+v", first)
	}

	secondNow := firstNow.Add(time.Hour)
	service.now = func() time.Time { return secondNow }
	second, err := service.StartAuthFileCooldown(context.Background(), AuthFileCooldownStartRequest{AuthIndex: "auth-1", FileName: "codex.json", Source: "auto", Reason: "limit_reached"})
	if err != nil {
		t.Fatalf("StartAuthFileCooldown second call returned error: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("expected active cooldown to be extended in place, first=%d second=%d", first.ID, second.ID)
	}
	if !second.RestoreAt.Equal(secondNow.Add(AuthFileCooldownDefaultDuration)) {
		t.Fatalf("expected restore_at to extend to %s, got %s", secondNow.Add(AuthFileCooldownDefaultDuration), second.RestoreAt)
	}
	var count int64
	if err := db.Model(&entities.AuthFileCooldown{}).Where("auth_index = ? AND status = ?", "auth-1", entities.AuthFileCooldownStatusActive).Count(&count).Error; err != nil {
		t.Fatalf("count cooldowns: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one active cooldown, got %d", count)
	}
	if len(client.statusCalls) != 2 || !client.statusCalls[0].disabled || !client.statusCalls[1].disabled {
		t.Fatalf("expected two disable calls, got %+v", client.statusCalls)
	}
}

func TestAuthFileCooldownServiceRestoresDueCooldown(t *testing.T) {
	db := openAuthFileCooldownTestDatabase(t)
	client := &authFilesManagementClientStub{}
	service := NewAuthFileCooldownService(db, client, nil)
	now := time.Date(2026, 7, 2, 15, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	if err := db.Create(&entities.AuthFileCooldown{AuthIndex: "auth-1", FileName: "codex.json", Source: "auto", Reason: "limit_reached", Status: entities.AuthFileCooldownStatusActive, DisabledAt: now.Add(-5 * time.Hour), RestoreAt: now.Add(-time.Minute)}).Error; err != nil {
		t.Fatalf("seed cooldown: %v", err)
	}

	restored, err := service.RestoreDueAuthFileCooldowns(context.Background(), 10)
	if err != nil {
		t.Fatalf("RestoreDueAuthFileCooldowns returned error: %v", err)
	}
	if restored != 1 {
		t.Fatalf("expected one restored cooldown, got %d", restored)
	}
	var row entities.AuthFileCooldown
	if err := db.Where("auth_index = ?", "auth-1").First(&row).Error; err != nil {
		t.Fatalf("load cooldown: %v", err)
	}
	if row.Status != entities.AuthFileCooldownStatusRestored || row.RestoredAt == nil {
		t.Fatalf("expected restored row, got %+v", row)
	}
	if len(client.statusCalls) != 1 || client.statusCalls[0].disabled {
		t.Fatalf("expected one restore status call, got %+v", client.statusCalls)
	}
}

func TestAuthFileCooldownServiceRestoreFailureKeepsActive(t *testing.T) {
	db := openAuthFileCooldownTestDatabase(t)
	client := &authFilesManagementClientStub{statusErrByName: map[string]error{"codex.json": errors.New("cpa unavailable")}}
	service := NewAuthFileCooldownService(db, client, nil)
	now := time.Date(2026, 7, 2, 15, 0, 0, 0, time.UTC)
	service.now = func() time.Time { return now }
	if err := db.Create(&entities.AuthFileCooldown{AuthIndex: "auth-1", FileName: "codex.json", Source: "auto", Reason: "limit_reached", Status: entities.AuthFileCooldownStatusActive, DisabledAt: now.Add(-5 * time.Hour), RestoreAt: now.Add(-time.Minute)}).Error; err != nil {
		t.Fatalf("seed cooldown: %v", err)
	}

	restored, err := service.RestoreDueAuthFileCooldowns(context.Background(), 10)
	if err == nil {
		t.Fatal("expected restore error")
	}
	if restored != 0 {
		t.Fatalf("expected no restored cooldowns, got %d", restored)
	}
	var row entities.AuthFileCooldown
	if err := db.Where("auth_index = ?", "auth-1").First(&row).Error; err != nil {
		t.Fatalf("load cooldown: %v", err)
	}
	if row.Status != entities.AuthFileCooldownStatusActive || row.LastError == nil || *row.LastError == "" {
		t.Fatalf("expected active row with last_error, got %+v", row)
	}
}

func openAuthFileCooldownTestDatabase(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := repository.OpenDatabase(config.Config{SQLitePath: filepath.Join(t.TempDir(), "auth-file-cooldown.db")})
	if err != nil {
		t.Fatalf("OpenDatabase returned error: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("db.DB returned error: %v", err)
	}
	t.Cleanup(func() {
		_ = sqlDB.Close()
	})
	return db
}
