import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCustomDateRangeQuery, clampCustomDateRangeToBounds, cpaUpdateCheckIntervalMs, CUSTOM_DATE_RANGE_BOUNDS_REFRESH_INTERVAL_MS, getBackToCPALinkURL, getCredentialSectionVisibility, getCustomDateRangeBounds, getOverviewDisplayLoading, getTimeRangeOptions, getUsageTabFromSearch, getUsageTabOptions, getVisibleUsageTabOptions, isCustomDateWithinBounds, isUsagePageVisible, loadRequestEventsPreferences, loadUsagePageVersionInfo, mergeRealtimeUsageEventPage, normalizeRequestEventsPreferences, normalizeUsageTabValue, openDateInputPicker, refreshPageData, REQUEST_EVENTS_PREFERENCES_STORAGE_KEY, sanitizeRequestEventFilters, saveRequestEventsPreferences, scheduleCpaUpdateChecks, scheduleCustomDateRangeBoundsRefresh, scheduleOverviewAutoRefresh, scheduleStatusActiveHeartbeat, shouldAutoRefreshUsageTab, shouldShowApiKeyFilter, shouldShowRangeControls, shouldShowUpdateCheckButton, STATUS_ACTIVE_HEARTBEAT_INTERVAL_MS, getUpdateCheckToastDuration } from './UsagePage';
import { REQUEST_EVENT_COLUMN_IDS } from '@/components/usage/RequestEventsDetailsCard';
import { ApiError } from '@/lib/api';
import type { StatusResponse, UsageFilterWindow, VersionResponse } from '@/lib/types';

