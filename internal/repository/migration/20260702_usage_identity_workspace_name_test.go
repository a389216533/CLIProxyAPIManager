package migration

import (
	"database/sql"
	"path/filepath"
	"testing"

	"CLIProxyAPIManager/internal/entities"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestAddUsageIdentityWorkspaceNameMigrationAddsNullableColumn(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(testSQLiteDSN(filepath.Join(t.TempDir(), "legacy.db"))), &gorm.Config{})
	if err != nil {
		t.Fatalf("open database: %v", err)
	}
	defer closeOpenedDatabase(t, db)

	if err := db.Exec(`CREATE TABLE usage_identities (
		id integer PRIMARY KEY AUTOINCREMENT,
		name text,
		auth_type integer,
		auth_type_name text,
		identity text,
		type text,
		provider text,
		is_deleted numeric
	)`).Error; err != nil {
		t.Fatalf("create legacy usage_identities table: %v", err)
	}
	if err := db.Exec(`INSERT INTO usage_identities (name, auth_type, auth_type_name, identity, type, provider, is_deleted)
		VALUES (?, ?, ?, ?, ?, ?, ?)`, "Codex", entities.UsageIdentityAuthTypeAuthFile, "oauth", "codex-auth", "codex", "Codex", false).Error; err != nil {
		t.Fatalf("seed legacy usage identity: %v", err)
	}

	if err := addUsageIdentityWorkspaceNameMigration(db); err != nil {
		t.Fatalf("add usage identity workspace name: %v", err)
	}
	if err := addUsageIdentityWorkspaceNameMigration(db); err != nil {
		t.Fatalf("add usage identity workspace name should be idempotent: %v", err)
	}
	if !db.Migrator().HasColumn(&entities.UsageIdentity{}, "workspace_name") {
		t.Fatal("expected usage_identities.workspace_name column to exist")
	}

	var workspaceName sql.NullString
	if err := db.Raw(`SELECT workspace_name FROM usage_identities WHERE identity = ?`, "codex-auth").Row().Scan(&workspaceName); err != nil {
		t.Fatalf("scan workspace_name: %v", err)
	}
	if workspaceName.Valid {
		t.Fatalf("expected legacy workspace_name to default NULL, got %+v", workspaceName)
	}
}
