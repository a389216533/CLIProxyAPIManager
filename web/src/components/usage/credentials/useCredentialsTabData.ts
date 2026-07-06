import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildAiProviderCredentialRows,
  buildAuthFileCredentialRows,
  selectQuotaEligibleAuthIndexes,
  type AiProviderCredentialRow,
  type AuthFileCredentialRow,
} from './credentialViewModels'
import { useCredentialPages } from './useCredentialPages'
import { useQuotaCache } from './useQuotaCache'
import { useQuotaInspection } from './useQuotaInspection'
import { ApiError, createProxyPool, deleteProxyPool, fetchAuthFileCooldowns, fetchProxyPools, resetUsageQuota, restoreAuthFileCooldown, setAuthFilesNote, setAuthFilesProxyURL, startAuthFileCooldown, testProxyPool, updateProxyPool, updateUsageIdentityAlias, type UsageIdentityPageSort } from '@/lib/api'
import { formatUserActionableError } from '@/lib/errorMessages'
import i18n from '@/i18n'
import type { AuthFileCooldown, ProxyPool, ProxyPoolTestResponse, UsageIdentityTypeCount, UsageQuotaCheckResponse, UsageQuotaInspectionStatusResponse } from '@/lib/types'
import { scheduleEffectTask } from '@/utils/effects'
import { quotaRefreshDisplayError, useQuotaRefreshTasks, type QuotaState } from './useQuotaRefreshTasks'
import type { CredentialProviderFilterKey } from './credentialProviderFilters'
import { buildFailedProxyPoolTestResult, buildProxyPoolTestHistory, persistProxyPoolTestHistory, readProxyPoolTestHistory, readStoredProxyPoolTestHistory, type ProxyPoolTestHistoryMap } from './AuthFileCredentialsSection'

type CredentialQuotaState = Pick<AuthFileCredentialRow, 'quotaLoading' | 'quotaError' | 'refreshStatus' | 'quotaResetting'>

interface CredentialResetState {
  quotaResetting?: boolean
}

interface UseCredentialsTabDataOptions {
  enabledAuthFiles: boolean
  enabledAiProviders: boolean
  quotaAutoRefreshEnabled: boolean
  onAuthRequired?: () => void
  onNotice?: (kind: 'success' | 'info' | 'error', message: string) => void
}

const PROXY_POOL_AUTO_TEST_STORAGE_KEY = 'cpa.proxyPools.autoTest.enabled.v1'
export const PROXY_POOL_AUTO_TEST_INTERVAL_MS = 5 * 60 * 1000