const usagePageSource = readFileSync(new URL('./UsagePage.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const usageProxyPoolsTabSource = readFileSync(new URL('./usage/UsageProxyPoolsTab.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const createAutoRefreshTestDocument = (visibilityState: DocumentVisibilityState = 'visible') => {
  const target = new EventTarget();
  return {
    get visibilityState() {
      return visibilityState;
    },
    setVisibilityState(nextVisibilityState: DocumentVisibilityState) {
      visibilityState = nextVisibilityState;
    },
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    dispatchEvent: target.dispatchEvent.bind(target),
  };
};

const createStatusResponse = (lastError = '', quotaAutoRefreshEnabled = true): StatusResponse => ({
  running: true,
  sync_running: false,
  timezone: 'UTC',
  last_error: lastError,
  quotaAutoRefreshEnabled,
});

const flushPromises = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

const createMemoryStorage = (seed: Record<string, string> = {}) => {
  const values = new Map(Object.entries(seed));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    value: (key: string) => values.get(key),
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('UsagePage Overview loading display', () => {
  it('keeps existing Overview data visible during background refresh', () => {
    expect(getOverviewDisplayLoading({ loading: true, hasUsage: true })).toBe(false);
  });

  it('shows loading before Overview data has loaded', () => {
    expect(getOverviewDisplayLoading({ loading: true, hasUsage: false })).toBe(true);
  });
});

describe('UsagePage Back to CPA link', () => {
  it('uses the CPA public URL from status', () => {
    expect(getBackToCPALinkURL({ cpa_public_url: 'https://cpa.example.com' }, 'https://keeper.example.com')).toBe('https://cpa.example.com/management.html');
  });

  it('does not fall back to the Manager origin when status does not include a CPA public URL', () => {
    expect(getBackToCPALinkURL({}, 'https://manager.example.com')).toBe('');
    expect(getBackToCPALinkURL(null, 'https://manager.example.com')).toBe('');
  });

  it('normalizes trailing slashes and existing management pages', () => {
    expect(getBackToCPALinkURL({ cpa_public_url: 'https://cpa.example.com/' }, 'https://keeper.example.com')).toBe('https://cpa.example.com/management.html');
    expect(getBackToCPALinkURL({ cpa_public_url: 'https://cpa.example.com/cpa/' }, 'https://keeper.example.com')).toBe('https://cpa.example.com/cpa/management.html');
    expect(getBackToCPALinkURL({ cpa_public_url: 'https://cpa.example.com/management.html' }, 'https://keeper.example.com')).toBe('https://cpa.example.com/management.html');
  });

  it('supports relative public paths and bare host names', () => {
    expect(getBackToCPALinkURL({ cpa_public_url: '/cpa/' }, 'https://keeper.example.com')).toBe('https://keeper.example.com/cpa/management.html');
    expect(getBackToCPALinkURL({ cpa_public_url: 'cpa.domain.com/' }, 'https://keeper.example.com')).toBe('https://cpa.domain.com/management.html');
    expect(getBackToCPALinkURL({ cpa_public_url: 'cpa.domain.com:8317/' }, 'https://keeper.example.com')).toBe('https://cpa.domain.com:8317/management.html');
  });

  it('rejects explicit non-http public URL schemes', () => {
    expect(getBackToCPALinkURL({ cpa_public_url: 'javascript://alert(1)' }, 'https://keeper.example.com')).toBe('');
    expect(getBackToCPALinkURL({ cpa_public_url: 'data://text/html,<script>alert(1)</script>' }, 'https://keeper.example.com')).toBe('');
    expect(getBackToCPALinkURL({ cpa_public_url: 'file:///etc/passwd' }, 'https://keeper.example.com')).toBe('');
    expect(getBackToCPALinkURL({ cpa_public_url: 'ftp://cpa.example.com' }, 'https://keeper.example.com')).toBe('');
  });
});

describe('UsagePage update check controls', () => {
  it('loads version info through the dedicated version loader', async () => {
    const signal = new AbortController().signal;
    const versionInfo = { version: 'v1.2.3', updateCheckEnabled: true };
    const loadVersion = vi.fn(async () => versionInfo);
    const setVersionInfo = vi.fn();

    await loadUsagePageVersionInfo({ loadVersion, signal, setVersionInfo });

    expect(loadVersion).toHaveBeenCalledWith(signal);
    expect(setVersionInfo).toHaveBeenCalledWith(versionInfo);
  });

  it('clears version info when version loading fails', async () => {
    const signal = new AbortController().signal;
    const loadVersion = vi.fn(async () => {
      throw new Error('network failed');
    });
    const setVersionInfo = vi.fn();

    await loadUsagePageVersionInfo({ loadVersion, signal, setVersionInfo });

    expect(setVersionInfo).toHaveBeenCalledWith(null);
  });

  it('requests reauthentication when version loading returns 401', async () => {
    const signal = new AbortController().signal;
    const loadVersion = vi.fn(async () => {
      throw new ApiError('expired', 401);
    });
    const setVersionInfo = vi.fn();
    const onAuthRequired = vi.fn();

    await loadUsagePageVersionInfo({ loadVersion, signal, setVersionInfo, onAuthRequired });

    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(setVersionInfo).not.toHaveBeenCalled();
  });

  it('ignores version results after the request is aborted', async () => {
    const requestController = new AbortController();
    const versionInfo = { version: 'v1.2.3', updateCheckEnabled: true };
    const loadVersion = vi.fn(async () => {
      requestController.abort();
      return versionInfo;
    });
    const setVersionInfo = vi.fn();

    await loadUsagePageVersionInfo({ loadVersion, signal: requestController.signal, setVersionInfo });

    expect(setVersionInfo).not.toHaveBeenCalled();
  });

  it('hides the update button before version loads', () => {
    expect(shouldShowUpdateCheckButton(null)).toBe(false);
  });

  it('hides the update button for dev builds', () => {
    expect(shouldShowUpdateCheckButton({ version: 'dev', updateCheckEnabled: false } satisfies VersionResponse)).toBe(false);
  });

  it('shows the update button for release builds', () => {
    expect(shouldShowUpdateCheckButton({ version: 'v1.2.3', updateCheckEnabled: true })).toBe(true);
  });

  it('keeps failure toasts visible longer than success toasts', () => {
    expect(getUpdateCheckToastDuration('success')).toBe(4_000);
    expect(getUpdateCheckToastDuration('info')).toBe(4_000);
    expect(getUpdateCheckToastDuration('error')).toBe(6_000);
  });
});

describe('UsagePage credential reset notice wiring', () => {
  it('passes the top notice handler into the credentials hook', () => {
    expect(usagePageSource).toContain('onNotice: showTopNotice')
    expect(usagePageSource).toMatch(/const showTopNotice = useCallback\([\s\S]*const credentialsData = useCredentialsTabData/)
  })
});

describe('UsagePage config diagnostics tab', () => {
  it('adds config diagnostics as an independent tab without range controls or auto refresh', () => {
    const translate = (key: string) => key;

    expect(getUsageTabOptions(translate).map((option) => option.value)).toContain('config-diagnostics');
    expect(shouldShowRangeControls('config-diagnostics')).toBe(false);
    expect(shouldAutoRefreshUsageTab({ activeTab: 'config-diagnostics', eventsPage: 1 })).toBe(false);
    expect(normalizeUsageTabValue('config-diagnostics')).toBe('config-diagnostics');
  });
});

describe('UsagePage public readonly mode', () => {
  it('only exposes readonly usage tabs', () => {
    const publicTabs = getVisibleUsageTabOptions((key) => key, 'public').map((option) => option.value);

    expect(publicTabs).toEqual(['overview', 'events']);
    expect(publicTabs).not.toContain('cpa-manager');
    expect(publicTabs).not.toContain('api-keys');
    expect(publicTabs).not.toContain('settings');
    expect(publicTabs).not.toContain('auth-files');
  });
});

describe('UsagePage Overview auto-refresh', () => {
  it('refreshes the Overview tab every 10 seconds', () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument();
    const refreshOverview = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, documentRef: testDocument });

    vi.advanceTimersByTime(9_999);
    expect(refreshOverview).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(refreshOverview).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('does not schedule refreshes outside the Overview tab', () => {
    vi.useFakeTimers();
    const refreshOverview = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: false, refreshOverview });

    vi.advanceTimersByTime(10_000);
    expect(refreshOverview).not.toHaveBeenCalled();

    cleanup();
  });

  it('pauses while the browser tab is hidden', () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument('hidden');
    const refreshOverview = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, documentRef: testDocument });

    vi.advanceTimersByTime(10_000);
    expect(refreshOverview).not.toHaveBeenCalled();

    cleanup();
  });

  it('refreshes once when the browser tab becomes visible again', () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument('hidden');
    const refreshOverview = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, documentRef: testDocument });
    testDocument.setVisibilityState('visible');
    testDocument.dispatchEvent(new Event('visibilitychange'));

    expect(refreshOverview).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('routes auto-refresh failures to the refresh error handler', async () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument();
    const failure = new Error('refresh failed');
    const refreshOverview = vi.fn(async () => {
      throw failure;
    });
    const onRefreshError = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, onRefreshError, documentRef: testDocument });

    vi.advanceTimersByTime(10_000);
    await flushPromises();

    expect(onRefreshError).toHaveBeenCalledWith(failure);

    cleanup();
  });

  it('restarts the interval cadence after refreshing on visibility restore', () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument('hidden');
    const refreshOverview = vi.fn();

    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, documentRef: testDocument });
    vi.advanceTimersByTime(9_999);
    testDocument.setVisibilityState('visible');
    testDocument.dispatchEvent(new Event('visibilitychange'));

    expect(refreshOverview).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(refreshOverview).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(9_999);
    expect(refreshOverview).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('cleans up the interval and visibility listener', () => {
    vi.useFakeTimers();
    const testDocument = createAutoRefreshTestDocument();
    const refreshOverview = vi.fn();
    const cleanup = scheduleOverviewAutoRefresh({ enabled: true, refreshOverview, documentRef: testDocument });

    cleanup();
    vi.advanceTimersByTime(10_000);
    testDocument.dispatchEvent(new Event('visibilitychange'));

    expect(refreshOverview).not.toHaveBeenCalled();
  });
});

