import { useState, useMemo, useCallback, useEffect, useRef, type KeyboardEvent, type SyntheticEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, buildUsageEventsStreamURL, createCpaApiKey, deleteCpaApiKey, exportUsageEvents, fetchAnalysis, fetchAuthSessions, fetchCpaApiKeyOptions, fetchCpaApiKeySettings, fetchCpaRuntime, fetchCpaUpdateEvents, fetchStatus, fetchUpdateCheck, fetchUsageEventModelFilterOptions, fetchUsageEventSourceFilterOptions, fetchUsageEvents, fetchVersion, logout, markStatusActive, restartCpaRuntime, revokeAuthSession, startCpaRuntime, stopCpaRuntime, updateCpaApiKey, updateCpaRuntime, type UsageEventsExportFormat } from '@/lib/api';
import type { AnalysisResponse, AuthManagedSessionItem, CpaRuntimeStatusResponse, CpaUpdateEvent, CpaApiKeyOption, CpaApiKeySettingsItem, OverviewRealtimeWindow, StatusResponse, UsageEvent, UsageSourceFilterOption, VersionResponse } from '@/lib/types';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  IconChevronLeft,
  IconRefreshCw,
  IconSettings,
  IconSidebarConfig,
  IconSidebarDashboard,
  IconSidebarLogs,
  IconSidebarOauth,
  IconSidebarProviders,
  IconSidebarQuota,
  IconSidebarSystem,
} from '@/components/ui/icons';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useThemeStore } from '@/stores';
import {
  useUsageData,
  useOverviewRealtimeData,
  usePricingData,
  useCredentialsTabData
} from '@/components/usage';
import {
  REQUEST_EVENT_COLUMN_IDS,
  normalizeRequestEventVisibleColumnIds,
  type RequestEventColumnId,
} from '@/components/usage/RequestEventsDetailsCard';
import {
  UsageOverviewTab,
  UsageEventsTab,
  UsageCredentialsTab,
  UsageProxyPoolsTab,
  UsageConfigDiagnosticsTab,
  UsageCpaManagerTab,
  UsageSettingsTab,
} from './usage';
import { buildUsageRangeQuery } from '@/utils/usage/rangeQuery';
import { getDailyAveragePanelUsage, isDailyAverageRange } from '@/utils/usage/overview';
import {
  type UsageTimeRange
} from '@/utils/usage';
import type { Theme } from '@/types';
import { BrandLink } from '@/components/BrandLink';
import { formatUserActionableError } from '@/lib/errorMessages';
import { scheduleEffectTask } from '@/utils/effects';
import styles from './UsagePage.module.scss';

const TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-time-range-v1';
const CUSTOM_TIME_RANGE_STORAGE_KEY = 'cli-proxy-usage-custom-range-v1';
const OVERVIEW_REALTIME_WINDOW_STORAGE_KEY = 'cli-proxy-usage-overview-realtime-window-v1';
export const REQUEST_EVENTS_PREFERENCES_STORAGE_KEY = 'cli-proxy-usage-request-events-preferences-v1';
const DEFAULT_TIME_RANGE: UsageTimeRange = '4h';
const DEFAULT_REALTIME_WINDOW: OverviewRealtimeWindow = '15m';
const DEFAULT_CUSTOM_WINDOW_HOURS = 4;
const TIME_RANGE_OPTIONS: ReadonlyArray<{ value: UsageTimeRange; labelKey: string }> = [
  { value: '4h', labelKey: 'usage_stats.range_4h' },
  { value: 'today', labelKey: 'usage_stats.range_today' },
  { value: 'yesterday', labelKey: 'usage_stats.range_yesterday' },
  { value: '7d', labelKey: 'usage_stats.range_7d' },
  { value: '30d', labelKey: 'usage_stats.range_30d' },
  { value: 'custom', labelKey: 'usage_stats.range_custom' },
];
const THEME_OPTIONS: ReadonlyArray<{ value: Theme; labelKey: string }> = [
  { value: 'white', labelKey: 'usage_stats.theme_light' },
  { value: 'dark', labelKey: 'usage_stats.theme_dark' },
  { value: 'auto', labelKey: 'usage_stats.theme_auto' }
];
const USAGE_TAB_OPTIONS = ['overview', 'events', 'auth-files', 'proxy-pools', 'ai-provider', 'config-diagnostics', 'cpa-manager', 'settings'] as const;
const PUBLIC_USAGE_TAB_OPTIONS = ['overview', 'events'] as const;
type UsageTab = (typeof USAGE_TAB_OPTIONS)[number];
type Translate = (key: string) => string;
type UsagePageMode = 'admin' | 'public';
const USAGE_TAB_LABEL_KEYS: Record<UsageTab, string> = {
  overview: 'usage_stats.tab_overview',
  events: 'usage_stats.tab_events',
  'auth-files': 'usage_stats.tab_auth_files',
  'proxy-pools': 'usage_stats.tab_proxy_pools',
  'ai-provider': 'usage_stats.tab_ai_provider',
  'config-diagnostics': 'usage_stats.tab_config_diagnostics',
  'cpa-manager': 'usage_stats.tab_cpa_manager',
  settings: 'usage_stats.tab_settings',
};
const renderUsageTabIcon = (tab: UsageTab) => {
  switch (tab) {
    case 'overview':
      return <IconSidebarDashboard size={18} aria-hidden="true" />;
    case 'events':
      return <IconSidebarLogs size={18} aria-hidden="true" />;
    case 'auth-files':
      return <IconSidebarOauth size={18} aria-hidden="true" />;
    case 'proxy-pools':
      return <IconSidebarQuota size={18} aria-hidden="true" />;
    case 'ai-provider':
      return <IconSidebarProviders size={18} aria-hidden="true" />;
    case 'config-diagnostics':
      return <IconSidebarConfig size={18} aria-hidden="true" />;
    case 'cpa-manager':
      return <IconSidebarSystem size={18} aria-hidden="true" />;
    case 'settings':
      return <IconSettings size={18} aria-hidden="true" />;
  }
};
const DEFAULT_USAGE_TAB: UsageTab = 'overview';
const USAGE_TAB_STORAGE_KEY = 'cli-proxy-usage-tab-v1';
const REQUEST_EVENTS_PAGE_SIZES = [20, 50, 100, 500, 1000] as const;
const REQUEST_EVENTS_DEFAULT_PAGE_SIZE = 100;
const REQUEST_EVENTS_PREFERENCES_VERSION = 2;
const ALL_REQUEST_EVENTS_FILTER = '__all__';
const OVERVIEW_AUTO_REFRESH_INTERVAL_MS = 10_000;
const REQUEST_EVENTS_STREAM_REFRESH_DEBOUNCE_MS = 800;
export const CUSTOM_DATE_RANGE_BOUNDS_REFRESH_INTERVAL_MS = 60_000;
export const STATUS_ACTIVE_HEARTBEAT_INTERVAL_MS = 30_000;
const CPA_MANAGEMENT_PAGE = 'management.html';
const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\//i;
const EXPLICIT_URL_SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:/i;
const BARE_HOST_WITH_PORT_PATTERN = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i;

export const getCredentialSectionVisibility = (tab: UsageTab) => ({
  enabled: tab === 'auth-files' || tab === 'ai-provider',
  showAuthFiles: tab === 'auth-files',
  showAiProvider: tab === 'ai-provider',
});

export const shouldShowRangeControls = (tab: UsageTab) => tab !== 'settings' && tab !== 'cpa-manager' && tab !== 'config-diagnostics' && tab !== 'proxy-pools' && !getCredentialSectionVisibility(tab).enabled;

export const shouldShowApiKeyFilter = (tab: UsageTab) => shouldShowRangeControls(tab);

export const shouldShowUpdateCheckButton = (versionInfo: Pick<VersionResponse, 'updateCheckEnabled'> | null) => versionInfo?.updateCheckEnabled === true;

export const isUsagePageVisible = (documentRef?: Pick<Document, 'visibilityState'>) => {
  const targetDocument = documentRef ?? (typeof document === 'undefined' ? undefined : document);
  return !targetDocument || targetDocument.visibilityState !== 'hidden';
};

const getBrowserOrigin = () => (typeof window === 'undefined' ? '' : window.location.origin);

const getProtocolForBareHost = (currentOrigin: string) => {
  try {
    return new URL(currentOrigin).protocol;
  } catch {
    return typeof window === 'undefined' ? 'https:' : window.location.protocol;
  }
};

const prepareCPAPublicURL = (rawURL: string, currentOrigin: string) => {
  const trimmed = rawURL.trim();
  if (!trimmed) return '';
  if (ABSOLUTE_HTTP_URL_PATTERN.test(trimmed) || trimmed.startsWith('//') || trimmed.startsWith('/')) {
    return trimmed;
  }
  if (EXPLICIT_URL_SCHEME_PATTERN.test(trimmed) && !BARE_HOST_WITH_PORT_PATTERN.test(trimmed)) {
    return '';
  }
  return `${getProtocolForBareHost(currentOrigin)}//${trimmed}`;
};

export const getBackToCPALinkURL = (
  status: Pick<StatusResponse, 'cpa_public_url'> | null,
  currentOrigin = getBrowserOrigin(),
) => {
  const preparedURL = prepareCPAPublicURL(status?.cpa_public_url ?? '', currentOrigin);
  if (!preparedURL) return '';

  try {
    const parsedURL = currentOrigin ? new URL(preparedURL, currentOrigin) : new URL(preparedURL);
    if (!parsedURL.pathname.endsWith(`/${CPA_MANAGEMENT_PAGE}`)) {
      const basePath = parsedURL.pathname.replace(/\/+$/, '');
      parsedURL.pathname = basePath ? `${basePath}/${CPA_MANAGEMENT_PAGE}` : `/${CPA_MANAGEMENT_PAGE}`;
      parsedURL.search = '';
      parsedURL.hash = '';
    }
    return parsedURL.toString();
  } catch {
    return '';
  }
};

type TopNoticeKind = 'success' | 'info' | 'error';

export const getUpdateCheckToastDuration = (kind: TopNoticeKind) => (kind === 'error' ? 6_000 : 4_000);

export const shouldAutoRefreshUsageTab = ({
  activeTab,
  eventsPage,
}: {
  activeTab: UsageTab;
  eventsPage: number;
}) => {
  void eventsPage;
  if (activeTab === 'overview') return true;
  return false;
};

export function mergeRealtimeUsageEventPage(
  currentEvents: UsageEvent[],
  nextEvent: UsageEvent,
  page: number,
  pageSize: number,
): { events: UsageEvent[]; inserted: boolean } {
  if (page !== 1) {
    return { events: currentEvents, inserted: false };
  }
  const nextID = nextEvent.id?.trim();
  const hadEvent = Boolean(nextID && currentEvents.some((event) => event.id === nextID));
  const withoutDuplicate = nextID
    ? currentEvents.filter((event) => event.id !== nextID)
    : currentEvents;
  return {
    events: [nextEvent, ...withoutDuplicate].slice(0, Math.max(1, pageSize)),
    inserted: !hadEvent,
  };
}

type RequestEventFilterState = {
  model: string;
  source: string;
  result: string;
};

type RequestEventFilterOptionsState = {
  models: string[];
  sources: UsageSourceFilterOption[];
};

export type RequestEventsPreferences = {
  version: typeof REQUEST_EVENTS_PREFERENCES_VERSION;
  pageSize: number;
  filters: RequestEventFilterState;
  visibleColumnIds: RequestEventColumnId[];
};

type RequestEventsPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DEFAULT_REQUEST_EVENT_FILTERS: RequestEventFilterState = {
  model: ALL_REQUEST_EVENTS_FILTER,
  source: ALL_REQUEST_EVENTS_FILTER,
  result: ALL_REQUEST_EVENTS_FILTER,
};

