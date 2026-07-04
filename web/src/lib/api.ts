import { type AnalysisResponse, type AuthFileCooldown, type AuthFileCooldownsResponse, type AuthFilesManagementResponse, type AuthManagedSessionsResponse, type AuthSessionResponse, type ConfigDiagnosticsResponse, type ConfigStatusResponse, type CpaRuntimeStatusResponse, type CpaUpdateEvent, type CpaApiKeyDisplayItem, type CpaApiKeyOptionsResponse, type CpaApiKeySaveRequest, type CpaApiKeySettingsItem, type CpaApiKeySettingsResponse, type CpaApiKeysResponse, type KeyOverviewTimeRange, type OverviewRealtimeBlock, type OverviewRealtimeWindow, type PricingEntry, type PricingResponse, type PricingSyncPreviewResponse, type ProxyPool, type ProxyPoolsResponse, type ProxyPoolTestResponse, type StatusResponse, type UpdateCheckResponse, type UsageEventModelFilterOptionsResponse, type UsageEventSourceFilterOptionsResponse, type UsedModelsResponse, type UsageIdentitiesPageResponse, type UsageIdentitiesResponse, type UsageEventsResponse, type UsageIdentity, type UsageIdentityAuthType, type UsageOverviewResponse, type UsageQuotaCacheResponse, type UsageQuotaCheckResponse, type UsageQuotaInspectionStatusResponse, type UsageQuotaRefreshRejectedAuthIndex, type UsageQuotaRefreshResponse, type UsageQuotaRefreshTaskRef, type UsageQuotaRefreshTaskResponse, type UsageQuotaResetResponse, type VersionResponse } from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const APP_BASE_PATH_PLACEHOLDER = '__APP_BASE_PATH__'

declare global {
  interface Window {
    __APP_BASE_PATH__?: string
  }
}

function normalizeBasePath(basePath: string | undefined): string {
  if (!basePath || basePath === '/' || basePath === APP_BASE_PATH_PLACEHOLDER) {
    return ''
  }
  return basePath.endsWith('/') ? basePath.slice(0, -1) : basePath
}

function realtimeBucketSecondsForWindow(window: OverviewRealtimeWindow): number {
  if (window === '60m') return 120
  if (window === '30m') return 60
  return 30
}

function realtimeResponseParticleTotal(particles: OverviewRealtimeBlock['response_distribution']['ttft']['particles']): number {
  return particles.reduce((total, particle) => total + Math.max(1, Number(particle.count) || 0), 0)
}

function normalizeOverviewRealtimeBlock(
  block: Partial<OverviewRealtimeBlock> & {
    current_usage?: Partial<OverviewRealtimeBlock['current_usage']>;
    response_distribution?: Partial<OverviewRealtimeBlock['response_distribution']>;
  },
  fallbackWindow?: OverviewRealtimeWindow,
): OverviewRealtimeBlock {
  const currentUsage: Partial<OverviewRealtimeBlock['current_usage']> = block.current_usage ?? {}
  const responseDistribution: Partial<OverviewRealtimeBlock['response_distribution']> = block.response_distribution ?? {}
  const ttftParticles = responseDistribution.ttft?.particles ?? []
  const latencyParticles = responseDistribution.latency?.particles ?? []
  const resolvedWindow = block.window ?? fallbackWindow ?? '15m'
  return {
    window: resolvedWindow,
    timezone: block.timezone,
    bucket_seconds: block.bucket_seconds ?? realtimeBucketSecondsForWindow(resolvedWindow),
    window_start: block.window_start,
    window_end: block.window_end,
    token_velocity: block.token_velocity ?? [],
    response_level: block.response_level ?? [],
    response_distribution: {
      ttft: {
        average_line: responseDistribution.ttft?.average_line ?? [],
        particles: ttftParticles,
        total_particles: responseDistribution.ttft?.total_particles ?? realtimeResponseParticleTotal(ttftParticles),
        sampled: responseDistribution.ttft?.sampled ?? false,
        max_particles: responseDistribution.ttft?.max_particles ?? 1000,
      },
      latency: {
        average_line: responseDistribution.latency?.average_line ?? [],
        particles: latencyParticles,
        total_particles: responseDistribution.latency?.total_particles ?? realtimeResponseParticleTotal(latencyParticles),
        sampled: responseDistribution.latency?.sampled ?? false,
        max_particles: responseDistribution.latency?.max_particles ?? 1000,
      },
    },
    current_usage: {
      models: currentUsage.models ?? [],
      api_keys: currentUsage.api_keys ?? [],
      auth_files: currentUsage.auth_files ?? [],
      ai_providers: currentUsage.ai_providers ?? [],
    },
    request_level: block.request_level ?? [],
    cache_level: block.cache_level ?? [],
  }
}

