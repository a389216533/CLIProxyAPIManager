package service

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"CLIProxyAPIManager/internal/entities"
	"CLIProxyAPIManager/internal/timeutil"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"
)

const (
	AuthFileCooldownDefaultDuration = 5 * time.Hour
	authFileCooldownRestoreInterval = time.Minute
	authFileCooldownRestoreLimit    = 25
)

var ErrAuthFileCooldownNotFound = errors.New("auth file cooldown not found")

type AuthFileCooldownProvider interface {
	ListAuthFileCooldowns(context.Context) (AuthFileCooldownListResponse, error)
	StartAuthFileCooldown(context.Context, AuthFileCooldownStartRequest) (AuthFileCooldownResponse, error)
	RestoreAuthFileCooldown(context.Context, AuthFileCooldownRestoreRequest) (AuthFileCooldownResponse, error)
}

type AuthFileCooldownStartRequest struct {
	AuthIndex string
	FileName  string
	Source    string
	Reason    string
	Duration  time.Duration
}

type AuthFileCooldownRestoreRequest struct {
	AuthIndex string
}

type AuthFileCooldownResponse struct {
	ID         int64      `json:"id"`
	AuthIndex  string     `json:"auth_index"`
	FileName   string     `json:"file_name"`
	Source     string     `json:"source"`
	Reason     string     `json:"reason"`
	Status     string     `json:"status"`
	DisabledAt time.Time  `json:"disabled_at"`
	RestoreAt  time.Time  `json:"restore_at"`
	RestoredAt *time.Time `json:"restored_at,omitempty"`
	LastError  *string    `json:"last_error,omitempty"`
	CreatedAt  time.Time  `json:"created_at"`
	UpdatedAt  time.Time  `json:"updated_at"`
}

type AuthFileCooldownListResponse struct {
	Cooldowns []AuthFileCooldownResponse `json:"cooldowns"`
}

type AuthFileCooldownService struct {
	db              *gorm.DB
	client          AuthFilesManagementClient
	onChanged       func(context.Context) error
	now             func() time.Time
	restoreInterval time.Duration
}

func NewAuthFileCooldownService(db *gorm.DB, client AuthFilesManagementClient, onChanged func(context.Context) error) *AuthFileCooldownService {
	return &AuthFileCooldownService{db: db, client: client, onChanged: onChanged, now: time.Now, restoreInterval: authFileCooldownRestoreInterval}
}

func (s *AuthFileCooldownService) ListAuthFileCooldowns(ctx context.Context) (AuthFileCooldownListResponse, error) {
	if err := s.validateStore(); err != nil {
		return AuthFileCooldownListResponse{}, err
	}
	var cooldowns []entities.AuthFileCooldown
	if err := s.db.WithContext(ctx).
		Where("status = ?", entities.AuthFileCooldownStatusActive).
		Order("restore_at ASC, id ASC").
		Find(&cooldowns).Error; err != nil {
		return AuthFileCooldownListResponse{}, err
	}
	response := AuthFileCooldownListResponse{Cooldowns: make([]AuthFileCooldownResponse, 0, len(cooldowns))}
	for _, cooldown := range cooldowns {
		response.Cooldowns = append(response.Cooldowns, mapAuthFileCooldownResponse(cooldown))
	}
	return response, nil
}

