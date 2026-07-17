import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api'
import { buildCredentialQuotaStateMap, quotaRefreshDisplayError, quotaResetDisplayError, runQuotaResetForAuthIndex } from './useCredentialsTabData'
import { AUTH_FILE_QUERY_DEBOUNCE_MS, CREDENTIAL_PAGES_REFRESH_INTERVAL_MS, mergeUsageIdentityAliasUpdate } from './useCredentialPages'
import { buildQuotaCacheAuthIndexesKey, QUOTA_CACHE_REFRESH_INTERVAL_MS } from './useQuotaCache'
import { buildQuotaRefreshSubmissionUpdate, buildQuotaRefreshTaskErrorUpdate } from './useQuotaRefreshTasks'
import type { UsageIdentity } from '@/lib/types'

const credentialsTabDataSource = readFileSync(new URL('./useCredentialsTabData.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const authFileCredentialsSectionSource = readFileSync(new URL('./AuthFileCredentialsSection.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const credentialPagesSource = readFileSync(new URL('./useCredentialPages.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const quotaCacheSource = readFileSync(new URL('./useQuotaCache.ts', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('Credentials polling intervals', () => {
  it('keeps list data on a 1 minute refresh interval', () => {
    expect(CREDENTIAL_PAGES_REFRESH_INTERVAL_MS).toBe(60 * 1000)
  })

  it('debounces Auth Files server search without delaying the input state', () => {
    expect(AUTH_FILE_QUERY_DEBOUNCE_MS).toBe(300)
    expect(credentialPagesSource).toContain('setAuthFileQueryState(query)')
    expect(credentialPagesSource).toContain('window.setTimeout')
    expect(credentialPagesSource).toContain('setDebouncedAuthFileQuery(authFileQuery)')
    expect(credentialPagesSource).toContain('query: debouncedAuthFileQuery || undefined')
  })

  it('keeps quota cache on a 1 minute refresh interval', () => {
    expect(QUOTA_CACHE_REFRESH_INTERVAL_MS).toBe(60 * 1000)
  })
})

describe('buildQuotaCacheAuthIndexesKey', () => {
  it('keeps equal auth index lists stable across array references', () => {
    expect(buildQuotaCacheAuthIndexesKey(['auth-1', 'auth-2'])).toBe(buildQuotaCacheAuthIndexesKey(['auth-1', 'auth-2']))
  })

  it('changes when auth index contents or order changes', () => {
    expect(buildQuotaCacheAuthIndexesKey(['auth-1', 'auth-2'])).not.toBe(buildQuotaCacheAuthIndexesKey(['auth-2', 'auth-1']))
  })
})

describe('useQuotaCache interval lifecycle', () => {
  it('does not register the cache interval while disabled', () => {
    const start = quotaCacheSource.indexOf('useEffect(() => {')
    const end = quotaCacheSource.indexOf('const intervalID = window.setInterval')

    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)

    const beforeInterval = quotaCacheSource.slice(start, end)
    expect(beforeInterval).toContain('if (!enabled)')
    expect(beforeInterval).toContain('return')
  })
})

describe('Credentials quota inspection cache refresh', () => {
  it('refreshes identities and quota cache together for manual page refresh', () => {
    expect(credentialsTabDataSource).toContain('const refreshCredentialPages = credentialPages.refresh')
    expect(credentialsTabDataSource).toMatch(/const\s+refresh\s*=\s*useCallback\(\s*async\s*\(\)\s*=>\s*\{[\s\S]*refreshCredentialPages\(\)[\s\S]*refreshQuotaCache\(\)[\s\S]*\}/)
    expect(credentialsTabDataSource).toMatch(/refresh:\s*refresh,/)
  })

  it('refreshes the current Auth Files quota cache when inspection completes', () => {
    expect(credentialsTabDataSource).toContain('refreshQuotaCache')
    expect(credentialsTabDataSource).toMatch(/useQuotaInspection\(\{[\s\S]*?onInspectionCompleted:\s*refreshQuotaCache[\s\S]*?\}\)/)
  })

  it('refreshes proxy pools after changing auth file proxy bindings', () => {
    expect(credentialsTabDataSource).toMatch(/await setAuthFilesProxyURL\(names, proxyURL\)[\s\S]*refreshCredentialPages\(\)[\s\S]*refreshProxyPools\(\)/)
  })

  it('runs proxy pool auto tests from the credentials data hook instead of the proxy pool panel', () => {
    expect(credentialsTabDataSource).toContain('PROXY_POOL_AUTO_TEST_INTERVAL_MS')
    expect(credentialsTabDataSource).toContain('window.setInterval')
    expect(credentialsTabDataSource).toContain('void testProxyPoolsByIds(proxyPools.map((pool) => pool.id))')
    expect(authFileCredentialsSectionSource).not.toContain('window.setInterval')
  })

  it('lets completed cache quota clear stale row refresh failures after inspection', () => {
    const states = buildCredentialQuotaStateMap(
      {},
      { 'auth-1': { refreshStatus: 'failed', error: 'HTTP 401: stale failure' } },
      { 'auth-1': { id: 'auth-1', quota: [{ key: 'rate_limit.primary_window', label: '5h' }] } },
    )

    expect(states.get('auth-1')).toEqual({
      quotaLoading: false,
      quotaError: undefined,
      refreshStatus: undefined,
      quotaResetting: false,
    })
  })

  it('keeps reset loading separate from quota panel errors', () => {
    const states = buildCredentialQuotaStateMap(
      {},
      { 'auth-1': { error: 'refresh failed' } },
      {},
      { 'auth-1': { quotaResetting: true } },
    )

    expect(states.get('auth-1')).toEqual({
      quotaLoading: false,
      quotaError: 'refresh failed',
      refreshStatus: undefined,
      quotaResetting: true,
    })
  })

  it('keeps reset loading separate from quota panel loading', () => {
    const states = buildCredentialQuotaStateMap(
      {},
      {},
      {},
      { 'auth-1': { quotaResetting: true } },
    )

    expect(states.get('auth-1')).toEqual({
      quotaLoading: false,
      quotaError: undefined,
      refreshStatus: undefined,
      quotaResetting: true,
    })
  })
})

describe('mergeUsageIdentityAliasUpdate', () => {
  it('updates alias display fields without dropping cached credential health', () => {
    const credentialHealth = {
      window_seconds: 18_000,
      bucket_seconds: 600,
      buckets: [],
    }
    const current = {
      id: '1',
      auth_type: 1,
      name: 'Original Auth',
      displayName: 'Original Auth',
      alias: null,
      credential_health: credentialHealth,
    } as UsageIdentity
    const updated = {
      id: '1',
      auth_type: 1,
      name: 'Original Auth',
      displayName: 'Friendly 🚀',
      alias: 'Friendly 🚀',
    } as UsageIdentity

    const merged = mergeUsageIdentityAliasUpdate(current, updated)

    expect(merged.displayName).toBe('Friendly 🚀')
    expect(merged.alias).toBe('Friendly 🚀')
    expect(merged.credential_health).toBe(credentialHealth)
  })
})

describe('quotaRefreshDisplayError', () => {
  it('turns refresh rejection codes into friendly messages', () => {
    expect(quotaRefreshDisplayError('duplicate')).toBe('该凭证的限额刷新正在运行。')
    expect(quotaRefreshDisplayError('duplicate_request')).toBe('该凭证已包含在本次刷新请求中。')
    expect(quotaRefreshDisplayError('not_auth_file')).toBe('限额刷新仅支持本地认证文件。')
    expect(quotaRefreshDisplayError('unsupported')).toBe('该凭证类型不支持限额刷新。')
  })

  it('keeps backend friendly refresh failures displayable', () => {
    expect(quotaRefreshDisplayError('Quota refresh timed out. Please try again later.')).toBe('Quota refresh timed out. Please try again later.')
  })
})

describe('buildQuotaRefreshSubmissionUpdate', () => {
  it('keeps duplicate refresh rejections in the polling queue', () => {
    const update = buildQuotaRefreshSubmissionUpdate({
      tasks: [{ authIndex: 'auth-1' }],
      rejected: [
        { authIndex: 'auth-2', error: 'duplicate' },
        { authIndex: 'auth-3', error: 'duplicate_request' },
      ],
      accepted: 1,
      skipped: 2,
      limit: 3,
    }, 'batch')

    expect(update.pendingTasks).toEqual([
      { authIndex: 'auth-1', source: 'batch' },
      { authIndex: 'auth-2', source: 'batch' },
    ])
    expect(update.stateUpdates['auth-2']).toEqual({ refreshStatus: 'queued', error: undefined })
    expect(update.stateUpdates['auth-3']).toEqual({ refreshStatus: 'failed', error: '该凭证已包含在本次刷新请求中。' })
  })
})

describe('buildQuotaRefreshTaskErrorUpdate', () => {
  it('settles 401 polling failures and asks the page to re-authenticate', () => {
    let authRequiredCalls = 0

    const update = buildQuotaRefreshTaskErrorUpdate('auth-1', new ApiError('unauthorized', 401), () => {
      authRequiredCalls += 1
    })

    expect(authRequiredCalls).toBe(1)
    expect(update).toEqual({
      authIndex: 'auth-1',
      settled: true,
      stateUpdate: {
        refreshStatus: 'failed',
        error: '请重新登录后刷新限额。',
      },
    })
  })
})

describe('quotaResetDisplayError', () => {
  it('always returns the generic localized reset failure message', () => {
    expect(quotaResetDisplayError()).toBe('重置限额失败，请稍后重试。')
  })
})

describe('runQuotaResetForAuthIndex', () => {
  it('refreshes quota only after reset succeeds', async () => {
    const calls: string[] = []
    const outcome = await runQuotaResetForAuthIndex('auth-1', {
      resetUsageQuota: async () => {
        calls.push('reset')
      },
      refreshQuotaForAuthIndex: async () => {
        calls.push('refresh')
      },
    })

    expect(outcome).toEqual({ kind: 'success' })
    expect(calls).toEqual(['reset', 'refresh'])
  })

  it('keeps reset successful when the follow-up quota refresh fails', async () => {
    const calls: string[] = []
    const outcome = await runQuotaResetForAuthIndex('auth-1', {
      resetUsageQuota: async () => {
        calls.push('reset')
      },
      refreshQuotaForAuthIndex: async () => {
        calls.push('refresh')
        throw new Error('refresh failed')
      },
    })

    expect(outcome).toEqual({ kind: 'success' })
    expect(calls).toEqual(['reset', 'refresh'])
  })

  it('does not refresh quota when reset fails', async () => {
    const refreshCalls: string[] = []
    const outcome = await runQuotaResetForAuthIndex('auth-1', {
      resetUsageQuota: async () => {
        throw new ApiError('quota_reset_failed', 429)
      },
      refreshQuotaForAuthIndex: async () => {
        refreshCalls.push('refresh')
      },
    })

    expect(outcome).toEqual({ kind: 'error', message: '重置限额失败，请稍后重试。' })
    expect(refreshCalls).toEqual([])
  })

  it('treats provider 401 mapped to 502 as a reset failure instead of dashboard auth logout', async () => {
    const refreshCalls: string[] = []
    const outcome = await runQuotaResetForAuthIndex('auth-1', {
      resetUsageQuota: async () => {
        throw new ApiError('quota_reset_failed', 502)
      },
      refreshQuotaForAuthIndex: async () => {
        refreshCalls.push('refresh')
      },
    })

    expect(outcome).toEqual({ kind: 'error', message: '重置限额失败，请稍后重试。' })
    expect(refreshCalls).toEqual([])
  })

  it('treats dashboard session expiry as a reset failure notice in this action', async () => {
    const outcome = await runQuotaResetForAuthIndex('auth-1', {
      resetUsageQuota: async () => {
        throw new ApiError('unauthorized', 401)
      },
      refreshQuotaForAuthIndex: async () => undefined,
    })

    expect(outcome).toEqual({ kind: 'error', message: '重置限额失败，请稍后重试。' })
  })
})

describe('useCredentialsTabData quota response contract', () => {
  it('narrows reset callback dependencies to refreshQuotaForAuthIndex and notice handler', () => {
    expect(credentialsTabDataSource).toMatch(/}, \[onNotice, refreshQuotaForAuthIndex\]\)/)
  })

  it('routes reset outcomes through the shared helper and top notice', () => {
    expect(credentialsTabDataSource).toContain('runQuotaResetForAuthIndex(authIndex, {')
    expect(credentialsTabDataSource).toContain("onNotice?.('error', outcome.message)")
    expect(credentialsTabDataSource).not.toContain("onAuthRequired?.()")
    expect(credentialsTabDataSource).not.toContain('quotaResetError')
  })
})