export interface FetchKeyOverviewRealtimeOptions {
  window?: OverviewRealtimeWindow
  signal?: AbortSignal
}

export interface FetchUsageOverviewRealtimeOptions extends FetchKeyOverviewRealtimeOptions {
  apiKeyId?: string
}

export function appPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizeBasePath(window.__APP_BASE_PATH__)}${normalizedPath}`
}

export function apiPath(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizeBasePath(window.__APP_BASE_PATH__)}/api/v1${normalizedPath}`
}

async function parseApiError(response: Response, fallback: string): Promise<never> {
  let message = fallback
  try {
    const payload = await response.json() as { error?: string }
    if (payload.error) {
      message = payload.error
    }
  } catch {
    // ignore invalid error payloads
  }
  throw new ApiError(message, response.status)
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    credentials: 'include',
    ...init,
  })
}

export async function getSession(signal?: AbortSignal): Promise<AuthSessionResponse> {
  const response = await apiFetch(apiPath('/auth/session'), { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load auth session: ${response.status}`)
  }
  return response.json()
}

export async function login(password: string): Promise<void> {
  const response = await apiFetch(apiPath('/auth/login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to login: ${response.status}`)
  }
}

function normalizeUsageQuotaCheckResponse(response: UsageQuotaCheckResponse): UsageQuotaCheckResponse {
  return {
    ...response,
    rateLimitResetCreditsAvailableCount: response.rateLimitResetCreditsAvailableCount ?? response.rate_limit_reset_credits_available_count,
    quota: response.quota.map((row) => ({
      ...row,
      planType: row.planType ?? row.plan_type,
      usedPercent: row.usedPercent ?? row.used_percent,
      remainingFraction: row.remainingFraction ?? row.remaining_fraction,
      limitReached: row.limitReached ?? row.limit_reached,
      resetAt: row.resetAt ?? row.reset_at,
      resetAfterSeconds: row.resetAfterSeconds ?? row.reset_after_seconds,
    })),
  }
}

function normalizeUsageQuotaRefreshTaskRef(task: UsageQuotaRefreshTaskRef): UsageQuotaRefreshTaskRef {
  return {
    ...task,
    authIndex: task.authIndex ?? task.auth_index ?? '',
  }
}

function normalizeUsageQuotaRefreshRejectedAuthIndex(rejected: UsageQuotaRefreshRejectedAuthIndex): UsageQuotaRefreshRejectedAuthIndex {
  return {
    ...rejected,
    authIndex: rejected.authIndex ?? rejected.auth_index ?? '',
  }
}

function normalizeUsageQuotaRefreshResponse(response: UsageQuotaRefreshResponse): UsageQuotaRefreshResponse {
  const tasks = Array.isArray(response.tasks) ? response.tasks : []
  const rejected = Array.isArray(response.rejected) ? response.rejected : []
  return {
    ...response,
    tasks: tasks.map(normalizeUsageQuotaRefreshTaskRef),
    rejected: rejected.map(normalizeUsageQuotaRefreshRejectedAuthIndex),
  }
}

