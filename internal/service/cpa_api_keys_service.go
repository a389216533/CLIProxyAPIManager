package service

import (
	"context"
	"errors"
	"strings"

	"CLIProxyAPIManager/internal/entities"
	"CLIProxyAPIManager/internal/repository"

	"gorm.io/gorm"
)

var ErrInvalidID = errors.New("invalid id")
var ErrInvalidCPAAPIKey = errors.New("invalid cpa api key")
var ErrDuplicateCPAAPIKey = errors.New("duplicate cpa api key")

type CPAAPIKeyProvider interface {
	ListCPAAPIKeys(ctx context.Context) ([]entities.CPAAPIKey, error)
	FindActiveCPAAPIKeyByValue(ctx context.Context, apiKey string) (entities.CPAAPIKey, error)
	FindActiveCPAAPIKeyByID(ctx context.Context, id int64) (entities.CPAAPIKey, error)
	CreateCPAAPIKey(ctx context.Context, keyAlias string, apiKey string) (entities.CPAAPIKey, error)
	UpdateCPAAPIKey(ctx context.Context, id int64, keyAlias string, apiKey string) (entities.CPAAPIKey, error)
	UpdateCPAAPIKeyAlias(ctx context.Context, id int64, keyAlias string) (entities.CPAAPIKey, error)
	DeleteCPAAPIKey(ctx context.Context, id int64) error
}

type cpaAPIKeyService struct {
	db *gorm.DB
}

func NewCPAAPIKeyService(db *gorm.DB) CPAAPIKeyProvider {
	return &cpaAPIKeyService{db: db}
}

func (s *cpaAPIKeyService) ListCPAAPIKeys(context.Context) ([]entities.CPAAPIKey, error) {
	return repository.ListActiveCPAAPIKeys(s.db)
}

func (s *cpaAPIKeyService) FindActiveCPAAPIKeyByValue(_ context.Context, apiKey string) (entities.CPAAPIKey, error) {
	trimmed := strings.TrimSpace(apiKey)
	if trimmed == "" {
		return entities.CPAAPIKey{}, gorm.ErrRecordNotFound
	}
	return repository.FindActiveCPAAPIKeyByValue(s.db, trimmed)
}

func (s *cpaAPIKeyService) FindActiveCPAAPIKeyByID(_ context.Context, id int64) (entities.CPAAPIKey, error) {
	if id <= 0 {
		return entities.CPAAPIKey{}, gorm.ErrRecordNotFound
	}
	return repository.FindActiveCPAAPIKeyByID(s.db, id)
}

func (s *cpaAPIKeyService) CreateCPAAPIKey(_ context.Context, keyAlias string, apiKey string) (entities.CPAAPIKey, error) {
	if strings.TrimSpace(apiKey) == "" {
		return entities.CPAAPIKey{}, ErrInvalidCPAAPIKey
	}
	row, err := repository.CreateCPAAPIKey(s.db, keyAlias, apiKey)
	if errors.Is(err, repository.ErrCPAAPIKeyAlreadyExists) {
		return entities.CPAAPIKey{}, ErrDuplicateCPAAPIKey
	}
	return row, err
}

func (s *cpaAPIKeyService) UpdateCPAAPIKey(_ context.Context, id int64, keyAlias string, apiKey string) (entities.CPAAPIKey, error) {
	if id <= 0 {
		return entities.CPAAPIKey{}, ErrInvalidID
	}
	if strings.TrimSpace(apiKey) == "" {
		return entities.CPAAPIKey{}, ErrInvalidCPAAPIKey
	}
	row, err := repository.UpdateCPAAPIKey(s.db, id, keyAlias, apiKey)
	if errors.Is(err, repository.ErrCPAAPIKeyAlreadyExists) {
		return entities.CPAAPIKey{}, ErrDuplicateCPAAPIKey
	}
	return row, err
}

func (s *cpaAPIKeyService) UpdateCPAAPIKeyAlias(_ context.Context, id int64, keyAlias string) (entities.CPAAPIKey, error) {
	if id <= 0 {
		return entities.CPAAPIKey{}, ErrInvalidID
	}
	if err := repository.UpdateCPAAPIKeyAlias(s.db, id, keyAlias); err != nil {
		return entities.CPAAPIKey{}, err
	}
	return repository.FindActiveCPAAPIKeyByID(s.db, id)
}

func (s *cpaAPIKeyService) DeleteCPAAPIKey(_ context.Context, id int64) error {
	if id <= 0 {
		return ErrInvalidID
	}
	return repository.DeleteCPAAPIKey(s.db, id)
}
