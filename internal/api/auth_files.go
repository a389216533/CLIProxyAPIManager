package api

import (
	"errors"
	"net/http"

	"CLIProxyAPIManager/internal/service"
	"github.com/gin-gonic/gin"
)

type authFilesRequest struct {
	Names []string `json:"names"`
}

type authFilesStatusRequest struct {
	Names    []string `json:"names"`
	Disabled bool     `json:"disabled"`
}

type authFilesProxyRequest struct {
	Names    []string `json:"names"`
	ProxyURL *string  `json:"proxy_url"`
}

type authFilesNoteRequest struct {
	Names []string `json:"names"`
	Note  *string  `json:"note"`
}

type authFilesImportRequest struct {
	Content string `json:"content"`
}

func registerAuthFileManagementRoutes(router gin.IRoutes, provider service.AuthFilesManagementProvider) {
	router.POST("/auth-files/import", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "auth files management provider is not configured", nil)
			return
		}

		var request authFilesImportRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "import content is required"})
			return
		}

		response, err := provider.ImportAuthFiles(c.Request.Context(), request.Content)
		if err != nil {
			if errors.Is(err, service.ErrAuthFilesManagementValidation) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid import content"})
				return
			}
			writeInternalError(c, "auth files import failed", err)
			return
		}
		c.JSON(http.StatusOK, response)
	})

	router.PATCH("/auth-files/status", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "auth files management provider is not configured", nil)
			return
		}

		var request authFilesStatusRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "names are required"})
			return
		}

		response, err := provider.SetAuthFilesDisabled(c.Request.Context(), request.Names, request.Disabled)
		if err != nil {
			if errors.Is(err, service.ErrAuthFilesManagementValidation) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "names are required"})
				return
			}
			writeInternalError(c, "auth files status update failed", err)
			return
		}
		c.JSON(http.StatusOK, response)
	})

	router.PATCH("/auth-files/proxy", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "auth files management provider is not configured", nil)
			return
		}

		var request authFilesProxyRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "names are required"})
			return
		}

		response, err := provider.SetAuthFilesProxyURL(c.Request.Context(), request.Names, request.ProxyURL)
		if err != nil {
			if errors.Is(err, service.ErrAuthFilesManagementValidation) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "names are required"})
				return
			}
			writeInternalError(c, "auth files proxy update failed", err)
			return
		}
		c.JSON(http.StatusOK, response)
	})

	router.PATCH("/auth-files/note", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "auth files management provider is not configured", nil)
			return
		}

		var request authFilesNoteRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "names are required"})
			return
		}

		response, err := provider.SetAuthFilesNote(c.Request.Context(), request.Names, request.Note)
		if err != nil {
			if errors.Is(err, service.ErrAuthFilesManagementValidation) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "names are required"})
				return
			}
			writeInternalError(c, "auth files note update failed", err)
			return
		}
		c.JSON(http.StatusOK, response)
	})

	router.DELETE("/auth-files", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "auth files management provider is not configured", nil)
			return
		}

		var request authFilesRequest
		if err := c.ShouldBindJSON(&request); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "names are required"})
			return
		}

		response, err := provider.DeleteAuthFiles(c.Request.Context(), request.Names)
		if err != nil {
			if errors.Is(err, service.ErrAuthFilesManagementValidation) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "names are required"})
				return
			}
			writeInternalError(c, "auth files delete failed", err)
			return
		}
		c.JSON(http.StatusOK, response)
	})
}
