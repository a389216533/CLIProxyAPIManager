package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode"

	"CLIProxyAPIManager/internal/entities"
	"CLIProxyAPIManager/internal/helper"
	"CLIProxyAPIManager/internal/service"
	"CLIProxyAPIManager/internal/timeutil"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

const (
	maxCPAAPIKeyAliasLength = 128
	maxCPAAPIKeyValueLength = 4096
)

type cpaAPIKeyResponse struct {
	ID           string  `json:"id"`
	KeyAlias     string  `json:"keyAlias"`
	DisplayKey   string  `json:"displayKey"`
	Label        string  `json:"label"`
	LastSyncedAt *string `json:"lastSyncedAt"`
}

type cpaAPIKeyListResponse struct {
	Items []cpaAPIKeyResponse `json:"items"`
}

type cpaAPIKeySettingsResponse struct {
	ID           string  `json:"id"`
	APIKey       string  `json:"apiKey"`
	KeyAlias     string  `json:"keyAlias"`
	DisplayKey   string  `json:"displayKey"`
	Label        string  `json:"label"`
	LastSyncedAt *string `json:"lastSyncedAt"`
}

type cpaAPIKeySettingsListResponse struct {
	Items []cpaAPIKeySettingsResponse `json:"items"`
}

type cpaAPIKeyOption struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

type cpaAPIKeyOptionsResponse struct {
	Options []cpaAPIKeyOption `json:"options"`
}

type updateCPAAPIKeyAliasRequest struct {
	KeyAlias string `json:"keyAlias"`
}

type saveCPAAPIKeyRequest struct {
	KeyAlias string `json:"keyAlias"`
	APIKey   string `json:"apiKey"`
}

func registerCPAAPIKeyRoutes(router gin.IRoutes, provider service.CPAAPIKeyProvider) {
	router.GET("/usage/api-keys", func(c *gin.Context) {
		rows, err := listCPAAPIKeyRows(c, provider)
		if err != nil {
			return
		}
		c.JSON(http.StatusOK, cpaAPIKeyListResponse{Items: rows})
	})

	router.GET("/usage/api-keys/settings", func(c *gin.Context) {
		rows, err := listCPAAPIKeySettingsRows(c, provider)
		if err != nil {
			return
		}
		c.JSON(http.StatusOK, cpaAPIKeySettingsListResponse{Items: rows})
	})

	router.GET("/usage/api-keys/options", func(c *gin.Context) {
		rows, err := listCPAAPIKeyOptionRows(c, provider)
		if err != nil {
			return
		}
		c.JSON(http.StatusOK, cpaAPIKeyOptionsResponse{Options: rows})
	})

	router.POST("/usage/api-keys", func(c *gin.Context) {
		if provider == nil {
			c.JSON(http.StatusNotImplemented, gin.H{"error": "api key provider is not configured"})
			return
		}
		request, ok := bindAndValidateCPAAPIKeyRequest(c)
		if !ok {
			return
		}
		row, err := provider.CreateCPAAPIKey(c.Request.Context(), request.KeyAlias, request.APIKey)
		if err != nil {
			writeCPAAPIKeyMutationError(c, "create api key failed", err)
			return
		}
		c.JSON(http.StatusCreated, toCPAAPIKeySettingsResponse(row))
	})

	router.PUT("/usage/api-keys/:id", func(c *gin.Context) {
		if provider == nil {
			c.JSON(http.StatusNotImplemented, gin.H{"error": "api key provider is not configured"})
			return
		}
		id, ok := parseCPAAPIKeyID(c)
		if !ok {
			return
		}
		request, ok := bindAndValidateCPAAPIKeyRequest(c)
		if !ok {
			return
		}
		row, err := provider.UpdateCPAAPIKey(c.Request.Context(), id, request.KeyAlias, request.APIKey)
		if err != nil {
			writeCPAAPIKeyMutationError(c, "update api key failed", err)
			return
		}
		c.JSON(http.StatusOK, toCPAAPIKeySettingsResponse(row))
	})

	router.PATCH("/usage/api-keys/:id", func(c *gin.Context) {
		if provider == nil {
			c.JSON(http.StatusNotImplemented, gin.H{"error": "api key provider is not configured"})
			return
		}
		id, ok := parseCPAAPIKeyID(c)
		if !ok {
			return
		}
		var request updateCPAAPIKeyAliasRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
			return
		}
		request.KeyAlias = strings.TrimSpace(request.KeyAlias)
		if err := validateCPAAPIKeyAlias(request.KeyAlias); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		row, err := provider.UpdateCPAAPIKeyAlias(c.Request.Context(), id, request.KeyAlias)
		if err != nil {
			if errors.Is(err, service.ErrInvalidID) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid api key id"})
				return
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				c.JSON(http.StatusNotFound, gin.H{"error": "api key not found"})
				return
			}
			writeInternalError(c, "update api key alias failed", err)
			return
		}
		c.JSON(http.StatusOK, toCPAAPIKeyResponse(row))
	})

	router.DELETE("/usage/api-keys/:id", func(c *gin.Context) {
		if provider == nil {
			c.JSON(http.StatusNotImplemented, gin.H{"error": "api key provider is not configured"})
			return
		}
		id, ok := parseCPAAPIKeyID(c)
		if !ok {
			return
		}
		if err := provider.DeleteCPAAPIKey(c.Request.Context(), id); err != nil {
			writeCPAAPIKeyMutationError(c, "delete api key failed", err)
			return
		}
		c.Status(http.StatusNoContent)
	})
}

