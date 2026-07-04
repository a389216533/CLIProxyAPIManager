package api

import (
	"errors"
	"net/http"

	"CLIProxyAPIManager/internal/service"
	"github.com/gin-gonic/gin"
)

type authFileCooldownStartRequest struct {
	AuthIndex string `json:"auth_index"`
	FileName  string `json:"file_name"`
}

type authFileCooldownRestoreRequest struct {
	AuthIndex string `json:"auth_index"`
}

func registerAuthFileCooldownRoutes(router gin.IRoutes, provider service.AuthFileCooldownProvider) {
	router.GET("/auth-files/cooldowns", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "auth file cooldown provider is not configured", nil)
			return
		}
		response, err := provider.ListAuthFileCooldowns(c.Request.Context())
		if err != nil {
			writeInternalError(c, "auth file cooldown list failed", err)
			return
		}
		c.JSON(http.StatusOK, response)
	})

	router.POST("/auth-files/cooldowns", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "auth file cooldown provider is not configured", nil)
			return
		}
		var request authFileCooldownStartRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "auth_index and file_name are required"})
			return
		}
		response, err := provider.StartAuthFileCooldown(c.Request.Context(), service.AuthFileCooldownStartRequest{
			AuthIndex: request.AuthIndex,
			FileName:  request.FileName,
			Source:    "manual",
			Reason:    "manual",
			Duration:  service.AuthFileCooldownDefaultDuration,
		})
		if err != nil {
			if errors.Is(err, service.ErrAuthFilesManagementValidation) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "auth_index and file_name are required"})
				return
			}
			writeInternalError(c, "auth file cooldown start failed", err)
			return
		}
		c.JSON(http.StatusOK, response)
	})

	router.POST("/auth-files/cooldowns/restore", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "auth file cooldown provider is not configured", nil)
			return
		}
		var request authFileCooldownRestoreRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "auth_index is required"})
			return
		}
		response, err := provider.RestoreAuthFileCooldown(c.Request.Context(), service.AuthFileCooldownRestoreRequest{AuthIndex: request.AuthIndex})
		if err != nil {
			switch {
			case errors.Is(err, service.ErrAuthFilesManagementValidation):
				c.JSON(http.StatusBadRequest, gin.H{"error": "auth_index is required"})
			case errors.Is(err, service.ErrAuthFileCooldownNotFound):
				c.JSON(http.StatusNotFound, gin.H{"error": "auth file cooldown not found"})
			default:
				writeInternalError(c, "auth file cooldown restore failed", err)
			}
			return
		}
		c.JSON(http.StatusOK, response)
	})
}