function normalizeUsageQuotaResetResponse(response: UsageQuotaResetResponse): UsageQuotaResetResponse {
  return {
    ...response,
    authIndex: response.authIndex ?? response.auth_index ?? '',
    windowsReset: response.windowsReset ?? response.windows_reset,
  }
}

function normalizeUsageQuotaRefreshTaskResponse(response: UsageQuotaRefreshTaskResponse): UsageQuotaRefreshTaskResponse {
  return {
    ...response,
    authIndex: response.authIndex ?? response.auth_index ?? '',
    expiresAt: response.expiresAt ?? response.expires_at,
    quota: response.quota ? normalizeUsageQuotaCheckResponse(response.quota) : undefined,
  }
}

function normalizeUsageQuotaCacheResponse(response: UsageQuotaCacheResponse): UsageQuotaCacheResponse {
  return {
    ...response,
    items: response.items.map((item) => ({
      ...item,
      quota: item.quota ? normalizeUsageQuotaCheckResponse(item.quota) : undefined,
    })),
  }
}

export async function setupFirstRun(password: string, cpaManagementKey: string): Promise<void> {
  const response = await apiFetch(apiPath('/auth/setup'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password, cpaManagementKey }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to complete first-run setup: ${response.status}`)
  }
}

export async function loginWithCPAAPIKey(apiKey: string): Promise<void> {
  const response = await apiFetch(apiPath('/auth/api-key-login'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ apiKey }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to login with CPA API key: ${response.status}`)
  }
}

export async function logout(): Promise<void> {
  const response = await apiFetch(apiPath('/auth/logout'), {
    method: 'POST',
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to logout: ${response.status}`)
  }
}

export async function fetchAuthSessions(signal?: AbortSignal): Promise<AuthManagedSessionsResponse> {
  const response = await apiFetch(apiPath('/auth/sessions'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load auth sessions: ${response.status}`)
  }
  return response.json()
}

export async function revokeAuthSession(id: string): Promise<void> {
  const response = await apiFetch(apiPath(`/auth/sessions/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to revoke auth session: ${response.status}`)
  }
}

export async function fetchKeyOverview(range: KeyOverviewTimeRange, signal?: AbortSignal): Promise<UsageOverviewResponse> {
  const params = new URLSearchParams()
  params.set('range', range)
  const response = await apiFetch(`${apiPath('/key-overview')}?${params.toString()}`, { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load key overview: ${response.status}`)
  }
  return response.json()
}

export async function fetchKeyOverviewRealtime(options: FetchKeyOverviewRealtimeOptions = {}): Promise<OverviewRealtimeBlock> {
  const { window, signal } = options
  const params = new URLSearchParams()
  if (window) {
    params.set('window', window)
  }
  const query = params.toString()
  const response = await apiFetch(`${apiPath('/key-overview/realtime')}${query ? `?${query}` : ''}`, { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load key overview realtime: ${response.status}`)
  }
  const payload = await response.json() as Partial<OverviewRealtimeBlock> & {
    current_usage?: Partial<OverviewRealtimeBlock['current_usage']>;
  }
  return normalizeOverviewRealtimeBlock(payload, window)
}