func (s *AuthFileCooldownService) StartAuthFileCooldown(ctx context.Context, request AuthFileCooldownStartRequest) (AuthFileCooldownResponse, error) {
	if err := s.validateStore(); err != nil {
		return AuthFileCooldownResponse{}, err
	}
	authIndex := strings.TrimSpace(request.AuthIndex)
	fileName := strings.TrimSpace(request.FileName)
	if authIndex == "" || fileName == "" {
		return AuthFileCooldownResponse{}, fmt.Errorf("%w: auth_index and file_name are required", ErrAuthFilesManagementValidation)
	}
	source := cleanCooldownText(request.Source, "manual")
	reason := cleanCooldownText(request.Reason, "limit_reached")
	duration := request.Duration
	if duration <= 0 {
		duration = AuthFileCooldownDefaultDuration
	}

	if err := s.client.UpdateAuthFileStatus(ctx, fileName, true); err != nil {
		return AuthFileCooldownResponse{}, fmt.Errorf("disable auth file %s: %w", fileName, err)
	}

	now := s.currentTime()
	restoreAt := timeutil.NormalizeStorageTime(now.Add(duration))
	var saved entities.AuthFileCooldown
	if err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var existing entities.AuthFileCooldown
		err := tx.Where("auth_index = ? AND status = ?", authIndex, entities.AuthFileCooldownStatusActive).First(&existing).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			saved = entities.AuthFileCooldown{
				AuthIndex:  authIndex,
				FileName:   fileName,
				Source:     source,
				Reason:     reason,
				Status:     entities.AuthFileCooldownStatusActive,
				DisabledAt: now,
				RestoreAt:  restoreAt,
			}
			return tx.Create(&saved).Error
		}
		existing.FileName = fileName
		existing.Source = source
		existing.Reason = reason
		existing.DisabledAt = now
		existing.RestoreAt = restoreAt
		existing.RestoredAt = nil
		existing.LastError = nil
		if err := tx.Save(&existing).Error; err != nil {
			return err
		}
		saved = existing
		return nil
	}); err != nil {
		return AuthFileCooldownResponse{}, err
	}
	if err := s.notifyChanged(ctx); err != nil {
		return AuthFileCooldownResponse{}, err
	}
	return mapAuthFileCooldownResponse(saved), nil
}

func (s *AuthFileCooldownService) StartLimitReachedCooldown(ctx context.Context, authIndex, fileName, source, reason string, duration time.Duration) error {
	_, err := s.StartAuthFileCooldown(ctx, AuthFileCooldownStartRequest{
		AuthIndex: authIndex,
		FileName:  fileName,
		Source:    source,
		Reason:    reason,
		Duration:  duration,
	})
	return err
}

func (s *AuthFileCooldownService) RestoreAuthFileCooldown(ctx context.Context, request AuthFileCooldownRestoreRequest) (AuthFileCooldownResponse, error) {
	if err := s.validateStore(); err != nil {
		return AuthFileCooldownResponse{}, err
	}
	authIndex := strings.TrimSpace(request.AuthIndex)
	if authIndex == "" {
		return AuthFileCooldownResponse{}, fmt.Errorf("%w: auth_index is required", ErrAuthFilesManagementValidation)
	}
	var cooldown entities.AuthFileCooldown
	if err := s.db.WithContext(ctx).Where("auth_index = ? AND status = ?", authIndex, entities.AuthFileCooldownStatusActive).First(&cooldown).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return AuthFileCooldownResponse{}, ErrAuthFileCooldownNotFound
		}
		return AuthFileCooldownResponse{}, err
	}
	return s.restoreCooldown(ctx, cooldown)
}

func (s *AuthFileCooldownService) RestoreDueAuthFileCooldowns(ctx context.Context, limit int) (int, error) {
	if err := s.validateStore(); err != nil {
		return 0, err
	}
	if limit <= 0 {
		limit = authFileCooldownRestoreLimit
	}
	now := s.currentTime()
	var cooldowns []entities.AuthFileCooldown
	if err := s.db.WithContext(ctx).
		Where("status = ? AND restore_at <= ?", entities.AuthFileCooldownStatusActive, timeutil.FormatStorageTime(now)).
		Order("restore_at ASC, id ASC").
		Limit(limit).
		Find(&cooldowns).Error; err != nil {
		return 0, err
	}
	restored := 0
	var joined error
	for _, cooldown := range cooldowns {
		if _, err := s.restoreCooldown(ctx, cooldown); err != nil {
			joined = errors.Join(joined, err)
			continue
		}
		restored++
	}
	return restored, joined
}

