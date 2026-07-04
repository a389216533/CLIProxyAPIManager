package quota

import (
	"testing"
	"time"

	"CLIProxyAPIManager/internal/timeutil"
)

func TestAuthFileLimitReachedCooldownDurationUsesFiveHourResetAt(t *testing.T) {
	now := time.Date(2026, 7, 2, 11, 0, 0, 0, time.Local)
	resetAt := timeutil.FormatStorageTime(now.Add(2 * time.Hour))
	rows := []QuotaRow{{
		Window:      &QuotaWindow{Seconds: intPtr(quotaWindowFiveHourSeconds)},
		UsedPercent: floatPtr(100),
		ResetAt:     resetAt,
	}}

	duration := authFileLimitReachedCooldownDuration(rows, now)
	if duration != 2*time.Hour {
		t.Fatalf("expected cooldown until reset_at, got %s", duration)
	}
}

func TestAuthFileLimitReachedCooldownDurationFallsBackWhenResetMissing(t *testing.T) {
	now := time.Date(2026, 7, 2, 11, 0, 0, 0, time.Local)
	rows := []QuotaRow{{
		Window:      &QuotaWindow{Seconds: intPtr(quotaWindowFiveHourSeconds)},
		UsedPercent: floatPtr(100),
	}}

	duration := authFileLimitReachedCooldownDuration(rows, now)
	if duration != AuthFileLimitReachedCooldownDuration {
		t.Fatalf("expected default cooldown duration, got %s", duration)
	}
}

func TestAuthFileLimitReachedCooldownDurationUsesResetAfterSeconds(t *testing.T) {
	now := time.Date(2026, 7, 2, 11, 0, 0, 0, time.Local)
	resetAfterSeconds := int64(900)
	rows := []QuotaRow{{
		Window:            &QuotaWindow{Seconds: intPtr(quotaWindowFiveHourSeconds)},
		UsedPercent:       floatPtr(100),
		ResetAfterSeconds: &resetAfterSeconds,
	}}

	duration := authFileLimitReachedCooldownDuration(rows, now)
	if duration != 15*time.Minute {
		t.Fatalf("expected cooldown from reset_after_seconds, got %s", duration)
	}
}