export async function fetchUsageOverview(range: string, start?: string, end?: string, signal?: AbortSignal, apiKeyId?: string): Promise<UsageOverviewResponse> {
  const params = new URLSearchParams()
  params.set('range', range)
  if (start) {
    params.set('start', start)
  }
  if (end) {
    params.set('end', end)
  }
  const selectedAPIKeyId = apiKeyId?.trim()
  if (selectedAPIKeyId) {
    params.set('api_key_id', selectedAPIKeyId)
  }
  const query = params.toString()
  const response = await apiFetch(`${apiPath('/usage/overview')}${query ? `?${query}` : ''}`, { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load usage overview: ${response.status}`)
  }
  return response.json()
}

export async function fetchUsageOverviewRealtime(options: FetchUsageOverviewRealtimeOptions = {}): Promise<OverviewRealtimeBlock> {
  const { signal, apiKeyId, window } = options
  const params = new URLSearchParams()
  const selectedAPIKeyId = apiKeyId?.trim()
  if (selectedAPIKeyId) {
    params.set('api_key_id', selectedAPIKeyId)
  }
  if (window) {
    params.set('window', window)
  }
  const query = params.toString()
  const response = await apiFetch(`${apiPath('/usage/overview/realtime')}${query ? `?${query}` : ''}`, { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load usage overview realtime: ${response.status}`)
  }
  const payload = await response.json() as Partial<OverviewRealtimeBlock> & {
    current_usage?: Partial<OverviewRealtimeBlock['current_usage']>;
  }
  return normalizeOverviewRealtimeBlock(payload, window)
}

export interface FetchUsageEventsOptions {
  page?: number
  pageSize?: number
  model?: string
  // Request Events 页面沿用 Source 命名；这里传的是 usage identity，后端会转换为 auth_index 查询。
  source?: string
  result?: string
  apiKeyId?: string
}

export type UsageEventsExportFormat = 'csv' | 'json'

export interface UsageEventsExportFile {
  blob: Blob
  filename: string
}

function buildUsageEventsParams(range: string, start?: string, end?: string, options?: FetchUsageEventsOptions, includePagination = true): URLSearchParams {
  const params = new URLSearchParams()
  params.set('range', range)
  if (start) {
    params.set('start', start)
  }
  if (end) {
    params.set('end', end)
  }
  if (includePagination && typeof options?.page === 'number' && Number.isFinite(options.page) && options.page > 0) {
    params.set('page', String(Math.floor(options.page)))
  }
  if (includePagination && typeof options?.pageSize === 'number' && Number.isFinite(options.pageSize) && options.pageSize > 0) {
    params.set('page_size', String(Math.floor(options.pageSize)))
  }
  const model = options?.model?.trim()
  if (model) {
    params.set('model', model)
  }
  const source = options?.source?.trim()
  if (source) {
    // Source 下拉的 value 不是 usage_events.source 原始字段，而是后端用于 auth_index 查询的 identity。
    params.set('source', source)
  }
  const result = options?.result?.trim()
  if (result) {
    params.set('result', result)
  }
  const selectedAPIKeyId = options?.apiKeyId?.trim()
  if (selectedAPIKeyId) {
    params.set('api_key_id', selectedAPIKeyId)
  }
  return params
}

function parseAttachmentFilename(contentDisposition: string | null, fallback: string): string {
  const match = contentDisposition?.match(/filename="([^"]+)"/i)
  return match?.[1]?.trim() || fallback
}

export async function fetchUsageEventModelFilterOptions(signal?: AbortSignal): Promise<UsageEventModelFilterOptionsResponse> {
  const response = await apiFetch(apiPath('/usage/events/filters/models'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load usage event model filters: ${response.status}`)
  }
  return response.json()
}

export async function fetchUsageEventSourceFilterOptions(signal?: AbortSignal): Promise<UsageEventSourceFilterOptionsResponse> {
  const response = await apiFetch(apiPath('/usage/events/filters/sources'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load usage event source filters: ${response.status}`)
  }
  return response.json()
}