func (s *AuthFileCooldownService) Run(ctx context.Context) error {
	if err := s.validateStore(); err != nil {
		return err
	}
	s.restoreDueAndLog(ctx)
	ticker := time.NewTicker(s.restoreTickInterval())
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			s.restoreDueAndLog(ctx)
		}
	}
}

func (s *AuthFileCooldownService) restoreCooldown(ctx context.Context, cooldown entities.AuthFileCooldown) (AuthFileCooldownResponse, error) {
	if strings.TrimSpace(cooldown.FileName) == "" {
		return AuthFileCooldownResponse{}, fmt.Errorf("%w: file_name is required", ErrAuthFilesManagementValidation)
	}
	if err := s.client.UpdateAuthFileStatus(ctx, cooldown.FileName, false); err != nil {
		message := err.Error()
		_ = s.db.WithContext(ctx).Model(&entities.AuthFileCooldown{}).Where("id = ?", cooldown.ID).Updates(map[string]any{
			"last_error": message,
			"updated_at": s.currentTime(),
		}).Error
		return AuthFileCooldownResponse{}, fmt.Errorf("restore auth file %s: %w", cooldown.FileName, err)
	}
	now := s.currentTime()
	cooldown.Status = entities.AuthFileCooldownStatusRestored
	cooldown.RestoredAt = &now
	cooldown.LastError = nil
	if err := s.db.WithContext(ctx).Save(&cooldown).Error; err != nil {
		return AuthFileCooldownResponse{}, err
	}
	if err := s.notifyChanged(ctx); err != nil {
		return AuthFileCooldownResponse{}, err
	}
	return mapAuthFileCooldownResponse(cooldown), nil
}

func (s *AuthFileCooldownService) restoreDueAndLog(ctx context.Context) {
	restored, err := s.RestoreDueAuthFileCooldowns(ctx, authFileCooldownRestoreLimit)
	if restored > 0 {
		logrus.WithField("count", restored).Info("auth file cooldowns restored")
	}
	if err != nil && !errors.Is(err, context.Canceled) {
		logrus.WithError(err).Warn("auth file cooldown restore failed")
	}
}

func (s *AuthFileCooldownService) validateStore() error {
	if s == nil {
		return fmt.Errorf("auth file cooldown service is not configured")
	}
	if s.db == nil {
		return fmt.Errorf("database is nil")
	}
	if s.client == nil {
		return fmt.Errorf("auth files management client is not configured")
	}
	return nil
}

func (s *AuthFileCooldownService) notifyChanged(ctx context.Context) error {
	if s.onChanged == nil {
		return nil
	}
	return s.onChanged(ctx)
}

func (s *AuthFileCooldownService) currentTime() time.Time {
	if s.now != nil {
		return timeutil.NormalizeStorageTime(s.now())
	}
	return timeutil.NormalizeStorageTime(time.Now())
}

func (s *AuthFileCooldownService) restoreTickInterval() time.Duration {
	if s.restoreInterval > 0 {
		return s.restoreInterval
	}
	return authFileCooldownRestoreInterval
}

func cleanCooldownText(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func mapAuthFileCooldownResponse(cooldown entities.AuthFileCooldown) AuthFileCooldownResponse {
	return AuthFileCooldownResponse{
		ID:         cooldown.ID,
		AuthIndex:  cooldown.AuthIndex,
		FileName:   cooldown.FileName,
		Source:     cooldown.Source,
		Reason:     cooldown.Reason,
		Status:     cooldown.Status,
		DisabledAt: cooldown.DisabledAt,
		RestoreAt:  cooldown.RestoreAt,
		RestoredAt: cooldown.RestoredAt,
		LastError:  cooldown.LastError,
		CreatedAt:  cooldown.CreatedAt,
		UpdatedAt:  cooldown.UpdatedAt,
	}
}
