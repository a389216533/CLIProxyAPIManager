import { describe, expect, it, vi } from 'vitest'
import type { UsageIdentity, UsageQuotaCheckResponse, UsageQuotaRow } from '@/lib/types'
import {
  CREDENTIALS_PAGE_SIZE,
  buildAiProviderCredentialRows,
  buildAuthFileCredentialRows,
  paginateCredentials,
  selectQuotaEligibleAuthIndexes,
  splitCredentialIdentities,
} from '../credentialViewModels'


function quotaResponse(authIndex: string, quota: UsageQuotaRow[], rateLimitResetCreditsAvailableCount?: number | null): UsageQuotaCheckResponse {
  return {
    id: authIndex,
    quota,
    rateLimitResetCreditsAvailableCount,
  }
}

function identity(overrides: Partial<UsageIdentity>): UsageIdentity {
  return {
    id: overrides.id ?? '1',
    name: overrides.name ?? '',
    auth_type: overrides.auth_type ?? 1,
    auth_type_name: overrides.auth_type_name ?? '认证文件',
    identity: overrides.identity ?? 'auth-1',
    type: overrides.type ?? 'claude',
    provider: overrides.provider ?? 'claude',
    priority: overrides.priority,
    plan_type: overrides.plan_type,
    workspace_name: overrides.workspace_name,
    total_requests: overrides.total_requests ?? 0,
    success_count: overrides.success_count ?? 0,
    failure_count: overrides.failure_count ?? 0,
    input_tokens: overrides.input_tokens ?? 0,
    output_tokens: overrides.output_tokens ?? 0,
    reasoning_tokens: overrides.reasoning_tokens ?? 0,
    cached_tokens: overrides.cached_tokens ?? 0,
    total_tokens: overrides.total_tokens ?? 0,
    last_aggregated_usage_event_id: overrides.last_aggregated_usage_event_id ?? '0',
    first_used_at: overrides.first_used_at,
    last_used_at: overrides.last_used_at,
    stats_updated_at: overrides.stats_updated_at,
    credential_health: overrides.credential_health,
    active_start: overrides.active_start,
    active_until: overrides.active_until,
    is_deleted: overrides.is_deleted ?? false,
    created_at: overrides.created_at ?? '2026-05-09T00:00:00Z',
    updated_at: overrides.updated_at ?? '2026-05-09T00:00:00Z',
    deleted_at: overrides.deleted_at,
    displayName: overrides.displayName,
  }
}