export async function fetchUsageEvents(range: string, start?: string, end?: string, signal?: AbortSignal, options?: FetchUsageEventsOptions): Promise<UsageEventsResponse> {
  const params = buildUsageEventsParams(range, start, end, options)
  const query = params.toString()
  const response = await apiFetch(`${apiPath('/usage/events')}${query ? `?${query}` : ''}`, { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load usage events: ${response.status}`)
  }
  return response.json()
}

export function buildUsageEventsStreamURL(range: string, start?: string, end?: string, options?: FetchUsageEventsOptions): string {
  const params = buildUsageEventsParams(range, start, end, options, false)
  const query = params.toString()
  return `${apiPath('/usage/events/stream')}${query ? `?${query}` : ''}`
}

export async function exportUsageEvents(range: string, start: string | undefined, end: string | undefined, format: UsageEventsExportFormat, options?: FetchUsageEventsOptions): Promise<UsageEventsExportFile> {
  const params = buildUsageEventsParams(range, start, end, options, false)
  params.set('format', format)
  const query = params.toString()
  const response = await apiFetch(`${apiPath('/usage/events/export')}${query ? `?${query}` : ''}`)
  if (!response.ok) {
    await parseApiError(response, `Failed to export usage events: ${response.status}`)
  }
  return {
    blob: await response.blob(),
    filename: parseAttachmentFilename(response.headers.get('Content-Disposition'), `usage-events.${format}`),
  }
}

export type UsageIdentityPageSort = 'priority' | 'total_requests' | 'total_tokens' | 'last_used_at'

export interface FetchUsageIdentitiesPageOptions {
  authType?: UsageIdentityAuthType
  activeOnly?: boolean
  types?: string[]
  proxyURLs?: string[]
  sort?: UsageIdentityPageSort
  page?: number
  pageSize?: number
  query?: string
}

export async function fetchUsageIdentities(signal?: AbortSignal): Promise<UsageIdentitiesResponse> {
  const response = await apiFetch(apiPath('/usage/identities'), { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load usage identities: ${response.status}`)
  }
  return response.json()
}

export async function fetchUsageIdentitiesPage(signal?: AbortSignal, options?: FetchUsageIdentitiesPageOptions): Promise<UsageIdentitiesPageResponse> {
  // Credentials 两个分区共用分页接口，通过 auth_type 控制服务端过滤。
  const params = new URLSearchParams()
  if (options?.authType) {
    params.set('auth_type', String(options.authType))
  }
  if (typeof options?.activeOnly === 'boolean') {
    params.set('active_only', String(options.activeOnly))
  }
  if (options?.sort) {
    params.set('sort', options.sort)
  }
  if (options?.query) {
    params.set('query', options.query)
  }
  for (const type of options?.types ?? []) {
    if (type !== '') {
      params.append('type', type)
    }
  }
  for (const proxyURL of options?.proxyURLs ?? []) {
    if (proxyURL !== '') {
      params.append('proxy_url', proxyURL)
    }
  }
  if (typeof options?.page === 'number' && Number.isFinite(options.page) && options.page > 0) {
    params.set('page', String(Math.floor(options.page)))
  }
  if (typeof options?.pageSize === 'number' && Number.isFinite(options.pageSize) && options.pageSize > 0) {
    params.set('page_size', String(Math.floor(options.pageSize)))
  }
  const query = params.toString()
  const response = await apiFetch(`${apiPath('/usage/identities/page')}${query ? `?${query}` : ''}`, { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load usage identities page: ${response.status}`)
  }
  return response.json()
}

export async function updateUsageIdentityAlias(id: string, alias: string | null): Promise<UsageIdentity> {
  const response = await apiFetch(apiPath(`/usage/identities/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ alias }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to update usage identity alias: ${response.status}`)
  }
  return response.json()
}

export async function fetchUsageQuotaCache(authIndexes: string[], signal?: AbortSignal): Promise<UsageQuotaCacheResponse> {
  // cache 只读后端已有结果，不携带刷新 limit，避免把缓存读取误当队列提交。
  const response = await apiFetch(apiPath('/quota/cache'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ auth_indexes: authIndexes }),
    signal,
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to load cached usage quotas: ${response.status}`)
  }
  return normalizeUsageQuotaCacheResponse(await response.json())
}