func listCPAAPIKeyRows(c *gin.Context, provider service.CPAAPIKeyProvider) ([]cpaAPIKeyResponse, error) {
	if provider == nil {
		return []cpaAPIKeyResponse{}, nil
	}
	rows, err := provider.ListCPAAPIKeys(c.Request.Context())
	if err != nil {
		writeInternalError(c, "list api keys failed", err)
		return nil, err
	}
	response := make([]cpaAPIKeyResponse, 0, len(rows))
	for _, row := range rows {
		response = append(response, toCPAAPIKeyResponse(row))
	}
	return response, nil
}

func listCPAAPIKeySettingsRows(c *gin.Context, provider service.CPAAPIKeyProvider) ([]cpaAPIKeySettingsResponse, error) {
	if provider == nil {
		return []cpaAPIKeySettingsResponse{}, nil
	}
	rows, err := provider.ListCPAAPIKeys(c.Request.Context())
	if err != nil {
		writeInternalError(c, "list api key settings failed", err)
		return nil, err
	}
	response := make([]cpaAPIKeySettingsResponse, 0, len(rows))
	for _, row := range rows {
		response = append(response, toCPAAPIKeySettingsResponse(row))
	}
	return response, nil
}

func listCPAAPIKeyOptionRows(c *gin.Context, provider service.CPAAPIKeyProvider) ([]cpaAPIKeyOption, error) {
	if provider == nil {
		return []cpaAPIKeyOption{}, nil
	}
	rows, err := provider.ListCPAAPIKeys(c.Request.Context())
	if err != nil {
		writeInternalError(c, "list api key options failed", err)
		return nil, err
	}
	response := make([]cpaAPIKeyOption, 0, len(rows))
	for _, row := range rows {
		response = append(response, toCPAAPIKeyOption(row))
	}
	return response, nil
}

func toCPAAPIKeyResponse(row entities.CPAAPIKey) cpaAPIKeyResponse {
	label := helper.CPAAPIKeyDisplayName(row)
	var lastSyncedAt *string
	if row.LastSyncedAt != nil {
		value := timeutil.FormatStorageTime(*row.LastSyncedAt)
		lastSyncedAt = &value
	}
	return cpaAPIKeyResponse{
		ID:           strconv.FormatInt(row.ID, 10),
		KeyAlias:     row.KeyAlias,
		DisplayKey:   helper.CPAAPIKeyMaskedDisplayKey(row),
		Label:        label,
		LastSyncedAt: lastSyncedAt,
	}
}

func toCPAAPIKeySettingsResponse(row entities.CPAAPIKey) cpaAPIKeySettingsResponse {
	label := helper.CPAAPIKeyDisplayName(row)
	var lastSyncedAt *string
	if row.LastSyncedAt != nil {
		value := timeutil.FormatStorageTime(*row.LastSyncedAt)
		lastSyncedAt = &value
	}
	return cpaAPIKeySettingsResponse{
		ID:           strconv.FormatInt(row.ID, 10),
		APIKey:       row.APIKey,
		KeyAlias:     row.KeyAlias,
		DisplayKey:   helper.CPAAPIKeyMaskedDisplayKey(row),
		Label:        label,
		LastSyncedAt: lastSyncedAt,
	}
}

func toCPAAPIKeyOption(row entities.CPAAPIKey) cpaAPIKeyOption {
	label := helper.CPAAPIKeyDisplayName(row)
	return cpaAPIKeyOption{
		ID:    strconv.FormatInt(row.ID, 10),
		Label: label,
	}
}

func parseCPAAPIKeyID(c *gin.Context) (int64, bool) {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid api key id"})
		return 0, false
	}
	return id, true
}

func bindAndValidateCPAAPIKeyRequest(c *gin.Context) (saveCPAAPIKeyRequest, bool) {
	var request saveCPAAPIKeyRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return saveCPAAPIKeyRequest{}, false
	}
	request.KeyAlias = strings.TrimSpace(request.KeyAlias)
	request.APIKey = strings.TrimSpace(request.APIKey)
	if err := validateCPAAPIKeyName(request.KeyAlias); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return saveCPAAPIKeyRequest{}, false
	}
	if err := validateCPAAPIKeyValue(request.APIKey); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return saveCPAAPIKeyRequest{}, false
	}
	return request, true
}

func writeCPAAPIKeyMutationError(c *gin.Context, message string, err error) {
	if errors.Is(err, service.ErrInvalidID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid api key id"})
		return
	}
	if errors.Is(err, service.ErrInvalidCPAAPIKey) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "apiKey is required"})
		return
	}
	if errors.Is(err, service.ErrDuplicateCPAAPIKey) {
		c.JSON(http.StatusConflict, gin.H{"error": "apiKey already exists"})
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "api key not found"})
		return
	}
	writeInternalError(c, message, err)
}

func validateCPAAPIKeyName(value string) error {
	if value == "" {
		return errors.New("keyAlias is required")
	}
	return validateCPAAPIKeyAlias(value)
}

func validateCPAAPIKeyAlias(value string) error {
	if len([]rune(value)) > maxCPAAPIKeyAliasLength {
		return errors.New("keyAlias is too long")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return errors.New("keyAlias cannot contain control characters")
		}
	}
	return nil
}

func validateCPAAPIKeyValue(value string) error {
	if value == "" {
		return errors.New("apiKey is required")
	}
	if len([]rune(value)) > maxCPAAPIKeyValueLength {
		return errors.New("apiKey is too long")
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return errors.New("apiKey cannot contain control characters")
		}
	}
	return nil
}