describe('credentialViewModels', () => {
  it('按凭证类型拆分用量身份，同时保留已删除行用于流量展示', () => {
    const groups = splitCredentialIdentities([
      identity({ id: '1', auth_type: 1, identity: 'auth-file' }),
      identity({ id: '2', auth_type: 2, identity: 'api-key' }),
      identity({ id: '3', auth_type: 1, identity: 'deleted-auth-file', is_deleted: true }),
    ])

    expect(groups.authFiles.map((item) => item.identity)).toEqual(['auth-file', 'deleted-auth-file'])
    expect(groups.aiProviders.map((item) => item.identity)).toEqual(['api-key'])
  })

  it('按 plan type 生成认证文件套餐徽标并忽略大小写', () => {
    const rows = buildAuthFileCredentialRows([
      identity({ identity: 'free-auth', plan_type: 'free' }),
      identity({ identity: 'team-auth', plan_type: 'TEAM' }),
      identity({ identity: 'plus-auth', plan_type: 'Plus' }),
      identity({ identity: 'pro-auth', plan_type: 'chatgpt-pro-monthly' }),
    ])

    expect(rows.map((row) => [row.planTypeLabel, row.planTypeTone])).toEqual([
      ['Free', 'free'],
      ['Team', 'team'],
      ['Plus', 'plus'],
      ['Pro', 'pro'],
    ])
  })

  it('优先使用刷新限额返回的套餐类型', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.primary_window', planType: 'pro' },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([
      identity({ identity: 'auth-1', plan_type: 'plus' }),
    ], quotas)

    expect(rows[0].planTypeLabel).toBe('Pro')
    expect(rows[0].planTypeTone).toBe('pro')
  })

  it('仅 team 认证文件显示工作空间名称', () => {
    const rows = buildAuthFileCredentialRows([
      identity({ identity: 'team-auth', plan_type: 'team', workspace_name: 'Workspace A' }),
      identity({ identity: 'plus-auth', plan_type: 'plus', workspace_name: 'Workspace B' }),
    ])

    expect(rows.map((row) => row.workspaceNameLabel)).toEqual(['Workspace A', undefined])
  })

  it('在前端格式化未知的刷新限额套餐类型', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.primary_window', planType: ' enterprise ' },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([
      identity({ identity: 'auth-1', plan_type: 'plus' }),
    ], quotas)

    expect(rows[0].planTypeLabel).toBe('Enterprise')
    expect(rows[0].planTypeTone).toBe('neutral')
  })

  it('生成 active-until 剩余天数徽标且最小为零', () => {
    vi.setSystemTime(new Date('2026-05-10T10:00:00Z'))
    try {
      const rows = buildAuthFileCredentialRows([
        identity({ identity: 'future-auth', active_until: '2026-06-04T09:59:59Z' }),
        identity({ identity: 'expired-auth', active_until: '2026-05-09T10:00:00Z' }),
      ])

      expect(rows.map((row) => row.remainingDaysLabel)).toEqual(['25d', '0d'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('限额请求只选择当前页启用的认证文件', () => {
    const rows = [
      identity({ id: '1', auth_type: 1, identity: 'active-auth-file' }),
      identity({ id: '2', auth_type: 1, identity: 'deleted-auth-file', is_deleted: true }),
      identity({ id: '3', auth_type: 2, identity: 'api-key' }),
    ]

    expect(selectQuotaEligibleAuthIndexes(rows)).toEqual(['active-auth-file'])
  })

  it('按固定每页十条分页凭证', () => {
    const identities = Array.from({ length: 25 }, (_, index) => identity({ id: String(index + 1), identity: `auth-${index + 1}` }))

    const firstPage = paginateCredentials(identities, 1)
    const thirdPage = paginateCredentials(identities, 3)

    expect(CREDENTIALS_PAGE_SIZE).toBe(10)
    expect(firstPage.items).toHaveLength(10)
    expect(firstPage.total).toBe(25)
    expect(firstPage.totalPages).toBe(3)
    expect(thirdPage.items.map((item) => item.identity)).toEqual(['auth-21', 'auth-22', 'auth-23', 'auth-24', 'auth-25'])
  })

  it('生成可展示限额条的认证文件行并忽略无进度限额', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.primary_window', label: '5h', remainingFraction: 0.72, remaining: 72, resetAt: '2026-05-09T12:00:00Z', window_usage_tokens: 1_500_000, window_usage_cost: 12.34 },
        { key: 'rate_limit.secondary_window', label: '每周', used: 40, limit: 100 },
        { key: 'rate_limit.gpt_codex_spark_5h', label: 'GPT-5.3-Codex-Spark 5h', usedPercent: 83 },
        { key: 'code_assist.current_tier.GOOGLE_ONE_AI', label: 'Code Assist Credit', remaining: 10 },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([identity({ identity: 'auth-1', displayName: 'Claude Auth', total_requests: 10, success_count: 9, input_tokens: 1000, cached_tokens: 250, total_tokens: 1500 })], quotas)

    expect(rows[0].displayName).toBe('Claude Auth')
    expect(rows[0].typeLabel).toBe('claude')
    expect(rows[0].totalRequests).toBe(10)
    expect(rows[0].successCount).toBe(9)
    expect(rows[0].failureCount).toBe(0)
    expect(rows[0].totalTokens).toBe(1500)
    expect(rows[0].cacheRate).toBe(25)
    expect(rows[0].displayQuotas.map((quota) => quota.label)).toEqual(['5h', '每周', 'GPT-5.3-Codex-Spark 5h'])
    expect(rows[0].displayQuotas[0]).toMatchObject({
      percent: 72,
      percentKind: 'remaining',
      barPercent: 72,
      status: 'ok',
      windowUsage: { tokens: '150万', cost: '$12.34' },
    })
    expect(rows[0].displayQuotas[1]).toMatchObject({
      percent: 40,
      percentKind: 'used',
      barPercent: 60,
    })
    expect(rows[0].displayQuotas[2]).toMatchObject({
      percent: 83,
      percentKind: 'used',
      barPercent: 17,
      status: 'danger',
    })
  })

  it('凭证标题使用后端 displayName 而不是原始用量身份名称', () => {
    const rows = buildAuthFileCredentialRows([
      identity({ identity: 'auth-1', name: 'Raw Upstream Name', displayName: 'Helper Display Name' }),
      identity({ identity: 'auth-2', name: 'Raw Only Name' }),
    ])

    expect(rows[0].displayName).toBe('Helper Display Name')
    expect(rows[1].displayName).toBe('auth-2')
  })

  it('将零限额窗口成本格式化为两位小数', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.primary_window', label: '5h', remainingFraction: 0.72, window_usage_tokens: 0, window_usage_cost: 0 },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([identity({ identity: 'auth-1' })], quotas)

    expect(rows[0].displayQuotas[0].windowUsage).toEqual({ tokens: '0', cost: '$0.00' })
  })

  it('用固定紧凑单位和美元小数格式化供应商限额窗口用量', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.primary_window', label: '5h', usedPercent: 3, window_usage_tokens: 11_368_055, window_usage_cost: 14.83442025 },
        { key: 'additional_rate_limits.GPT-5.3-Codex-Spark.primary_window', label: 'GPT-5.3-Codex-Spark 5h', usedPercent: 0, window_usage_tokens: 393_311, window_usage_cost: 0.458464 },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([identity({ identity: 'auth-1' })], quotas)

    expect(rows[0].displayQuotas.map((quota) => quota.windowUsage)).toEqual([
      { tokens: '1136.8万', cost: '$14.83' },
      { tokens: '39.3万', cost: '$0.46' },
    ])
  })

  it('将 xai 账单限额分值格式化为美元花费且不展示 Token 窗口用量', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['xai-auth', quotaResponse('xai-auth', [
        { key: 'billing.monthly', label: '月度花费', scope: 'billing', metric: 'usd_cents', used: 167, limit: 20000, remaining: 19833, usedPercent: 0.835, window: { seconds: 2592000 }, resetAt: '2026-07-01T00:00:00+00:00' },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([identity({ identity: 'xai-auth', type: 'xai', provider: 'xAI' })], quotas)

    expect(rows[0].displayQuotas[0]).toMatchObject({
      label: '月度花费',
      percent: 0.835,
      percentKind: 'used',
      barPercent: 99.165,
      billingUsage: {
        used: '$1.67',
        limit: '$200.00',
        remaining: '$198.33',
      },
      windowUsage: undefined,
      windowUsageEstimate: undefined,
    })
  })

  it('只从正数当前用量和部分已用百分比估算限额窗口用量', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.primary_window', label: '5h', usedPercent: 25, window_usage_tokens: 1_000_000, window_usage_cost: 2.5 },
        { key: 'rate_limit.secondary_window', label: '每周', remainingFraction: 0.75, window_usage_tokens: 500_000, window_usage_cost: 1 },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([identity({ identity: 'auth-1' })], quotas)

    expect(rows[0].displayQuotas.map((quota) => quota.windowUsageEstimate)).toEqual([
      { tokens: '400万', cost: '$10.00' },
      { tokens: '200万', cost: '$4.00' },
    ])
  })

  it('当已用百分比或当前成本无法估算时保留当前限额窗口用量', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.zero_window', label: 'Zero', usedPercent: 0, window_usage_tokens: 393_311, window_usage_cost: 0.458464 },
        { key: 'rate_limit.full_window', label: 'Full', usedPercent: 100, window_usage_tokens: 1_000, window_usage_cost: 1 },
        { key: 'rate_limit.free_window', label: 'Free', usedPercent: 50, window_usage_tokens: 1_000, window_usage_cost: 0 },
        { key: 'rate_limit.empty_window', label: 'Empty', usedPercent: 50, window_usage_tokens: 0, window_usage_cost: 1 },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([identity({ identity: 'auth-1' })], quotas)

    expect(rows[0].displayQuotas.map((quota) => quota.windowUsage)).toEqual([
      { tokens: '39.3万', cost: '$0.46' },
      { tokens: '1,000', cost: '$1.00' },
      { tokens: '1,000', cost: '$0.00' },
      { tokens: '0', cost: '$1.00' },
    ])
    expect(rows[0].displayQuotas.map((quota) => quota.windowUsageEstimate)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ])
  })

  it('限额窗口成本格式化显式使用 US locale', () => {
    const numberFormatSpy = vi.spyOn(Intl, 'NumberFormat')
    try {
      const quotas = new Map<string, UsageQuotaCheckResponse>([
        ['auth-1', quotaResponse('auth-1', [
          { key: 'rate_limit.primary_window', label: '5h', usedPercent: 3, window_usage_tokens: 11_368_055, window_usage_cost: 14.83442025 },
        ])],
      ])

      buildAuthFileCredentialRows([identity({ identity: 'auth-1' })], quotas)

      expect(numberFormatSpy).toHaveBeenCalledWith('en-US', expect.objectContaining({
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }))
    } finally {
      numberFormatSpy.mockRestore()
    }
  })

  it('认证文件缓存率使用归一化输入 Token 语义', () => {
    const rows = buildAuthFileCredentialRows([
      identity({ identity: 'auth-claude', type: 'claude', input_tokens: 1000, cached_tokens: 600 }),
    ])

    expect(rows[0].cacheRate).toBe(60)
  })

  it('按剩余额度 50% 和 20% 阈值分类限额条颜色', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['green-auth', quotaResponse('green-auth', [{ key: 'rate_limit.primary_window', label: '5h', remainingFraction: 0.5 }])],
      ['yellow-auth', quotaResponse('yellow-auth', [{ key: 'rate_limit.primary_window', label: '5h', remainingFraction: 0.49 }])],
      ['red-auth', quotaResponse('red-auth', [{ key: 'rate_limit.primary_window', label: '5h', remainingFraction: 0.19 }])],
    ])

    const rows = buildAuthFileCredentialRows([
      identity({ identity: 'green-auth' }),
      identity({ identity: 'yellow-auth' }),
      identity({ identity: 'red-auth' }),
    ], quotas)

    expect(rows.map((row) => row.displayQuotas[0]?.status)).toEqual(['ok', 'warning', 'danger'])
  })

  it('分类 Codex 窗口时使用限额窗口时长而不是原始 key', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.primary_window', label: '5h', usedPercent: 10, window: { seconds: 604800 } },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([identity({ identity: 'auth-1' })], quotas)

    expect(rows[0].displayQuotas[0]?.label).toBe('每周')
    expect(rows[0].displayQuotas[0]?.barPercent).toBe(90)
  })

  it('为月度 Codex 窗口使用月度中文限额标签', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.primary_window', label: '5h', usedPercent: 20, window: { seconds: 2628000 } },
        { key: 'code_review_rate_limit.primary_window', label: '代码审查每周', usedPercent: 40, window: { seconds: 2592000 } },
        { key: 'additional_rate_limits.GPT-5.3-Codex-Spark.primary_window', label: 'GPT-5.3-Codex-Spark 5h', usedPercent: 60, window: { seconds: 2628000 } },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([identity({ identity: 'auth-1' })], quotas)

    expect(rows[0].displayQuotas.map((quota) => quota.label)).toEqual(['每月', '代码审查每月', 'GPT-5.3-Codex-Spark 每月'])
    expect(rows[0].displayQuotas.map((quota) => quota.barPercent)).toEqual([80, 60, 40])
  })

  it('未知 Codex 窗口可展示但不显示通用窗口占位', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.primary_window', label: '窗口', usedPercent: 10, window: { seconds: 3600 } },
        { key: 'additional_rate_limits.GPT-5.3-Codex-Spark.primary_window', label: 'GPT-5.3-Codex-Spark 5h', usedPercent: 83, window: { seconds: 3600 } },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([identity({ identity: 'auth-1' })], quotas)

    expect(rows[0].displayQuotas.map((quota) => quota.label)).toEqual(['主窗口', 'GPT-5.3-Codex-Spark 主窗口'])
    expect(rows[0].displayQuotas.map((quota) => quota.barPercent)).toEqual([90, 17])
  })

  it('无 seconds 时也按 Codex 窗口角色映射旧版通用窗口标签', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [
        { key: 'rate_limit.primary_window', label: '窗口', usedPercent: 10 },
        { key: 'code_review_rate_limit.secondary_window', label: '代码审查窗口', usedPercent: 30 },
      ])],
    ])

    const rows = buildAuthFileCredentialRows([identity({ identity: 'auth-1' })], quotas)

    expect(rows[0].displayQuotas.map((quota) => quota.label)).toEqual(['主窗口', '代码审查次窗口'])
    expect(rows[0].displayQuotas.map((quota) => quota.barPercent)).toEqual([90, 70])
  })


  it('从完整限额响应派生认证文件限额行和重置次数', () => {
    const quotas = new Map<string, UsageQuotaCheckResponse>([
      ['auth-1', quotaResponse('auth-1', [{ key: 'rate_limit.primary_window', label: '5h', usedPercent: 20 }], 2)],
      ['auth-2', quotaResponse('auth-2', [{ key: 'rate_limit.primary_window', label: '5h', usedPercent: 20 }], 0)],
    ])

    const rows = buildAuthFileCredentialRows([
      identity({ identity: 'auth-1' }),
      identity({ identity: 'auth-2' }),
    ], quotas)

    expect(rows.map((row) => row.quotaResetCreditsAvailableCount)).toEqual([2, 0])
    expect(rows[0].quota).toEqual(quotas.get('auth-1')?.quota)
  })

  it('为认证文件和 AI 供应商生成紧凑优先级标签', () => {
    const authFileRows = buildAuthFileCredentialRows([
      identity({ identity: 'priority-auth', priority: 5 }),
      identity({ identity: 'zero-priority-auth', priority: 0 }),
      identity({ identity: 'default-auth' }),
    ])
    const aiProviderRows = buildAiProviderCredentialRows([
      identity({ auth_type: 2, identity: 'priority-provider', priority: 7 }),
    ])

    expect(authFileRows.map((row) => row.priorityLabel)).toEqual(['P5', 'P0', undefined])
    expect(aiProviderRows[0].priorityLabel).toBe('P7')
  })

  it('在认证文件和 AI 供应商行上保留凭证健康快照', () => {
    const credentialHealth = {
      window_seconds: 18_000,
      bucket_seconds: 600,
      window_start: '2026-05-10T05:30:00Z',
      window_end: '2026-05-10T10:30:00Z',
      total_success: 2,
      total_failure: 1,
      success_rate: 66.6667,
      buckets: [],
    }

    const authFileRows = buildAuthFileCredentialRows([
      identity({ identity: 'auth-1', credential_health: credentialHealth }),
    ])
    const aiProviderRows = buildAiProviderCredentialRows([
      identity({ auth_type: 2, identity: 'provider-1', credential_health: credentialHealth }),
    ])

    expect(authFileRows[0].credentialHealth).toBe(credentialHealth)
    expect(aiProviderRows[0].credentialHealth).toBe(credentialHealth)
  })

  it('生成不包含限额数据的 AI 供应商行', () => {
    const rows = buildAiProviderCredentialRows([
      identity({ auth_type: 2, identity: 'sk-a***1234', displayName: 'Claude API', total_requests: 4, success_count: 3, failure_count: 1 }),
    ])

    expect(rows[0].displayName).toBe('Claude API')
    expect(rows[0].maskedIdentity).toBe('sk-a***1234')
    expect(rows[0].totalRequests).toBe(4)
    expect(rows[0].successCount).toBe(3)
    expect(rows[0].failureCount).toBe(1)
    expect(rows[0].successRate).toBe(75)
    expect(rows[0].totalTokens).toBe(0)
    expect(rows[0].cacheRate).toBeNull()
    expect('displayQuotas' in rows[0]).toBe(false)
  })
})
