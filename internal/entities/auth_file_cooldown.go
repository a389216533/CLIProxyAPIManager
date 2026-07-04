package entities

import "time"

const (
	AuthFileCooldownStatusActive   = "active"
	AuthFileCooldownStatusRestored = "restored"
)

type AuthFileCooldown struct {
	ID        int64  `gorm:"primaryKey"`
	AuthIndex string `gorm:"not null;index:idx_auth_file_cooldowns_auth_status,priority:1"`
	FileName  string `gorm:"not null"`
	Source    string `gorm:"not null"`
	Reason    string `gorm:"not null"`
	Status    string `gorm:"not null;index:idx_auth_file_cooldowns_auth_status,priority:2;index:idx_auth_file_cooldowns_status_restore,priority:1"`

	DisabledAt time.Time  `gorm:"serializer:storageTime;not null"`
	RestoreAt  time.Time  `gorm:"serializer:storageTime;not null;index:idx_auth_file_cooldowns_status_restore,priority:2"`
	RestoredAt *time.Time `gorm:"serializer:storageTime"`
	LastError  *string

	CreatedAt time.Time `gorm:"serializer:storageTime"`
	UpdatedAt time.Time `gorm:"serializer:storageTime"`
}
