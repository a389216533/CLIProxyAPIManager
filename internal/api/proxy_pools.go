package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"CLIProxyAPIManager/internal/entities"
	"CLIProxyAPIManager/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type proxyPoolsResponse struct {
	ProxyPools []proxyPoolResponse `json:"proxy_pools"`
}

type proxyPoolResponse struct {
	ID                 string `json:"id"`
	Name               string `json:"name"`
	ProxyURL           string `json:"proxy_url"`
	BoundAuthFileCount int64  `json:"bound_auth_file_count"`
	AverageLatencyMS   *int64 `json:"average_latency_ms,omitempty"`
	LatencySource      string `json:"latency_source,omitempty"`
	CreatedAt          string `json:"created_at"`
	UpdatedAt          string `json:"updated_at"`
}

type proxyPoolTestResponse struct {
	IP         string                       `json:"ip"`
	Address    string                       `json:"address"`
	Country    string                       `json:"country"`
	Region     string                       `json:"region"`
	City       string                       `json:"city"`
	Org        string                       `json:"org"`
	CheckedAt  string                       `json:"checked_at"`
	DurationMS int64                        `json:"duration_ms"`
	Targets    proxyPoolTestTargetsResponse `json:"targets"`
}

type proxyPoolTestTargetsResponse struct {
	Latency proxyPoolTestTargetResponse `json:"latency"`
	GPT     proxyPoolTestTargetResponse `json:"gpt"`
	Claude  proxyPoolTestTargetResponse `json:"claude"`
}

type proxyPoolTestTargetResponse struct {
	OK         bool   `json:"ok"`
	DurationMS int64  `json:"duration_ms"`
	StatusCode int    `json:"status_code"`
	Error      string `json:"error"`
	URL        string `json:"url"`
}

type proxyPoolRequest struct {
	Name     string `json:"name"`
	ProxyURL string `json:"proxy_url"`
}

func registerProxyPoolRoutes(router gin.IRoutes, provider service.ProxyPoolProvider) {
	router.GET("/proxy-pools", func(c *gin.Context) {
		if provider == nil {
			c.JSON(http.StatusOK, proxyPoolsResponse{ProxyPools: []proxyPoolResponse{}})
			return
		}
		pools, err := provider.ListProxyPools(c.Request.Context())
		if err != nil {
			writeInternalError(c, "list proxy pools failed", err)
			return
		}
		c.JSON(http.StatusOK, proxyPoolsResponse{ProxyPools: mapProxyPoolsResponse(pools)})
	})

	router.POST("/proxy-pools", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "proxy pool provider is not configured", nil)
			return
		}
		input, ok := parseProxyPoolRequest(c)
		if !ok {
			return
		}
		pool, err := provider.CreateProxyPool(c.Request.Context(), input)
		if err != nil {
			writeProxyPoolError(c, err)
			return
		}
		c.JSON(http.StatusCreated, mapProxyPoolResponse(pool))
	})

	router.PATCH("/proxy-pools/:id", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "proxy pool provider is not configured", nil)
			return
		}
		id, ok := parsePositiveInt64Param(c, "id")
		if !ok {
			return
		}
		input, ok := parseProxyPoolRequest(c)
		if !ok {
			return
		}
		pool, err := provider.UpdateProxyPool(c.Request.Context(), id, input)
		if err != nil {
			writeProxyPoolError(c, err)
			return
		}
		c.JSON(http.StatusOK, mapProxyPoolResponse(pool))
	})

	router.POST("/proxy-pools/:id/test", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "proxy pool provider is not configured", nil)
			return
		}
		id, ok := parsePositiveInt64Param(c, "id")
		if !ok {
			return
		}
		result, err := provider.TestProxyPool(c.Request.Context(), id)
		if err != nil {
			writeProxyPoolError(c, err)
			return
		}
		c.JSON(http.StatusOK, mapProxyPoolTestResponse(result))
	})

	router.DELETE("/proxy-pools/:id", func(c *gin.Context) {
		if provider == nil {
			writeInternalError(c, "proxy pool provider is not configured", nil)
			return
		}
		id, ok := parsePositiveInt64Param(c, "id")
		if !ok {
			return
		}
		if err := provider.DeleteProxyPool(c.Request.Context(), id); err != nil {
			writeProxyPoolError(c, err)
			return
		}
		c.Status(http.StatusNoContent)
	})
}

func parseProxyPoolRequest(c *gin.Context) (service.ProxyPoolInput, bool) {
	var request proxyPoolRequest
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return service.ProxyPoolInput{}, false
	}
	return service.ProxyPoolInput{Name: request.Name, ProxyURL: request.ProxyURL}, true
}

func parsePositiveInt64Param(c *gin.Context, key string) (int64, bool) {
	id, err := strconv.ParseInt(strings.TrimSpace(c.Param(key)), 10, 64)
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return 0, false
	}
	return id, true
}

func writeProxyPoolError(c *gin.Context, err error) {
	if errors.Is(err, service.ErrProxyPoolValidation) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, service.ErrInvalidID) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "proxy pool not found"})
		return
	}
	writeInternalError(c, "proxy pool operation failed", err)
}

func mapProxyPoolsResponse(pools []entities.ProxyPool) []proxyPoolResponse {
	response := make([]proxyPoolResponse, 0, len(pools))
	for _, pool := range pools {
		response = append(response, mapProxyPoolResponse(pool))
	}
	return response
}

func mapProxyPoolResponse(pool entities.ProxyPool) proxyPoolResponse {
	return proxyPoolResponse{
		ID:                 strconv.FormatInt(pool.ID, 10),
		Name:               pool.Name,
		ProxyURL:           pool.ProxyURL,
		BoundAuthFileCount: pool.BoundAuthFileCount,
		AverageLatencyMS:   pool.AverageLatencyMS,
		LatencySource:      pool.LatencySource,
		CreatedAt:          pool.CreatedAt.Format(time.RFC3339Nano),
		UpdatedAt:          pool.UpdatedAt.Format(time.RFC3339Nano),
	}
}

func mapProxyPoolTestResponse(result service.ProxyPoolTestResult) proxyPoolTestResponse {
	return proxyPoolTestResponse{
		IP:         result.IP,
		Address:    result.Address,
		Country:    result.Country,
		Region:     result.Region,
		City:       result.City,
		Org:        result.Org,
		CheckedAt:  result.CheckedAt.Format(time.RFC3339Nano),
		DurationMS: result.DurationMS,
		Targets: proxyPoolTestTargetsResponse{
			Latency: mapProxyPoolTestTargetResponse(result.Targets.Latency),
			GPT:     mapProxyPoolTestTargetResponse(result.Targets.GPT),
			Claude:  mapProxyPoolTestTargetResponse(result.Targets.Claude),
		},
	}
}

func mapProxyPoolTestTargetResponse(result service.ProxyPoolTargetResult) proxyPoolTestTargetResponse {
	return proxyPoolTestTargetResponse{
		OK:         result.OK,
		DurationMS: result.DurationMS,
		StatusCode: result.StatusCode,
		Error:      result.Error,
		URL:        result.URL,
	}
}