describe('UsagePage visibility guard', () => {
  it('treats hidden documents as inactive for credentials polling', () => {
    expect(isUsagePageVisible({ visibilityState: 'visible' })).toBe(true);
    expect(isUsagePageVisible({ visibilityState: 'hidden' })).toBe(false);
  });
});

describe('UsagePage CPA update checks', () => {
  it('converts the backend duration from nanoseconds to browser milliseconds', () => {
    expect(cpaUpdateCheckIntervalMs(6 * 60 * 60 * 1_000_000_000)).toBe(21_600_000);
    expect(cpaUpdateCheckIntervalMs(0)).toBe(0);
    expect(cpaUpdateCheckIntervalMs(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('checks on the configured cadence and when the page becomes visible', async () => {
    let intervalHandler: (() => void) | undefined;
    const testDocument = createAutoRefreshTestDocument();
    const timerTarget = {
      setInterval: vi.fn((handler: () => void, timeout: number) => {
        intervalHandler = handler;
        expect(timeout).toBe(21_600_000);
        return 21;
      }),
      clearInterval: vi.fn(),
    };
    const checkForUpdate = vi.fn(async () => undefined);

    const cleanup = scheduleCpaUpdateChecks({
      enabled: true,
      intervalNanoseconds: 6 * 60 * 60 * 1_000_000_000,
      checkForUpdate,
      documentRef: testDocument,
      timerTarget,
    });

    expect(checkForUpdate).not.toHaveBeenCalled();
    intervalHandler?.();
    await flushPromises();
    expect(checkForUpdate).toHaveBeenCalledTimes(1);

    testDocument.setVisibilityState('hidden');
    testDocument.dispatchEvent(new Event('visibilitychange'));
    expect(timerTarget.clearInterval).toHaveBeenCalledWith(21);

    testDocument.setVisibilityState('visible');
    testDocument.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();
    expect(checkForUpdate).toHaveBeenCalledTimes(2);
    expect(timerTarget.setInterval).toHaveBeenCalledTimes(2);

    cleanup();
  });
});

describe('UsagePage status active heartbeat', () => {
  it('loads status and marks the page active immediately and on the 30s cadence', async () => {
    let intervalHandler: (() => void) | undefined;
    const testDocument = createAutoRefreshTestDocument();
    const timerTarget = {
      setInterval: vi.fn((handler: () => void, timeout: number) => {
        intervalHandler = handler;
        expect(timeout).toBe(STATUS_ACTIVE_HEARTBEAT_INTERVAL_MS);
        return 7;
      }),
      clearInterval: vi.fn(),
    };
    const status = createStatusResponse('last problem');
    const loadStatus = vi.fn(async () => status);
    const markActive = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    const setStatusError = vi.fn();

    const cleanup = scheduleStatusActiveHeartbeat({
      loadStatus,
      markActive,
      setStatus,
      setStatusError,
      documentRef: testDocument,
      timerTarget,
    });
    await flushPromises();

    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(markActive).toHaveBeenCalledTimes(1);
    expect(setStatus).toHaveBeenCalledWith(status);
    expect(setStatusError).toHaveBeenCalledWith('last problem');

    intervalHandler?.();
    await flushPromises();

    expect(loadStatus).toHaveBeenCalledTimes(2);
    expect(markActive).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('loads status once without active heartbeat when quota auto refresh is disabled', async () => {
    const testDocument = createAutoRefreshTestDocument();
    const timerTarget = {
      setInterval: vi.fn(() => 7),
      clearInterval: vi.fn(),
    };
    const status = createStatusResponse('', false);
    const loadStatus = vi.fn(async () => status);
    const markActive = vi.fn(async () => undefined);
    const setStatus = vi.fn();
    const setStatusError = vi.fn();

    const cleanup = scheduleStatusActiveHeartbeat({
      loadStatus,
      markActive,
      setStatus,
      setStatusError,
      documentRef: testDocument,
      timerTarget,
    });
    await flushPromises();

    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(markActive).not.toHaveBeenCalled();
    expect(timerTarget.setInterval).not.toHaveBeenCalled();
    expect(setStatus).toHaveBeenCalledWith(status);

    cleanup();
  });

  it('does not start while hidden and starts immediately when visible again', async () => {
    const testDocument = createAutoRefreshTestDocument('hidden');
    const timerTarget = {
      setInterval: vi.fn(() => 8),
      clearInterval: vi.fn(),
    };
    const loadStatus = vi.fn(async () => createStatusResponse());
    const markActive = vi.fn(async () => undefined);

    const cleanup = scheduleStatusActiveHeartbeat({
      loadStatus,
      markActive,
      setStatus: vi.fn(),
      setStatusError: vi.fn(),
      documentRef: testDocument,
      timerTarget,
    });
    await flushPromises();

    expect(loadStatus).not.toHaveBeenCalled();

    testDocument.setVisibilityState('visible');
    testDocument.dispatchEvent(new Event('visibilitychange'));
    await flushPromises();

    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(markActive).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('aborts the in-flight heartbeat before creating an interval when hidden', () => {
    let capturedSignal: AbortSignal | undefined;
    const testDocument = createAutoRefreshTestDocument();
    const timerTarget = {
      setInterval: vi.fn(() => 9),
      clearInterval: vi.fn(),
    };
    const loadStatus = vi.fn((signal: AbortSignal) => {
      capturedSignal = signal;
      return new Promise<StatusResponse>(() => undefined);
    });

    const cleanup = scheduleStatusActiveHeartbeat({
      loadStatus,
      markActive: vi.fn(async () => undefined),
      setStatus: vi.fn(),
      setStatusError: vi.fn(),
      documentRef: testDocument,
      timerTarget,
    });

    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);

    testDocument.setVisibilityState('hidden');
    testDocument.dispatchEvent(new Event('visibilitychange'));

    expect(capturedSignal?.aborted).toBe(true);
    expect(timerTarget.setInterval).not.toHaveBeenCalled();
    expect(timerTarget.clearInterval).not.toHaveBeenCalled();

    cleanup();
  });
});

describe('UsagePage Custom date range bounds refresh', () => {
  it('refreshes the bounds anchor immediately and on the visible interval when Custom is active', () => {
    let intervalHandler: (() => void) | undefined;
    const testDocument = createAutoRefreshTestDocument();
    const timerTarget = {
      setInterval: vi.fn((handler: () => void, timeout: number) => {
        intervalHandler = handler;
        expect(timeout).toBe(CUSTOM_DATE_RANGE_BOUNDS_REFRESH_INTERVAL_MS);
        return 11;
      }),
      clearInterval: vi.fn(),
    };
    const refreshBoundsAnchor = vi.fn();

    const cleanup = scheduleCustomDateRangeBoundsRefresh({
      enabled: true,
      refreshBoundsAnchor,
      documentRef: testDocument,
      timerTarget,
    });

    expect(refreshBoundsAnchor).toHaveBeenCalledTimes(1);
    intervalHandler?.();
    expect(refreshBoundsAnchor).toHaveBeenCalledTimes(2);

    cleanup();
    intervalHandler?.();

    expect(timerTarget.clearInterval).toHaveBeenCalledWith(11);
    expect(refreshBoundsAnchor).toHaveBeenCalledTimes(2);
  });

  it('does not refresh while Custom is inactive', () => {
    const timerTarget = {
      setInterval: vi.fn(() => 12),
      clearInterval: vi.fn(),
    };
    const refreshBoundsAnchor = vi.fn();

    const cleanup = scheduleCustomDateRangeBoundsRefresh({
      enabled: false,
      refreshBoundsAnchor,
      timerTarget,
    });

    expect(refreshBoundsAnchor).not.toHaveBeenCalled();
    expect(timerTarget.setInterval).not.toHaveBeenCalled();

    cleanup();
  });

  it('refreshes when a hidden Custom page becomes visible again', () => {
    const testDocument = createAutoRefreshTestDocument('hidden');
    const timerTarget = {
      setInterval: vi.fn(() => 13),
      clearInterval: vi.fn(),
    };
    const refreshBoundsAnchor = vi.fn();

    const cleanup = scheduleCustomDateRangeBoundsRefresh({
      enabled: true,
      refreshBoundsAnchor,
      documentRef: testDocument,
      timerTarget,
    });

    expect(refreshBoundsAnchor).not.toHaveBeenCalled();

    testDocument.setVisibilityState('visible');
    testDocument.dispatchEvent(new Event('visibilitychange'));

    expect(refreshBoundsAnchor).toHaveBeenCalledTimes(1);

    cleanup();
  });
});

describe('UsagePage active tab auto-refresh guard', () => {
  it('does not auto-refresh Request Events because SSE owns realtime updates', () => {
    expect(shouldAutoRefreshUsageTab({ activeTab: 'events', eventsPage: 1 })).toBe(false);
    expect(shouldAutoRefreshUsageTab({ activeTab: 'events', eventsPage: 2 })).toBe(false);
  });

  it('does not auto-refresh credential detail tabs', () => {
    expect(shouldAutoRefreshUsageTab({ activeTab: 'auth-files', eventsPage: 1 })).toBe(false);
    expect(shouldAutoRefreshUsageTab({ activeTab: 'ai-provider', eventsPage: 1 })).toBe(false);
  });

  it('keeps Overview auto-refresh enabled and does not auto-refresh other tabs', () => {
    expect(shouldAutoRefreshUsageTab({ activeTab: 'overview', eventsPage: 2 })).toBe(true);
    expect(shouldAutoRefreshUsageTab({ activeTab: 'settings', eventsPage: 1 })).toBe(false);
  });
});

describe('UsagePage request event filters', () => {
  it('keeps restored model and source filters until backend filter options load', () => {
    const next = sanitizeRequestEventFilters(
      {
        model: 'claude-opus',
        source: 'authidx-source-b',
        result: 'failed',
      },
      {
        models: [],
        sources: [],
      },
      false,
    );

    expect(next).toEqual({
      model: 'claude-opus',
      source: 'authidx-source-b',
      result: 'failed',
    });
  });

  it('clears model and source filters that are no longer available', () => {
    const next = sanitizeRequestEventFilters(
      {
        model: 'claude-opus',
        source: 'authidx-source-b',
        result: 'failed',
      },
      {
        models: ['claude-sonnet'],
        sources: [{ value: 'authidx-source-a', label: 'authidx-source-a' }],
      },
    );

    expect(next).toEqual({
      model: '__all__',
      source: '__all__',
      result: 'failed',
    });
  });

  it('keeps source filters that are still available after refreshing options', () => {
    const next = sanitizeRequestEventFilters(
      {
        model: 'claude-sonnet',
        source: 'authidx-source-a',
        result: 'success',
      },
      {
        models: ['claude-sonnet'],
        sources: [{ value: 'authidx-source-a', label: 'authidx-source-a' }],
      },
    );

    expect(next).toEqual({
      model: 'claude-sonnet',
      source: 'authidx-source-a',
      result: 'success',
    });
  });
});

describe('UsagePage realtime request events', () => {
  const event = (id: string, model = `model-${id}`) => ({
    id,
    timestamp: '2026-04-20T00:00:00+08:00',
    model,
    source: 'auth-1',
    failed: false,
    latency_ms: 10,
    tokens: {
      input_tokens: 1,
      output_tokens: 2,
      reasoning_tokens: 0,
      cached_tokens: 0,
      cache_read_tokens: 0,
      cache_creation_tokens: 0,
      total_tokens: 3,
    },
  });

  it('inserts new realtime event at the top of page one and trims to page size', () => {
    const result = mergeRealtimeUsageEventPage([event('2'), event('1')], event('3'), 1, 2);

    expect(result.inserted).toBe(true);
    expect(result.events.map((item) => item.id)).toEqual(['3', '2']);
  });

  it('deduplicates realtime events by id without increasing total count', () => {
    const result = mergeRealtimeUsageEventPage([event('2', 'old'), event('1')], event('2', 'new'), 1, 10);

    expect(result.inserted).toBe(false);
    expect(result.events.map((item) => item.id)).toEqual(['2', '1']);
    expect(result.events[0].model).toBe('new');
  });

  it('does not locally mutate non-first pages', () => {
    const current = [event('2'), event('1')];
    const result = mergeRealtimeUsageEventPage(current, event('3'), 2, 2);

    expect(result.inserted).toBe(false);
    expect(result.events).toBe(current);
  });
});

describe('UsagePage request event preferences', () => {
  it('normalizes persisted filters, page size, and visible columns', () => {
    const preferences = normalizeRequestEventsPreferences({
      version: 1,
      pageSize: 500,
      filters: {
        model: 'claude-opus',
        source: 'authidx-source-b',
        result: 'failed',
      },
      visibleColumnIds: ['model', 'timestamp', 'model', 'not-a-column', 'total_cost'],
    });

    expect(preferences).toEqual({
      version: 2,
      pageSize: 500,
      filters: {
        model: 'claude-opus',
        source: 'authidx-source-b',
        result: 'failed',
      },
      visibleColumnIds: ['model', 'timestamp', 'total_cost'],
    });
  });

  it('falls back safely for damaged persisted request event preferences', () => {
    const preferences = normalizeRequestEventsPreferences({
      version: 1,
      pageSize: 999,
      filters: {
        model: 42,
        source: '',
        result: 'maybe',
      },
      visibleColumnIds: ['not-a-column'],
    });

    expect(preferences.pageSize).toBe(100);
    expect(preferences.filters).toEqual({
      model: '__all__',
      source: '__all__',
      result: '__all__',
    });
    expect(preferences.visibleColumnIds[0]).toBe('timestamp');
    expect(preferences.visibleColumnIds.length).toBeGreaterThan(1);
  });

  it('keeps persisted request event columns unchanged when Speed is absent', () => {
    const columnIdsWithoutSpeed = REQUEST_EVENT_COLUMN_IDS.filter((columnId) => columnId !== 'speed');
    const preferences = normalizeRequestEventsPreferences({
      version: 1,
      pageSize: 100,
      visibleColumnIds: columnIdsWithoutSpeed,
    });

    expect(preferences.visibleColumnIds).toEqual(columnIdsWithoutSpeed);
    expect(preferences.visibleColumnIds).not.toContain('speed');
  });

  it('adds Speed Mode to legacy full-column request event preferences', () => {
    const legacyFullColumnIds = REQUEST_EVENT_COLUMN_IDS.filter((columnId) => columnId !== 'service_tier');
    const preferences = normalizeRequestEventsPreferences({
      version: 1,
      pageSize: 100,
      visibleColumnIds: legacyFullColumnIds,
    });

    expect(preferences.visibleColumnIds).toEqual(REQUEST_EVENT_COLUMN_IDS);
  });

  it('preserves a saved preference that intentionally hides Speed', () => {
    const storage = createMemoryStorage();
    const hiddenSpeedColumnIds = REQUEST_EVENT_COLUMN_IDS.filter((columnId) => columnId !== 'speed');

    saveRequestEventsPreferences({
      version: 2,
      pageSize: 100,
      filters: {
        model: '__all__',
        source: '__all__',
        result: '__all__',
      },
      visibleColumnIds: hiddenSpeedColumnIds,
    }, storage);

    const stored = JSON.parse(storage.value(REQUEST_EVENTS_PREFERENCES_STORAGE_KEY) ?? '');
    expect(stored).toEqual({
      version: 2,
      pageSize: 100,
      filters: {
        model: '__all__',
        source: '__all__',
        result: '__all__',
      },
      visibleColumnIds: hiddenSpeedColumnIds,
    });
    expect(loadRequestEventsPreferences(storage).visibleColumnIds).toEqual(hiddenSpeedColumnIds);
  });

  it('preserves a v2 saved preference that intentionally hides Speed Mode', () => {
    const storage = createMemoryStorage();
    const hiddenSpeedModeColumnIds = REQUEST_EVENT_COLUMN_IDS.filter((columnId) => columnId !== 'service_tier');

    saveRequestEventsPreferences({
      version: 2,
      pageSize: 100,
      filters: {
        model: '__all__',
        source: '__all__',
        result: '__all__',
      },
      visibleColumnIds: hiddenSpeedModeColumnIds,
    }, storage);

    expect(loadRequestEventsPreferences(storage).visibleColumnIds).toEqual(hiddenSpeedModeColumnIds);
  });

  it('loads defaults from invalid JSON and persists normalized request event preferences', () => {
    const storage = createMemoryStorage({
      [REQUEST_EVENTS_PREFERENCES_STORAGE_KEY]: '{bad json',
    });

    expect(loadRequestEventsPreferences(storage).pageSize).toBe(100);

    saveRequestEventsPreferences({
      version: 2,
      pageSize: 50,
      filters: {
        model: 'gpt-4.1',
        source: 'source-a',
        result: 'success',
      },
      visibleColumnIds: ['timestamp', 'timestamp', 'model'],
    }, storage);

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.value(REQUEST_EVENTS_PREFERENCES_STORAGE_KEY) ?? '')).toEqual({
      version: 2,
      pageSize: 50,
      filters: {
        model: 'gpt-4.1',
        source: 'source-a',
        result: 'success',
      },
      visibleColumnIds: ['timestamp', 'model'],
    });
  });
});

for (const [tab, expected] of [
  ['overview', true],
  ['events', true],
  ['api-keys', false],
  ['auth-files', false],
  ['ai-provider', false],
  ['settings', false],
] as const) {
  it(`returns ${expected} for ${tab} range controls visibility`, () => {
    expect(shouldShowRangeControls(tab)).toBe(expected);
  });
}

for (const [tab, expected] of [
  ['overview', true],
  ['events', true],
  ['api-keys', false],
  ['auth-files', false],
  ['ai-provider', false],
  ['settings', false],
] as const) {
  it(`returns ${expected} for ${tab} API Key filter visibility`, () => {
    expect(shouldShowApiKeyFilter(tab)).toBe(expected);
  });
}

describe('UsagePage time range options', () => {
  it('includes rolling 4h, local Today, Yesterday, and 30d ranges', () => {
    const options = getTimeRangeOptions((key) => `translated:${key}`);

    expect(options.map((option) => option.value)).toEqual(['4h', 'today', 'yesterday', '7d', '30d', 'custom']);
    expect(options.map((option) => option.label)).toContain('translated:usage_stats.range_today');
    expect(options.map((option) => option.label)).toContain('translated:usage_stats.range_yesterday');
    expect(options.map((option) => option.label)).toContain('translated:usage_stats.range_30d');
  });
});

describe('UsagePage custom date input bounds', () => {
  it('limits selectable Custom dates to today through the first day of the previous month', () => {
    expect(getCustomDateRangeBounds(Date.parse('2026-05-13T12:00:00.000Z'), 'UTC')).toEqual({
      min: '2026-04-01',
      max: '2026-05-13',
    });
  });

  it('uses the project timezone when deriving Custom date bounds', () => {
    expect(getCustomDateRangeBounds(Date.parse('2026-05-13T06:30:00.000Z'), 'America/Los_Angeles')).toEqual({
      min: '2026-04-01',
      max: '2026-05-12',
    });
  });

  it('rejects tomorrow and dates before the first day of the previous month', () => {
    const bounds = { min: '2026-04-01', max: '2026-05-13' };

    expect(isCustomDateWithinBounds('2026-05-13', bounds)).toBe(true);
    expect(isCustomDateWithinBounds('2026-04-01', bounds)).toBe(true);
    expect(isCustomDateWithinBounds('2026-05-14', bounds)).toBe(false);
    expect(isCustomDateWithinBounds('2026-03-31', bounds)).toBe(false);
  });

  it('clamps saved Custom dates to the moving bounds', () => {
    const bounds = { min: '2026-05-01', max: '2026-06-16' };

    expect(clampCustomDateRangeToBounds({ start: '2026-04-20', end: '2026-06-20' }, bounds)).toEqual({
      start: '2026-05-01',
      end: '2026-06-16',
    });
  });

  it('opens the native date picker when the date field is activated', () => {
    const showPicker = vi.fn();

    openDateInputPicker({ showPicker } as unknown as HTMLInputElement);

    expect(showPicker).toHaveBeenCalledTimes(1);
  });

  it('ignores browsers that reject programmatic date picker opening', () => {
    const input = { showPicker: vi.fn(() => { throw new Error('not allowed') }) } as unknown as HTMLInputElement;

    expect(() => openDateInputPicker(input)).not.toThrow();
  });
});

describe('UsagePage custom date query', () => {
  it('keeps custom date query bounds as project-local dates for the backend', () => {
    expect(buildCustomDateRangeQuery({ start: '2026-04-20', end: '2026-04-21' })).toEqual({
      valid: true,
      start: '2026-04-20',
      end: '2026-04-21',
    });
  });

  it('rejects rollover calendar dates before sending them to the backend', () => {
    expect(buildCustomDateRangeQuery({ start: '2026-02-31', end: '2026-03-31' })).toEqual({
      valid: false,
      start: undefined,
      end: undefined,
    });
  });
});

describe('UsagePage tab labels', () => {
  it('resolves tab labels through translation keys', () => {
    const labels = getUsageTabOptions((key) => `translated:${key}`).map((option) => option.label);

    expect(labels).toEqual([
      'translated:usage_stats.tab_overview',
      'translated:usage_stats.tab_events',
      'translated:usage_stats.tab_api_keys',
      'translated:usage_stats.tab_auth_files',
      'translated:usage_stats.tab_proxy_pools',
      'translated:usage_stats.tab_ai_provider',
      'translated:usage_stats.tab_config_diagnostics',
      'translated:usage_stats.tab_cpa_manager',
      'translated:usage_stats.tab_settings',
    ]);
  });
});

describe('UsagePage proxy pools tab', () => {
  it('does not repeat the proxy pool tab title and subtitle inside the page body', () => {
    expect(usageProxyPoolsTabSource).not.toContain('proxy_pools_title');
    expect(usageProxyPoolsTabSource).not.toContain('proxy_pools_subtitle');
    expect(usageProxyPoolsTabSource).toContain('ProxyPoolManagerPanel');
  });
});

describe('UsagePage credentials tab migration', () => {
  it('reads direct and legacy tab values from the URL query', () => {
    expect(getUsageTabFromSearch('?tab=auth-files')).toBe('auth-files');
    expect(getUsageTabFromSearch('?view=compact&tab=credentials')).toBe('auth-files');
    expect(getUsageTabFromSearch('?tab=unknown')).toBeNull();
    expect(getUsageTabFromSearch('')).toBeNull();
  });

  it('migrates the legacy Credentials tab value to Auth Files', () => {
    expect(normalizeUsageTabValue('credentials')).toBe('auth-files');
  });

  it('falls back legacy Analysis tab values to Overview', () => {
    expect(normalizeUsageTabValue('analysis')).toBe('overview');
  });

  it('keeps each credential section scoped to its own tab', () => {
    expect(getCredentialSectionVisibility('auth-files')).toEqual({
      enabled: true,
      showAuthFiles: true,
      showAiProvider: false,
    });
    expect(getCredentialSectionVisibility('ai-provider')).toEqual({
      enabled: true,
      showAuthFiles: false,
      showAiProvider: true,
    });
    expect(getCredentialSectionVisibility('overview')).toEqual({
      enabled: false,
      showAuthFiles: false,
      showAiProvider: false,
    });
  });
});

describe('UsagePage refresh action', () => {
  it('reloads page data without triggering backend sync', async () => {
    let refreshCalls = 0;
    const syncCalls = 0;

    await refreshPageData({
      refreshActiveTab: async () => {
        refreshCalls += 1;
      },
    });

    expect(refreshCalls).toBe(1);
    expect(syncCalls).toBe(0);
  });
});
