package quota

import (
	"time"

	"CLIProxyAPIManager/internal/timeutil"
)

const AuthFileLimitReachedCooldownDuration = 5 * time.Hour

func authFileLimitReachedCooldownDuration(rows []QuotaRow, now time.Time) time.Duration {
	now = timeutil.NormalizeStorageTime(now)
	var restoreAt time.Time
	for _, row := range rows {
		if !quotaRowIsFiveHourWindow(row) || !quotaRowReachedLimit(row) {
			continue
		}
		candidate, ok := quotaRowRestoreAt(row, now)
		if !ok || !candidate.After(now) {
			continue
		}
		if restoreAt.IsZero() || candidate.After(restoreAt) {
			restoreAt = candidate
		}
	}
	if restoreAt.IsZero() {
		return AuthFileLimitReachedCooldownDuration
	}
	return restoreAt.Sub(now)
}

func quotaRowIsFiveHourWindow(row QuotaRow) bool {
	return row.Window != nil && row.Window.Seconds != nil && *row.Window.Seconds == quotaWindowFiveHourSeconds
}

func quotaRowReachedLimit(row QuotaRow) bool {
	return quotaRowLimitReached(row) ||
		quotaRowUsedPercentAtLeast(row, 100) ||
		quotaRowRemainingAtMost(row, 0) ||
		quotaRowUsedAtLimit(row)
}

func quotaRowRestoreAt(row QuotaRow, now time.Time) (time.Time, bool) {
	if row.ResetAt != "" {
		parsed, err := timeutil.ParseStorageTime(row.ResetAt)
		if err == nil {
			return timeutil.NormalizeStorageTime(parsed), true
		}
	}
	if row.ResetAfterSeconds != nil && *row.ResetAfterSeconds >= 0 {
		return timeutil.NormalizeStorageTime(now.Add(time.Duration(*row.ResetAfterSeconds) * time.Second)), true
	}
	return time.Time{}, false
}