export async function refreshUsageQuotas(authIndexes: string[], signal?: AbortSignal): Promise<UsageQuotaRefreshResponse> {
  // refresh 会创建后台任务，前端提交当前页所有 auth_index。
  const response = await apiFetch(apiPath('/quota/refresh'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ auth_indexes: authIndexes }),
    signal,
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to refresh usage quotas: ${response.status}`)
  }
  return normalizeUsageQuotaRefreshResponse(await response.json())
}

export async function fetchUsageQuotaInspectionStatus(signal?: AbortSignal): Promise<UsageQuotaInspectionStatusResponse> {
  const response = await apiFetch(apiPath('/quota/inspection'), { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load quota inspection status: ${response.status}`)
  }
  return response.json()
}

export async function startUsageQuotaInspection(signal?: AbortSignal): Promise<UsageQuotaInspectionStatusResponse> {
  const response = await apiFetch(apiPath('/quota/inspection'), {
    method: 'POST',
    signal,
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to start quota inspection: ${response.status}`)
  }
  return response.json()
}


export async function resetUsageQuota(authIndex: string, signal?: AbortSignal): Promise<UsageQuotaResetResponse> {
  const response = await apiFetch(apiPath('/quota/reset'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ auth_index: authIndex }),
    signal,
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to reset usage quota: ${response.status}`)
  }
  return normalizeUsageQuotaResetResponse(await response.json())
}

export async function fetchUsageQuotaRefreshTask(authIndex: string, signal?: AbortSignal): Promise<UsageQuotaRefreshTaskResponse> {
  const response = await apiFetch(apiPath(`/quota/refresh/${encodeURIComponent(authIndex)}`), { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load usage quota refresh task: ${response.status}`)
  }
  return normalizeUsageQuotaRefreshTaskResponse(await response.json())
}

export async function setAuthFilesDisabled(names: string[], disabled: boolean): Promise<AuthFilesManagementResponse> {
  const response = await apiFetch(apiPath('/auth-files/status'), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ names, disabled }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to update auth file status: ${response.status}`)
  }
  return response.json()
}

export async function fetchAuthFileCooldowns(signal?: AbortSignal): Promise<AuthFileCooldown[]> {
  const response = await apiFetch(apiPath('/auth-files/cooldowns'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load auth file cooldowns: ${response.status}`)
  }
  const payload = await response.json() as AuthFileCooldownsResponse
  return payload.cooldowns ?? []
}

export async function startAuthFileCooldown(authIndex: string, fileName: string): Promise<AuthFileCooldown> {
  const response = await apiFetch(apiPath('/auth-files/cooldowns'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ auth_index: authIndex, file_name: fileName }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to start auth file cooldown: ${response.status}`)
  }
  return response.json()
}

export async function restoreAuthFileCooldown(authIndex: string): Promise<AuthFileCooldown> {
  const response = await apiFetch(apiPath('/auth-files/cooldowns/restore'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ auth_index: authIndex }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to restore auth file cooldown: ${response.status}`)
  }
  return response.json()
}

export async function setAuthFilesProxyURL(names: string[], proxyURL: string | null): Promise<AuthFilesManagementResponse> {
  const response = await apiFetch(apiPath('/auth-files/proxy'), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ names, proxy_url: proxyURL }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to update auth file proxy: ${response.status}`)
  }
  return response.json()
}

export async function setAuthFilesNote(names: string[], note: string | null): Promise<AuthFilesManagementResponse> {
  const response = await apiFetch(apiPath('/auth-files/note'), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ names, note }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to update auth file note: ${response.status}`)
  }
  return response.json()
}

export async function importAuthFilesFromToken(content: string): Promise<AuthFilesManagementResponse> {
  const response = await apiFetch(apiPath('/auth-files/import'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to import auth files: ${response.status}`)
  }
  return response.json()
}

export async function deleteAuthFiles(names: string[]): Promise<AuthFilesManagementResponse> {
  const response = await apiFetch(apiPath('/auth-files'), {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ names }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to delete auth files: ${response.status}`)
  }
  return response.json()
}

export async function fetchProxyPools(signal?: AbortSignal): Promise<ProxyPool[]> {
  const response = await apiFetch(apiPath('/proxy-pools'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load proxy pools: ${response.status}`)
  }
  const payload = await response.json() as ProxyPoolsResponse
  return payload.proxy_pools ?? []
}

