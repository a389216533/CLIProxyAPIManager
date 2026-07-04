package service

import "testing"

func TestUsageEventHubReplaysEventsAfterLastSequence(t *testing.T) {
	hub := NewUsageEventHub(3)
	first := hub.PublishUsageEventID(101)
	second := hub.PublishUsageEventID(102)
	third := hub.PublishUsageEventID(103)

	sub, replay, syncRequired, unsubscribe := hub.SubscribeUsageEvents(first.Sequence)
	defer unsubscribe()

	if syncRequired {
		t.Fatal("expected replay to be available")
	}
	if len(replay) != 2 {
		t.Fatalf("expected two replayed events, got %d", len(replay))
	}
	if replay[0] != second || replay[1] != third {
		t.Fatalf("unexpected replay: %#v", replay)
	}
	if sub == nil {
		t.Fatal("expected subscription channel")
	}
}

func TestUsageEventHubReportsSyncRequiredWhenLastSequenceFallsOutOfBuffer(t *testing.T) {
	hub := NewUsageEventHub(2)
	first := hub.PublishUsageEventID(201)
	hub.PublishUsageEventID(202)
	hub.PublishUsageEventID(203)
	hub.PublishUsageEventID(204)

	_, replay, syncRequired, unsubscribe := hub.SubscribeUsageEvents(first.Sequence)
	defer unsubscribe()

	if !syncRequired {
		t.Fatal("expected sync_required when replay window is no longer complete")
	}
	if len(replay) != 0 {
		t.Fatalf("expected no partial replay when sync is required, got %#v", replay)
	}
}

func TestUsageEventHubPublishesToSubscribersWithoutBlocking(t *testing.T) {
	hub := NewUsageEventHub(1)
	sub, replay, syncRequired, unsubscribe := hub.SubscribeUsageEvents(0)
	defer unsubscribe()

	if syncRequired || len(replay) != 0 {
		t.Fatalf("unexpected initial replay syncRequired=%v replay=%#v", syncRequired, replay)
	}
	notification := hub.PublishUsageEventID(301)

	select {
	case got := <-sub:
		if got != notification {
			t.Fatalf("unexpected notification: %#v", got)
		}
	default:
		t.Fatal("expected subscriber to receive published event")
	}
}