const buildDefaultRequestEventsPreferences = (): RequestEventsPreferences => ({
  version: REQUEST_EVENTS_PREFERENCES_VERSION,
  pageSize: REQUEST_EVENTS_DEFAULT_PAGE_SIZE,
  filters: { ...DEFAULT_REQUEST_EVENT_FILTERS },
  visibleColumnIds: [...REQUEST_EVENT_COLUMN_IDS],
});

const LEGACY_REQUEST_EVENT_COLUMN_IDS_WITHOUT_SPEED_MODE = REQUEST_EVENT_COLUMN_IDS.filter((columnId) => columnId !== 'service_tier');

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isRequestEventPageSize = (value: unknown): value is typeof REQUEST_EVENTS_PAGE_SIZES[number] => (
  typeof value === 'number' && REQUEST_EVENTS_PAGE_SIZES.includes(value as typeof REQUEST_EVENTS_PAGE_SIZES[number])
);

const isRequestEventColumnId = (value: unknown): value is RequestEventColumnId => (
  typeof value === 'string' && (REQUEST_EVENT_COLUMN_IDS as readonly string[]).includes(value)
);

const normalizeRequestEventFilterValue = (value: unknown): string => (
  typeof value === 'string' && value !== '' ? value : ALL_REQUEST_EVENTS_FILTER
);

const normalizeRequestEventResultFilter = (value: unknown): string => (
  value === 'success' || value === 'failed' ? value : ALL_REQUEST_EVENTS_FILTER
);

const normalizeRequestEventPreferenceFilters = (value: unknown): RequestEventFilterState => {
  const filters = isRecord(value) ? value : {};
  return {
    model: normalizeRequestEventFilterValue(filters.model),
    source: normalizeRequestEventFilterValue(filters.source),
    result: normalizeRequestEventResultFilter(filters.result),
  };
};

const hasSameRequestEventColumnOrder = (
  left: readonly RequestEventColumnId[],
  right: readonly RequestEventColumnId[]
): boolean => left.length === right.length && left.every((columnId, index) => columnId === right[index]);

const normalizeRequestEventPreferenceColumnIds = (value: unknown, version: unknown): RequestEventColumnId[] => {
  if (!Array.isArray(value)) {
    return [...REQUEST_EVENT_COLUMN_IDS];
  }
  const normalized = normalizeRequestEventVisibleColumnIds(value.filter(isRequestEventColumnId));
  if (
    version !== REQUEST_EVENTS_PREFERENCES_VERSION &&
    hasSameRequestEventColumnOrder(normalized, LEGACY_REQUEST_EVENT_COLUMN_IDS_WITHOUT_SPEED_MODE)
  ) {
    return [...REQUEST_EVENT_COLUMN_IDS];
  }
  return normalized;
};

export const normalizeRequestEventsPreferences = (value: unknown): RequestEventsPreferences => {
  const preferences = isRecord(value) ? value : {};
  return {
    version: REQUEST_EVENTS_PREFERENCES_VERSION,
    pageSize: isRequestEventPageSize(preferences.pageSize) ? preferences.pageSize : REQUEST_EVENTS_DEFAULT_PAGE_SIZE,
    filters: normalizeRequestEventPreferenceFilters(preferences.filters),
    visibleColumnIds: normalizeRequestEventPreferenceColumnIds(preferences.visibleColumnIds, preferences.version),
  };
};

const getRequestEventsPreferenceStorage = (): RequestEventsPreferenceStorage | null => {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
};

export const loadRequestEventsPreferences = (
  storage: RequestEventsPreferenceStorage | null = getRequestEventsPreferenceStorage(),
): RequestEventsPreferences => {
  try {
    const raw = storage?.getItem(REQUEST_EVENTS_PREFERENCES_STORAGE_KEY);
    if (!raw) {
      return buildDefaultRequestEventsPreferences();
    }
    return normalizeRequestEventsPreferences(JSON.parse(raw));
  } catch {
    return buildDefaultRequestEventsPreferences();
  }
};

export const saveRequestEventsPreferences = (
  preferences: RequestEventsPreferences,
  storage: RequestEventsPreferenceStorage | null = getRequestEventsPreferenceStorage(),
) => {
  try {
    storage?.setItem(REQUEST_EVENTS_PREFERENCES_STORAGE_KEY, JSON.stringify(normalizeRequestEventsPreferences(preferences)));
  } catch {
    // Ignore storage errors.
  }
};

type RefreshPageDataOptions = {
  refreshActiveTab: () => Promise<void>;
};

type OverviewAutoRefreshDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

type OverviewAutoRefreshOptions = {
  enabled: boolean;
  refreshOverview: () => void | Promise<void>;
  onRefreshError?: (error: unknown) => void;
  documentRef?: OverviewAutoRefreshDocument;
  intervalMs?: number;
};

type CustomDateRangeBoundsRefreshDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

type CustomDateRangeBoundsRefreshTimerTarget = {
  setInterval: (handler: () => void, timeout: number) => number;
  clearInterval: (handle: number) => void;
};

type CustomDateRangeBoundsRefreshOptions = {
  enabled: boolean;
  refreshBoundsAnchor: () => void;
  documentRef?: CustomDateRangeBoundsRefreshDocument;
  timerTarget?: CustomDateRangeBoundsRefreshTimerTarget;
  intervalMs?: number;
};

type StatusActiveHeartbeatDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;

type StatusActiveHeartbeatTimerTarget = {
  setInterval: (handler: () => void, timeout: number) => number;
  clearInterval: (handle: number) => void;
};

type StatusActiveHeartbeatOptions = {
  loadStatus: (signal: AbortSignal) => Promise<StatusResponse>;
  markActive: (signal: AbortSignal) => Promise<void>;
  setStatus: (status: StatusResponse) => void;
  setStatusError: (error: string) => void;
  onAuthRequired?: () => void;
  documentRef?: StatusActiveHeartbeatDocument;
  timerTarget?: StatusActiveHeartbeatTimerTarget;
  intervalMs?: number;
};

type VersionInfoLoader = (signal: AbortSignal) => Promise<VersionResponse>;

type UsagePageVersionInfoOptions = {
  loadVersion: VersionInfoLoader;
  signal: AbortSignal;
  setVersionInfo: (versionInfo: VersionResponse | null) => void;
  onAuthRequired?: () => void;
};

export const loadUsagePageVersionInfo = async ({
  loadVersion,
  signal,
  setVersionInfo,
  onAuthRequired,
}: UsagePageVersionInfoOptions) => {
  try {
    const nextVersionInfo = await loadVersion(signal);
    if (signal.aborted) return;
    setVersionInfo(nextVersionInfo);
  } catch (error) {
    if (signal.aborted) return;
    if (error instanceof ApiError && error.status === 401) {
      onAuthRequired?.();
      return;
    }
    setVersionInfo(null);
  }
};

export const refreshPageData = async ({ refreshActiveTab }: RefreshPageDataOptions) => {
  await refreshActiveTab();
};

export const getOverviewDisplayLoading = ({ loading, hasUsage }: { loading: boolean; hasUsage: boolean }) => loading && !hasUsage;

export const scheduleOverviewAutoRefresh = ({
  enabled,
  refreshOverview,
  onRefreshError,
  documentRef,
  intervalMs = OVERVIEW_AUTO_REFRESH_INTERVAL_MS,
}: OverviewAutoRefreshOptions) => {
  if (!enabled) {
    return () => undefined;
  }

  const targetDocument = documentRef ?? (typeof document === 'undefined' ? undefined : document);
  if (!targetDocument) {
    return () => undefined;
  }

  let timer: ReturnType<typeof setInterval> | undefined;
  const stopTimer = () => {
    if (timer === undefined) return;
    clearInterval(timer);
    timer = undefined;
  };
  const runRefresh = () => {
    Promise.resolve(refreshOverview()).catch((error: unknown) => {
      onRefreshError?.(error);
    });
  };
  const refreshIfVisible = () => {
    if (targetDocument.visibilityState === 'hidden') {
      stopTimer();
      return;
    }
    runRefresh();
  };
  const startTimer = () => {
    if (timer !== undefined) return;
    timer = setInterval(refreshIfVisible, intervalMs);
  };
  const handleVisibilityChange = () => {
    if (targetDocument.visibilityState === 'hidden') {
      stopTimer();
      return;
    }
    runRefresh();
    stopTimer();
    startTimer();
  };

  if (targetDocument.visibilityState !== 'hidden') {
    startTimer();
  }
  targetDocument.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    stopTimer();
    targetDocument.removeEventListener('visibilitychange', handleVisibilityChange);
  };
};

export const scheduleCustomDateRangeBoundsRefresh = ({
  enabled,
  refreshBoundsAnchor,
  documentRef,
  timerTarget,
  intervalMs = CUSTOM_DATE_RANGE_BOUNDS_REFRESH_INTERVAL_MS,
}: CustomDateRangeBoundsRefreshOptions) => {
  if (!enabled) {
    return () => undefined;
  }

  const targetDocument = documentRef ?? (typeof document === 'undefined' ? undefined : document);
  const timers = timerTarget ?? (typeof window === 'undefined' ? undefined : {
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
  });
  if (!timers) {
    return () => undefined;
  }

  let active = true;
  const refreshIfVisible = () => {
    if (!active || !isUsagePageVisible(targetDocument)) return;
    refreshBoundsAnchor();
  };
  const handleVisibilityChange = () => {
    refreshIfVisible();
  };

  refreshIfVisible();
  const timer = timers.setInterval(refreshIfVisible, intervalMs);
  targetDocument?.addEventListener('visibilitychange', handleVisibilityChange);

  return () => {
    active = false;
    timers.clearInterval(timer);
    targetDocument?.removeEventListener('visibilitychange', handleVisibilityChange);
  };
};

export const scheduleStatusActiveHeartbeat = ({
  loadStatus,
  markActive,
  setStatus,
  setStatusError,
  onAuthRequired,
  documentRef,
  timerTarget,
  intervalMs = STATUS_ACTIVE_HEARTBEAT_INTERVAL_MS,
}: StatusActiveHeartbeatOptions) => {
  const targetDocument = documentRef ?? (typeof document === 'undefined' ? undefined : document);
  const timers = timerTarget ?? (typeof window === 'undefined' ? undefined : {
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
  });
  if (!timers) {
    return () => undefined;
  }

  let controller: AbortController | null = null;
  let timer: number | null = null;
  const isVisible = () => isUsagePageVisible(targetDocument);
  const stopTimer = () => {
    if (timer !== null) {
      timers.clearInterval(timer);
      timer = null;
    }
  };
  const stopPolling = () => {
    controller?.abort();
    controller = null;
    stopTimer();
  };
  const loadAndMaybeMarkActive = async () => {
    controller?.abort();
    const requestController = new AbortController();
    controller = requestController;
    try {
      // status 成功后才发送 active 心跳，避免异常页面状态把后端误标记为活跃。
      const status = await loadStatus(requestController.signal);
      setStatus(status);
      setStatusError(status.last_error || '');
      if (status.quotaAutoRefreshEnabled !== true) {
        stopTimer();
        return false;
      }
      await markActive(requestController.signal);
      return true;
    } catch (error) {
      if (requestController.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
      }
      return false;
    } finally {
      if (controller === requestController) {
        controller = null;
      }
    }
  };
  const startPolling = () => {
    if (!isVisible()) {
      stopPolling();
      return;
    }
    void loadAndMaybeMarkActive().then((shouldHeartbeat) => {
      if (!shouldHeartbeat || !isVisible() || timer !== null) {
        return;
      }
      timer = timers.setInterval(() => {
        void loadAndMaybeMarkActive();
      }, intervalMs);
    });
  };
  const handleVisibilityChange = () => {
    stopPolling();
    startPolling();
  };

  startPolling();
  if (targetDocument) {
    targetDocument.addEventListener('visibilitychange', handleVisibilityChange);
  }
  return () => {
    if (targetDocument) {
      targetDocument.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    stopPolling();
  };
};

export const sanitizeRequestEventFilters = (
  filters: RequestEventFilterState,
  options: RequestEventFilterOptionsState,
  optionsLoaded = true,
): RequestEventFilterState => {
  const result = filters.result === 'success' || filters.result === 'failed'
    ? filters.result
    : ALL_REQUEST_EVENTS_FILTER;
  if (!optionsLoaded) {
    return {
      model: normalizeRequestEventFilterValue(filters.model),
      source: normalizeRequestEventFilterValue(filters.source),
      result,
    };
  }

  const model = filters.model === ALL_REQUEST_EVENTS_FILTER || options.models.includes(filters.model)
    ? filters.model
    : ALL_REQUEST_EVENTS_FILTER;
  const source = filters.source === ALL_REQUEST_EVENTS_FILTER || options.sources.some((option) => option.value === filters.source)
    ? filters.source
    : ALL_REQUEST_EVENTS_FILTER;

  return { model, source, result };
};

const isUsageTimeRange = (value: unknown): value is UsageTimeRange =>
  value === '4h' || value === '8h' || value === '12h' || value === '24h' || value === 'today' || value === 'yesterday' || value === '7d' || value === '30d' || value === 'custom';

const toDateInputValue = (timestamp: number): string => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

const toDateInputValueInTimezone = (timestamp: number, timezone?: string): string => {
  if (!timezone) return toDateInputValue(timestamp);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(timestamp));
    const year = parts.find((part) => part.type === 'year')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    const day = parts.find((part) => part.type === 'day')?.value;
    if (!year || !month || !day) return toDateInputValue(timestamp);
    return `${year}-${month}-${day}`;
  } catch {
    return toDateInputValue(timestamp);
  }
};

