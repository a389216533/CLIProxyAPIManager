package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"CLIProxyAPIManager/internal/service"
	servicedto "CLIProxyAPIManager/internal/service/dto"
	"CLIProxyAPIManager/internal/timeutil"

	"github.com/gin-gonic/gin"
)

type usageEventsByIDProvider interface {
	ListUsageEventsByIDs(context.Context, servicedto.UsageFilter, []int64) ([]servicedto.UsageEventRecord, error)
}

// registerUsageEventStreamRoute 注册 usage events 的 SSE 实时事件流。
func registerUsageEventStreamRoute(
	router gin.IRoutes,
	usageProvider service.UsageProvider,
	usageIdentityProvider service.UsageIdentityProvider,
	cpaAPIKeyProvider service.CPAAPIKeyProvider,
	hub *service.UsageEventHub,
) {
	if hub == nil {
		return
	}
	router.GET("/usage/events/stream", func(c *gin.Context) {
		byIDProvider, ok := usageProvider.(usageEventsByIDProvider)
		if usageProvider == nil || !ok {
			c.Status(http.StatusNoContent)
			return
		}

		filter, err := parseUsageFilterQuery(c.Request, timeutil.NormalizeStorageTime(time.Now()))
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		if err := applyUsageEventsSourceFilter(&filter); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		identities, err := loadUsageResolutionData(c, usageIdentityProvider)
		if err != nil {
			writeInternalError(c, "load usage resolution data failed", err)
			return
		}
		resolver := newUsageIdentityResolver(identities)
		apiKeyInfos, err := loadCPAAPIKeyInfos(c, cpaAPIKeyProvider)
		if err != nil {
			return
		}

		lastSequence := parseLastEventID(c.GetHeader("Last-Event-ID"))
		notifications, replay, syncRequired, unsubscribe := hub.SubscribeUsageEvents(lastSequence)
		defer unsubscribe()

		c.Header("Content-Type", "text/event-stream; charset=utf-8")
		c.Header("Cache-Control", "no-store")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")
		c.Status(http.StatusOK)

		if syncRequired {
			if err := writeSSEFrame(c, 0, "sync_required", gin.H{}); err != nil {
				return
			}
		} else if err := writeUsageEventNotifications(c, byIDProvider, filter, replay, resolver, apiKeyInfos); err != nil {
			return
		}

		ticker := time.NewTicker(20 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-c.Request.Context().Done():
				return
			case notification, ok := <-notifications:
				if !ok {
					return
				}
				if err := writeUsageEventNotifications(c, byIDProvider, filter, []service.UsageEventNotification{notification}, resolver, apiKeyInfos); err != nil {
					return
				}
			case <-ticker.C:
				if _, err := c.Writer.Write([]byte(": ping\n\n")); err != nil {
					return
				}
				c.Writer.Flush()
			}
		}
	})
}

func parseLastEventID(value string) int64 {
	sequence, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || sequence < 0 {
		return 0
	}
	return sequence
}

func writeUsageEventNotifications(
	c *gin.Context,
	provider usageEventsByIDProvider,
	filter servicedto.UsageFilter,
	notifications []service.UsageEventNotification,
	resolver usageIdentityResolver,
	apiKeyInfos map[string]analysisAPIKeyInfo,
) error {
	if len(notifications) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(notifications))
	for _, notification := range notifications {
		if notification.EventID > 0 {
			ids = append(ids, notification.EventID)
		}
	}
	rows, err := provider.ListUsageEventsByIDs(c.Request.Context(), filter, ids)
	if err != nil {
		return err
	}
	rowByID := make(map[int64]servicedto.UsageEventRecord, len(rows))
	for _, row := range rows {
		rowByID[row.ID] = row
	}
	for _, notification := range notifications {
		row, ok := rowByID[notification.EventID]
		if !ok {
			continue
		}
		payloads := buildUsageEventsPayload([]servicedto.UsageEventRecord{row}, resolver, apiKeyInfos)
		if len(payloads) == 0 {
			continue
		}
		if err := writeSSEFrame(c, notification.Sequence, "usage_event", payloads[0]); err != nil {
			return err
		}
	}
	return nil
}

func writeSSEFrame(c *gin.Context, id int64, event string, payload any) error {
	if id > 0 {
		if _, err := fmt.Fprintf(c.Writer, "id: %d\n", id); err != nil {
			return err
		}
	}
	if _, err := fmt.Fprintf(c.Writer, "event: %s\n", event); err != nil {
		return err
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	if _, err := c.Writer.Write([]byte("data: " + string(data) + "\n\n")); err != nil {
		return err
	}
	c.Writer.Flush()
	return nil
}