export async function createProxyPool(input: Pick<ProxyPool, 'name' | 'proxy_url'>): Promise<ProxyPool> {
  const response = await apiFetch(apiPath('/proxy-pools'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to create proxy pool: ${response.status}`)
  }
  return response.json()
}

export async function updateProxyPool(id: string, input: Pick<ProxyPool, 'name' | 'proxy_url'>): Promise<ProxyPool> {
  const response = await apiFetch(apiPath(`/proxy-pools/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to update proxy pool: ${response.status}`)
  }
  return response.json()
}

export async function deleteProxyPool(id: string): Promise<void> {
  const response = await apiFetch(apiPath(`/proxy-pools/${encodeURIComponent(id)}`), { method: 'DELETE' })
  if (!response.ok) {
    await parseApiError(response, `Failed to delete proxy pool: ${response.status}`)
  }
}

export async function testProxyPool(id: string): Promise<ProxyPoolTestResponse> {
  const response = await apiFetch(apiPath(`/proxy-pools/${encodeURIComponent(id)}/test`), { method: 'POST' })
  if (!response.ok) {
    await parseApiError(response, `Failed to test proxy pool: ${response.status}`)
  }
  return response.json()
}

export async function fetchAnalysis(range: string, start?: string, end?: string, signal?: AbortSignal, apiKeyId?: string): Promise<AnalysisResponse> {
  const params = new URLSearchParams()
  params.set('range', range)
  if (start) {
    params.set('start', start)
  }
  if (end) {
    params.set('end', end)
  }
  const selectedAPIKeyId = apiKeyId?.trim()
  if (selectedAPIKeyId) {
    params.set('api_key_id', selectedAPIKeyId)
  }
  const query = params.toString()
  const response = await apiFetch(`${apiPath('/usage/analysis')}${query ? `?${query}` : ''}`, { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load analysis: ${response.status}`)
  }
  return response.json()
}


export async function fetchCpaApiKeyOptions(signal?: AbortSignal): Promise<CpaApiKeyOptionsResponse> {
  const response = await apiFetch(apiPath('/usage/api-keys/options'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load CPA API key options: ${response.status}`)
  }
  return response.json()
}

export async function fetchCpaApiKeys(signal?: AbortSignal): Promise<CpaApiKeysResponse> {
  const response = await apiFetch(apiPath('/usage/api-keys'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load CPA API keys: ${response.status}`)
  }
  return response.json()
}

export async function fetchCpaApiKeySettings(signal?: AbortSignal): Promise<CpaApiKeySettingsResponse> {
  const response = await apiFetch(apiPath('/usage/api-keys/settings'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load CPA API key settings: ${response.status}`)
  }
  return response.json()
}

export async function createCpaApiKey(payload: CpaApiKeySaveRequest): Promise<CpaApiKeySettingsItem> {
  const response = await apiFetch(apiPath('/usage/api-keys'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to create CPA API key: ${response.status}`)
  }
  return response.json()
}

export async function updateCpaApiKey(id: string, payload: CpaApiKeySaveRequest): Promise<CpaApiKeySettingsItem> {
  const response = await apiFetch(apiPath(`/usage/api-keys/${encodeURIComponent(id)}`), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to update CPA API key: ${response.status}`)
  }
  return response.json()
}

export async function deleteCpaApiKey(id: string): Promise<void> {
  const response = await apiFetch(apiPath(`/usage/api-keys/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to delete CPA API key: ${response.status}`)
  }
}

export async function updateCpaApiKeyAlias(id: string, keyAlias: string): Promise<CpaApiKeyDisplayItem> {
  const response = await apiFetch(apiPath(`/usage/api-keys/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ keyAlias }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to update CPA API key alias: ${response.status}`)
  }
  return response.json()
}

export async function fetchUsedModels(signal?: AbortSignal): Promise<UsedModelsResponse> {
  const response = await apiFetch(apiPath('/models/used'), { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load used models: ${response.status}`)
  }
  return response.json()
}

