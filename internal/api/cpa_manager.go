package api

import (
	"context"
	"net/http"

	"CLIProxyAPIManager/internal/cpamanager"
	"github.com/gin-gonic/gin"
)

type CPAManagerProvider interface {
	Status(context.Context) cpamanager.RuntimeStatus
	Start(context.Context) error
	Stop(context.Context) error
	Restart(context.Context) error
	Update(context.Context) (cpamanager.RuntimeStatus, error)
	Events() []cpamanager.UpdateEvent
}

func registerCPAManagerRoutes(router gin.IRoutes, manager CPAManagerProvider) {
	router.GET("/cpa/runtime", func(c *gin.Context) {
		if manager == nil {
			c.JSON(http.StatusOK, cpamanager.RuntimeStatus{Enabled: false})
			return
		}
		c.JSON(http.StatusOK, manager.Status(c.Request.Context()))
	})
	router.GET("/cpa/update-events", func(c *gin.Context) {
		if manager == nil {
			c.JSON(http.StatusOK, []cpamanager.UpdateEvent{})
			return
		}
		c.JSON(http.StatusOK, manager.Events())
	})
	router.POST("/cpa/start", func(c *gin.Context) {
		if manager == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "CPA manager is disabled"})
			return
		}
		if err := manager.Start(c.Request.Context()); err != nil {
			writeInternalError(c, "start CPA failed", err)
			return
		}
		c.JSON(http.StatusOK, manager.Status(c.Request.Context()))
	})
	router.POST("/cpa/stop", func(c *gin.Context) {
		if manager == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "CPA manager is disabled"})
			return
		}
		if err := manager.Stop(c.Request.Context()); err != nil {
			writeInternalError(c, "stop CPA failed", err)
			return
		}
		c.JSON(http.StatusOK, manager.Status(c.Request.Context()))
	})
	router.POST("/cpa/restart", func(c *gin.Context) {
		if manager == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "CPA manager is disabled"})
			return
		}
		if err := manager.Restart(c.Request.Context()); err != nil {
			writeInternalError(c, "restart CPA failed", err)
			return
		}
		c.JSON(http.StatusOK, manager.Status(c.Request.Context()))
	})
	router.POST("/cpa/update", func(c *gin.Context) {
		if manager == nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "CPA manager is disabled"})
			return
		}
		status, err := manager.Update(c.Request.Context())
		if err != nil {
			writeInternalError(c, "update CPA failed", err)
			return
		}
		c.JSON(http.StatusOK, status)
	})
}