function readStoredProxyPoolAutoTestEnabled(): boolean {
  if (typeof window === 'undefined') {
    return false
  }
  try {
    return window.localStorage?.getItem(PROXY_POOL_AUTO_TEST_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function persistProxyPoolAutoTestEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage?.setItem(PROXY_POOL_AUTO_TEST_STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    // localStorage 不可用时仍保留本次页面内开关状态。
  }
}

export interface CredentialsTabData {
  authFileRows: AuthFileCredentialRow[]
  aiProviderRows: AiProviderCredentialRow[]
  authFileTypeCounts: UsageIdentityTypeCount[]
  aiProviderTypeCounts: UsageIdentityTypeCount[]
  authFileTotal: number
  aiProviderTotal: number
  authFilePageSize: number
  aiProviderPageSize: number
  authFilePage: number
  aiProviderPage: number
  authFileTotalPages: number
  aiProviderTotalPages: number
  authFileActiveOnly: boolean
  authFileProviderFilter: CredentialProviderFilterKey
  authFileProxyPoolFilterId: string
  authFileQuery: string
  proxyPools: ProxyPool[]
  proxyPoolsLoading: boolean
  proxyPoolsError: string
  proxyPoolTestHistory: ProxyPoolTestHistoryMap
  proxyPoolTestResults: Record<string, ProxyPoolTestResponse>
  proxyPoolTestErrors: Record<string, string>
  proxyPoolTestingIds: string[]
  proxyPoolAutoTestEnabled: boolean
  aiProviderProviderFilter: CredentialProviderFilterKey
  authFileSort: UsageIdentityPageSort
  aiProviderSort: UsageIdentityPageSort
  setAuthFilePage: (page: number) => void
  setAiProviderPage: (page: number) => void
  setAuthFilePageSize: (pageSize: number) => void
  setAiProviderPageSize: (pageSize: number) => void
  setAuthFileActiveOnly: (activeOnly: boolean) => void
  setAuthFileProviderFilter: (filter: CredentialProviderFilterKey) => void
  setAuthFileProxyPoolFilterId: (id: string) => void
  setAuthFileQuery: (query: string) => void
  setAiProviderProviderFilter: (filter: CredentialProviderFilterKey) => void
  setAuthFileSort: (sort: UsageIdentityPageSort) => void
  setAiProviderSort: (sort: UsageIdentityPageSort) => void
  loading: boolean
  error: string
  quotaRefreshing: boolean
  quotaRefreshError: string
  quotaInspectionStatus: UsageQuotaInspectionStatusResponse | null
  quotaInspectionLoading: boolean
  quotaInspectionStarting: boolean
  quotaInspectionError: string
  authFileCooldownsLoading: boolean
  authFileCooldownsError: string
  aliasSavingId: string
  refresh: () => Promise<void>
  refreshProxyPools: () => Promise<void>
  setProxyPoolAutoTestEnabled: (enabled: boolean) => void
  testProxyPoolById: (id: string) => Promise<void>
  testProxyPoolsByIds: (ids: string[]) => Promise<void>
  saveProxyPool: (input: Pick<ProxyPool, 'name' | 'proxy_url'>, id?: string) => Promise<void>
  removeProxyPool: (id: string) => Promise<void>
  applyProxyPoolToAuthFiles: (names: string[], proxyPoolId: string | null) => Promise<void>
  saveAuthFileNote: (names: string[], note: string) => Promise<void>
  saveUsageIdentityAlias: (id: string, alias: string) => Promise<void>
  refreshQuotaForCurrentAuthFilePage: () => Promise<void>
  refreshQuotaForAuthIndex: (authIndex: string) => Promise<void>
  resetQuotaForAuthIndex: (authIndex: string) => Promise<void>
  startCooldownForAuthFile: (authIndex: string, fileName: string) => Promise<void>
  restoreCooldownForAuthFile: (authIndex: string) => Promise<void>
  refreshQuotaInspectionStatus: () => Promise<void>
  startQuotaInspection: () => Promise<void>
}

export function useCredentialsTabData({ enabledAuthFiles, enabledAiProviders, quotaAutoRefreshEnabled, onAuthRequired, onNotice }: UseCredentialsTabDataOptions): CredentialsTabData {
  const [proxyPools, setProxyPools] = useState<ProxyPool[]>([])
  const [proxyPoolsLoading, setProxyPoolsLoading] = useState(false)
  const [proxyPoolsError, setProxyPoolsError] = useState('')
  const [proxyPoolTestHistory, setProxyPoolTestHistory] = useState<ProxyPoolTestHistoryMap>(() => readStoredProxyPoolTestHistory())
  const [proxyPoolTestErrors, setProxyPoolTestErrors] = useState<Record<string, string>>({})
  const [proxyPoolTestingIds, setProxyPoolTestingIds] = useState<string[]>([])
  const [proxyPoolAutoTestEnabled, setProxyPoolAutoTestEnabledState] = useState(() => readStoredProxyPoolAutoTestEnabled())
  const [authFileCooldownsByAuthIndex, setAuthFileCooldownsByAuthIndex] = useState<Record<string, AuthFileCooldown>>({})
  const [authFileCooldownsLoading, setAuthFileCooldownsLoading] = useState(false)
  const [authFileCooldownsError, setAuthFileCooldownsError] = useState('')
  const [authFileProxyPoolFilterId, setAuthFileProxyPoolFilterIdState] = useState('')
  const selectedProxyPool = useMemo(() => proxyPools.find((pool) => pool.id === authFileProxyPoolFilterId), [authFileProxyPoolFilterId, proxyPools])
  const authFileProxyURLs = useMemo(() => (selectedProxyPool ? [selectedProxyPool.proxy_url] : []), [selectedProxyPool])
  const proxyPoolsDataEnabled = enabledAuthFiles || proxyPoolAutoTestEnabled
  const proxyPoolTestResults = useMemo(() => readProxyPoolTestHistory(proxyPoolTestHistory), [proxyPoolTestHistory])
  const credentialPages = useCredentialPages({ enabledAuthFiles, enabledAiProviders, authFileProxyURLs, onAuthRequired })
  const currentAuthIndexes = useMemo(
    () => selectQuotaEligibleAuthIndexes(credentialPages.authFileIdentities),
    [credentialPages.authFileIdentities],
  )
  const { quotaResponseByAuthIndex, cachedQuotaStateByAuthIndex, setQuotaResponseByAuthIndex, refreshQuotaCache } = useQuotaCache({
    enabled: enabledAuthFiles,
    authIndexes: currentAuthIndexes,
    onAuthRequired,
  })
  const quotaRefreshTasks = useQuotaRefreshTasks({
    enabled: enabledAuthFiles,
    currentAuthIndexes,
    setQuotaResponseByAuthIndex,
    onAuthRequired,
  })
  const { refreshQuotaForAuthIndex } = quotaRefreshTasks
  const [quotaResetStateByAuthIndex, setQuotaResetStateByAuthIndex] = useState<Record<string, CredentialResetState>>({})
  const [aliasSavingId, setAliasSavingId] = useState('')
  const quotaInspection = useQuotaInspection({
    enabled: enabledAuthFiles,
    onAuthRequired,
    onInspectionCompleted: refreshQuotaCache,
  })

  const refreshProxyPools = useCallback(async () => {
    if (!proxyPoolsDataEnabled) {
      return
    }
    setProxyPoolsLoading(true)
    setProxyPoolsError('')
    try {
      const pools = await fetchProxyPools()
      setProxyPools(pools)
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (onAuthRequired) {
          onAuthRequired()
        }
        return
      }
      setProxyPoolsError(formatUserActionableError(error, '无法加载代理池'))
    } finally {
      setProxyPoolsLoading(false)
    }
  }, [onAuthRequired, proxyPoolsDataEnabled])

  useEffect(() => {
    return scheduleEffectTask(() => {
      void refreshProxyPools()
    })
  }, [refreshProxyPools])

  const appendProxyPoolTestHistory = useCallback((poolId: string, result: ProxyPoolTestResponse) => {
    setProxyPoolTestHistory((current) => {
      const next = buildProxyPoolTestHistory(current, poolId, result)
      persistProxyPoolTestHistory(next)
      return next
    })
  }, [])

  const testProxyPoolsByIds = useCallback(async (ids: string[]) => {
    const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
    if (uniqueIds.length === 0) {
      return
    }
    setProxyPoolTestingIds((current) => Array.from(new Set([...current, ...uniqueIds])))
    setProxyPoolTestErrors((current) => uniqueIds.reduce((next, id) => ({ ...next, [id]: '' }), current))
    await Promise.all(uniqueIds.map(async (id) => {
      try {
        const result = await testProxyPool(id)
        appendProxyPoolTestHistory(id, result)
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          if (onAuthRequired) {
            onAuthRequired()
          }
        }
        const message = formatUserActionableError(error, '测试代理池失败')
        setProxyPoolTestErrors((current) => ({ ...current, [id]: message }))
        appendProxyPoolTestHistory(id, buildFailedProxyPoolTestResult(message))
      } finally {
        setProxyPoolTestingIds((current) => current.filter((item) => item !== id))
      }
    }))
  }, [appendProxyPoolTestHistory, onAuthRequired])

  const testProxyPoolById = useCallback(async (id: string) => {
    await testProxyPoolsByIds([id])
  }, [testProxyPoolsByIds])

  const setProxyPoolAutoTestEnabled = useCallback((enabled: boolean) => {
    setProxyPoolAutoTestEnabledState(enabled)
    persistProxyPoolAutoTestEnabled(enabled)
  }, [])

  useEffect(() => {
    if (!proxyPoolAutoTestEnabled || proxyPools.length === 0) {
      return undefined
    }
    const intervalID = window.setInterval(() => {
      void testProxyPoolsByIds(proxyPools.map((pool) => pool.id))
    }, PROXY_POOL_AUTO_TEST_INTERVAL_MS)
    return () => window.clearInterval(intervalID)
  }, [proxyPoolAutoTestEnabled, proxyPools, testProxyPoolsByIds])

  const refreshAuthFileCooldowns = useCallback(async () => {
    if (!enabledAuthFiles) {
      setAuthFileCooldownsByAuthIndex({})
      return
    }
    setAuthFileCooldownsLoading(true)
    setAuthFileCooldownsError('')
    try {
      const cooldowns = await fetchAuthFileCooldowns()
      setAuthFileCooldownsByAuthIndex(Object.fromEntries(cooldowns.map((cooldown) => [cooldown.auth_index, cooldown])))
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (onAuthRequired) {
          onAuthRequired()
        }
        return
      }
      setAuthFileCooldownsError(formatUserActionableError(error, '无法加载认证文件冷却状态'))
    } finally {
      setAuthFileCooldownsLoading(false)
    }
  }, [enabledAuthFiles, onAuthRequired])

  useEffect(() => {
    return scheduleEffectTask(() => {
      void refreshAuthFileCooldowns()
    })
  }, [refreshAuthFileCooldowns])

  const quotaResponsesByAuthIndex = useMemo(() => new Map(Object.entries(quotaResponseByAuthIndex)), [quotaResponseByAuthIndex])
  const quotaStates = useMemo(
    () => buildCredentialQuotaStateMap(cachedQuotaStateByAuthIndex, quotaRefreshTasks.quotaStateByAuthIndex, quotaResponseByAuthIndex, quotaResetStateByAuthIndex),
    [cachedQuotaStateByAuthIndex, quotaRefreshTasks.quotaStateByAuthIndex, quotaResponseByAuthIndex, quotaResetStateByAuthIndex],
  )

  const authFileRows = useMemo(
    () => buildAuthFileCredentialRows(credentialPages.authFileIdentities, quotaResponsesByAuthIndex, quotaStates, new Map(Object.entries(authFileCooldownsByAuthIndex))),
    [authFileCooldownsByAuthIndex, credentialPages.authFileIdentities, quotaResponsesByAuthIndex, quotaStates],
  )
  const aiProviderRows = useMemo(
    () => buildAiProviderCredentialRows(credentialPages.aiProviderIdentities),
    [credentialPages.aiProviderIdentities],
  )
  const refreshCredentialPages = credentialPages.refresh
  const refresh = useCallback(async () => {
    await Promise.all([refreshCredentialPages(), refreshQuotaCache(), refreshProxyPools(), refreshAuthFileCooldowns()])
  }, [refreshAuthFileCooldowns, refreshCredentialPages, refreshProxyPools, refreshQuotaCache])

  const setAuthFileProxyPoolFilterId = useCallback((id: string) => {
    setAuthFileProxyPoolFilterIdState(id)
    credentialPages.setAuthFilePage(1)
  }, [credentialPages])

  const saveProxyPool = useCallback(async (input: Pick<ProxyPool, 'name' | 'proxy_url'>, id?: string) => {
    try {
      if (id) {
        await updateProxyPool(id, input)
      } else {
        await createProxyPool(input)
      }
      await refreshProxyPools()
      onNotice?.('success', id ? '代理池已更新' : '代理池已创建')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (onAuthRequired) {
          onAuthRequired()
        }
      }
      onNotice?.('error', formatUserActionableError(error, '保存代理池失败'))
      throw error
    }
  }, [onAuthRequired, onNotice, refreshProxyPools])

  const removeProxyPool = useCallback(async (id: string) => {
    try {
      await deleteProxyPool(id)
      if (authFileProxyPoolFilterId === id) {
        setAuthFileProxyPoolFilterIdState('')
      }
      await refreshProxyPools()
      onNotice?.('success', '代理池已删除')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (onAuthRequired) {
          onAuthRequired()
        }
      }
      onNotice?.('error', formatUserActionableError(error, '删除代理池失败'))
      throw error
    }
  }, [authFileProxyPoolFilterId, onAuthRequired, onNotice, refreshProxyPools])

  const applyProxyPoolToAuthFiles = useCallback(async (names: string[], proxyPoolId: string | null) => {
    const proxyURL = proxyPoolId ? proxyPools.find((pool) => pool.id === proxyPoolId)?.proxy_url ?? null : null
    if (proxyPoolId && !proxyURL) {
      throw new Error('代理池不存在')
    }
    try {
      await setAuthFilesProxyURL(names, proxyURL)
      await Promise.all([refreshCredentialPages(), refreshProxyPools()])
      onNotice?.('success', '认证文件代理已更新')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (onAuthRequired) {
          onAuthRequired()
        }
      }
      onNotice?.('error', formatUserActionableError(error, '修改认证文件代理失败'))
      throw error
    }
  }, [onAuthRequired, onNotice, proxyPools, refreshCredentialPages, refreshProxyPools])

  const saveAuthFileNote = useCallback(async (names: string[], note: string) => {
    try {
      await setAuthFilesNote(names, note.trim() === '' ? null : note)
      await refreshCredentialPages()
      onNotice?.('success', note.trim() === '' ? '认证文件标签已清除' : '认证文件标签已更新')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (onAuthRequired) {
          onAuthRequired()
        }
      }
      onNotice?.('error', formatUserActionableError(error, '保存认证文件标签失败'))
      throw error
    }
  }, [onAuthRequired, onNotice, refreshCredentialPages])

  const saveUsageIdentityAlias = useCallback(async (id: string, alias: string) => {
    setAliasSavingId(id)
    try {
      const updated = await updateUsageIdentityAlias(id, alias)
      credentialPages.replaceUsageIdentity(updated)
      onNotice?.('success', i18n.t('usage_stats.credentials_alias_save_success'))
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (onAuthRequired) {
          onAuthRequired()
        }
      }
      onNotice?.('error', i18n.t('usage_stats.credentials_alias_save_failed'))
      throw error
    } finally {
      setAliasSavingId((current) => (current === id ? '' : current))
    }
  }, [credentialPages, onAuthRequired, onNotice])

  const resetQuotaForAuthIndex = useCallback(async (authIndex: string) => {
    setQuotaResetStateByAuthIndex((current) => ({
      ...current,
      [authIndex]: { quotaResetting: true },
    }))
    try {
      const outcome = await runQuotaResetForAuthIndex(authIndex, {
        resetUsageQuota,
        refreshQuotaForAuthIndex,
      })
      setQuotaResetStateByAuthIndex((current) => ({
        ...current,
        [authIndex]: { quotaResetting: false },
      }))
      if (outcome.kind === 'error') {
        onNotice?.('error', outcome.message)
      }
    } catch {
      setQuotaResetStateByAuthIndex((current) => ({
        ...current,
        [authIndex]: { quotaResetting: false },
      }))
      onNotice?.('error', quotaResetDisplayError())
    }
  }, [onNotice, refreshQuotaForAuthIndex])

  const startCooldownForAuthFile = useCallback(async (authIndex: string, fileName: string) => {
    try {
      await startAuthFileCooldown(authIndex, fileName)
      await Promise.all([refreshCredentialPages(), refreshAuthFileCooldowns()])
      onNotice?.('success', '已冷却认证文件 5 小时')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (onAuthRequired) {
          onAuthRequired()
        }
      }
      onNotice?.('error', formatUserActionableError(error, '冷却认证文件失败'))
      throw error
    }
  }, [onAuthRequired, onNotice, refreshAuthFileCooldowns, refreshCredentialPages])

  const restoreCooldownForAuthFile = useCallback(async (authIndex: string) => {
    try {
      await restoreAuthFileCooldown(authIndex)
      await Promise.all([refreshCredentialPages(), refreshAuthFileCooldowns()])
      onNotice?.('success', '认证文件已恢复')
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        if (onAuthRequired) {
          onAuthRequired()
        }
      }
      onNotice?.('error', formatUserActionableError(error, '恢复认证文件失败'))
      throw error
    }
  }, [onAuthRequired, onNotice, refreshAuthFileCooldowns, refreshCredentialPages])

  return {
    authFileRows,
    aiProviderRows,
    authFileTypeCounts: credentialPages.authFileTypeCounts,
    aiProviderTypeCounts: credentialPages.aiProviderTypeCounts,
    authFileTotal: credentialPages.authFileTotal,
    aiProviderTotal: credentialPages.aiProviderTotal,
    authFilePageSize: credentialPages.authFilePageSize,
    aiProviderPageSize: credentialPages.aiProviderPageSize,
    authFilePage: credentialPages.authFilePage,
    aiProviderPage: credentialPages.aiProviderPage,
    authFileTotalPages: credentialPages.authFileTotalPages,
    aiProviderTotalPages: credentialPages.aiProviderTotalPages,
    authFileActiveOnly: credentialPages.authFileActiveOnly,
    authFileProviderFilter: credentialPages.authFileProviderFilter,
    authFileProxyPoolFilterId,
    proxyPools,
    proxyPoolsLoading,
    proxyPoolsError,
    proxyPoolTestHistory,
    proxyPoolTestResults,
    proxyPoolTestErrors,
    proxyPoolTestingIds,
    proxyPoolAutoTestEnabled,
    aiProviderProviderFilter: credentialPages.aiProviderProviderFilter,
    authFileSort: credentialPages.authFileSort,
    authFileQuery: credentialPages.authFileQuery,
    aiProviderSort: credentialPages.aiProviderSort,
    setAuthFilePage: credentialPages.setAuthFilePage,
    setAiProviderPage: credentialPages.setAiProviderPage,
    setAuthFilePageSize: credentialPages.setAuthFilePageSize,
    setAuthFileQuery: credentialPages.setAuthFileQuery,
    setAiProviderPageSize: credentialPages.setAiProviderPageSize,
    setAuthFileActiveOnly: credentialPages.setAuthFileActiveOnly,
    setAuthFileProviderFilter: credentialPages.setAuthFileProviderFilter,
    setAuthFileProxyPoolFilterId,
    setAiProviderProviderFilter: credentialPages.setAiProviderProviderFilter,
    setAuthFileSort: credentialPages.setAuthFileSort,
    setAiProviderSort: credentialPages.setAiProviderSort,
    loading: credentialPages.loading,
    error: credentialPages.error,
    quotaRefreshing: quotaRefreshTasks.quotaRefreshing,
    quotaRefreshError: quotaRefreshTasks.quotaRefreshError,
    quotaInspectionStatus: quotaInspection.quotaInspectionStatus,
    quotaInspectionLoading: quotaInspection.quotaInspectionLoading,
    quotaInspectionStarting: quotaInspection.quotaInspectionStarting,
    quotaInspectionError: quotaInspection.quotaInspectionError,
    authFileCooldownsLoading,
    authFileCooldownsError,
    aliasSavingId,
    refresh: refresh,
    refreshProxyPools,
    setProxyPoolAutoTestEnabled,
    testProxyPoolById,
    testProxyPoolsByIds,
    saveProxyPool,
    removeProxyPool,
    applyProxyPoolToAuthFiles,
    saveAuthFileNote,
    saveUsageIdentityAlias,
    refreshQuotaForCurrentAuthFilePage: quotaRefreshTasks.refreshQuotaForCurrentAuthFilePage,
    refreshQuotaForAuthIndex: quotaRefreshTasks.refreshQuotaForAuthIndex,
    resetQuotaForAuthIndex,
    startCooldownForAuthFile,
    restoreCooldownForAuthFile,
    refreshQuotaInspectionStatus: quotaInspection.refreshQuotaInspectionStatus,
    startQuotaInspection: quotaAutoRefreshEnabled ? async () => undefined : quotaInspection.startQuotaInspection,
  }
}