export async function fetchStatus(signal?: AbortSignal): Promise<StatusResponse> {
  const response = await apiFetch(apiPath('/status'), { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load status: ${response.status}`)
  }
  return response.json()
}

export async function fetchConfigStatus(signal?: AbortSignal): Promise<ConfigStatusResponse> {
  const response = await apiFetch(apiPath('/config/status'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load config status: ${response.status}`)
  }
  return response.json()
}

export async function fetchConfigDiagnostics(signal?: AbortSignal): Promise<ConfigDiagnosticsResponse> {
  const response = await apiFetch(apiPath('/config/diagnostics'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load config diagnostics: ${response.status}`)
  }
  return response.json()
}

export async function fetchVersion(signal?: AbortSignal): Promise<VersionResponse> {
  const response = await apiFetch(apiPath('/version'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load version: ${response.status}`)
  }
  return response.json()
}

export async function markStatusActive(signal?: AbortSignal): Promise<void> {
  const response = await apiFetch(apiPath('/status/active'), { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to mark backend page activity: ${response.status}`)
  }
}

export async function fetchUpdateCheck(signal?: AbortSignal): Promise<UpdateCheckResponse> {
  const response = await apiFetch(apiPath('/update/check'), { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to check for updates: ${response.status}`)
  }
  return response.json()
}

export async function fetchCpaRuntime(signal?: AbortSignal): Promise<CpaRuntimeStatusResponse> {
  const response = await apiFetch(apiPath('/cpa/runtime'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load CPA runtime: ${response.status}`)
  }
  return response.json()
}

async function postCpaRuntimeAction(action: 'start' | 'stop' | 'restart' | 'update'): Promise<CpaRuntimeStatusResponse> {
  const response = await apiFetch(apiPath(`/cpa/${action}`), { method: 'POST' })
  if (!response.ok) {
    await parseApiError(response, `Failed to ${action} CPA: ${response.status}`)
  }
  return response.json()
}

export const startCpaRuntime = () => postCpaRuntimeAction('start')
export const stopCpaRuntime = () => postCpaRuntimeAction('stop')
export const restartCpaRuntime = () => postCpaRuntimeAction('restart')
export const updateCpaRuntime = () => postCpaRuntimeAction('update')

export async function fetchCpaUpdateEvents(signal?: AbortSignal): Promise<CpaUpdateEvent[]> {
  const response = await apiFetch(apiPath('/cpa/update-events'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to load CPA update events: ${response.status}`)
  }
  return response.json()
}

export async function fetchPricing(signal?: AbortSignal): Promise<PricingResponse> {
  const response = await apiFetch(apiPath('/pricing'), { signal })
  if (!response.ok) {
    await parseApiError(response, `Failed to load pricing: ${response.status}`)
  }
  return response.json()
}

export async function fetchPricingSyncPreview(signal?: AbortSignal): Promise<PricingSyncPreviewResponse> {
  const response = await apiFetch(apiPath('/pricing/sync/preview'), { signal, cache: 'no-store' })
  if (!response.ok) {
    await parseApiError(response, `Failed to preview pricing sync: ${response.status}`)
  }
  return response.json()
}

export async function updatePricing(model: string, pricing: Omit<PricingEntry, 'model'>): Promise<PricingEntry> {
  const response = await apiFetch(apiPath('/pricing'), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, ...pricing }),
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to update pricing: ${response.status}`)
  }
  return response.json()
}

export async function deletePricing(model: string): Promise<void> {
  const params = new URLSearchParams({ model })
  const response = await apiFetch(`${apiPath('/pricing')}?${params.toString()}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    await parseApiError(response, `Failed to delete pricing: ${response.status}`)
  }
}