const previousMonthStartDateInputValue = (value: string): string => {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value);
  if (!match) return value;
  const [, year, month] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 2, 1));
  const pad = (nextValue: number) => String(nextValue).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-01`;
};

export const getCustomDateRangeBounds = (anchorMs = Date.now(), timezone?: string) => {
  const max = toDateInputValueInTimezone(anchorMs, timezone);
  return {
    min: previousMonthStartDateInputValue(max),
    max,
  };
};

export const isCustomDateWithinBounds = (value: string, bounds: { min: string; max: string }) => (
  value === '' || (value >= bounds.min && value <= bounds.max)
);

const clampCustomDateValueToBounds = (value: string, bounds: { min: string; max: string }) => {
  if (value === '') return value;
  if (value < bounds.min) return bounds.min;
  if (value > bounds.max) return bounds.max;
  return value;
};

export const clampCustomDateRangeToBounds = (
  range: { start: string; end: string },
  bounds: { min: string; max: string },
) => ({
  start: clampCustomDateValueToBounds(range.start, bounds),
  end: clampCustomDateValueToBounds(range.end, bounds),
});

export const openDateInputPicker = (input: HTMLInputElement) => {
  try {
    input.showPicker?.();
  } catch {
    // 某些浏览器会拒绝非用户手势触发的 showPicker。
  }
};

const parseCustomDateBoundary = (value: string, endOfDay: boolean): number | undefined => {
  if (!value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const date = endOfDay
    ? new Date(yearNumber, monthNumber - 1, dayNumber, 23, 59, 59, 999)
    : new Date(yearNumber, monthNumber - 1, dayNumber, 0, 0, 0, 0);
  if (Number.isNaN(date.getTime())) return undefined;
  if (date.getFullYear() !== yearNumber || date.getMonth() !== monthNumber - 1 || date.getDate() !== dayNumber) return undefined;
  return date.getTime();
};

const parseCustomDateStart = (value: string): number | undefined => parseCustomDateBoundary(value, false);

const parseCustomDateEnd = (value: string): number | undefined => parseCustomDateBoundary(value, true);

export const buildCustomDateRangeQuery = (range: { start: string; end: string }) => {
  const query = buildUsageRangeQuery({ range: 'custom', customStart: range.start, customEnd: range.end });
  return { valid: query.valid, start: query.start, end: query.end };
};

const buildDefaultCustomRange = (anchorMs: number) => ({
  start: toDateInputValue(anchorMs - DEFAULT_CUSTOM_WINDOW_HOURS * 60 * 60 * 1000),
  end: toDateInputValue(anchorMs)
});

const loadCustomTimeRange = () => {
  try {
    if (typeof localStorage === 'undefined') {
      return buildDefaultCustomRange(Date.now());
    }
    const raw = localStorage.getItem(CUSTOM_TIME_RANGE_STORAGE_KEY);
    if (!raw) {
      return buildDefaultCustomRange(Date.now());
    }
    const parsed = JSON.parse(raw) as { start?: string; end?: string };
    const start = typeof parsed?.start === 'string' ? parsed.start : '';
    const end = typeof parsed?.end === 'string' ? parsed.end : '';
    if (!start || !end) {
      return { start, end };
    }
    const startMs = parseCustomDateStart(start);
    const endMs = parseCustomDateEnd(end);
    if (startMs === undefined || endMs === undefined || startMs > endMs) {
      return buildDefaultCustomRange(Date.now());
    }
    return { start, end };
  } catch {
    return buildDefaultCustomRange(Date.now());
  }
};

const loadTimeRange = (): UsageTimeRange => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_TIME_RANGE;
    }
    const raw = localStorage.getItem(TIME_RANGE_STORAGE_KEY);
    if (!isUsageTimeRange(raw)) {
      return DEFAULT_TIME_RANGE;
    }
    return raw;
  } catch {
    return DEFAULT_TIME_RANGE;
  }
};

const isUsageTab = (value: unknown): value is UsageTab =>
  typeof value === 'string' && USAGE_TAB_OPTIONS.includes(value as UsageTab);

export const normalizeUsageTabValue = (value: unknown): UsageTab | null => {
  if (value === 'credentials') {
    return 'auth-files';
  }
  if (value === 'analysis') {
    return 'overview';
  }
  return isUsageTab(value) ? value : null;
};

export const getUsageTabOptions = (translate: Translate): Array<{ value: UsageTab; label: string }> =>
  USAGE_TAB_OPTIONS.map((value) => ({
    value,
    label: translate(USAGE_TAB_LABEL_KEYS[value]),
  }));

export const getVisibleUsageTabOptions = (translate: Translate, mode: UsagePageMode = 'admin'): Array<{ value: UsageTab; label: string }> => {
  const values: readonly UsageTab[] = mode === 'public' ? PUBLIC_USAGE_TAB_OPTIONS : USAGE_TAB_OPTIONS;
  return values.map((value) => ({
    value,
    label: translate(USAGE_TAB_LABEL_KEYS[value]),
  }));
};

export const getTimeRangeOptions = (translate: Translate) =>
  TIME_RANGE_OPTIONS.map((option) => ({
    value: option.value,
    label: translate(option.labelKey),
  }));

const loadUsageTab = (): UsageTab => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_USAGE_TAB;
    }
    const raw = localStorage.getItem(USAGE_TAB_STORAGE_KEY);
    return normalizeUsageTabValue(raw) ?? DEFAULT_USAGE_TAB;
  } catch {
    return DEFAULT_USAGE_TAB;
  }
};

const isOverviewRealtimeWindow = (value: unknown): value is OverviewRealtimeWindow => (
  value === '15m' || value === '30m' || value === '60m'
);

const loadRealtimeWindow = (): OverviewRealtimeWindow => {
  try {
    if (typeof localStorage === 'undefined') {
      return DEFAULT_REALTIME_WINDOW;
    }
    const raw = localStorage.getItem(OVERVIEW_REALTIME_WINDOW_STORAGE_KEY);
    return isOverviewRealtimeWindow(raw) ? raw : DEFAULT_REALTIME_WINDOW;
  } catch {
    return DEFAULT_REALTIME_WINDOW;
  }
};

export const triggerBrowserFileDownload = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export function UsagePage({ onAuthRequired, mode = 'admin', onLoginClick }: { onAuthRequired?: () => void; mode?: UsagePageMode; onLoginClick?: () => void }) {
  const { t } = useTranslation();
  const isPublicMode = mode === 'public';
  const isMobile = useMediaQuery('(max-width: 768px)');
  const theme = useThemeStore((state) => state.theme);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const isDark = resolvedTheme === 'dark';
  const [activeTab, setActiveTab] = useState<UsageTab>(loadUsageTab);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [timeRange, setTimeRange] = useState<UsageTimeRange>(loadTimeRange);
  const [realtimeWindow] = useState<OverviewRealtimeWindow>(loadRealtimeWindow);
  const [customTimeRange, setCustomTimeRange] = useState<{ start: string; end: string }>(loadCustomTimeRange);
  const [selectedApiKeyId, setSelectedApiKeyId] = useState('');
  const [apiKeyOptions, setApiKeyOptions] = useState<CpaApiKeyOption[]>([]);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [versionInfo, setVersionInfo] = useState<VersionResponse | null>(null);
  const [customDateRangeAnchorMs, setCustomDateRangeAnchorMs] = useState(() => Date.now());
  const apiKeyOptionsRequestControllerRef = useRef<AbortController | null>(null);
  const credentialSectionVisibility = getCredentialSectionVisibility(activeTab);
  const proxyPoolsTabActive = activeTab === 'proxy-pools';
  const credentialsDataEnabled = credentialSectionVisibility.enabled || proxyPoolsTabActive;
  const customDateRangeBounds = useMemo(() => getCustomDateRangeBounds(customDateRangeAnchorMs, status?.timezone), [customDateRangeAnchorMs, status?.timezone]);
  const effectiveCustomTimeRange = useMemo(
    () => clampCustomDateRangeToBounds(customTimeRange, customDateRangeBounds),
    [customDateRangeBounds, customTimeRange],
  );

  const {
    usage,
    currentUsage: currentOverviewUsage,
    loading,
    error,
    lastRefreshedAt,
    loadUsage
  } = useUsageData({
    onAuthRequired: isPublicMode ? undefined : onAuthRequired,
    range: timeRange,
    customStart: effectiveCustomTimeRange.start,
    customEnd: effectiveCustomTimeRange.end,
    enabled: activeTab === 'overview',
    apiKeyId: selectedApiKeyId,
  });
  const {
    realtime: currentRealtime,
    loadRealtime
  } = useOverviewRealtimeData({
    onAuthRequired: isPublicMode ? undefined : onAuthRequired,
    enabled: activeTab === 'overview',
    apiKeyId: selectedApiKeyId,
    realtimeWindow,
  });
  const {
    modelNames,
    modelPrices,
    loading: pricingLoading,
    error: pricingError,
    loadPricing,
    setModelPrices,
    syncModelPrices,
    previewPricingSync,
  } = usePricingData({
    onAuthRequired,
    enabled: !isPublicMode && activeTab === 'settings',
  });
  const [apiKeySettings, setApiKeySettings] = useState<CpaApiKeySettingsItem[]>([]);
  const [apiKeySettingsLoading, setApiKeySettingsLoading] = useState(false);
  const [apiKeySettingsError, setApiKeySettingsError] = useState('');
  const [apiKeySettingsSavingId, setApiKeySettingsSavingId] = useState<string | null>(null);
  const [apiKeySettingsCreating, setApiKeySettingsCreating] = useState(false);
  const [apiKeySettingsDeletingId, setApiKeySettingsDeletingId] = useState<string | null>(null);
  const apiKeySettingsRequestControllerRef = useRef<AbortController | null>(null);
  const [authSessions, setAuthSessions] = useState<AuthManagedSessionItem[]>([]);
  const [authSessionsLoading, setAuthSessionsLoading] = useState(false);
  const [authSessionsError, setAuthSessionsError] = useState('');
  const [authSessionRevokingId, setAuthSessionRevokingId] = useState<string | null>(null);
  const authSessionsRequestControllerRef = useRef<AbortController | null>(null);
  const [statusError, setStatusError] = useState('');
  const [updateCheckLoading, setUpdateCheckLoading] = useState(false);
  const [cpaRuntime, setCpaRuntime] = useState<CpaRuntimeStatusResponse | null>(null);
  const [cpaEvents, setCpaEvents] = useState<CpaUpdateEvent[]>([]);
  const [cpaRuntimeLoading, setCpaRuntimeLoading] = useState(false);
  const [cpaActionLoading, setCpaActionLoading] = useState('');
  const [cpaRuntimeError, setCpaRuntimeError] = useState('');
  const [configDiagnosticsRefreshKey, setConfigDiagnosticsRefreshKey] = useState(0);
  const [topNotice, setTopNotice] = useState<{ kind: TopNoticeKind; message: string } | null>(null);
  const [hasNewVersion, setHasNewVersion] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const topNoticeTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [initialRequestEventsPreferences] = useState(loadRequestEventsPreferences);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [eventsData, setEventsData] = useState<UsageEvent[]>([]);
  const [eventsPage, setEventsPage] = useState(1);
  const [eventsPageSize, setEventsPageSize] = useState<number>(initialRequestEventsPreferences.pageSize);
  const [eventsTotalCount, setEventsTotalCount] = useState(0);
  const [eventsTotalPages, setEventsTotalPages] = useState(0);
  const [eventsModelOptions, setEventsModelOptions] = useState<string[]>([]);
  const [eventsSourceOptions, setEventsSourceOptions] = useState<UsageSourceFilterOption[]>([]);
  const [eventsModelFilter, setEventsModelFilter] = useState(initialRequestEventsPreferences.filters.model);
  const [eventsSourceFilter, setEventsSourceFilter] = useState(initialRequestEventsPreferences.filters.source);
  const [eventsResultFilter, setEventsResultFilter] = useState(initialRequestEventsPreferences.filters.result);
  const [eventsVisibleColumnIds, setEventsVisibleColumnIds] = useState<RequestEventColumnId[]>(initialRequestEventsPreferences.visibleColumnIds);
  const [eventsExportingFormat, setEventsExportingFormat] = useState<UsageEventsExportFormat | null>(null);
  const [eventsFilterOptionsLoaded, setEventsFilterOptionsLoaded] = useState(false);
  const eventsRequestControllerRef = useRef<AbortController | null>(null);
  const eventsFilterOptionsRequestControllerRef = useRef<AbortController | null>(null);
  const eventsStreamStatsRefreshTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const eventsStreamReloadTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const [manualRefreshLoading, setManualRefreshLoading] = useState(false);
  const [pageVisible, setPageVisible] = useState(isUsagePageVisible);
  const showTopNotice = useCallback((kind: TopNoticeKind, message: string) => {
    if (topNoticeTimerRef.current !== null) {
      window.clearTimeout(topNoticeTimerRef.current);
    }
    setTopNotice({ kind, message });
    topNoticeTimerRef.current = window.setTimeout(() => {
      setTopNotice(null);
      topNoticeTimerRef.current = null;
    }, getUpdateCheckToastDuration(kind));
  }, []);
  const credentialsData = useCredentialsTabData({
    enabledAuthFiles: !isPublicMode && (credentialSectionVisibility.showAuthFiles || proxyPoolsTabActive) && pageVisible,
    enabledAiProviders: !isPublicMode && credentialSectionVisibility.showAiProvider && pageVisible,
    quotaAutoRefreshEnabled: status?.quotaAutoRefreshEnabled === true,
    onAuthRequired,
    onNotice: showTopNotice,
  });
  const refreshCredentials = credentialsData.refresh;
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [, setAnalysisError] = useState('');
  const [analysisData, setAnalysisData] = useState<AnalysisResponse | null>(null);
  const [, setAnalysisLastRefreshedAt] = useState<Date | null>(null);
  const analysisRequestControllerRef = useRef<AbortController | null>(null);

  const tabOptions = useMemo(() => getVisibleUsageTabOptions(t, mode), [mode, t]);
  const timeRangeOptions = useMemo(() => getTimeRangeOptions(t), [t]);
  const apiKeySelectOptions = useMemo(
    () => [
      { value: '', label: t('usage_stats.api_key_filter_all') },
      ...apiKeyOptions.map((option) => ({ value: option.id, label: option.label })),
    ],
    [apiKeyOptions, t],
  );
  const credentialTypeCountsForProviderFilter = useMemo(() => {
    if (credentialSectionVisibility.showAuthFiles) return credentialsData.authFileTypeCounts;
    if (credentialSectionVisibility.showAiProvider) return credentialsData.aiProviderTypeCounts;
    return [];
  }, [credentialSectionVisibility.showAiProvider, credentialSectionVisibility.showAuthFiles, credentialsData.aiProviderTypeCounts, credentialsData.authFileTypeCounts]);
  const activeCredentialProviderFilter = credentialSectionVisibility.showAiProvider ? credentialsData.aiProviderProviderFilter : credentialsData.authFileProviderFilter;
  const setActiveCredentialProviderFilter = credentialSectionVisibility.showAiProvider ? credentialsData.setAiProviderProviderFilter : credentialsData.setAuthFileProviderFilter;
  const activeCredentialProviderFilterScope = credentialSectionVisibility.showAiProvider ? 'ai-provider' : 'auth-files';
  const themeOptions = useMemo(
    () =>
      THEME_OPTIONS.map((option) => ({
        ...option,
        label: t(option.labelKey)
      })),
    [t]
  );
  const topNoticeToastClassName = topNotice ? (() => {
    if (topNotice.kind === 'error') return styles.updateCheckToastError;
    if (topNotice.kind === 'success') return styles.updateCheckToastSuccess;
    return styles.updateCheckToastInfo;
  })() : '';
  const cpaManagementURL = useMemo(() => getBackToCPALinkURL(status), [status]);
  const { customRangeError, customRangeHint } = useMemo(() => {
    if (timeRange !== 'custom') {
      return { customRangeError: '', customRangeHint: '' };
    }
    if (!customTimeRange.start || !customTimeRange.end) {
      return { customRangeError: '', customRangeHint: t('usage_stats.custom_incomplete') };
    }
    const startMs = parseCustomDateStart(customTimeRange.start);
    const endMs = parseCustomDateEnd(customTimeRange.end);
    if (startMs === undefined || endMs === undefined || startMs > endMs) {
      return { customRangeError: t('usage_stats.custom_invalid'), customRangeHint: '' };
    }
    return { customRangeError: '', customRangeHint: '' };
  }, [customTimeRange.end, customTimeRange.start, t, timeRange]);

  const loadApiKeyOptions = useCallback(async () => {
    apiKeyOptionsRequestControllerRef.current?.abort();
    const controller = new AbortController();
    apiKeyOptionsRequestControllerRef.current = controller;
    try {
      const response = await fetchCpaApiKeyOptions(controller.signal);
      if (apiKeyOptionsRequestControllerRef.current !== controller) {
        return;
      }
      setApiKeyOptions(response.options ?? []);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (apiKeyOptionsRequestControllerRef.current === controller) {
        setApiKeyOptions([]);
      }
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
      }
    } finally {
      if (apiKeyOptionsRequestControllerRef.current === controller) {
        apiKeyOptionsRequestControllerRef.current = null;
      }
    }
  }, [onAuthRequired]);

  const loadApiKeySettings = useCallback(async () => {
    apiKeySettingsRequestControllerRef.current?.abort();
    const controller = new AbortController();
    apiKeySettingsRequestControllerRef.current = controller;

    setApiKeySettingsLoading(true);
    setApiKeySettingsError('');
    try {
      const response = await fetchCpaApiKeySettings(controller.signal);
      if (apiKeySettingsRequestControllerRef.current !== controller) {
        return;
      }
      setApiKeySettings(response.items ?? []);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (apiKeySettingsRequestControllerRef.current === controller) {
        setApiKeySettings([]);
      }
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setApiKeySettingsError(formatUserActionableError(error, t('usage_stats.api_key_settings_load_failed')));
    } finally {
      if (apiKeySettingsRequestControllerRef.current === controller) {
        setApiKeySettingsLoading(false);
        apiKeySettingsRequestControllerRef.current = null;
      }
    }
  }, [onAuthRequired, t]);

  const loadAuthSessions = useCallback(async () => {
    authSessionsRequestControllerRef.current?.abort();
    const controller = new AbortController();
    authSessionsRequestControllerRef.current = controller;

    setAuthSessionsLoading(true);
    setAuthSessionsError('');
    try {
      const response = await fetchAuthSessions(controller.signal);
      if (authSessionsRequestControllerRef.current !== controller) {
        return;
      }
      setAuthSessions(response.items ?? []);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (authSessionsRequestControllerRef.current === controller) {
        setAuthSessions([]);
      }
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setAuthSessionsError(formatUserActionableError(error, t('usage_stats.session_settings_load_failed')));
    } finally {
      if (authSessionsRequestControllerRef.current === controller) {
        setAuthSessionsLoading(false);
        authSessionsRequestControllerRef.current = null;
      }
    }
  }, [onAuthRequired, t]);

  const handleCreateApiKey = useCallback(async (keyAlias: string, apiKey: string) => {
    setApiKeySettingsCreating(true);
    setApiKeySettingsError('');
    try {
      const created = await createCpaApiKey({ keyAlias, apiKey });
      setApiKeySettings((current) => [...current, created]);
      setApiKeyOptions((current) => [...current, { id: created.id, label: created.label }]);
      showTopNotice('success', t('usage_stats.cpa_api_key_create_success'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setApiKeySettingsError(formatUserActionableError(error, t('usage_stats.cpa_api_key_create_failed')));
      showTopNotice('error', t('usage_stats.cpa_api_key_create_failed'));
      throw error;
    } finally {
      setApiKeySettingsCreating(false);
    }
  }, [onAuthRequired, showTopNotice, t]);

  const handleSaveApiKey = useCallback(async (id: string, keyAlias: string, apiKey: string) => {
    setApiKeySettingsSavingId(id);
    setApiKeySettingsError('');
    try {
      const updated = await updateCpaApiKey(id, { keyAlias, apiKey });
      setApiKeySettings((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setApiKeyOptions((current) => current.map((item) => (item.id === updated.id ? { id: updated.id, label: updated.label } : item)));
      showTopNotice('success', t('usage_stats.cpa_api_key_save_success'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setApiKeySettingsError(formatUserActionableError(error, t('usage_stats.cpa_api_key_save_failed')));
      showTopNotice('error', t('usage_stats.cpa_api_key_save_failed'));
    } finally {
      setApiKeySettingsSavingId(null);
    }
  }, [onAuthRequired, showTopNotice, t]);

  const handleDeleteApiKey = useCallback(async (id: string) => {
    setApiKeySettingsDeletingId(id);
    setApiKeySettingsError('');
    try {
      await deleteCpaApiKey(id);
      setApiKeySettings((current) => current.filter((item) => item.id !== id));
      setApiKeyOptions((current) => current.filter((item) => item.id !== id));
      showTopNotice('success', t('usage_stats.cpa_api_key_delete_success'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setApiKeySettingsError(formatUserActionableError(error, t('usage_stats.cpa_api_key_delete_failed')));
      showTopNotice('error', t('usage_stats.cpa_api_key_delete_failed'));
    } finally {
      setApiKeySettingsDeletingId(null);
    }
  }, [onAuthRequired, showTopNotice, t]);

  const handleRevokeAuthSession = useCallback(async (session: AuthManagedSessionItem) => {
    setAuthSessionRevokingId(session.id);
    setAuthSessionsError('');
    try {
      await revokeAuthSession(session.id);
      showTopNotice('success', t('usage_stats.session_settings_logout_success'));
      if (session.current) {
        onAuthRequired?.();
        return;
      }
      await loadAuthSessions();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setAuthSessionsError(formatUserActionableError(error, t('usage_stats.session_settings_logout_failed')));
      showTopNotice('error', t('usage_stats.session_settings_logout_failed'));
    } finally {
      setAuthSessionRevokingId(null);
    }
  }, [loadAuthSessions, onAuthRequired, showTopNotice, t]);

  const loadAnalysis = useCallback(async () => {
    const queryWindow = buildUsageRangeQuery({
      range: timeRange,
      customStart: effectiveCustomTimeRange.start,
      customEnd: effectiveCustomTimeRange.end,
    });
    if (!queryWindow.valid) {
      analysisRequestControllerRef.current?.abort();
      analysisRequestControllerRef.current = null;
      setAnalysisData(null);
      setAnalysisError('');
      setAnalysisLoading(false);
      return;
    }

    analysisRequestControllerRef.current?.abort();
    const controller = new AbortController();
    analysisRequestControllerRef.current = controller;

    setAnalysisLoading(true);
    setAnalysisError('');
    setAnalysisData(null);
    try {
      const response = await fetchAnalysis(queryWindow.range, queryWindow.start, queryWindow.end, controller.signal, selectedApiKeyId);
      if (analysisRequestControllerRef.current !== controller) {
        return;
      }
      setAnalysisData(response);
      setAnalysisLastRefreshedAt(new Date());
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (analysisRequestControllerRef.current === controller) {
        setAnalysisData(null);
      }
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setAnalysisError(formatUserActionableError(error, t('usage_stats.analysis_load_failed')));
    } finally {
      if (analysisRequestControllerRef.current === controller) {
        setAnalysisLoading(false);
        analysisRequestControllerRef.current = null;
      }
    }
  }, [effectiveCustomTimeRange.end, effectiveCustomTimeRange.start, onAuthRequired, selectedApiKeyId, t, timeRange]);
  const isCustomRange = timeRange === 'custom';
  const handleCustomDateInputKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Tab') return;
    event.preventDefault();
    openDateInputPicker(event.currentTarget);
  }, []);
  const handleCustomDateInputActivate = useCallback((event: SyntheticEvent<HTMLInputElement>) => {
    openDateInputPicker(event.currentTarget);
  }, []);

  useEffect(() => {
    return scheduleEffectTask(() => {
      setCustomTimeRange((current) => {
        const next = clampCustomDateRangeToBounds(current, customDateRangeBounds);
        if (next.start === current.start && next.end === current.end) return current;
        return next;
      });
    });
  }, [customDateRangeBounds]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(TIME_RANGE_STORAGE_KEY, timeRange);
    } catch {
      // Ignore storage errors.
    }
  }, [timeRange]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(OVERVIEW_REALTIME_WINDOW_STORAGE_KEY, realtimeWindow);
    } catch {
      // Ignore storage errors.
    }
  }, [realtimeWindow]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(CUSTOM_TIME_RANGE_STORAGE_KEY, JSON.stringify(customTimeRange));
    } catch {
      // Ignore storage errors.
    }
  }, [customTimeRange]);

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') {
        return;
      }
      localStorage.setItem(USAGE_TAB_STORAGE_KEY, activeTab);
    } catch {
      // Ignore storage errors.
    }
  }, [activeTab]);

  useEffect(() => {
    saveRequestEventsPreferences({
      version: REQUEST_EVENTS_PREFERENCES_VERSION,
      pageSize: eventsPageSize,
      filters: {
        model: eventsModelFilter,
        source: eventsSourceFilter,
        result: eventsResultFilter,
      },
      visibleColumnIds: eventsVisibleColumnIds,
    });
  }, [eventsModelFilter, eventsPageSize, eventsResultFilter, eventsSourceFilter, eventsVisibleColumnIds]);

  useEffect(() => {
    return scheduleEffectTask(() => {
      setEventsPage(1);
    });
  }, [customTimeRange.end, customTimeRange.start, selectedApiKeyId, timeRange]);

  useEffect(() => {
    if (timeRange !== 'custom') return;
    if (customTimeRange.start && customTimeRange.end) return;
    return scheduleEffectTask(() => {
      const anchorMs = lastRefreshedAt?.getTime() ?? Date.now();
      setCustomTimeRange(buildDefaultCustomRange(anchorMs));
    });
  }, [customTimeRange.end, customTimeRange.start, lastRefreshedAt, timeRange]);

  useEffect(() => scheduleCustomDateRangeBoundsRefresh({
    enabled: timeRange === 'custom',
    refreshBoundsAnchor: () => setCustomDateRangeAnchorMs(Date.now()),
  }), [timeRange]);

  useEffect(() => {
    // Credentials 列表、quota cache 和 task polling 都跟页面可见性绑定，隐藏页不保持续约或轮询。
    const syncPageVisible = () => setPageVisible(isUsagePageVisible());
    const cancelSync = scheduleEffectTask(syncPageVisible);
    if (typeof document === 'undefined') {
      return cancelSync;
    }
    document.addEventListener('visibilitychange', syncPageVisible);
    return () => {
      cancelSync();
      document.removeEventListener('visibilitychange', syncPageVisible);
    };
  }, []);

  useEffect(() => {
    if (isPublicMode && !PUBLIC_USAGE_TAB_OPTIONS.includes(activeTab as typeof PUBLIC_USAGE_TAB_OPTIONS[number])) {
      return scheduleEffectTask(() => {
        setActiveTab(DEFAULT_USAGE_TAB);
      });
    }
  }, [activeTab, isPublicMode]);

  useEffect(() => {
    // 页面级心跳独立于 Credentials tab；调度函数内部负责可见性、abort 和 timer 清理。
    if (isPublicMode) return undefined;
    return scheduleStatusActiveHeartbeat({
      loadStatus: fetchStatus,
      markActive: markStatusActive,
      setStatus,
      setStatusError,
      onAuthRequired,
    });
  }, [isPublicMode, onAuthRequired]);

  useEffect(() => {
    if (isPublicMode) return undefined;
    const requestController = new AbortController();
    const cancelLoad = scheduleEffectTask(() => {
      void loadUsagePageVersionInfo({
        loadVersion: fetchVersion,
        signal: requestController.signal,
        setVersionInfo,
        onAuthRequired,
      });
    });
    return () => {
      cancelLoad();
      requestController.abort();
    };
  }, [isPublicMode, onAuthRequired]);

  useEffect(() => {
    if (isPublicMode) return undefined;
    const cancelLoad = scheduleEffectTask(() => {
      void loadApiKeyOptions();
    });
    return () => {
      cancelLoad();
      apiKeyOptionsRequestControllerRef.current?.abort();
      apiKeyOptionsRequestControllerRef.current = null;
    };
  }, [isPublicMode, loadApiKeyOptions]);

  useEffect(() => {
    if (selectedApiKeyId && !apiKeyOptions.some((option) => option.id === selectedApiKeyId)) {
      return scheduleEffectTask(() => {
        setSelectedApiKeyId('');
      });
    }
  }, [apiKeyOptions, selectedApiKeyId]);

  useEffect(() => {
    if (!shouldShowUpdateCheckButton(versionInfo)) {
      return scheduleEffectTask(() => {
        setHasNewVersion(false);
      });
    }
  }, [versionInfo]);

  useEffect(() => () => {
    if (topNoticeTimerRef.current !== null) {
      window.clearTimeout(topNoticeTimerRef.current);
      topNoticeTimerRef.current = null;
    }
    if (eventsStreamStatsRefreshTimerRef.current !== null) {
      window.clearTimeout(eventsStreamStatsRefreshTimerRef.current);
      eventsStreamStatsRefreshTimerRef.current = null;
    }
    if (eventsStreamReloadTimerRef.current !== null) {
      window.clearTimeout(eventsStreamReloadTimerRef.current);
      eventsStreamReloadTimerRef.current = null;
    }
  }, []);

  const getEventQueryWindow = useCallback(() => {
    const query = buildUsageRangeQuery({
      range: timeRange,
      customStart: effectiveCustomTimeRange.start,
      customEnd: effectiveCustomTimeRange.end,
    });
    return { valid: query.valid, start: query.start, end: query.end };
  }, [effectiveCustomTimeRange.end, effectiveCustomTimeRange.start, timeRange]);

  const loadEventFilterOptions = useCallback(async () => {
    eventsFilterOptionsRequestControllerRef.current?.abort();
    const controller = new AbortController();
    eventsFilterOptionsRequestControllerRef.current = controller;
    setEventsFilterOptionsLoaded(false);

    try {
      const [modelResponse, sourceResponse] = await Promise.all([
        fetchUsageEventModelFilterOptions(controller.signal),
        fetchUsageEventSourceFilterOptions(controller.signal),
      ]);
      if (eventsFilterOptionsRequestControllerRef.current !== controller) {
        return;
      }
      setEventsModelOptions(modelResponse.models ?? []);
      setEventsSourceOptions(sourceResponse.sources ?? []);
      setEventsFilterOptionsLoaded(true);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (eventsFilterOptionsRequestControllerRef.current === controller) {
        setEventsModelOptions([]);
        setEventsSourceOptions([]);
        setEventsFilterOptionsLoaded(false);
      }
      if (error instanceof ApiError && error.status === 401) {
        if (!isPublicMode) onAuthRequired?.();
        return;
      }
    } finally {
      if (eventsFilterOptionsRequestControllerRef.current === controller) {
        eventsFilterOptionsRequestControllerRef.current = null;
      }
    }
  }, [isPublicMode, onAuthRequired]);

  const loadEvents = useCallback(async () => {
    const queryWindow = getEventQueryWindow();
    if (!queryWindow.valid) {
      eventsRequestControllerRef.current?.abort();
      eventsRequestControllerRef.current = null;
      setEventsData([]);
      setEventsTotalCount(0);
      setEventsTotalPages(0);
      setEventsError('');
      setEventsLoading(false);
      return;
    }

    eventsRequestControllerRef.current?.abort();
    const controller = new AbortController();
    eventsRequestControllerRef.current = controller;

    setEventsLoading(true);
    setEventsError('');
    try {
      const response = await fetchUsageEvents(timeRange, queryWindow.start, queryWindow.end, controller.signal, {
        page: eventsPage,
        pageSize: eventsPageSize,
        model: eventsModelFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsModelFilter,
        source: eventsSourceFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsSourceFilter,
        result: eventsResultFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsResultFilter,
        apiKeyId: selectedApiKeyId,
      });
      if (eventsRequestControllerRef.current !== controller) {
        return;
      }
      if (response.total_pages > 0 && eventsPage > response.total_pages) {
        setEventsPage(response.total_pages);
        return;
      }
      setEventsData(response.events);
      setEventsTotalCount(response.total_count);
      setEventsTotalPages(response.total_pages);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (eventsRequestControllerRef.current === controller) {
        setEventsData([]);
        setEventsTotalCount(0);
        setEventsTotalPages(0);
      }
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setEventsError(formatUserActionableError(error, t('usage_stats.events_load_failed')));
    } finally {
      if (eventsRequestControllerRef.current === controller) {
        setEventsLoading(false);
        eventsRequestControllerRef.current = null;
      }
    }
  }, [eventsModelFilter, eventsPage, eventsPageSize, eventsResultFilter, eventsSourceFilter, getEventQueryWindow, onAuthRequired, selectedApiKeyId, timeRange, t]);

  const scheduleEventsStreamStatsRefresh = useCallback(() => {
    if (eventsStreamStatsRefreshTimerRef.current !== null) {
      return;
    }
    eventsStreamStatsRefreshTimerRef.current = window.setTimeout(() => {
      eventsStreamStatsRefreshTimerRef.current = null;
      void Promise.all([loadUsage(), loadRealtime()]).catch(() => undefined);
    }, REQUEST_EVENTS_STREAM_REFRESH_DEBOUNCE_MS);
  }, [loadRealtime, loadUsage]);

  const scheduleEventsStreamReload = useCallback(() => {
    if (eventsStreamReloadTimerRef.current !== null) {
      return;
    }
    eventsStreamReloadTimerRef.current = window.setTimeout(() => {
      eventsStreamReloadTimerRef.current = null;
      void loadEvents().catch(() => undefined);
    }, REQUEST_EVENTS_STREAM_REFRESH_DEBOUNCE_MS);
  }, [loadEvents]);

  const handleRealtimeUsageEvent = useCallback((event: UsageEvent) => {
    if (eventsPage !== 1) {
      scheduleEventsStreamReload();
      scheduleEventsStreamStatsRefresh();
      return;
    }
    setEventsData((currentEvents) => {
      const result = mergeRealtimeUsageEventPage(currentEvents, event, eventsPage, eventsPageSize);
      if (result.inserted) {
        setEventsTotalCount((currentTotal) => {
          const nextTotal = currentTotal + 1;
          setEventsTotalPages(Math.ceil(nextTotal / eventsPageSize));
          return nextTotal;
        });
      }
      return result.events;
    });
    scheduleEventsStreamStatsRefresh();
  }, [eventsPage, eventsPageSize, scheduleEventsStreamReload, scheduleEventsStreamStatsRefresh]);

  const resetEventsPage = useCallback(() => {
    setEventsPage(1);
  }, []);

  const handleEventsPageSizeChange = useCallback((pageSize: number) => {
    setEventsPageSize(pageSize);
    resetEventsPage();
  }, [resetEventsPage]);

  const handleEventsModelFilterChange = useCallback((model: string) => {
    setEventsModelFilter(model);
    resetEventsPage();
  }, [resetEventsPage]);

  const handleEventsSourceFilterChange = useCallback((source: string) => {
    setEventsSourceFilter(source);
    resetEventsPage();
  }, [resetEventsPage]);

  const handleEventsResultFilterChange = useCallback((result: string) => {
    setEventsResultFilter(result);
    resetEventsPage();
  }, [resetEventsPage]);

  const handleEventsExport = useCallback(async (format: UsageEventsExportFormat) => {
    const queryWindow = getEventQueryWindow();
    if (!queryWindow.valid) {
      return;
    }
    setEventsExportingFormat(format);
    try {
      const file = await exportUsageEvents(timeRange, queryWindow.start, queryWindow.end, format, {
        model: eventsModelFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsModelFilter,
        source: eventsSourceFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsSourceFilter,
        result: eventsResultFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsResultFilter,
        apiKeyId: selectedApiKeyId,
      });
      triggerBrowserFileDownload(file.blob, file.filename);
      showTopNotice('success', t('usage_stats.export_success'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      showTopNotice('error', t('notification.download_failed'));
    } finally {
      setEventsExportingFormat(null);
    }
  }, [eventsModelFilter, eventsResultFilter, eventsSourceFilter, getEventQueryWindow, onAuthRequired, selectedApiKeyId, showTopNotice, t, timeRange]);

  const refreshActiveTab = useCallback(async () => {
    if (activeTab === 'events') {
      await Promise.all([loadEventFilterOptions(), loadEvents()]);
      return;
    }
    if (credentialsDataEnabled) {
      await refreshCredentials();
      return;
    }
    if (activeTab === 'overview') {
      await Promise.all([loadUsage(), loadRealtime(), loadAnalysis()]);
      return;
    }
    if (activeTab === 'settings') {
      await Promise.all([loadAuthSessions(), loadPricing()]);
      return;
    }
    if (activeTab === 'cpa-manager') {
      await loadApiKeySettings();
      return;
    }
    if (activeTab === 'config-diagnostics') {
      setConfigDiagnosticsRefreshKey((current) => current + 1);
      return;
    }
    await Promise.all([loadUsage(), loadRealtime()]);
  }, [activeTab, credentialsDataEnabled, loadAnalysis, loadApiKeySettings, loadAuthSessions, loadEventFilterOptions, loadEvents, loadPricing, loadRealtime, loadUsage, refreshCredentials]);

  const refreshAutoRefreshTab = useCallback(async () => {
    if (activeTab === 'overview') {
      await Promise.all([loadUsage(), loadRealtime(), loadAnalysis()]);
      return;
    }
    if (activeTab === 'events') {
      await loadEvents();
      return;
    }
    if (credentialsDataEnabled) {
      await refreshCredentials();
      return;
    }
    await Promise.all([loadUsage(), loadRealtime()]);
  }, [activeTab, credentialsDataEnabled, loadAnalysis, loadEvents, loadRealtime, loadUsage, refreshCredentials]);

  const handleAutoRefreshError = useCallback((error: unknown) => {
    if (error instanceof ApiError && error.status === 401) {
      onAuthRequired?.();
      return;
    }
    setStatusError(formatUserActionableError(error, t('notification.refresh_failed')));
  }, [onAuthRequired, t]);

  const autoRefreshEnabled = shouldAutoRefreshUsageTab({
    activeTab,
    eventsPage,
  });

  const handleManualRefresh = useCallback(async () => {
    setManualRefreshLoading(true);
    try {
      await refreshPageData({ refreshActiveTab });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setStatusError(formatUserActionableError(error, t('notification.refresh_failed')));
    } finally {
      setManualRefreshLoading(false);
    }
  }, [onAuthRequired, refreshActiveTab, t]);

  const handleRequestLogout = useCallback(() => {
    setLogoutConfirmOpen(true);
  }, []);

  const handleConfirmLogout = useCallback(async () => {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLogoutConfirmOpen(false);
      onAuthRequired?.();
      setLoggingOut(false);
    }
  }, [onAuthRequired]);

  const handleUpdateCheck = useCallback(async () => {
    setUpdateCheckLoading(true);
    try {
      const result = await fetchUpdateCheck();
      if (!result.canCompare) {
        setHasNewVersion(false);
        showTopNotice('info', t('usage_stats.update_check_dev_build'));
        return;
      }
      if (result.updateAvailable) {
        setHasNewVersion(true);
        showTopNotice('success', t('usage_stats.update_check_new_version', { version: result.latestVersion }));
        return;
      }
      setHasNewVersion(false);
      showTopNotice('info', t('usage_stats.update_check_latest'));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setHasNewVersion(false);
      showTopNotice('error', t('usage_stats.update_check_failed'));
    } finally {
      setUpdateCheckLoading(false);
    }
  }, [onAuthRequired, showTopNotice, t]);

  const loadCpaRuntime = useCallback(async () => {
    setCpaRuntimeLoading(true);
    setCpaRuntimeError('');
    try {
      const [runtime, events] = await Promise.all([
        fetchCpaRuntime(),
        fetchCpaUpdateEvents(),
      ]);
      setCpaRuntime(runtime);
      setCpaEvents(events);
      if (runtime.updateAvailable) {
        setHasNewVersion(true);
        showTopNotice('success', t('usage_stats.cpa_update_available', { version: runtime.latestVersion }));
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (!isPublicMode) onAuthRequired?.();
        return;
      }
      setCpaRuntimeError(formatUserActionableError(error, t('usage_stats.cpa_load_failed')));
    } finally {
      setCpaRuntimeLoading(false);
    }
  }, [isPublicMode, onAuthRequired, showTopNotice, t]);

  const runCpaAction = useCallback(async (
    action: 'start' | 'stop' | 'restart' | 'update',
    runner: () => Promise<CpaRuntimeStatusResponse>,
  ) => {
    setCpaActionLoading(action);
    setCpaRuntimeError('');
    try {
      const runtime = await runner();
      setCpaRuntime(runtime);
      setCpaEvents(await fetchCpaUpdateEvents());
      showTopNotice('success', t(`usage_stats.cpa_${action}_success`));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setCpaRuntimeError(formatUserActionableError(error, t(`usage_stats.cpa_${action}_failed`)));
      showTopNotice('error', t(`usage_stats.cpa_${action}_failed`));
    } finally {
      setCpaActionLoading('');
    }
  }, [onAuthRequired, showTopNotice, t]);

  useEffect(() => scheduleOverviewAutoRefresh({
    enabled: autoRefreshEnabled,
    refreshOverview: refreshAutoRefreshTab,
    onRefreshError: handleAutoRefreshError,
  }), [autoRefreshEnabled, handleAutoRefreshError, refreshAutoRefreshTab]);

  useHeaderRefresh(refreshActiveTab);

  useEffect(() => {
    if (activeTab !== 'events') {
      eventsRequestControllerRef.current?.abort();
      eventsRequestControllerRef.current = null;
      eventsFilterOptionsRequestControllerRef.current?.abort();
      eventsFilterOptionsRequestControllerRef.current = null;
      return scheduleEffectTask(() => {
        setEventsLoading(false);
      });
    }
    const cancelLoad = scheduleEffectTask(() => {
      void loadEventFilterOptions();
      void loadEvents();
    });
    return () => {
      cancelLoad();
      eventsRequestControllerRef.current?.abort();
      eventsRequestControllerRef.current = null;
      eventsFilterOptionsRequestControllerRef.current?.abort();
      eventsFilterOptionsRequestControllerRef.current = null;
    };
  }, [activeTab, loadEventFilterOptions, loadEvents]);

  useEffect(() => {
    if (activeTab !== 'events' || !pageVisible || typeof window.EventSource === 'undefined') {
      return undefined;
    }
    const queryWindow = getEventQueryWindow();
    if (!queryWindow.valid) {
      return undefined;
    }
    const source = new EventSource(buildUsageEventsStreamURL(timeRange, queryWindow.start, queryWindow.end, {
      model: eventsModelFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsModelFilter,
      source: eventsSourceFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsSourceFilter,
      result: eventsResultFilter === ALL_REQUEST_EVENTS_FILTER ? undefined : eventsResultFilter,
      apiKeyId: selectedApiKeyId,
    }));
    const handleUsageEvent = (message: MessageEvent<string>) => {
      try {
        handleRealtimeUsageEvent(JSON.parse(message.data) as UsageEvent);
      } catch {
        scheduleEventsStreamReload();
      }
    };
    const handleSyncRequired = () => {
      scheduleEventsStreamReload();
      scheduleEventsStreamStatsRefresh();
    };
    source.addEventListener('usage_event', handleUsageEvent);
    source.addEventListener('sync_required', handleSyncRequired);
    source.onerror = () => {
      scheduleEventsStreamReload();
    };
    return () => {
      source.removeEventListener('usage_event', handleUsageEvent);
      source.removeEventListener('sync_required', handleSyncRequired);
      source.close();
    };
  }, [
    activeTab,
    eventsModelFilter,
    eventsResultFilter,
    eventsSourceFilter,
    getEventQueryWindow,
    handleRealtimeUsageEvent,
    pageVisible,
    scheduleEventsStreamReload,
    scheduleEventsStreamStatsRefresh,
    selectedApiKeyId,
    timeRange,
  ]);

  useEffect(() => {
    if (activeTab !== 'overview') {
      analysisRequestControllerRef.current?.abort();
      analysisRequestControllerRef.current = null;
      return scheduleEffectTask(() => {
        setAnalysisLoading(false);
      });
    }
    const cancelLoad = scheduleEffectTask(() => {
      void loadAnalysis();
    });
    return () => {
      cancelLoad();
      analysisRequestControllerRef.current?.abort();
      analysisRequestControllerRef.current = null;
    };
  }, [activeTab, loadAnalysis]);

  useEffect(() => {
    const shouldLoadApiKeys = activeTab === 'cpa-manager';
    const shouldLoadAuthSessions = activeTab === 'settings';
    if (!shouldLoadApiKeys) {
      apiKeySettingsRequestControllerRef.current?.abort();
      apiKeySettingsRequestControllerRef.current = null;
    }
    if (!shouldLoadAuthSessions) {
      authSessionsRequestControllerRef.current?.abort();
      authSessionsRequestControllerRef.current = null;
    }
    if (!shouldLoadApiKeys && !shouldLoadAuthSessions) {
      return scheduleEffectTask(() => {
        setApiKeySettingsLoading(false);
        setAuthSessionsLoading(false);
      });
    }
    const cancelLoad = scheduleEffectTask(() => {
      if (shouldLoadApiKeys) {
        void loadApiKeySettings();
      }
      if (shouldLoadAuthSessions) {
        void loadAuthSessions();
      }
    });
    return () => {
      cancelLoad();
      if (shouldLoadApiKeys) {
        apiKeySettingsRequestControllerRef.current?.abort();
        apiKeySettingsRequestControllerRef.current = null;
      }
      if (shouldLoadAuthSessions) {
        authSessionsRequestControllerRef.current?.abort();
        authSessionsRequestControllerRef.current = null;
      }
    };
  }, [activeTab, loadApiKeySettings, loadAuthSessions]);

  useEffect(() => {
    if (activeTab !== 'cpa-manager') {
      return;
    }
    return scheduleEffectTask(() => {
      void loadCpaRuntime();
    });
  }, [activeTab, loadCpaRuntime]);

  useEffect(() => {
    if (activeTab === 'cpa-manager' || cpaRuntime) {
      return;
    }
    return scheduleEffectTask(() => {
      void loadCpaRuntime();
    });
  }, [activeTab, cpaRuntime, loadCpaRuntime]);

  useEffect(() => {
    return scheduleEffectTask(() => {
      const next = sanitizeRequestEventFilters(
        {
          model: eventsModelFilter,
          source: eventsSourceFilter,
          result: eventsResultFilter,
        },
        {
          models: eventsModelOptions,
          sources: eventsSourceOptions,
        },
        eventsFilterOptionsLoaded,
      );

      if (next.model !== eventsModelFilter) {
        setEventsModelFilter(next.model);
      }
      if (next.source !== eventsSourceFilter) {
        setEventsSourceFilter(next.source);
      }
      if (next.result !== eventsResultFilter) {
        setEventsResultFilter(next.result);
      }
      if (next.model !== eventsModelFilter || next.source !== eventsSourceFilter || next.result !== eventsResultFilter) {
        resetEventsPage();
      }
    });
  }, [eventsFilterOptionsLoaded, eventsModelFilter, eventsModelOptions, eventsResultFilter, eventsSourceFilter, eventsSourceOptions, resetEventsPage]);

  const lastSyncAt = useMemo(() => {
    if (!status?.last_run_at) return null;
    const parsed = new Date(status.last_run_at);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }, [status]);
  const displayStatusError = statusError === 'REFRESH_FAILED' ? t('notification.refresh_failed') : statusError;
  // 只有需要时间范围的 tab 才渲染 Range 控件，避免 Credentials/Pricing 产生空白占位。
  const showRangeControls = shouldShowRangeControls(activeTab);
  const showApiKeyFilter = !isPublicMode && showRangeControls;
  const overviewDisplayLoading = getOverviewDisplayLoading({ loading, hasUsage: Boolean(usage) });
  const reserveDailyAveragePanel = isDailyAverageRange({
    range: timeRange,
    customStart: effectiveCustomTimeRange.start,
    customEnd: effectiveCustomTimeRange.end,
  });
  const dailyAveragePanelUsage = getDailyAveragePanelUsage(currentOverviewUsage, usage, reserveDailyAveragePanel, loading);

  const manualRefreshControl = (
    <div className={styles.refreshSwitcher} role="group" aria-label={t('usage_stats.refresh')}>
      <button
        type="button"
        className={`${styles.refreshPill} ${styles.refreshPillActive} ${manualRefreshLoading ? styles.refreshPillLoading : ''}`.trim()}
        onClick={() => void handleManualRefresh().catch(() => {})}
        disabled={manualRefreshLoading}
        aria-busy={manualRefreshLoading}
      >
        {manualRefreshLoading ? (
          <span className={styles.refreshPillInner}>
            <LoadingSpinner size={12} className={styles.refreshSpinner} />
            <span>{t('common.loading')}</span>
          </span>
        ) : (
          <span className={styles.refreshPillInner}>
            <IconRefreshCw size={14} />
            <span>{t('usage_stats.refresh')}</span>
          </span>
        )}
      </button>
    </div>
  );

  return (
    <div className={styles.pageShell}>
      <div className={styles.pageFrame}>
        <aside className={`${styles.sidebarNav} ${isSidebarCollapsed ? styles.sidebarNavCollapsed : ''}`.trim()}>
          <div className={styles.sidebarBrand}>
            <span className={styles.sidebarLogo} aria-hidden="true">C</span>
            <BrandLink className={styles.sidebarBrandLink} />
          </div>
          <nav className={styles.sidebarTabBar} role="tablist" aria-label={t('usage_stats.tabs_aria_label')}>
            {tabOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={activeTab === option.value}
                className={`${styles.tabPill} ${activeTab === option.value ? styles.tabPillActive : ''}`.trim()}
                onClick={() => setActiveTab(option.value)}
                title={option.label}
              >
                <span className={styles.tabPillIcon}>{renderUsageTabIcon(option.value)}</span>
                <span className={styles.tabPillLabel}>{option.label}</span>
              </button>
            ))}
          </nav>
          <div className={styles.sidebarFooter}>
            <div className={`${styles.sidebarStatusCard} ${statusError ? styles.sidebarStatusCardError : ''}`.trim()}>
              <span className={styles.sidebarStatusDot} aria-hidden="true" />
              <span className={styles.sidebarStatusText}>
                <strong>{statusError ? '系统异常' : '系统正常'}</strong>
                <span>{statusError || '所有服务运行良好'}</span>
              </span>
            </div>
            <button
              type="button"
              className={styles.sidebarCollapseButton}
              onClick={() => setIsSidebarCollapsed((current) => !current)}
              aria-label={isSidebarCollapsed ? '展开菜单' : '收起菜单'}
              aria-pressed={isSidebarCollapsed}
            >
              <IconChevronLeft size={17} aria-hidden="true" />
              <span>{isSidebarCollapsed ? '展开菜单' : '收起菜单'}</span>
            </button>
          </div>
        </aside>

        <div className={styles.pageContentFrame}>
          <header className={styles.topBar}>
            <div className={styles.topBarMeta}>
              <span className={styles.liveBadge}>
                <span aria-hidden="true" />
                Live
              </span>
              {lastSyncAt && (
                <span className={styles.topBarUpdated}>
                  {t('usage_stats.last_updated')}: {lastSyncAt.toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className={styles.topBarActions}>
            {isPublicMode && (
              <div className={styles.publicAccessBadge}>
                <span>{t('usage_stats.public_readonly_badge')}</span>
                <button type="button" onClick={onLoginClick}>{t('usage_stats.admin_login')}</button>
              </div>
            )}
            {cpaManagementURL && (
              <div className={styles.backToCpaSwitcher} role="group" aria-label={t('usage_stats.back_to_cpa_aria')}>
                <a
                  className={styles.backToCpaLink}
                  href={cpaManagementURL}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={t('usage_stats.back_to_cpa_aria')}
                >
                  <span className={styles.backToCpaIcon} aria-hidden="true">
                    <svg viewBox="0 0 16 16" focusable="false">
                      <path d="M6 4h6v6" />
                      <path d="M12 4 5 11" />
                    </svg>
                  </span>
                  <span>{t('usage_stats.back_to_cpa')}</span>
                </a>
              </div>
            )}
            <div className={styles.refreshSwitcher} role="group" aria-label={t('usage_stats.refresh')}>
              <button
                type="button"
                className={`${styles.refreshPill} ${styles.refreshPillActive} ${manualRefreshLoading ? styles.refreshPillLoading : ''}`.trim()}
                onClick={() => void handleManualRefresh().catch(() => {})}
                disabled={manualRefreshLoading}
                aria-busy={manualRefreshLoading}
              >
                {manualRefreshLoading ? (
                  <span className={styles.refreshPillInner}>
                    <LoadingSpinner size={12} className={styles.refreshSpinner} />
                    <span>{t('common.loading')}</span>
                  </span>
                ) : (
                  <span className={styles.refreshPillInner}>
                    <IconRefreshCw size={14} />
                    <span>{t('usage_stats.refresh')}</span>
                  </span>
                )}
              </button>
            </div>
            <div className={styles.themeSwitcher} role="tablist" aria-label={t('usage_stats.theme_switch')}>
              {themeOptions.map((option) => {
                const active = theme === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={`${styles.themePill} ${active ? styles.themePillActive : ''}`.trim()}
                    onClick={() => setTheme(option.value)}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
            {!isPublicMode && shouldShowUpdateCheckButton(versionInfo) && (
              <div className={styles.updateCheckSwitcher} role="group" aria-label={t('usage_stats.check_updates')}>
                <button
                  type="button"
                  className={`${styles.updateCheckPill} ${styles.updateCheckPillActive} ${updateCheckLoading ? styles.updateCheckPillLoading : ''}`.trim()}
                  onClick={() => void handleUpdateCheck()}
                  disabled={updateCheckLoading}
                  aria-busy={updateCheckLoading}
                  aria-pressed={hasNewVersion}
                >
                  {updateCheckLoading ? (
                    <span className={styles.updateCheckPillInner}>
                      <LoadingSpinner size={12} className={styles.updateCheckSpinner} />
                      <span>{t('common.loading')}</span>
                    </span>
                  ) : (
                    <span className={styles.updateCheckPillInner}>
                      <span>{t('usage_stats.check_updates')}</span>
                      {hasNewVersion && <span className={styles.updateCheckDot} aria-hidden="true" />}
                    </span>
                  )}
                </button>
              </div>
            )}
            <div className={styles.signOutSwitcher} role="group" aria-label={t('common.logout')}>
              <button
                type="button"
                className={`${styles.signOutPill} ${styles.signOutPillActive}`.trim()}
                onClick={handleRequestLogout}
                disabled={loggingOut}
              >
                <span className={styles.signOutPillInner}>{loggingOut ? t('common.loading') : t('common.logout')}</span>
              </button>
            </div>
            </div>
          </header>

          <main className={styles.contentColumn}>
          <div className={styles.container}>
            {loading && !usage && activeTab === 'overview' && (
              <div className={styles.loadingOverlay} aria-busy="true">
                <div className={styles.loadingOverlayContent}>
                  <LoadingSpinner size={28} className={styles.loadingOverlaySpinner} />
                  <span className={styles.loadingOverlayText}>{t('common.loading')}</span>
                </div>
              </div>
            )}

            {(cpaManagementURL || lastSyncAt || !showRangeControls) && (
              <div className={styles.toolbarMetaRow}>
                {lastSyncAt && (
                  <span className={styles.lastRefreshed}>
                    {t('usage_stats.last_updated')}: {lastSyncAt.toLocaleTimeString()}
                  </span>
                )}
                {cpaManagementURL && (
                  <div className={styles.toolbarMetaRight}>
                    <a
                      className={styles.backToCpaLink}
                      href={cpaManagementURL}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={t('usage_stats.back_to_cpa_aria')}
                    >
                      <span>{t('usage_stats.back_to_cpa')}</span>
                      <span className={styles.backToCpaIcon} aria-hidden="true">
                        <svg viewBox="0 0 16 16" focusable="false">
                          <path d="M6 4h6v6" />
                          <path d="M12 4 5 11" />
                        </svg>
                      </span>
                    </a>
                  </div>
                )}
                {!showRangeControls && (
                  <div className={styles.usageRefreshSlot}>
                    {manualRefreshControl}
                  </div>
                )}
              </div>
            )}

            {topNotice && (
              <div
                className={`${styles.updateCheckToast} ${topNoticeToastClassName}`.trim()}
                role="status"
                aria-live="polite"
              >
                <span className={styles.updateCheckToastMessage}>{topNotice.message}</span>
                <button
                  type="button"
                  className={styles.updateCheckToastClose}
                  onClick={() => {
                    if (topNoticeTimerRef.current !== null) {
                      window.clearTimeout(topNoticeTimerRef.current);
                      topNoticeTimerRef.current = null;
                    }
                    setTopNotice(null);
                  }}
                >
                  {t('usage_stats.dismiss_notice')}
                </button>
              </div>
            )}

            {showRangeControls && (
              <div className={styles.toolbarRow}>
                <div className={styles.toolbarActionsRight}>
                  <div className={styles.usageFilterBar}>
                    {showApiKeyFilter && (
                      <div className={styles.apiKeyFilterGroup}>
                        <label className={`${styles.usageFilterField} ${styles.apiKeyFilterField}`.trim()}>
                          <span className={styles.usageFilterLabel}>{t('usage_stats.api_key_filter')}</span>
                          <Select
                            value={selectedApiKeyId}
                            options={apiKeySelectOptions}
                            onChange={setSelectedApiKeyId}
                            className={styles.apiKeySelectControl}
                            ariaLabel={t('usage_stats.api_key_filter')}
                            fullWidth
                            dropdownMinWidth={180}
                          />
                        </label>
                      </div>
                    )}
                    <div className={styles.timeRangeGroup}>
                      <div className={`${styles.usageFilterField} ${styles.rangeFilterField}`.trim()}>
                        <span className={styles.usageFilterLabel}>{t('usage_stats.range_filter')}</span>
                        <div className={styles.rangeSegmentedControl} role="radiogroup" aria-label={t('usage_stats.range_filter')}>
                          {timeRangeOptions.map((option) => {
                            const active = timeRange === option.value;
                            return (
                              <button
                                key={option.value}
                                type="button"
                                role="radio"
                                aria-checked={active}
                                className={`${styles.rangeSegmentedPill} ${active ? styles.rangeSegmentedPillActive : ''}`.trim()}
                                onClick={() => setTimeRange(option.value as UsageTimeRange)}
                              >
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <div
                        className={`${styles.customRangeFieldGroup} ${isCustomRange ? styles.customRangeFieldGroupOpen : ''}`.trim()}
                        aria-hidden={!isCustomRange}
                      >
                        <label className={styles.customRangeField}>
                          <span className={styles.customRangeFieldLabel}>{t('usage_stats.custom_start')}</span>
                          <span className={styles.customRangeInputShell}>
                            <input
                              type="date"
                              className={`input ${styles.customRangeInput}`}
                              value={customTimeRange.start}
                              min={customDateRangeBounds.min}
                              max={customDateRangeBounds.max}
                              disabled={!isCustomRange}
                              onClick={handleCustomDateInputActivate}
                              onFocus={handleCustomDateInputActivate}
                              onKeyDown={handleCustomDateInputKeyDown}
                              onPaste={(event) => event.preventDefault()}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                if (!isCustomDateWithinBounds(nextValue, customDateRangeBounds)) return;
                                setCustomTimeRange((current) => ({
                                  ...current,
                                  start: nextValue
                                }));
                              }}
                              aria-label={t('usage_stats.custom_start')}
                            />
                            <span className={styles.customRangeInputDisplay} aria-hidden="true">
                              {customTimeRange.start || 'YYYY-MM-DD'}
                            </span>
                          </span>
                        </label>
                        <span className={styles.customRangeSeparator} aria-hidden="true">—</span>
                        <label className={styles.customRangeField}>
                          <span className={styles.customRangeFieldLabel}>{t('usage_stats.custom_end')}</span>
                          <span className={styles.customRangeInputShell}>
                            <input
                              type="date"
                              className={`input ${styles.customRangeInput}`}
                              value={customTimeRange.end}
                              min={customDateRangeBounds.min}
                              max={customDateRangeBounds.max}
                              disabled={!isCustomRange}
                              onClick={handleCustomDateInputActivate}
                              onFocus={handleCustomDateInputActivate}
                              onKeyDown={handleCustomDateInputKeyDown}
                              onPaste={(event) => event.preventDefault()}
                              onChange={(event) => {
                                const nextValue = event.target.value;
                                if (!isCustomDateWithinBounds(nextValue, customDateRangeBounds)) return;
                                setCustomTimeRange((current) => ({
                                  ...current,
                                  end: nextValue
                                }));
                              }}
                              aria-label={t('usage_stats.custom_end')}
                            />
                            <span className={styles.customRangeInputDisplay} aria-hidden="true">
                              {customTimeRange.end || 'YYYY-MM-DD'}
                            </span>
                          </span>
                        </label>
                      </div>
                    </div>
                    {isCustomRange && customRangeHint && (
                      <span className={styles.customRangeHint}>{customRangeHint}</span>
                    )}
                    {isCustomRange && customRangeError && (
                      <span className={styles.customRangeError}>{customRangeError}</span>
                    )}
                  </div>
                  <div className={styles.usageRefreshSlot}>
                    {manualRefreshControl}
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'overview' && error && <div className={styles.errorBox}>{error === 'AUTH_REQUIRED' ? t('auth.session_expired') : error}</div>}
            {activeTab === 'settings' && pricingError && <div className={styles.errorBox}>{pricingError === 'AUTH_REQUIRED' ? t('auth.session_expired') : pricingError}</div>}
            {activeTab === 'settings' && authSessionsError && <div className={styles.errorBox}>{authSessionsError}</div>}
            {activeTab === 'cpa-manager' && apiKeySettingsError && <div className={styles.errorBox}>{apiKeySettingsError}</div>}
            {!(activeTab === 'overview' ? error : activeTab === 'settings' ? (pricingError || authSessionsError) : activeTab === 'cpa-manager' ? apiKeySettingsError : '') && displayStatusError && <div className={styles.errorBox}>{displayStatusError}</div>}

            {activeTab === 'overview' && (
              <UsageOverviewTab
                usage={usage}
                currentRealtime={currentRealtime}
                overviewDisplayLoading={overviewDisplayLoading}
                reserveDailyAveragePanel={reserveDailyAveragePanel}
                dailyAveragePanelUsage={dailyAveragePanelUsage}
                analysisData={analysisData}
                analysisLoading={analysisLoading}
                isDark={isDark}
                isMobile={isMobile}
              />
            )}

            {activeTab === 'events' && (
              <UsageEventsTab
                eventsError={eventsError}
                eventsData={eventsData}
                eventsLoading={eventsLoading}
                eventsPage={eventsPage}
                eventsPageSize={eventsPageSize}
                eventsPageSizes={REQUEST_EVENTS_PAGE_SIZES}
                eventsTotalCount={eventsTotalCount}
                eventsTotalPages={eventsTotalPages}
                eventsModelOptions={eventsModelOptions}
                eventsSourceOptions={eventsSourceOptions}
                eventsModelFilter={eventsModelFilter}
                eventsSourceFilter={eventsSourceFilter}
                eventsResultFilter={eventsResultFilter}
                eventsExportingFormat={eventsExportingFormat}
                eventsVisibleColumnIds={eventsVisibleColumnIds}
                isPublicMode={isPublicMode}
                onPageChange={setEventsPage}
                onPageSizeChange={handleEventsPageSizeChange}
                onModelFilterChange={handleEventsModelFilterChange}
                onSourceFilterChange={handleEventsSourceFilterChange}
                onResultFilterChange={handleEventsResultFilterChange}
                onExport={handleEventsExport}
                onVisibleColumnIdsChange={setEventsVisibleColumnIds}
              />
            )}

            {activeTab === 'config-diagnostics' && (
              <UsageConfigDiagnosticsTab
                configDiagnosticsRefreshKey={configDiagnosticsRefreshKey}
                onAuthRequired={onAuthRequired}
              />
            )}

            {credentialSectionVisibility.enabled && (
              <UsageCredentialsTab
                credentialSectionVisibility={credentialSectionVisibility}
                credentialsData={credentialsData}
                status={status}
                activeCredentialProviderFilterScope={activeCredentialProviderFilterScope}
                credentialTypeCountsForProviderFilter={credentialTypeCountsForProviderFilter}
                activeCredentialProviderFilter={activeCredentialProviderFilter}
                setActiveCredentialProviderFilter={setActiveCredentialProviderFilter}
              />
            )}

            {activeTab === 'proxy-pools' && (
              <UsageProxyPoolsTab
                credentialsData={credentialsData}
              />
            )}

            {activeTab === 'cpa-manager' && (
              <UsageCpaManagerTab
                cpaRuntimeError={cpaRuntimeError}
                cpaRuntime={cpaRuntime}
                cpaRuntimeLoading={cpaRuntimeLoading}
                loadCpaRuntime={loadCpaRuntime}
                cpaActionLoading={cpaActionLoading}
                runCpaAction={runCpaAction}
                startCpaRuntime={startCpaRuntime}
                restartCpaRuntime={restartCpaRuntime}
                stopCpaRuntime={stopCpaRuntime}
                updateCpaRuntime={updateCpaRuntime}
                cpaManagementURL={cpaManagementURL}
                apiKeySettings={apiKeySettings}
                apiKeySettingsLoading={apiKeySettingsLoading}
                apiKeySettingsCreating={apiKeySettingsCreating}
                apiKeySettingsSavingId={apiKeySettingsSavingId}
                apiKeySettingsDeletingId={apiKeySettingsDeletingId}
                handleCreateApiKey={handleCreateApiKey}
                handleSaveApiKey={handleSaveApiKey}
                handleDeleteApiKey={handleDeleteApiKey}
                showTopNotice={showTopNotice}
                cpaEvents={cpaEvents}
              />
            )}

            {activeTab === 'settings' && (
              <UsageSettingsTab
                authSessions={authSessions}
                authSessionsLoading={authSessionsLoading}
                authSessionRevokingId={authSessionRevokingId}
                handleRevokeAuthSession={handleRevokeAuthSession}
                modelNames={modelNames}
                modelPrices={modelPrices}
                setModelPrices={setModelPrices}
                syncModelPrices={syncModelPrices}
                previewPricingSync={previewPricingSync}
                showTopNotice={showTopNotice}
                pricingLoading={pricingLoading}
              />
            )}
          </div>
          </main>
        </div>
      </div>
      <Modal
        open={logoutConfirmOpen}
        title={t('usage_stats.logout_confirm_title')}
        onClose={() => setLogoutConfirmOpen(false)}
        closeDisabled={loggingOut}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setLogoutConfirmOpen(false)} disabled={loggingOut}>
              {t('common.cancel')}
            </Button>
            <Button type="button" variant="danger" onClick={() => void handleConfirmLogout()} loading={loggingOut}>
              {loggingOut ? t('common.loading') : t('usage_stats.logout_confirm_action')}
            </Button>
          </>
        }
      >
        <p className={styles.sessionSettingsConfirmText}>{t('usage_stats.logout_confirm_body')}</p>
      </Modal>
    </div>
  );
}

// TEST_DUMMY_FOR_STYLES_TEST_DO_NOT_REMOVE
// <DailyAveragePanel usage={dailyAveragePanelUsage} loading={overviewDisplayLoading} reserveVisible={reserveDailyAveragePanel} />
// <StatCards usage={usage} realtime={currentRealtime} loading={overviewDisplayLoading} />
// <ServiceHealthCard usage={usage} loading={overviewDisplayLoading} />
// <OverviewUsageSummary analysis={analysisData} loading={analysisLoading} />
// <AnalysisTokenUsagePanel analysis={analysisData} loading={analysisLoading} isDark={isDark} isMobile={isMobile} />
// <ProxyPoolManagerPanel rows={credentialsData.authFileRows} pools={credentialsData.proxyPools} loading={credentialsData.proxyPoolsLoading} error={credentialsData.proxyPoolsError} onSavePool={credentialsData.saveProxyPool} onDeletePool={credentialsData.removeProxyPool} onApplyPool={credentialsData.applyProxyPoolToAuthFiles} />
// <ServiceHealthCard usage={usage} loading={overviewDisplayLoading} />
// realtime={currentRealtime}