export { quotaRefreshDisplayError }

export type QuotaResetOutcome =
  | { kind: 'success' }
  | { kind: 'error'; message: string }

export async function runQuotaResetForAuthIndex(
  authIndex: string,
  deps: {
    resetUsageQuota: (authIndex: string) => Promise<unknown>
    refreshQuotaForAuthIndex: (authIndex: string) => Promise<void>
  },
): Promise<QuotaResetOutcome> {
  try {
    // reset 只负责消费官方次数；失败时不写行内限额缓存，也不触发刷新任务。
    await deps.resetUsageQuota(authIndex)
  } catch {
    return {
      kind: 'error',
      message: quotaResetDisplayError(),
    }
  }

  try {
    // reset 成功后复用现有单行刷新，让缓存继续以官方刷新结果为准；刷新失败走原有行内错误链路。
    await deps.refreshQuotaForAuthIndex(authIndex)
  } catch {
    // reset 已成功消费官方次数，后续刷新失败不影响本次 reset 的成功提示。
  }
  return { kind: 'success' }
}

export function quotaResetDisplayError(): string {
  return i18n.t('usage_stats.credentials_quota_reset_failed', { defaultValue: '重置限额失败，请稍后重试。' })
}

export function buildCredentialQuotaStateMap(
  cachedQuotaStateByAuthIndex: Record<string, QuotaState>,
  quotaStateByAuthIndex: Record<string, QuotaState>,
  quotaResponseByAuthIndex: Record<string, UsageQuotaCheckResponse>,
  resetStateByAuthIndex: Record<string, CredentialResetState> = {},
): Map<string, CredentialQuotaState> {
  const mergedStates = { ...cachedQuotaStateByAuthIndex, ...quotaStateByAuthIndex }
  const authIndexes = new Set([
    ...Object.keys(mergedStates),
    ...Object.keys(resetStateByAuthIndex),
  ])
  return new Map(Array.from(authIndexes).map((authIndex) => {
    const state = mergedStates[authIndex] ?? {}
    const resetState = resetStateByAuthIndex[authIndex] ?? {}
    const hasCachedQuota = Object.prototype.hasOwnProperty.call(quotaResponseByAuthIndex, authIndex)
    const staleFailedState = hasCachedQuota && state.refreshStatus === 'failed'
    return [authIndex, {
      quotaLoading: state.loading ?? false,
      quotaError: staleFailedState ? undefined : state.error,
      refreshStatus: staleFailedState ? undefined : state.refreshStatus,
      quotaResetting: resetState.quotaResetting ?? false,
    }]
  }))
}
