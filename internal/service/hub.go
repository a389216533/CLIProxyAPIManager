package service

import "sync"

const DefaultUsageEventHubBufferSize = 100

// UsageEventNotification 是 SSE Hub 内部事件，只携带已提交入库的 usage_events.id。
type UsageEventNotification struct {
	Sequence int64
	EventID  int64
}

// UsageEventPublisher 是 usage_events 事务提交后的非阻塞通知出口。
type UsageEventPublisher interface {
	PublishUsageEventID(eventID int64) UsageEventNotification
}

// UsageEventHub 维护在线客户端订阅和最近事件滑动窗口。
type UsageEventHub struct {
	mu          sync.RWMutex
	subscribers map[chan UsageEventNotification]struct{}
	buffer      []UsageEventNotification
	bufferCap   int
	nextSeq     int64
}

// NewUsageEventHub 创建事件 Hub。bufferCap 小于 1 时使用默认 100 条缓存。
func NewUsageEventHub(bufferCap int) *UsageEventHub {
	if bufferCap < 1 {
		bufferCap = DefaultUsageEventHubBufferSize
	}
	return &UsageEventHub{
		subscribers: make(map[chan UsageEventNotification]struct{}),
		buffer:      make([]UsageEventNotification, 0, bufferCap),
		bufferCap:   bufferCap,
	}
}

// PublishUsageEventID 广播已提交的 usage event ID，并写入滑动窗口。
func (h *UsageEventHub) PublishUsageEventID(eventID int64) UsageEventNotification {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.nextSeq++
	notification := UsageEventNotification{Sequence: h.nextSeq, EventID: eventID}
	if len(h.buffer) >= h.bufferCap {
		copy(h.buffer, h.buffer[1:])
		h.buffer[len(h.buffer)-1] = notification
	} else {
		h.buffer = append(h.buffer, notification)
	}

	for ch := range h.subscribers {
		select {
		case ch <- notification:
		default:
		}
	}
	return notification
}

// SubscribeUsageEvents 注册订阅并返回 lastSequence 之后的可重放事件。
// 当 lastSequence 已经早于缓存窗口时，syncRequired=true，调用方应触发完整刷新。
func (h *UsageEventHub) SubscribeUsageEvents(lastSequence int64) (<-chan UsageEventNotification, []UsageEventNotification, bool, func()) {
	h.mu.Lock()
	defer h.mu.Unlock()

	ch := make(chan UsageEventNotification, 50)
	h.subscribers[ch] = struct{}{}
	replay := make([]UsageEventNotification, 0)
	syncRequired := false

	if len(h.buffer) > 0 {
		firstSeq := h.buffer[0].Sequence
		if lastSequence > 0 && lastSequence < firstSeq-1 {
			syncRequired = true
		} else {
			for _, notification := range h.buffer {
				if notification.Sequence > lastSequence {
					replay = append(replay, notification)
				}
			}
		}
	}

	unsubscribe := func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		if _, ok := h.subscribers[ch]; !ok {
			return
		}
		delete(h.subscribers, ch)
		close(ch)
	}
	return ch, replay, syncRequired, unsubscribe
}
