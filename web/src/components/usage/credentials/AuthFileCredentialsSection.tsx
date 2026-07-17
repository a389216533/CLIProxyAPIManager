import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { IconChartLine, IconChevronDown, IconChevronUp, IconDownload, IconFileText, IconGaugeReset, IconLayoutGrid, IconLayoutList, IconPencil, IconRefreshCw, IconSearch, IconSettings, IconShield, IconTrash2, IconKey, IconX, IconSatellite, IconCircleAlert } from '@/components/ui/icons'
import quotaCostIcon from '@/assets/icons/quota-cost.svg'
import quotaTokenIcon from '@/assets/icons/quota-token.svg'
import styles from './CredentialSections.module.scss'
import type { AuthFileCredentialRow, DisplayQuota, PlanTypeTone } from './credentialViewModels'
import { deleteAuthFiles, importAuthFilesFromToken, setAuthFilesDisabled, type UsageIdentityPageSort } from '@/lib/api'
import { formatUserActionableError } from '@/lib/errorMessages'
import type { ProxyPool, ProxyPoolTestResponse, ProxyPoolTestTargetResult, UsageQuotaInspectionResult, UsageQuotaInspectionResultStatus, UsageQuotaInspectionStatusResponse } from '@/lib/types'
import { CredentialAliasEditor, isCredentialAliasEditorDisabled } from './CredentialAliasEditor'
import { CredentialHealthPanel } from './CredentialHealthPanel'
import { CredentialProviderFilterIcon } from './CredentialProviderFilterBar'
import type { CredentialProviderFilterKey } from './credentialProviderFilters'
import { CredentialBadge, CredentialPriorityBadge, CredentialRowShell, CredentialSectionShell, CredentialTableHeader, CredentialsPagination, MetricPill, RequestMetric, TonePercent, cacheRateTone, capitalize, credentialToneClassName, formatCredentialNumber, successRateTone } from './CredentialSectionShell'
import { Select } from '@/components/ui/Select'

type Translate = (key: string, options?: Record<string, string>) => string
type InspectionIndicatorTone = 'idle' | 'running' | 'completed'
type InspectionResultStatusFilter = 'normal' | 'limit_reached' | 'unauthorized_401_402' | 'other_failed'
type InspectionResultStatusFilterState = InspectionResultStatusFilter | null
type InspectionStatTone = 'normal' | 'limitReached' | 'unauthorized' | 'failed' | 'unknown'
type QuotaUsageMode = 'current' | 'estimated'
type AuthFileDisplayMode = 'quota' | 'health'
type InvalidInspectionAccountAction = 'disable' | 'delete'
type SortDirection = 'asc' | 'desc'
type ProxyPoolLatencySortKey = 'latency' | 'gpt' | 'claude'
type ProxyPoolLatencyTone = 'good' | 'normal' | 'warning' | 'error' | 'muted'
type ProxyPoolSortState = { key: ProxyPoolLatencySortKey; direction: SortDirection }
type ProxyPoolBindingSort = 'name_asc' | 'name_desc' | 'proxy_asc' | 'proxy_desc'
export type ProxyPoolTestHistoryMap = Record<string, ProxyPoolTestResponse[]>
type QuotaErrorDisplay = {
  code?: string
  message: string
  title: string
}
type QuotaErrorDetails = {
  code?: string
  message?: string
}
type QuotaResetPopoverPosition = {
  top: number
  right: number
}

const QUOTA_ERROR_MESSAGE_MAX_LENGTH = 96
const QUOTA_ERROR_PARSE_MAX_DEPTH = 10
const AUTH_FILE_DISPLAY_MODE_STORAGE_KEY = 'cpa.credentials.authFiles.displayMode'
const PROXY_POOL_TEST_HISTORY_STORAGE_KEY = 'cpa.proxyPools.testHistory.v1'
export const PROXY_POOL_TEST_HISTORY_LIMIT = 20
export const INSPECTION_RESULT_PAGE_SIZE_OPTIONS = [10, 20, 50] as const
const DEFAULT_INSPECTION_RESULT_PAGE_SIZE = INSPECTION_RESULT_PAGE_SIZE_OPTIONS[0]
const INSPECTION_SELECTABLE_RESULT_STATUSES = new Set<InspectionResultStatusFilter>([
  'normal',
  'limit_reached',
  'unauthorized_401_402',
  'other_failed',
])
const INVALID_INSPECTION_ACCOUNT_STATUSES = new Set<UsageQuotaInspectionResultStatus>([
  'unauthorized_401',
  'payment_required_402',
])

export function reconcileSelectedAuthIndexes(current: Set<string>, rows: AuthFileCredentialRow[]): Set<string> {
  if (current.size === 0) return current

  const visibleAuthIndexes = new Set(
    rows
      .filter((row) => !row.identity.is_deleted)
      .map((row) => row.identity.identity)
  )
  const next = new Set(Array.from(current).filter((authIndex) => visibleAuthIndexes.has(authIndex)))
  return next.size === current.size ? current : next
}

function AuthFileMoreActionsMenu({ inspectionTone, inspectionLabel, onOpenInspection }: {
  inspectionTone: InspectionIndicatorTone
  inspectionLabel: string
  onOpenInspection: () => void
}) {
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const inspectionItemRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  useEffect(() => {
    if (open) inspectionItemRef.current?.focus()
  }, [open])

  return (
    <div
      ref={rootRef}
      className={styles.credentialMoreActions}
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return
        setOpen(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setOpen(false)
          triggerRef.current?.focus()
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.credentialToolbarButton} ${styles.credentialMoreActionsTrigger}`.trim()}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return
          event.preventDefault()
          setOpen(true)
        }}
      >
        <span>更多操作</span>
        {inspectionTone !== 'idle' && (
          <span className={`${styles.credentialInspectionDot} ${styles[`credentialInspectionDot${capitalize(inspectionTone)}`]}`.trim()} aria-hidden="true" />
        )}
        <IconChevronDown size={12} aria-hidden="true" />
      </button>
      {open && (
        <div id={menuId} className={styles.credentialMoreActionsMenu} role="menu" aria-label="更多操作">
          <button
            ref={inspectionItemRef}
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onOpenInspection()
            }}
          >
            <IconSearch size={13} aria-hidden="true" />
            <span>{inspectionLabel}</span>
            {inspectionTone !== 'idle' && (
              <span className={`${styles.credentialInspectionDot} ${styles[`credentialInspectionDot${capitalize(inspectionTone)}`]}`.trim()} aria-hidden="true" />
            )}
          </button>
        </div>
      )}
    </div>
  )
}

interface AuthFileCredentialsSectionProps {
  rows: AuthFileCredentialRow[]
  total: number
  page: number
  totalPages: number
  pageSize: number
  activeOnly: boolean
  sort: UsageIdentityPageSort
  loading: boolean
  quotaRefreshing: boolean
  quotaRefreshError: string
  quotaAutoRefreshEnabled: boolean
  quotaInspectionStatus: UsageQuotaInspectionStatusResponse | null
  quotaInspectionLoading: boolean
  quotaInspectionStarting: boolean
  quotaInspectionError: string
  authFileCooldownsLoading: boolean
  authFileCooldownsError: string
  proxyPools: ProxyPool[]
  proxyPoolsLoading: boolean
  proxyPoolsError: string
  proxyPoolFilterId: string
  providerFilter?: CredentialProviderFilterKey
  authFileQuery: string
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  onActiveOnlyChange: (activeOnly: boolean) => void
  onSortChange: (sort: UsageIdentityPageSort) => void
  onRefreshQuota: () => Promise<void>
  onRefreshQuotaForAuthIndex: (authIndex: string) => Promise<void>
  onResetQuotaForAuthIndex: (authIndex: string) => Promise<void>
  onStartCooldownForAuthFile: (authIndex: string, fileName: string) => Promise<void>
  onRestoreCooldownForAuthFile: (authIndex: string) => Promise<void>
  aliasSavingId?: string
  onSaveAlias?: (id: string, alias: string) => Promise<void>
  onSaveNote?: (names: string[], note: string) => Promise<void>
  onRefreshInspectionStatus: () => Promise<void>
  onStartInspection: () => Promise<void>
  onAfterInvalidAccountAction?: () => Promise<void>
  onProxyPoolFilterChange: (id: string) => void
  onApplyProxyPool: (names: string[], proxyPoolId: string | null) => Promise<void>
  onAuthFileQueryChange: (query: string) => void
}

export function AuthFileCredentialsSection({ rows, total, page, totalPages, pageSize, activeOnly, sort, loading, quotaRefreshing, quotaRefreshError, quotaAutoRefreshEnabled, quotaInspectionStatus, quotaInspectionLoading, quotaInspectionStarting, quotaInspectionError, authFileCooldownsLoading, authFileCooldownsError, proxyPools, proxyPoolsLoading, proxyPoolFilterId, providerFilter = 'all', authFileQuery, onPageChange, onPageSizeChange, onActiveOnlyChange, onSortChange, onRefreshQuota, onRefreshQuotaForAuthIndex, onResetQuotaForAuthIndex, onStartCooldownForAuthFile, onRestoreCooldownForAuthFile, aliasSavingId, onSaveAlias, onSaveNote, onRefreshInspectionStatus, onStartInspection, onAfterInvalidAccountAction, onProxyPoolFilterChange, onApplyProxyPool, onAuthFileQueryChange }: AuthFileCredentialsSectionProps) {
  const { t } = useTranslation()
  const [inspectionOpen, setInspectionOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importContent, setImportContent] = useState('')
  const [importSubmitting, setImportSubmitting] = useState(false)
  const [importError, setImportError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<AuthFileCredentialRow | null>(null)
  const [deleteSubmitting, setDeleteSubmitting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [noteTarget, setNoteTarget] = useState<AuthFileCredentialRow | null>(null)
  const [noteValue, setNoteValue] = useState('')
  const [noteSubmitting, setNoteSubmitting] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [quotaUsageMode, setQuotaUsageMode] = useState<QuotaUsageMode>('current')
  const [displayMode, setDisplayModeState] = useState<AuthFileDisplayMode>(() => readStoredAuthFileDisplayMode())
  
  // UI/UX Refactoring States
  const [selectedAuthIndexes, setSelectedAuthIndexes] = useState<Set<string>>(new Set())
  const [batchProcessing, setBatchProcessing] = useState(false)
  const [batchProgress, setBatchProgress] = useState('')
  const [batchDeleteConfirm, setBatchDeleteConfirm] = useState(false)
  const [drawerTarget, setDrawerTarget] = useState<AuthFileCredentialRow | null>(null)

  useEffect(() => {
    setSelectedAuthIndexes(new Set())
  }, [activeOnly, authFileQuery, page, pageSize, providerFilter, proxyPoolFilterId, sort])

  useEffect(() => {
    setSelectedAuthIndexes((current) => reconcileSelectedAuthIndexes(current, rows))
  }, [rows])

  const [layoutMode, setLayoutMode] = useState<'list' | 'card'>(() => {
    if (typeof window === 'undefined') return 'list'
    return (window.localStorage?.getItem('cpa.authFiles.layoutMode') as 'list' | 'card') || 'list'
  })
  const changeLayoutMode = (mode: 'list' | 'card') => {
    setLayoutMode(mode)
    if (mode === 'card') setSelectedAuthIndexes(new Set())
    window.localStorage?.setItem('cpa.authFiles.layoutMode', mode)
  }
  const [authFileProxyPoolTestHistory] = useState<ProxyPoolTestHistoryMap>(() => readStoredProxyPoolTestHistory())
  const [cooldownActionAuthIndex, setCooldownActionAuthIndex] = useState('')
  const showHealthMode = displayMode === 'health'
  const canRefresh = rows.some((row) => !isRowRefreshing(row) && !row.identity.is_deleted) && !quotaRefreshing
  const inspectionTone = inspectionIndicatorTone(quotaInspectionStatus)
  const selectedRows = useMemo(() => {
    return rows.filter((row) => selectedAuthIndexes.has(row.identity.identity))
  }, [rows, selectedAuthIndexes])

  const handleSelectRow = (identity: string, checked: boolean) => {
    setSelectedAuthIndexes((prev) => {
      const next = new Set(prev)
      if (checked) {
        next.add(identity)
      } else {
        next.delete(identity)
      }
      return next
    })
  }

  const handleSelectAllChange = (checked: boolean) => {
    if (checked) {
      const next = new Set(selectedAuthIndexes)
      rows.forEach((row) => {
        if (!row.identity.is_deleted) {
          next.add(row.identity.identity)
        }
      })
      setSelectedAuthIndexes(next)
    } else {
      const next = new Set(selectedAuthIndexes)
      rows.forEach((row) => {
        next.delete(row.identity.identity)
      })
      setSelectedAuthIndexes(next)
    }
  }

  const isAllSelected = useMemo(() => {
    const activeRows = rows.filter((r) => !r.identity.is_deleted)
    return activeRows.length > 0 && activeRows.every((row) => selectedAuthIndexes.has(row.identity.identity))
  }, [rows, selectedAuthIndexes])

  const handleBatchRefresh = async () => {
    setBatchProcessing(true)
    let done = 0
    const total = selectedRows.length
    for (const row of selectedRows) {
      setBatchProgress(`正在刷新 (${done + 1}/${total})`)
      try {
        await onRefreshQuotaForAuthIndex(row.identity.identity)
      } catch (e) {
        console.error("Batch refresh failed", e)
      }
      done++
    }
    setBatchProcessing(false)
    setBatchProgress('')
    setSelectedAuthIndexes(new Set())
  }

  const handleBatchApplyProxy = async (proxyPoolId: string | null) => {
    setBatchProcessing(true)
    try {
      const fileNames = selectedRows.map((row) => authFileDeleteName(row)).filter(Boolean)
      await onApplyProxyPool(fileNames, proxyPoolId)
      setSelectedAuthIndexes(new Set())
    } catch (e) {
      console.error("Batch proxy apply failed", e)
    } finally {
      setBatchProcessing(false)
    }
  }

  const handleBatchToggleStatus = async (disabled: boolean) => {
    setBatchProcessing(true)
    try {
      const fileNames = selectedRows.map((row) => authFileDeleteName(row)).filter(Boolean)
      await setAuthFilesDisabled(fileNames, disabled)
      await onAfterInvalidAccountAction?.()
      setSelectedAuthIndexes(new Set())
    } catch (e) {
      console.error("Batch status toggle failed", e)
    } finally {
      setBatchProcessing(false)
    }
  }

  const handleBatchDeleteConfirm = async () => {
    setBatchProcessing(true)
    try {
      const fileNames = selectedRows.map((row) => authFileDeleteName(row)).filter(Boolean)
      await deleteAuthFiles(fileNames)
      await onAfterInvalidAccountAction?.()
      setSelectedAuthIndexes(new Set())
      setBatchDeleteConfirm(false)
    } catch (e) {
      console.error("Batch delete failed", e)
    } finally {
      setBatchProcessing(false)
    }
  }

  const proxyPoolFilterOptions = useMemo(() => [
    { value: '', label: '全部' },
    ...proxyPools.map((pool) => ({ value: pool.id, label: pool.name }))
  ], [proxyPools])

  const authFileProxyPoolTestResults = useMemo(() => readProxyPoolTestHistory(authFileProxyPoolTestHistory), [authFileProxyPoolTestHistory])
  const openInspection = () => {
    setInspectionOpen(true)
    void onRefreshInspectionStatus()
  }
  const openImportAuthFile = () => {
    setImportOpen(true)
    setImportError('')
  }
  const closeImportAuthFile = () => {
    if (importSubmitting) {
      return
    }
    setImportOpen(false)
    setImportError('')
  }
  const submitImportAuthFile = async () => {
    const content = importContent.trim()
    if (!content) {
      setImportError(t('usage_stats.credentials_auth_file_import_required'))
      return
    }
    setImportSubmitting(true)
    setImportError('')
    try {
      await importAuthFilesFromToken(content)
      setImportContent('')
      setImportOpen(false)
      await onAfterInvalidAccountAction?.()
    } catch (nextError) {
      setImportError(formatUserActionableError(nextError, t('usage_stats.credentials_auth_file_import_failed')))
    } finally {
      setImportSubmitting(false)
    }
  }
  const setDisplayMode = (mode: AuthFileDisplayMode) => {
    setDisplayModeState(mode)
    persistAuthFileDisplayMode(mode)
  }
  const openDeleteAuthFile = (row: AuthFileCredentialRow) => {
    setDeleteTarget(row)
    setDeleteError('')
  }
  const closeDeleteAuthFile = () => {
    if (deleteSubmitting) {
      return
    }
    setDeleteTarget(null)
    setDeleteError('')
  }
  const openNoteEditor = (row: AuthFileCredentialRow) => {
    setNoteTarget(row)
    setNoteValue(row.identity.note ?? '')
    setNoteError('')
  }
  const closeNoteEditor = () => {
    if (noteSubmitting) {
      return
    }
    setNoteTarget(null)
    setNoteValue('')
    setNoteError('')
  }
  const submitNoteEditor = async () => {
    if (!noteTarget || !onSaveNote) {
      return
    }
    const fileName = authFileDeleteName(noteTarget)
    if (!fileName) {
      setNoteError('认证文件名称为空，无法保存标签')
      return
    }
    const note = noteValue.trim()
    setNoteSubmitting(true)
    setNoteError('')
    try {
      await onSaveNote([fileName], note)
      setNoteTarget(null)
      setNoteValue('')
    } catch (nextError) {
      setNoteError(formatUserActionableError(nextError, '保存认证文件标签失败'))
    } finally {
      setNoteSubmitting(false)
    }
  }
  const confirmDeleteAuthFile = async () => {
    if (!deleteTarget) {
      return
    }
    const fileName = authFileDeleteName(deleteTarget)
    if (!fileName) {
      setDeleteError(t('usage_stats.credentials_auth_file_delete_failed'))
      return
    }
    setDeleteSubmitting(true)
    setDeleteError('')
    try {
      await deleteAuthFiles([fileName])
      await onAfterInvalidAccountAction?.()
      setDeleteTarget(null)
    } catch (nextError) {
      setDeleteError(formatUserActionableError(nextError, t('usage_stats.credentials_auth_file_delete_failed')))
    } finally {
      setDeleteSubmitting(false)
    }
  }
  const startCooldown = async (row: AuthFileCredentialRow) => {
    const fileName = authFileDeleteName(row)
    if (!fileName) {
      return
    }
    setCooldownActionAuthIndex(row.identity.identity)
    try {
      await onStartCooldownForAuthFile(row.identity.identity, fileName)
    } finally {
      setCooldownActionAuthIndex((current) => (current === row.identity.identity ? '' : current))
    }
  }
  const restoreCooldown = async (row: AuthFileCredentialRow) => {
    setCooldownActionAuthIndex(row.identity.identity)
    try {
      await onRestoreCooldownForAuthFile(row.identity.identity)
    } finally {
      setCooldownActionAuthIndex((current) => (current === row.identity.identity ? '' : current))
    }
  }

  return (
    <>
      <CredentialSectionShell
        title={t('usage_stats.credentials_auth_files_title')}
        subtitle={t('usage_stats.credentials_auth_files_subtitle')}
        countLabel={t('usage_stats.credentials_count', { count: total })}
        toolbar={(
          <div className={styles.credentialAuthFileToolbar} role="toolbar" aria-label="认证文件操作">
            <div className={styles.credentialAuthFileFilterRow} role="search" aria-label="筛选认证文件">
              <div className={styles.credentialAuthFileFilterControls}>
                <label className={styles.credentialListSearch}>
                  <IconSearch size={13} />
                  <input
                    value={authFileQuery}
                    onChange={(event) => onAuthFileQueryChange(event.target.value)}
                    placeholder="搜索认证文件"
                    disabled={loading}
                  />
                </label>
                <label className={styles.credentialActiveOnlySwitch}>
                  <span className={styles.credentialActiveOnlyLabel}>{t('usage_stats.credentials_auth_files_active_only')}</span>
                  <input type="checkbox" checked={activeOnly} onChange={(event) => onActiveOnlyChange(event.target.checked)} />
                  <span className={styles.credentialActiveOnlyTrack} aria-hidden="true">
                    <span className={styles.credentialActiveOnlyThumb} />
                  </span>
                </label>
                <div className={styles.credentialProxyPoolFilter}>
                  <span>代理池</span>
                  <Select
                    value={proxyPoolFilterId}
                    options={proxyPoolFilterOptions}
                    onChange={onProxyPoolFilterChange}
                    disabled={proxyPoolsLoading}
                    className={styles.credentialProxyPoolSelect}
                    fullWidth={false}
                  />
                </div>
              </div>
            </div>
            <div className={styles.credentialAuthFileToolbarEnd}>
              <div className={styles.credentialAuthFileViewControls} role="group" aria-label="认证文件显示方式">
                <AuthFileDisplayModeSwitch mode={displayMode} onChange={setDisplayMode} />
                <AuthFileLayoutModeSwitch mode={layoutMode} onChange={changeLayoutMode} />
              </div>
              <div className={styles.credentialSectionActionButtons}>
                <button
                  type="button"
                  className={`${styles.credentialToolbarButton} ${styles.credentialToolbarButtonPrimary}`.trim()}
                  onClick={openImportAuthFile}
                >
                  <span className={styles.credentialRefreshButtonInner}>
                    <IconDownload size={12} />
                    <span>{t('usage_stats.credentials_auth_file_import_open')}</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`${styles.credentialToolbarButton} ${quotaRefreshing ? styles.credentialRefreshButtonLoading : ''}`.trim()}
                  onClick={() => void onRefreshQuota()}
                  disabled={!canRefresh}
                  aria-busy={quotaRefreshing}
                >
                  <span className={styles.credentialRefreshButtonInner}>
                    {quotaRefreshing ? <LoadingSpinner size={12} className={styles.credentialRefreshSpinner} /> : <IconRefreshCw size={12} />}
                    <span>{quotaRefreshing ? t('usage_stats.credentials_quota_refreshing') : t('usage_stats.credentials_quota_refresh_current_page')}</span>
                  </span>
                </button>
                <AuthFileMoreActionsMenu
                  inspectionTone={inspectionTone}
                  inspectionLabel={t('usage_stats.credentials_inspection_open')}
                  onOpenInspection={openInspection}
                />
              </div>
            </div>
          </div>
        )}
      >
      {/* 批量刷新失败显示在区块顶部，单行任务失败显示在对应限额位置。 */}
      {quotaRefreshError && <div className={styles.credentialInlineError}>{quotaRefreshError}</div>}
      {authFileCooldownsError && <div className={styles.credentialInlineError}>{authFileCooldownsError}</div>}
      {loading && rows.length === 0 && <div className={styles.credentialEmptyState}>{t('common.loading')}</div>}
      {!loading && rows.length === 0 && <div className={styles.credentialEmptyState}>{t('usage_stats.credentials_auth_files_empty')}</div>}
      {layoutMode === 'list' && rows.length > 0 && (
        <CredentialTableHeader
          rowClassName={styles.authFileCredentialRow}
          nameLabel={t('usage_stats.credentials_column_name')}
          totalRequestsLabel={t('usage_stats.total_requests')}
          successRateLabel={t('usage_stats.success_rate')}
          totalTokensLabel={t('usage_stats.total_tokens')}
          cacheRateLabel={t('usage_stats.cache_rate')}
          sideLabel={showHealthMode ? t('usage_stats.credentials_column_health') : t('usage_stats.credentials_column_quota')}
          selectable={true}
          selectedAll={isAllSelected}
          onSelectAllChange={handleSelectAllChange}
        />
      )}
      <div className={layoutMode === 'card' ? styles.credentialRowsCardGrid : undefined}>
        {rows.map((row) => {
        const rowRefreshing = isRowRefreshing(row)
        const cooldownSubmitting = cooldownActionAuthIndex === row.identity.identity
        const resetCredits = row.quotaResetCreditsAvailableCount ?? 0
        const canResetQuota = resetCredits > 0 && !row.identity.is_deleted && !rowRefreshing && !row.quotaResetting
        const proxyPoolName = getAuthFileProxyPoolName(row.identity.proxy_url, proxyPools)
        const deleteName = authFileDeleteName(row)
        const canDeleteAuthFile = deleteName !== '' && !row.identity.is_deleted && !deleteSubmitting
        const canStartCooldown = deleteName !== '' && !row.cooldown && !row.identity.is_deleted && !authFileCooldownsLoading && !cooldownSubmitting
        const canRestoreCooldown = Boolean(row.cooldown) && !row.identity.is_deleted && !authFileCooldownsLoading && !cooldownSubmitting
        const email = authFileEmail(row)
        const rowActions = (
          <div className={styles.credentialQuotaActionStack}>
            {resetCredits > 0 && (
              <QuotaResetAction
                resetCredits={resetCredits}
                disabled={!canResetQuota}
                loading={row.quotaResetting === true}
                onConfirm={() => onResetQuotaForAuthIndex(row.identity.identity)}
              />
            )}
            <button
              type="button"
              className={`${styles.credentialRowRefreshButton} ${rowRefreshing ? styles.credentialRowRefreshButtonLoading : ''}`.trim()}
              onClick={() => void onRefreshQuotaForAuthIndex(row.identity.identity)}
              disabled={row.identity.is_deleted || rowRefreshing}
              aria-label={t('usage_stats.credentials_refresh_single', { name: row.displayName })}
              aria-busy={rowRefreshing}
            >
              {rowRefreshing ? <LoadingSpinner size={13} /> : <IconRefreshCw size={13} />}
            </button>
            {row.cooldown ? (
              <button
                type="button"
                className={styles.credentialRowRefreshButton}
                onClick={() => void restoreCooldown(row)}
                disabled={!canRestoreCooldown}
                aria-label={t('usage_stats.credentials_cooldown_restore_button', { name: row.displayName })}
                aria-busy={cooldownSubmitting}
                title={t('usage_stats.credentials_cooldown_restore_button', { name: row.displayName })}
              >
                {cooldownSubmitting ? <LoadingSpinner size={13} /> : <IconGaugeReset size={13} />}
              </button>
            ) : (
              <button
                type="button"
                className={styles.credentialRowRefreshButton}
                onClick={() => void startCooldown(row)}
                disabled={!canStartCooldown}
                aria-label={t('usage_stats.credentials_cooldown_start_button', { name: row.displayName })}
                aria-busy={cooldownSubmitting}
                title={t('usage_stats.credentials_cooldown_start_button', { name: row.displayName })}
              >
                {cooldownSubmitting ? <LoadingSpinner size={13} /> : <IconShield size={13} />}
              </button>
            )}
            <button
              type="button"
              className={styles.credentialRowDeleteButton}
              onClick={() => openDeleteAuthFile(row)}
              disabled={!canDeleteAuthFile}
              aria-label={t('usage_stats.credentials_auth_file_delete_button', { name: row.displayName })}
            >
              <IconTrash2 size={13} />
            </button>
          </div>
        )
        return (
          <CredentialRowShell
            key={row.identity.id || row.identity.identity}
            title={(
              <span className={styles.credentialAuthFileTitle}>
                {onSaveAlias ? (
                  <CredentialAliasEditor
                    identityId={row.identity.id}
                    displayName={row.displayName}
                    alias={row.identity.alias}
                    saving={aliasSavingId === row.identity.id}
                    disabled={isCredentialAliasEditorDisabled(row.identity.id, row.identity.is_deleted, aliasSavingId)}
                    onSaveAlias={onSaveAlias}
                  />
                ) : row.displayName}
                {email && (
                  <button
                    type="button"
                    className={styles.credentialCopyEmailButton}
                    onClick={() => void copyAuthFileEmail(email)}
                    aria-label={`复制邮箱 ${email}`}
                    title="复制邮箱"
                  >
                    <IconFileText size={12} />
                  </button>
                )}
              </span>
            )}
            subtitle={(
              <span className={styles.credentialIdentityBadges}>
                <CredentialBadge>{row.typeLabel}</CredentialBadge>
                {row.planTypeLabel && <CredentialPlanBadge tone={row.planTypeTone}>{row.planTypeLabel}</CredentialPlanBadge>}
                {row.workspaceNameLabel && <CredentialBadge>工作空间: {row.workspaceNameLabel}</CredentialBadge>}
                {row.remainingDaysLabel && <span className={styles.credentialRemainingDaysBadge}>{row.remainingDaysLabel}</span>}
                {row.cooldown && <CredentialBadge>{t('usage_stats.credentials_cooldown_badge', { time: formatCooldownRestoreAt(row.cooldown.restore_at) })}</CredentialBadge>}
                {row.cooldown?.last_error && <CredentialBadge>{t('usage_stats.credentials_cooldown_restore_failed')}</CredentialBadge>}
                {row.priorityLabel && <CredentialPriorityBadge>{row.priorityLabel}</CredentialPriorityBadge>}
                {row.identity.proxy_url && <CredentialBadge>{proxyPoolName ? `代理: ${proxyPoolName}` : '自定义代理'}</CredentialBadge>}
                {row.identity.note && <CredentialBadge>标签: {row.identity.note}</CredentialBadge>}
                {onSaveNote && (
                  <button
                    type="button"
                    className={styles.credentialInlineIconButton}
                    onClick={(event) => {
                      event.stopPropagation()
                      openNoteEditor(row)
                    }}
                    disabled={row.identity.is_deleted}
                    aria-label={`编辑标签 ${row.displayName}`}
                    title="编辑标签"
                  >
                    <IconPencil size={12} />
                  </button>
                )}
              </span>
            )}
            badges={null}
            metrics={(
              <>
                <MetricPill label={t('usage_stats.total_requests')} value={<RequestMetric total={row.totalRequests} success={row.successCount} failure={row.failureCount} />} />
                <MetricPill label={t('usage_stats.success_rate')} value={<TonePercent value={row.successRate} tone={successRateTone(row.successRate)} />} />
                <MetricPill label={t('usage_stats.total_tokens')} value={formatCredentialNumber(row.totalTokens)} />
                <MetricPill label={t('usage_stats.cache_rate')} value={<TonePercent value={row.cacheRate} tone={cacheRateTone(row.cacheRate)} />} />
              </>
            )}
            rowClassName={layoutMode === 'card' ? styles.authFileCredentialCardItem : styles.authFileCredentialRow}
            selectable={layoutMode === 'list'}
            selected={selectedAuthIndexes.has(row.identity.identity)}
            onSelectChange={(checked) => handleSelectRow(row.identity.identity, checked)}
            onClick={() => setDrawerTarget(row)}
            side={(
              <div className={styles.credentialQuotaSideWithAction}>
                <div className={styles.credentialMergedPanel}>
                  <AuthFileQuotaPanel row={row} quotaUsageMode={quotaUsageMode} />
                  <div className={styles.credentialQuotaHealthMeta}>
                    <span className={
                      row.successRate === null 
                        ? styles.statusDotGreen 
                        : (row.successRate >= 95 
                            ? styles.statusDotGreen 
                            : (row.successRate >= 80 ? styles.statusDotYellow : styles.statusDotRed))
                    } />
                    <span>平均耗时: —</span>
                    <span className={styles.divider}>|</span>
                    <span>错误率: {row.totalRequests > 0 ? `${((row.failureCount / row.totalRequests) * 100).toFixed(1)}%` : '0.0%'}</span>
                    {row.successRate !== null && (
                      <>
                        <span className={styles.divider}>|</span>
                        <span>成功率: {row.successRate.toFixed(1)}%</span>
                      </>
                    )}
                  </div>
                </div>
                {rowActions}
              </div>
            )}
          />
        )
      })}
      </div>
      <CredentialsPagination
        leadingControls={showHealthMode ? undefined : <QuotaUsageModeSwitch label={t('usage_stats.credentials_quota_usage_mode_label')} mode={quotaUsageMode} onChange={setQuotaUsageMode} />}
        page={page}
        total={total}
        totalPages={totalPages}
        pageSize={pageSize}
        sortValue={sort}
        sortLabel={t('usage_stats.credentials_sort_label')}
        sortOptions={[
          { value: 'priority', label: t('usage_stats.credentials_sort_priority') },
          { value: 'total_requests', label: t('usage_stats.credentials_sort_total_requests') },
          { value: 'total_tokens', label: t('usage_stats.credentials_sort_total_tokens') },
          { value: 'last_used_at', label: t('usage_stats.credentials_sort_last_used') },
        ]}
        previousLabel={t('usage_stats.previous_page')}
        nextLabel={t('usage_stats.next_page')}
        rowsPerPageLabel={t('usage_stats.rows_per_page')}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        onSortChange={(nextSort) => onSortChange(nextSort as UsageIdentityPageSort)}
      />
      </CredentialSectionShell>
      <div className={`${styles.batchActionBar} ${selectedAuthIndexes.size > 0 ? styles.batchActionBarActive : ''}`}>
        <div className={styles.batchActionCount}>
          已选择 <span>{selectedAuthIndexes.size}</span> 项
        </div>
        <div className={styles.batchActionButtons}>
          <button
            type="button"
            className={`${styles.batchActionBtn} ${styles.batchActionBtnPrimary}`}
            onClick={handleBatchRefresh}
            disabled={batchProcessing}
          >
            {batchProcessing ? <LoadingSpinner size={11} /> : <IconRefreshCw size={11} />}
            {batchProcessing ? (batchProgress || '正在刷新...') : '批量刷新额度'}
          </button>
          
          <select
            className={styles.batchActionSelect}
            value=""
            disabled={batchProcessing}
            onChange={(e) => {
              const val = e.target.value
              if (val === '__clear__') {
                void handleBatchApplyProxy(null)
              } else if (val) {
                void handleBatchApplyProxy(val)
              }
            }}
          >
            <option value="" disabled>批量应用代理...</option>
            <option value="__clear__">清除代理</option>
            {proxyPools.map((pool) => (
              <option key={pool.id} value={pool.id}>{buildProxyPoolOptionLabel(pool, authFileProxyPoolTestResults[pool.id], authFileProxyPoolTestHistory[pool.id])}</option>
            ))}
          </select>

          <button
            type="button"
            className={styles.batchActionBtn}
            onClick={() => handleBatchToggleStatus(false)}
            disabled={batchProcessing}
          >
            批量启用
          </button>
          
          <button
            type="button"
            className={styles.batchActionBtn}
            onClick={() => handleBatchToggleStatus(true)}
            disabled={batchProcessing}
          >
            批量禁用
          </button>

          <button
            type="button"
            className={`${styles.batchActionBtn} ${styles.batchActionBtnDanger}`}
            onClick={() => setBatchDeleteConfirm(true)}
            disabled={batchProcessing}
          >
            <IconTrash2 size={11} />
            批量删除
          </button>
        </div>
      </div>

      {batchDeleteConfirm && (
        <Modal
          open={true}
          title="确认批量删除"
          onClose={() => setBatchDeleteConfirm(false)}
          closeDisabled={batchProcessing}
          width={400}
        >
          <div style={{ padding: '16px 24px', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p>确定要删除选中的 {selectedAuthIndexes.size} 个认证凭证文件吗？此操作不可逆。</p>
            <div className={styles.credentialInvalidAccountFooter}>
              <button
                type="button"
                className={styles.credentialInvalidAccountCancelButton}
                onClick={() => setBatchDeleteConfirm(false)}
                disabled={batchProcessing}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={styles.credentialInvalidAccountConfirmButton}
                onClick={handleBatchDeleteConfirm}
                disabled={batchProcessing}
                style={{ backgroundColor: 'var(--danger-color)' }}
              >
                {batchProcessing ? <LoadingSpinner size={12} /> : '确认批量删除'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {noteTarget && (
        <Modal
          open={true}
          title="编辑认证文件标签"
          onClose={closeNoteEditor}
          closeDisabled={noteSubmitting}
          width={420}
        >
          <div className={styles.credentialNoteEditorDialog}>
            <label className={styles.credentialNoteEditorField}>
              <span>标签</span>
              <input
                value={noteValue}
                onChange={(event) => setNoteValue(event.target.value)}
                placeholder="例如：主账号、备用、团队 A"
                maxLength={64}
                disabled={noteSubmitting}
                autoFocus
              />
            </label>
            {noteError && <div className={styles.credentialInlineError}>{noteError}</div>}
            <div className={styles.credentialInvalidAccountFooter}>
              <button
                type="button"
                className={styles.credentialInvalidAccountCancelButton}
                onClick={closeNoteEditor}
                disabled={noteSubmitting}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className={styles.credentialInvalidAccountConfirmButton}
                onClick={() => void submitNoteEditor()}
                disabled={noteSubmitting}
              >
                {noteSubmitting ? <LoadingSpinner size={12} /> : '保存'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      <div 
        className={`${styles.detailsDrawerOverlay} ${drawerTarget ? styles.detailsDrawerOverlayOpen : ''}`} 
        onClick={() => setDrawerTarget(null)} 
      />
      <div className={`${styles.detailsDrawer} ${drawerTarget ? styles.detailsDrawerOpen : ''}`}>
        <div className={styles.detailsDrawerHeader}>
          <h3>{drawerTarget?.displayName || '凭证详情'}</h3>
          <button type="button" className={styles.detailsDrawerCloseBtn} onClick={() => setDrawerTarget(null)}>
            <IconX size={16} />
          </button>
        </div>
        <div className={styles.detailsDrawerBody}>
          {drawerTarget && (
            <>
              <div className={styles.detailsDrawerSection}>
                <h4><IconShield size={13} /> 基本信息</h4>
                <div className={styles.detailsDrawerLabelValueGrid}>
                  <span className="label">文件名称:</span>
                  <span className="value">{drawerTarget.identity.file_name || '-'}</span>
                  <span className="label">别名:</span>
                  <span className="value">{drawerTarget.identity.alias || '-'}</span>
                  <span className="label">优先级:</span>
                  <span className="value">{drawerTarget.identity.priority ?? '-'}</span>
                  <span className="label">状态:</span>
                  <span className="value">{drawerTarget.identity.is_deleted ? '已删除' : (drawerTarget.identity.disabled ? '已禁用' : '正常')}</span>
                </div>
              </div>

              <div className={styles.detailsDrawerSection}>
                <h4><IconKey size={13} /> 密钥明细</h4>
                <div className={styles.detailsDrawerTokenWrapper}>
                  <div className="tokenBox">{drawerTarget.identity.identity}</div>
                  <div className="tokenActions">
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(drawerTarget.identity.identity)
                      }}
                    >
                      复制完整密钥
                    </button>
                  </div>
                </div>
              </div>

              <div className={styles.detailsDrawerSection}>
                <h4><IconSatellite size={13} /> 代理设置</h4>
                <div className={styles.detailsDrawerLabelValueGrid}>
                  <span className="label">代理 URL:</span>
                  <span className="value">{drawerTarget.identity.proxy_url || '未设置代理'}</span>
                  <span className="label">所属分组:</span>
                  <span className="value">{getAuthFileProxyPoolName(drawerTarget.identity.proxy_url, proxyPools) || '-'}</span>
                  <span className="label">工作空间:</span>
                  <span className="value">{drawerTarget.identity.workspace_name || '-'}</span>
                </div>
              </div>

              <div className={styles.detailsDrawerSection}>
                <h4><IconChartLine size={13} /> 5小时健康趋势</h4>
                {(() => {
                  const row = drawerTarget
                  return (
                    <CredentialHealthPanel
                      displayName={row.displayName}
                      health={row.credentialHealth}
                      lastUsedAt={row.identity.last_used_at}
                      statsUpdatedAt={row.identity.stats_updated_at}
                    />
                  )
                })()}
              </div>

              {(drawerTarget.cooldown || drawerTarget.quotaError) && (
                <div className={styles.detailsDrawerSection}>
                  <h4><IconCircleAlert size={13} /> 冷却与异常报错</h4>
                  <div className={styles.detailsDrawerLabelValueGrid}>
                    {drawerTarget.cooldown && (
                      <>
                        <span className="label">冷却原因:</span>
                        <span className="value">{drawerTarget.cooldown.reason || '-'}</span>
                        <span className="label">恢复时间:</span>
                        <span className="value">{new Date(drawerTarget.cooldown.restore_at).toLocaleString()}</span>
                      </>
                    )}
                    {drawerTarget.cooldown?.last_error && (
                      <>
                        <span className="label">冷却异常:</span>
                        <span className="value" style={{ color: 'var(--danger-color)' }}>{drawerTarget.cooldown.last_error}</span>
                      </>
                    )}
                    {drawerTarget.quotaError && (
                      <>
                        <span className="label">刷新异常:</span>
                        <span className="value" style={{ color: 'var(--danger-color)' }}>{drawerTarget.quotaError}</span>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <QuotaInspectionModal
        open={inspectionOpen}
        status={quotaInspectionStatus}
        loading={quotaInspectionLoading}
        starting={quotaInspectionStarting}
        error={quotaInspectionError}
        quotaAutoRefreshEnabled={quotaAutoRefreshEnabled}
        onClose={() => setInspectionOpen(false)}
        onStart={onStartInspection}
        onRefreshStatus={onRefreshInspectionStatus}
        onAfterInvalidAccountAction={onAfterInvalidAccountAction}
      />
      {importOpen && (
        <AuthFileImportModal
          open={importOpen}
          content={importContent}
          submitting={importSubmitting}
          error={importError}
          onContentChange={setImportContent}
          onClose={closeImportAuthFile}
          onSubmit={submitImportAuthFile}
        />
      )}
      <AuthFileDeleteConfirmModal
        row={deleteTarget}
        submitting={deleteSubmitting}
        error={deleteError}
        onClose={closeDeleteAuthFile}
        onConfirm={confirmDeleteAuthFile}
      />
    </>
  )
}

export function authFileDeleteName(row: Pick<AuthFileCredentialRow, 'identity'>): string {
  return (row.identity.file_name || row.identity.identity || '').trim()
}

export function authFileEmail(row: Pick<AuthFileCredentialRow, 'displayName' | 'identity'>): string {
  const candidates = [
    row.displayName,
    row.identity.name,
    row.identity.file_name,
    row.identity.identity,
  ]
  for (const candidate of candidates) {
    const email = extractEmail(candidate)
    if (email) {
      return email
    }
  }
  return ''
}

export async function copyAuthFileEmail(email: string): Promise<void> {
  const value = email.trim()
  if (!value || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return
  }
  await navigator.clipboard.writeText(value)
}

function extractEmail(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\.json$/i, '')
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
  return match?.[0] ?? ''
}

function getAuthFileProxyPoolName(proxyURL: string | undefined, pools: ProxyPool[]): string {
  return proxyURL ? pools.find((pool) => pool.proxy_url === proxyURL)?.name ?? '' : ''
}

function formatAuthFileProxyLabel(row: Pick<AuthFileCredentialRow, 'identity'>, pools: ProxyPool[]): string {
  if (!row.identity.proxy_url) {
    return '未设置代理'
  }
  const proxyPoolName = getAuthFileProxyPoolName(row.identity.proxy_url, pools)
  return proxyPoolName ? `代理: ${proxyPoolName}` : '自定义代理'
}

function AuthFileDeleteConfirmModal({ row, submitting, error, onClose, onConfirm }: {
  row: AuthFileCredentialRow | null
  submitting: boolean
  error: string
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const { t } = useTranslation()
  if (!row) {
    return null
  }
  const fileName = authFileDeleteName(row)

  return (
    <Modal open={true} title={t('usage_stats.credentials_auth_file_delete_title')} onClose={onClose} width={520} closeDisabled={submitting}>
      <div className={styles.credentialInvalidAccountPanel}>
        {error && <div className={styles.credentialInlineError}>{error}</div>}
        <p>{t('usage_stats.credentials_auth_file_delete_confirm', { name: row.displayName })}</p>
        <div className={styles.credentialInvalidAccountTip}>{fileName}</div>
        <div className={styles.credentialInvalidAccountFooter}>
          <button type="button" className={styles.credentialInvalidAccountCancelButton} onClick={onClose} disabled={submitting}>{t('common.cancel')}</button>
          <button type="button" className={`${styles.credentialInvalidAccountConfirmButton} ${styles.credentialInvalidAccountConfirmButtonDanger}`.trim()} onClick={() => void onConfirm()} disabled={submitting || fileName === ''} aria-busy={submitting}>
            {submitting ? <LoadingSpinner size={12} /> : t('common.delete')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function IconUpload({ size = 20, ...props }: { size?: number } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function AuthFileImportModal({ open, content, submitting, error, onContentChange, onClose, onSubmit }: {
  open: boolean
  content: string
  submitting: boolean
  error: string
  onContentChange: (content: string) => void
  onClose: () => void
  onSubmit: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'input' | 'file'>('input')
  const [dragOver, setDragOver] = useState(false)
  
  interface ParsedFile {
    id: string
    name: string
    size: number
    content: string
    tokenCount: number
    status: 'success' | 'failed'
    error?: string
  }
  
  const [parsedFiles, setParsedFiles] = useState<ParsedFile[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  if (!open) {
    return null
  }

  const canSubmit = content.trim() !== '' && !submitting

  const processFiles = (files: FileList) => {
    const newFiles: ParsedFile[] = []
    let processed = 0
    const total = files.length
    if (total === 0) return

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const reader = new FileReader()
      reader.onload = (event) => {
        const text = (event.target?.result as string) || ''
        let tokenCount = 0
        let status: 'success' | 'failed' = 'success'
        let errorMsg = ''

        try {
          const trimmed = text.trim()
          if (!trimmed) {
            status = 'failed'
            errorMsg = '文件内容为空'
          } else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
            const parsed = JSON.parse(trimmed)
            if (Array.isArray(parsed)) {
              tokenCount = parsed.length
            } else if (typeof parsed === 'object' && parsed !== null) {
              tokenCount = Object.keys(parsed).length
            } else {
              tokenCount = 1
            }
          } else {
            const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean)
            tokenCount = lines.length
          }
        } catch {
          status = 'failed'
          errorMsg = 'JSON解析失败'
        }

        newFiles.push({
          id: `${file.name}-${file.size}-${Date.now()}-${i}`,
          name: file.name,
          size: file.size,
          content: text,
          tokenCount,
          status,
          error: errorMsg
        })

        processed++
        if (processed === total) {
          setParsedFiles((prev) => {
            const updated = [...prev, ...newFiles]
            const allContents = updated
              .filter(f => f.status === 'success')
              .map(f => f.content)
              .join('\n')
            onContentChange(allContents)
            return updated
          })
        }
      }
      reader.readAsText(file)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      processFiles(e.target.files)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    if (submitting) return
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (submitting) return
    setDragOver(false)
    if (e.dataTransfer.files) {
      processFiles(e.dataTransfer.files)
    }
  }

  const removeFile = (id: string) => {
    setParsedFiles((prev) => {
      const next = prev.filter((f) => f.id !== id)
      const allContents = next
        .filter((f) => f.status === 'success')
        .map((f) => f.content)
        .join('\n')
      onContentChange(allContents)
      return next
    })
  }

  const formatBytes = (bytes: number, decimals = 2) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const dm = decimals < 0 ? 0 : decimals
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
  }

  return (
    <Modal open={true} title={t('usage_stats.credentials_auth_file_import_title')} onClose={onClose} width={640} closeDisabled={submitting}>
      <div className={styles.credentialImportPanel}>
        {error && <div className={styles.credentialInlineError}>{error}</div>}
        
        <div className={styles.importTabHeader}>
          <button
            type="button"
            className={`${styles.importTabButton} ${activeTab === 'input' ? styles.active : ''}`}
            onClick={() => setActiveTab('input')}
            disabled={submitting}
          >
            直接输入 Token
          </button>
          <button
            type="button"
            className={`${styles.importTabButton} ${activeTab === 'file' ? styles.active : ''}`}
            onClick={() => setActiveTab('file')}
            disabled={submitting}
          >
            上传文件
          </button>
        </div>

        {activeTab === 'input' ? (
          <>
            <p className={styles.credentialImportDescription}>{t('usage_stats.credentials_auth_file_import_description')}</p>
            <textarea
              className={styles.credentialImportTextarea}
              value={content}
              onChange={(event) => onContentChange(event.target.value)}
              placeholder={t('usage_stats.credentials_auth_file_import_placeholder')}
              spellCheck={false}
              disabled={submitting}
            />
          </>
        ) : (
          <div className={styles.credentialImportPanel}>
            <p className={styles.credentialImportDescription}>请拖拽或选择要导入的认证文件，支持拖入多个 JSON、TXT 或 PEM 格式的文本文件。</p>
            
            <div
              className={`${styles.importDragDropZone} ${dragOver ? styles.dragOver : ''} ${submitting ? styles.disabled : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => !submitting && fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".json,.txt,.pem,text/plain,application/json"
                disabled={submitting}
                multiple
              />
              <IconSatellite size={32} className={styles.importFileIcon} />
              <div className={styles.importDragDropText}>
                <strong>拖拽文件到此处，或点击选择（支持多选）</strong>
                <span>支持多个 JSON、TXT、PEM 等文本文档</span>
              </div>
            </div>

            {parsedFiles.length > 0 && (
              <div className={styles.importFilePreviewList}>
                {parsedFiles.map((file) => (
                  <div key={file.id} className={styles.importPreviewItem}>
                    <div className={styles.importPreviewItemLeft}>
                      <IconFileText size={16} style={{ color: 'var(--primary-color)', flexShrink: 0 }} />
                      <span className={styles.fileName} title={file.name}>{file.name}</span>
                      <span className={styles.fileSize}>({formatBytes(file.size)})</span>
                      {file.status === 'success' ? (
                        <span className={styles.parsedCount}>解析成功 (包含 {file.tokenCount} 个 Token)</span>
                      ) : (
                        <span className={styles.errorMsg}>解析失败: {file.error}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className={styles.importFileRemove}
                      onClick={() => removeFile(file.id)}
                      disabled={submitting}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div className={styles.credentialInvalidAccountFooter}>
          <button type="button" className={styles.credentialInvalidAccountCancelButton} onClick={onClose} disabled={submitting}>{t('common.cancel')}</button>
          <button type="button" className={styles.credentialInvalidAccountConfirmButton} onClick={() => void onSubmit()} disabled={!canSubmit} aria-busy={submitting}>
            {submitting ? <LoadingSpinner size={12} /> : t('usage_stats.credentials_auth_file_import_confirm')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function ProxyPoolManagerPanel({ rows, pools, loading, error, testHistory, testResults, testErrors, testingIds, autoTestEnabled, onAutoTestEnabledChange, onTestPool, onTestPools, onSavePool, onDeletePool, onApplyPool }: {
  rows: AuthFileCredentialRow[]
  pools: ProxyPool[]
  loading: boolean
  error: string
  testHistory: ProxyPoolTestHistoryMap
  testResults: Record<string, ProxyPoolTestResponse>
  testErrors: Record<string, string>
  testingIds: string[]
  autoTestEnabled: boolean
  onAutoTestEnabledChange: (enabled: boolean) => void
  onTestPool: (id: string) => Promise<void>
  onTestPools: (ids: string[]) => Promise<void>
  onSavePool: (input: Pick<ProxyPool, 'name' | 'proxy_url'>, id?: string) => Promise<void>
  onDeletePool: (id: string) => Promise<void>
  onApplyPool: (names: string[], proxyPoolId: string | null) => Promise<void>
}) {
  const [editingId, setEditingId] = useState('')
  const [name, setName] = useState('')
  const [proxyURL, setProxyURL] = useState('')
  const [poolFormOpen, setPoolFormOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [proxyPoolActionError, setProxyPoolActionError] = useState('')
  const [selectedPoolIds, setSelectedPoolIds] = useState<string[]>([])
  const [poolQuery, setPoolQuery] = useState('')
  const [proxyPoolSort, setProxyPoolSort] = useState<ProxyPoolSortState | null>(null)
  const [bindingPool, setBindingPool] = useState<ProxyPool | null>(null)
  const [bindingSelectedNames, setBindingSelectedNames] = useState<string[]>([])
  const [bindingSearch, setBindingSearch] = useState('')
  const [bindingFilter, setBindingFilter] = useState<'all' | 'unbound' | 'current' | 'other'>('all')
  const [bindingSort, setBindingSort] = useState<ProxyPoolBindingSort>('name_asc')
  const authFileRows = useMemo(() => rows.map((row) => ({
    name: authFileDeleteName(row),
    displayName: row.displayName,
    currentProxyURL: row.identity.proxy_url ?? '',
    proxyLabel: formatAuthFileProxyLabel(row, pools),
  })).filter((row) => row.name !== ''), [pools, rows])
  const filteredPools = useMemo(() => {
    const term = poolQuery.trim().toLowerCase()
    if (!term) return pools
    return pools.filter((pool) => pool.name.toLowerCase().includes(term) || pool.proxy_url.toLowerCase().includes(term))
  }, [poolQuery, pools])
  const visiblePools = useMemo(() => sortProxyPoolsForDisplay(filteredPools, testResults, proxyPoolSort), [filteredPools, proxyPoolSort, testResults])
  const visiblePoolIds = useMemo(() => visiblePools.map((pool) => pool.id), [visiblePools])
  const selectedVisiblePoolCount = useMemo(() => visiblePoolIds.filter((id) => selectedPoolIds.includes(id)).length, [selectedPoolIds, visiblePoolIds])
  const allVisiblePoolsSelected = visiblePoolIds.length > 0 && selectedVisiblePoolCount === visiblePoolIds.length
  const someVisiblePoolsSelected = selectedVisiblePoolCount > 0 && !allVisiblePoolsSelected
  const bindingRows = useMemo(() => {
    if (!bindingPool) return []
    const term = bindingSearch.trim().toLowerCase()
    const filteredRows = authFileRows.filter((row) => {
      const currentProxyURL = row.currentProxyURL.trim()
      const matchesTerm = !term || row.displayName.toLowerCase().includes(term) || row.name.toLowerCase().includes(term) || row.proxyLabel.toLowerCase().includes(term)
      const matchesFilter =
        bindingFilter === 'all' ||
        (bindingFilter === 'unbound' && currentProxyURL === '') ||
        (bindingFilter === 'current' && currentProxyURL === bindingPool.proxy_url) ||
        (bindingFilter === 'other' && currentProxyURL !== '' && currentProxyURL !== bindingPool.proxy_url)
      return matchesTerm && matchesFilter
    })
    return sortProxyPoolBindingRows(filteredRows, bindingSort)
  }, [authFileRows, bindingFilter, bindingPool, bindingSearch, bindingSort])
  const bindingSelectedSet = useMemo(() => new Set(bindingSelectedNames), [bindingSelectedNames])
  const bindingRebindCount = useMemo(() => {
    if (!bindingPool) return 0
    return authFileRows.filter((row) => bindingSelectedSet.has(row.name) && row.currentProxyURL !== '' && row.currentProxyURL !== bindingPool.proxy_url).length
  }, [authFileRows, bindingPool, bindingSelectedSet])
  const bindingFilterOptions = useMemo(() => [
    { value: 'all', label: '全部账号' },
    { value: 'unbound', label: '未绑定' },
    { value: 'current', label: '已绑定当前代理' },
    { value: 'other', label: '已绑定其他代理' },
  ], [])
  const bindingSortOptions = useMemo(() => [
    { value: 'name_asc', label: '账号 A-Z' },
    { value: 'name_desc', label: '账号 Z-A' },
    { value: 'proxy_asc', label: '代理 A-Z' },
    { value: 'proxy_desc', label: '代理 Z-A' },
  ], [])

  const resetForm = () => {
    setEditingId('')
    setName('')
    setProxyURL('')
  }
  const openCreatePoolModal = () => {
    resetForm()
    setPoolFormOpen(true)
  }
  const closePoolFormModal = () => {
    if (submitting) {
      return
    }
    resetForm()
    setPoolFormOpen(false)
  }
  const editPool = (pool: ProxyPool) => {
    setEditingId(pool.id)
    setName(pool.name)
    setProxyURL(pool.proxy_url)
    setPoolFormOpen(true)
  }
  const submitPool = async () => {
    setSubmitting(true)
    setProxyPoolActionError('')
    try {
      await onSavePool({ name, proxy_url: proxyURL }, editingId || undefined)
      resetForm()
      setPoolFormOpen(false)
    } catch (nextError) {
      setProxyPoolActionError(formatUserActionableError(nextError, '保存代理池失败'))
    } finally {
      setSubmitting(false)
    }
  }
  const applyPool = async (poolId: string | null) => {
    if (!bindingPool) {
      return
    }
    setSubmitting(true)
    setProxyPoolActionError('')
    try {
      await onApplyPool(bindingSelectedNames, poolId)
      setBindingPool(null)
    } catch (nextError) {
      setProxyPoolActionError(formatUserActionableError(nextError, '修改认证文件代理失败'))
    } finally {
      setSubmitting(false)
    }
  }
  const openBindingModal = (pool: ProxyPool) => {
    setBindingPool(pool)
    setBindingSearch('')
    setBindingFilter('all')
    setBindingSelectedNames(authFileRows.filter((row) => row.currentProxyURL === pool.proxy_url).map((row) => row.name))
  }
  const toggleBindingName = (fileName: string, checked: boolean) => {
    setBindingSelectedNames((current) => checked ? Array.from(new Set([...current, fileName])) : current.filter((item) => item !== fileName))
  }
  const selectVisibleBindingNames = () => {
    const names = bindingRows.map((row) => row.name)
    setBindingSelectedNames((current) => Array.from(new Set([...current, ...names])))
  }
  const clearBindingSelection = () => {
    setBindingSelectedNames([])
  }
  const toggleProxyPoolSort = (key: ProxyPoolLatencySortKey) => {
    setProxyPoolSort((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
      }
      return { key, direction: 'asc' }
    })
  }
  const toggleSelectedPool = (poolId: string, checked: boolean) => {
    setSelectedPoolIds((current) => checked ? Array.from(new Set([...current, poolId])) : current.filter((id) => id !== poolId))
  }
  const toggleVisiblePools = (checked: boolean) => {
    setSelectedPoolIds((current) => {
      if (!checked) {
        return current.filter((id) => !visiblePoolIds.includes(id))
      }
      return Array.from(new Set([...current, ...visiblePoolIds]))
    })
  }

  const testSelectedPools = () => onTestPools(selectedPoolIds.filter((id) => visiblePoolIds.includes(id)))

  return (
    <div>
      <div className={styles.credentialProxyPoolTablePanel}>
        {(error || proxyPoolActionError) && <div className={styles.credentialInlineError}>{proxyPoolActionError || error}</div>}

        <div className={styles.credentialProxyPoolTableToolbar}>
          <Button type="button" variant="primary" size="sm" onClick={openCreatePoolModal} disabled={submitting}>
            新增代理池
          </Button>
          <Button type="button" variant="secondary" size="sm" onClick={() => void testSelectedPools()} disabled={submitting || selectedVisiblePoolCount === 0 || testingIds.length > 0}>
            测试选中
          </Button>
          <label className={styles.credentialProxyPoolAutoTest}>
            <input
              type="checkbox"
              checked={autoTestEnabled}
              onChange={(event) => onAutoTestEnabledChange(event.currentTarget.checked)}
              disabled={loading || visiblePools.length === 0}
            />
            <span>自动测试</span>
          </label>
          <label className={styles.credentialProxyPoolSearch}>
            <IconSearch size={13} />
            <input
              value={poolQuery}
              onChange={(event) => setPoolQuery(event.target.value)}
              placeholder="搜索名称或代理 URL"
              disabled={loading}
            />
          </label>
        </div>

        <div className={styles.credentialProxyPoolTableWrap}>
          <table className={styles.credentialProxyPoolTable}>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="选择"
                    checked={allVisiblePoolsSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = someVisiblePoolsSelected
                    }}
                    onChange={(event) => toggleVisiblePools(event.currentTarget.checked)}
                  />
                </th>
                <th>名称</th>
                <th>代理 URL</th>
                <th>绑定认证文件</th>
                <th>{renderProxyPoolSortButton('latency', '延迟', proxyPoolSort, toggleProxyPoolSort)}</th>
                <th>{renderProxyPoolSortButton('gpt', 'Gpt延迟', proxyPoolSort, toggleProxyPoolSort)}</th>
                <th>{renderProxyPoolSortButton('claude', 'Claude延迟', proxyPoolSort, toggleProxyPoolSort)}</th>
                <th>最后测试</th>
                <th>稳定性</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={10}><div className={styles.credentialEmptyState}>加载中</div></td>
                </tr>
              )}
              {!loading && visiblePools.length === 0 && (
                <tr>
                  <td colSpan={10}><div className={styles.credentialEmptyState}>暂无代理池</div></td>
                </tr>
              )}
              {visiblePools.map((pool) => {
                const testResult = testResults[pool.id]
                const rowError = testErrors[pool.id]
                const testSummary = buildProxyPoolTestSummary(testHistory[pool.id] ?? [])
                const latency = rowError ? proxyPoolDisplayResult('失败', rowError, '', 'error') : formatProxyPoolLatency(pool, testResult)
                const gptLatency = formatProxyPoolTargetResult(testResult?.targets?.gpt)
                const claudeLatency = formatProxyPoolTargetResult(testResult?.targets?.claude)
                const boundCount = formatProxyPoolBoundCount(pool.bound_auth_file_count)
                const selected = selectedPoolIds.includes(pool.id)
                const testing = testingIds.includes(pool.id)
                return (
                  <tr key={pool.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`选择 ${pool.name}`}
                        checked={selected}
                        onChange={(event) => toggleSelectedPool(pool.id, event.currentTarget.checked)}
                      />
                    </td>
                    <td><strong>{pool.name}</strong></td>
                    <td><code className={styles.credentialPoolUrl}>{maskProxyURL(pool.proxy_url)}</code></td>
                    <td>
                      {boundCount.count > 0 ? (
                        <button
                          type="button"
                          className={styles.credentialProxyPoolCountButton}
                          onClick={() => openBindingModal(pool)}
                          title="查看或调整绑定认证文件"
                        >
                          {boundCount.label}
                        </button>
                      ) : (
                        <span className={styles.credentialProxyPoolCountEmpty} title="暂无绑定认证文件">-</span>
                      )}
                    </td>
                    <td>
                      <span className={proxyPoolLatencyClassName(latency.tone)} title={latency.title}>{latency.value}</span>
                      <small className={styles.credentialProxyPoolLatencySource}>{latency.source}</small>
                    </td>
                    <td>
                      <span className={proxyPoolLatencyClassName(gptLatency.tone)} title={gptLatency.title}>{gptLatency.value}</span>
                      {gptLatency.source && <small className={styles.credentialProxyPoolLatencySource}>{gptLatency.source}</small>}
                    </td>
                    <td>
                      <span className={proxyPoolLatencyClassName(claudeLatency.tone)} title={claudeLatency.title}>{claudeLatency.value}</span>
                      {claudeLatency.source && <small className={styles.credentialProxyPoolLatencySource}>{claudeLatency.source}</small>}
                    </td>
                    <td>
                      <span className={styles.credentialProxyPoolLastTest} title={testSummary.lastCheckedAt}>{formatProxyPoolTestTime(testSummary.lastCheckedAt)}</span>
                    </td>
                    <td>
                      <span className={proxyPoolLatencyClassName(testSummary.stabilityTone)} title={testSummary.sparkline}>{testSummary.stabilityLabel}</span>
                      <small className={styles.credentialProxyPoolLatencySource}>
                        {testSummary.successRate === null ? '无历史' : `${testSummary.successRate}% · ${testSummary.trendLabel}`}
                      </small>
                    </td>
                    <td>
                      <div className={styles.credentialPoolActions}>
                        <button type="button" onClick={() => openBindingModal(pool)} disabled={submitting}>绑定认证文件</button>
                        <button type="button" onClick={() => void onTestPool(pool.id)} disabled={submitting || testing} title={testing ? '测试中' : '测试'}>
                          {testing ? <LoadingSpinner size={11} /> : <IconChartLine size={13} />}
                        </button>
                        <button type="button" onClick={() => editPool(pool)} disabled={submitting} title="编辑"><IconSettings size={13} /></button>
                        <button type="button" className={styles.deleteBtn} onClick={() => void onDeletePool(pool.id)} disabled={submitting} title="删除"><IconTrash2 size={13} /></button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={poolFormOpen} title={editingId ? '编辑代理池' : '新增代理池'} onClose={closePoolFormModal} width={560} closeDisabled={submitting}>
        <div className={styles.credentialProxyPoolForm}>
          <div className={styles.credentialFormGroup}>
            <label>名称</label>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="输入代理池名称" disabled={submitting} />
          </div>
          <div className={styles.credentialFormGroup}>
            <label>代理 URL</label>
            <input value={proxyURL} onChange={(event) => setProxyURL(event.target.value)} placeholder="socks5://user:pass@host:port" disabled={submitting} />
          </div>
          <div className={styles.credentialFormActions}>
            <Button type="button" variant="secondary" size="sm" onClick={closePoolFormModal} disabled={submitting}>
              取消
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => void submitPool()}
              disabled={submitting || name.trim() === '' || proxyURL.trim() === ''}
              loading={submitting}
            >
              {editingId ? '保存代理池' : '新增代理池'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={bindingPool !== null} title={bindingPool ? `绑定认证文件到：${bindingPool.name}` : '绑定认证文件'} onClose={() => setBindingPool(null)} width={860} closeDisabled={submitting}>
        {bindingPool && (
          <div className={styles.credentialProxyPoolBindingModal}>
            <div className={styles.credentialProxyPoolBindingSummary}>
              <div><strong>目标代理</strong><span>{bindingPool.name}</span></div>
              <div><strong>当前绑定</strong><span>{bindingPool.bound_auth_file_count ?? 0} 个认证文件</span></div>
              <div><strong>改绑规则</strong><span>选中后覆盖当前代理</span></div>
            </div>
            <div className={styles.credentialProxyPoolSelectionTools}>
              <label className={styles.credentialProxyPoolSearch}>
                <IconSearch size={13} />
                <input
                  value={bindingSearch}
                  onChange={(event) => setBindingSearch(event.target.value)}
                  placeholder="搜索认证文件、账号别名或当前代理"
                  disabled={submitting}
                />
              </label>
              <Select
                value={bindingFilter}
                options={bindingFilterOptions}
                onChange={(value) => setBindingFilter(value as typeof bindingFilter)}
                disabled={submitting}
                className={styles.credentialProxyPoolBindingFilter}
                ariaLabel="绑定认证文件筛选"
              />
              <Select
                value={bindingSort}
                options={bindingSortOptions}
                onChange={(value) => setBindingSort(value as ProxyPoolBindingSort)}
                disabled={submitting}
                className={styles.credentialProxyPoolBindingFilter}
                ariaLabel="绑定认证文件排序"
              />
              <Button type="button" variant="secondary" size="sm" onClick={selectVisibleBindingNames} disabled={submitting || bindingRows.length === 0}>选择当前筛选结果</Button>
              <Button type="button" variant="ghost" size="sm" onClick={clearBindingSelection} disabled={submitting || bindingSelectedNames.length === 0}>清空选择</Button>
            </div>
            <div className={styles.credentialProxyPoolAuthList}>
              {bindingRows.length === 0 && (
                <div className={styles.credentialEmptyState} style={{ padding: '24px 0', textAlign: 'center' }}>
                  没有匹配的认证文件
                </div>
              )}
              {bindingRows.map((row) => {
                const selected = bindingSelectedSet.has(row.name)
                const willRebind = selected && row.currentProxyURL !== '' && row.currentProxyURL !== bindingPool.proxy_url
                const alreadyBound = row.currentProxyURL === bindingPool.proxy_url
                return (
                  <label key={row.name} className={`${styles.credentialProxyPoolAuthItem} ${willRebind ? styles.credentialProxyPoolAuthItemWarning : ''}`.trim()}>
                    <input type="checkbox" checked={selected} onChange={(event) => toggleBindingName(row.name, event.target.checked)} disabled={submitting} />
                    <span className={styles.credentialProxyPoolAuthMain}>
                      <span className={styles.credentialProxyPoolAuthName}>{row.displayName}</span>
                      <small className={styles.credentialProxyPoolAuthProxy}>{willRebind ? '将改绑' : alreadyBound ? '已绑定当前代理' : row.proxyLabel}</small>
                    </span>
                  </label>
                )
              })}
            </div>
            <div className={styles.credentialProxyPoolBindingFooter}>
              <span>已选择 {bindingSelectedNames.length} 个认证文件{bindingRebindCount > 0 ? `，其中 ${bindingRebindCount} 个会从其他代理改绑` : ''}</span>
              <div>
                <Button type="button" variant="secondary" size="sm" onClick={() => setBindingPool(null)} disabled={submitting}>取消</Button>
                <Button type="button" variant="primary" size="sm" onClick={() => void applyPool(bindingPool.id)} disabled={submitting || bindingSelectedNames.length === 0}>确认绑定</Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function maskProxyURL(proxyURL: string) {
  try {
    const parsed = new URL(proxyURL)
    if (parsed.password) {
      parsed.password = '***'
    }
    return parsed.toString()
  } catch {
    return proxyURL.replace(/:\/\/([^:@\s]+):([^@\s]+)@/, '://$1:***@')
  }
}

function formatProxyPoolBoundCount(count: number | undefined) {
  const normalizedCount = typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.round(count) : 0
  return {
    count: normalizedCount,
    label: normalizedCount > 0 ? `已绑定 ${normalizedCount} 个` : '-',
  }
}

type ProxyPoolDisplayResult = {
  value: string
  title: string
  source: string
  tone: ProxyPoolLatencyTone
}

type ProxyPoolTestSummary = {
  lastCheckedAt: string
  successRate: number | null
  averageLatencyMS: number | null
  trendLabel: string
  trendTone: ProxyPoolLatencyTone
  stabilityLabel: string
  stabilityTone: ProxyPoolLatencyTone
  sparkline: string
}

function proxyPoolDisplayResult(value: string, title: string, source: string, tone: ProxyPoolLatencyTone): ProxyPoolDisplayResult {
  return { value, title, source, tone }
}

function formatProxyPoolLatency(pool: ProxyPool, testResult?: Partial<ProxyPoolTestResponse>) {
  const testedLatency = formatProxyPoolTargetResult(testResult?.targets?.latency)
  if (testResult?.targets?.latency) {
    return testedLatency
  }
  if (typeof pool.average_latency_ms === 'number' && Number.isFinite(pool.average_latency_ms) && pool.average_latency_ms > 0) {
    return proxyPoolDisplayResult(`${Math.round(pool.average_latency_ms)}ms`, '', pool.latency_source === 'recent_usage' ? '近24h业务' : '业务均值', proxyPoolLatencyTone(pool.average_latency_ms))
  }
  return testedLatency
}

export function formatProxyPoolTargetResult(target?: ProxyPoolTestTargetResult): ProxyPoolDisplayResult {
  if (!target) {
    return proxyPoolDisplayResult('-', '', '', 'muted')
  }
  if (!target.ok) {
    return proxyPoolDisplayResult('失败', target.error || `HTTP ${target.status_code || 0}`, '', 'error')
  }
  return proxyPoolDisplayResult(`${Math.round(target.duration_ms)}ms`, target.url, '最近测试', proxyPoolLatencyTone(target.duration_ms))
}

export function buildFailedProxyPoolTestResult(error: string): ProxyPoolTestResponse {
  const failedTarget = { ok: false, duration_ms: 0, status_code: 0, error, url: '' }
  return {
    ip: '',
    address: '',
    country: '',
    region: '',
    city: '',
    org: '',
    checked_at: new Date().toISOString(),
    duration_ms: 0,
    targets: {
      latency: failedTarget,
      gpt: failedTarget,
      claude: failedTarget,
    },
  }
}

export function buildProxyPoolTestSummary(history: Array<Partial<ProxyPoolTestResponse>>): ProxyPoolTestSummary {
  const entries = history.filter((entry) => entry.checked_at)
  const latest = entries.at(-1)
  const latencyTargets = entries.map((entry) => entry.targets?.latency).filter((target): target is ProxyPoolTestTargetResult => !!target)
  if (!latest || latencyTargets.length === 0) {
    return {
      lastCheckedAt: '',
      successRate: null,
      averageLatencyMS: null,
      trendLabel: '无数据',
      trendTone: 'muted',
      stabilityLabel: '待测试',
      stabilityTone: 'muted',
      sparkline: '',
    }
  }
  const successTargets = latencyTargets.filter((target) => target.ok && Number.isFinite(target.duration_ms) && target.duration_ms > 0)
  const successRate = Math.round((successTargets.length / latencyTargets.length) * 100)
  const averageLatencyMS = successTargets.length > 0
    ? Math.round(successTargets.reduce((sum, target) => sum + target.duration_ms, 0) / successTargets.length)
    : null
  const successfulDurations = successTargets.map((target) => target.duration_ms)
  const latestTarget = latencyTargets.at(-1)
  const previousSuccessfulDuration = successfulDurations.at(-2)
  const latestSuccessfulDuration = latestTarget?.ok && Number.isFinite(latestTarget.duration_ms) && latestTarget.duration_ms > 0 ? latestTarget.duration_ms : null
  let trendLabel = '无变化'
  let trendTone: ProxyPoolLatencyTone = 'normal'
  if (!latestSuccessfulDuration) {
    trendLabel = '下降'
    trendTone = 'error'
  } else if (!previousSuccessfulDuration) {
    trendLabel = '新增'
    trendTone = proxyPoolLatencyTone(latestSuccessfulDuration)
  } else {
    const diff = latestSuccessfulDuration - previousSuccessfulDuration
    if (Math.abs(diff) <= 50) {
      trendLabel = '稳定'
      trendTone = 'good'
    } else if (diff < 0) {
      trendLabel = '改善'
      trendTone = 'good'
    } else {
      trendLabel = '变慢'
      trendTone = diff > 300 ? 'error' : 'warning'
    }
  }
  const stability = proxyPoolStability(successRate)
  return {
    lastCheckedAt: latest.checked_at ?? '',
    successRate,
    averageLatencyMS,
    trendLabel,
    trendTone,
    stabilityLabel: stability.label,
    stabilityTone: stability.tone,
    sparkline: latencyTargets.map((target) => target.ok && target.duration_ms > 0 ? `${Math.round(target.duration_ms)}` : '失败').join(' -> '),
  }
}

function proxyPoolStability(successRate: number): { label: string; tone: ProxyPoolLatencyTone } {
  if (successRate >= 90) return { label: '稳定', tone: 'good' }
  if (successRate >= 60) return { label: '一般', tone: 'warning' }
  if (successRate > 0) return { label: '波动', tone: 'error' }
  return { label: '不稳定', tone: 'error' }
}

function formatProxyPoolTestTime(value: string) {
  if (!value) return '未测试'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '未知时间'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

export function buildProxyPoolOptionMeta(pool: ProxyPool, testResult?: Partial<ProxyPoolTestResponse>, history: Array<Partial<ProxyPoolTestResponse>> = []) {
  const boundCount = formatProxyPoolBoundCount(pool.bound_auth_file_count)
  const latency = formatProxyPoolLatency(pool, testResult)
  const summary = buildProxyPoolTestSummary(history)
  const stabilityLabel = summary.successRate === null ? proxyPoolLatencyHealthLabel(latency.tone) : summary.stabilityLabel
  const parts = [boundCount.count > 0 ? boundCount.label : '未绑定']
  if (latency.value !== '-') {
    parts.push(latency.value)
  } else {
    parts.push('未测试')
  }
  if (stabilityLabel) {
    parts.push(stabilityLabel)
  }
  return parts.join(' · ')
}

export function buildProxyPoolOptionLabel(pool: ProxyPool, testResult?: Partial<ProxyPoolTestResponse>, history: Array<Partial<ProxyPoolTestResponse>> = []) {
  return `${pool.name}（${buildProxyPoolOptionMeta(pool, testResult, history)}）`
}

function proxyPoolLatencyHealthLabel(tone: ProxyPoolLatencyTone) {
  if (tone === 'good' || tone === 'normal') return '稳定'
  if (tone === 'warning') return '偏慢'
  if (tone === 'error') return '异常'
  return ''
}

function proxyPoolLatencyTone(durationMS: number): ProxyPoolLatencyTone {
  if (!Number.isFinite(durationMS) || durationMS <= 0) {
    return 'muted'
  }
  if (durationMS < 300) {
    return 'good'
  }
  if (durationMS <= 500) {
    return 'normal'
  }
  if (durationMS > 1000) {
    return 'error'
  }
  return 'warning'
}

function proxyPoolLatencyClassName(tone: ProxyPoolLatencyTone) {
  const toneClassName = {
    good: styles.credentialProxyPoolLatencyGood,
    normal: styles.credentialProxyPoolLatencyNormal,
    warning: styles.credentialProxyPoolLatencyWarning,
    error: styles.credentialProxyPoolLatencyError,
    muted: styles.credentialProxyPoolLatencyMuted,
  }[tone]
  return `${styles.credentialProxyPoolLatencyValue} ${toneClassName}`.trim()
}

function proxyPoolLatencySortValue(pool: ProxyPool, testResults: ProxyPoolTestResultMap, key: ProxyPoolLatencySortKey) {
  if (key === 'latency') {
    const target = testResults[pool.id]?.targets?.latency
    if (target?.ok && Number.isFinite(target.duration_ms) && target.duration_ms > 0) {
      return target.duration_ms
    }
    if (typeof pool.average_latency_ms === 'number' && Number.isFinite(pool.average_latency_ms) && pool.average_latency_ms > 0) {
      return pool.average_latency_ms
    }
    return null
  }
  const target = testResults[pool.id]?.targets?.[key]
  if (target?.ok && Number.isFinite(target.duration_ms) && target.duration_ms > 0) {
    return target.duration_ms
  }
  return null
}

type ProxyPoolTestResultMap = Record<string, Partial<ProxyPoolTestResponse> & { targets?: Partial<ProxyPoolTestResponse['targets']> }>

export function sortProxyPoolsForDisplay(pools: ProxyPool[], testResults: ProxyPoolTestResultMap, sort: ProxyPoolSortState | null) {
  if (!sort) {
    return pools
  }
  return [...pools].sort((left, right) => {
    const leftValue = proxyPoolLatencySortValue(left, testResults, sort.key)
    const rightValue = proxyPoolLatencySortValue(right, testResults, sort.key)
    if (leftValue === null && rightValue === null) {
      return left.name.localeCompare(right.name)
    }
    if (leftValue === null) return 1
    if (rightValue === null) return -1
    const diff = leftValue - rightValue
    return sort.direction === 'asc' ? diff : -diff
  })
}

type ProxyPoolBindingRow = {
  name: string
  displayName: string
  currentProxyURL: string
  proxyLabel: string
}

export function sortProxyPoolBindingRows(rows: ProxyPoolBindingRow[], sort: ProxyPoolBindingSort) {
  return [...rows].sort((left, right) => {
    const direction = sort.endsWith('_desc') ? -1 : 1
    if (sort.startsWith('proxy_')) {
      const leftUnbound = left.currentProxyURL.trim() === ''
      const rightUnbound = right.currentProxyURL.trim() === ''
      if (leftUnbound !== rightUnbound) {
        return leftUnbound ? 1 : -1
      }
    }
    const leftValue = sort.startsWith('proxy_') ? left.proxyLabel || left.currentProxyURL : left.displayName || left.name
    const rightValue = sort.startsWith('proxy_') ? right.proxyLabel || right.currentProxyURL : right.displayName || right.name
    const compared = leftValue.localeCompare(rightValue, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    return compared === 0 ? left.name.localeCompare(right.name) : compared * direction
  })
}

function renderProxyPoolSortButton(key: ProxyPoolLatencySortKey, label: string, sort: ProxyPoolSortState | null, onSort: (key: ProxyPoolLatencySortKey) => void) {
  const active = sort?.key === key
  const direction = active ? sort.direction : 'asc'
  const Icon = direction === 'asc' ? IconChevronUp : IconChevronDown
  return (
    <button type="button" className={`${styles.credentialProxyPoolSortButton} ${active ? styles.credentialProxyPoolSortButtonActive : ''}`.trim()} onClick={() => onSort(key)} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <span>{label}</span>
      <Icon size={12} />
    </button>
  )
}

function QuotaResetAction({
  resetCredits,
  disabled,
  loading,
  onConfirm,
}: {
  resetCredits: number
  disabled: boolean
  loading: boolean
  onConfirm: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [popoverPosition, setPopoverPosition] = useState<QuotaResetPopoverPosition | null>(null)
  const tooltipId = useId()
  const actionRef = useRef<HTMLDivElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)

  const updatePopoverPosition = useCallback(() => {
    if (typeof window === 'undefined') {
      return
    }
    const button = buttonRef.current
    if (!button) {
      return
    }
    const rect = button.getBoundingClientRect()
    // popover 使用 fixed，避免被卡片 overflow 裁切，同时跟随右侧按钮重新定位。
    setPopoverPosition({
      top: Math.round(rect.bottom + 8),
      right: Math.max(12, Math.round(window.innerWidth - rect.right)),
    })
  }, [])

  useEffect(() => {
    if (!open) {
      return
    }
    updatePopoverPosition()
    const refreshPopoverPosition = () => updatePopoverPosition()
    window.addEventListener('resize', refreshPopoverPosition)
    window.addEventListener('scroll', refreshPopoverPosition, true)
    return () => {
      window.removeEventListener('resize', refreshPopoverPosition)
      window.removeEventListener('scroll', refreshPopoverPosition, true)
    }
  }, [open, updatePopoverPosition])

  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (actionRef.current?.contains(target)) {
        return
      }
      setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleConfirm = async () => {
    await onConfirm()
    setOpen(false)
  }

  const handleToggleOpen = () => {
    if (open) {
      setOpen(false)
      return
    }
    updatePopoverPosition()
    setOpen(true)
  }

  return (
    <div ref={actionRef} className={styles.credentialQuotaResetAction}>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.credentialRowResetButton} ${loading ? styles.credentialRowRefreshButtonLoading : ''}`.trim()}
        onClick={handleToggleOpen}
        disabled={disabled}
        aria-label={t('usage_stats.credentials_quota_reset_button', { count: String(resetCredits) })}
        aria-describedby={open ? undefined : tooltipId}
        aria-busy={loading}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        {loading ? <LoadingSpinner size={13} /> : <IconGaugeReset size={13} />}
      </button>
      {!open && (
        <span id={tooltipId} className={styles.credentialQuotaResetTooltip} role="tooltip">
          <span className={styles.credentialQuotaResetCount}>{resetCredits}</span>
          <span>{t('usage_stats.credentials_quota_reset_tooltip_suffix')}</span>
        </span>
      )}
      {open && (
        <div
          className={styles.credentialQuotaResetPopover}
          role="dialog"
          aria-label={t('usage_stats.credentials_quota_reset_title')}
          style={popoverPosition ? { top: popoverPosition.top, right: popoverPosition.right } : undefined}
        >
          <p className={styles.credentialQuotaResetTitle}>{t('usage_stats.credentials_quota_reset_title')}</p>
          <p className={styles.credentialQuotaResetMessage}>
            <span className={styles.credentialQuotaResetCountLine}>
              <span className={styles.credentialQuotaResetCount}>{resetCredits}</span>
              <span>{t('usage_stats.credentials_quota_reset_message_suffix')}</span>
            </span>
            <span>{t('usage_stats.credentials_quota_reset_message_prompt')}</span>
          </p>
          <div className={styles.credentialQuotaResetActions}>
            <button type="button" className={styles.credentialQuotaResetCancelButton} onClick={() => setOpen(false)} disabled={loading}>
              {t('common.cancel')}
            </button>
            <button type="button" className={styles.credentialQuotaResetConfirmButton} onClick={() => void handleConfirm()} disabled={loading} aria-busy={loading}>
              {loading ? <LoadingSpinner size={12} /> : t('usage_stats.credentials_quota_reset_confirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function isRowRefreshing(row: AuthFileCredentialRow): boolean {
  return row.refreshStatus === 'queued' || row.refreshStatus === 'running'
}

export function inspectionProgressTotal(status: Pick<UsageQuotaInspectionStatusResponse, 'total' | 'unknown'> | null): number {
  // 弹框进度条展示的是“巡检刷新任务进度”，不是 Auth Files 总账号覆盖率。
  if (!status) {
    return 0
  }
  // unknown 代表未参与刷新或没有可解析缓存的账号，不参与进度百分比分母。
  return Math.max(0, status.total - status.unknown)
}

export function formatInspectionProgressPercent(status: Pick<UsageQuotaInspectionStatusResponse, 'total' | 'cached' | 'unknown'> | null): number {
  // 初始加载或接口失败时没有状态，进度保持 0，避免前端自行 fallback total。
  if (!status) {
    return 0
  }
  // 分母统一走 inspectionProgressTotal，保证显示文本和进度条使用同一口径。
  const progressTotal = inspectionProgressTotal(status)
  if (progressTotal <= 0) {
    return 0
  }
  // cached 可能因为缓存恢复或并发刷新短暂超过分母，最终百分比要钳制在 0-100。
  return Math.max(0, Math.min(100, Math.round((status.cached / progressTotal) * 100)))
}

export function isInspectionStartDisabled({ quotaAutoRefreshEnabled, starting, total, running }: { quotaAutoRefreshEnabled: boolean; starting: boolean; total: number; running: boolean }): boolean {
  // 自动刷新开启时共用刷新结果，按钮不可手动启动巡检；running 只代表显式巡检轮次。
  return quotaAutoRefreshEnabled || starting || running || total <= 0
}

export function inspectionIndicatorTone(status: Pick<UsageQuotaInspectionStatusResponse, 'running' | 'completed' | 'completed_at'> | null): InspectionIndicatorTone {
  // 黄色点只看显式巡检 running，不响应普通手动刷新/自动刷新。
  if (status?.running) {
    return 'running'
  }
  // 绿色点必须有 completed_at；completed 没有时间时不展示完成态，避免共享缓存误点亮。
  if (status?.completed_at) {
    return 'completed'
  }
  return 'idle'
}

export function isSelectableInspectionStatusFilter(status: unknown): status is InspectionResultStatusFilter {
  return typeof status === 'string' && INSPECTION_SELECTABLE_RESULT_STATUSES.has(status as InspectionResultStatusFilter)
}

export function nextInspectionResultStatusFilter(current: InspectionResultStatusFilterState, next: InspectionResultStatusFilter): InspectionResultStatusFilterState {
  return current === next ? null : next
}

export function buildInspectionResultsPage(results: UsageQuotaInspectionResult[], statusFilter: InspectionResultStatusFilterState, page: number, pageSize: number): { results: UsageQuotaInspectionResult[]; total: number; totalPages: number; page: number; pageSize: number } {
  const safePageSize = INSPECTION_RESULT_PAGE_SIZE_OPTIONS.includes(pageSize as (typeof INSPECTION_RESULT_PAGE_SIZE_OPTIONS)[number])
    ? pageSize
    : DEFAULT_INSPECTION_RESULT_PAGE_SIZE
  const filteredResults = statusFilter ? results.filter((result) => matchesInspectionResultStatusFilter(result.status, statusFilter)) : results
  const total = filteredResults.length
  const totalPages = Math.max(1, Math.ceil(total / safePageSize))
  const safePage = Math.max(1, Math.min(Math.floor(page) || 1, totalPages))
  const start = (safePage - 1) * safePageSize
  return {
    results: filteredResults.slice(start, start + safePageSize),
    total,
    totalPages,
    page: safePage,
    pageSize: safePageSize,
  }
}

function matchesInspectionResultStatusFilter(status: UsageQuotaInspectionResultStatus, filter: InspectionResultStatusFilter): boolean {
  // 摘要卡把 401/402 合并，但结果行仍保留原始状态，方便禁用/删除按行处理。
  if (filter === 'unauthorized_401_402') {
    return status === 'unauthorized_401' || status === 'payment_required_402'
  }
  return status === filter
}

export function buildInvalidInspectionAccountFileNames(results: UsageQuotaInspectionResult[]): string[] {
  const seen = new Set<string>()
  const names: string[] = []
  for (const result of results) {
    if (!INVALID_INSPECTION_ACCOUNT_STATUSES.has(result.status)) {
      continue
    }
    const fileName = (result.file_name ?? '').trim()
    if (!fileName || seen.has(fileName)) {
      continue
    }
    seen.add(fileName)
    names.push(fileName)
  }
  return names
}

export function selectAllInvalidInspectionAccountFileNames(fileNames: string[]): string[] {
  return [...fileNames]
}

export function invertInvalidInspectionAccountFileNames(fileNames: string[], selectedFileNames: string[]): string[] {
  const selected = new Set(selectedFileNames)
  return fileNames.filter((fileName) => !selected.has(fileName))
}

function QuotaInspectionModal({
  open,
  status,
  loading,
  starting,
  error,
  quotaAutoRefreshEnabled,
  onClose,
  onStart,
  onRefreshStatus,
  onAfterInvalidAccountAction,
}: {
  open: boolean
  status: UsageQuotaInspectionStatusResponse | null
  loading: boolean
  starting: boolean
  error: string
  quotaAutoRefreshEnabled: boolean
  onClose: () => void
  onStart: () => Promise<void>
  onRefreshStatus: () => Promise<void>
  onAfterInvalidAccountAction?: () => Promise<void>
}) {
  const { t } = useTranslation()
  const [resultStatusFilter, setResultStatusFilter] = useState<InspectionResultStatusFilterState>(null)
  const [resultPage, setResultPage] = useState(1)
  const [resultPageSize, setResultPageSize] = useState<number>(DEFAULT_INSPECTION_RESULT_PAGE_SIZE)
  const [invalidAccountAction, setInvalidAccountAction] = useState<InvalidInspectionAccountAction | null>(null)
  const [selectedInvalidFileNames, setSelectedInvalidFileNames] = useState<string[]>([])
  const [invalidAccountSubmitting, setInvalidAccountSubmitting] = useState(false)
  const [invalidAccountError, setInvalidAccountError] = useState('')
  // total 由后端 Auth Files 身份统计提供，不用页面分页总数替代。
  const total = status?.total ?? 0
  // cached 是已经能解析出最近巡检结果的账号数。
  const cached = status?.cached ?? 0
  // progressTotal 排除 unknown，使进度条只描述实际刷新任务完成度。
  const progressTotal = inspectionProgressTotal(status)
  const progress = formatInspectionProgressPercent(status)
  // startDisabled 只依赖后端巡检 running 和自动刷新开关，不被普通行刷新状态牵连。
  const startDisabled = isInspectionStartDisabled({
    quotaAutoRefreshEnabled,
    starting,
    total,
    running: status?.running ?? false,
  })
  const startLabel = quotaAutoRefreshEnabled
    ? t('usage_stats.credentials_inspection_auto_enabled')
    : (starting || status?.running)
        ? t('usage_stats.credentials_inspection_running')
        : t('usage_stats.credentials_inspection_start')
  const results = status?.results ?? []
  const invalidFileNames = buildInvalidInspectionAccountFileNames(results)
  const resultPageData = buildInspectionResultsPage(results, resultStatusFilter, resultPage, resultPageSize)
  const handleSelectResultStatus = (nextStatus: InspectionResultStatusFilter) => {
    // 切换状态筛选时回到第一页，避免沿用上一个筛选的高页码导致空页。
    setResultStatusFilter((current) => nextInspectionResultStatusFilter(current, nextStatus))
    setResultPage(1)
  }
  const handleResultPageSizeChange = (nextPageSize: number) => {
    setResultPageSize(nextPageSize)
    setResultPage(1)
  }
  const openInvalidAccountAction = (action: InvalidInspectionAccountAction) => {
    setInvalidAccountAction(action)
    setSelectedInvalidFileNames(invalidFileNames)
    setInvalidAccountError('')
  }
  const selectAllInvalidFileNames = () => {
    setSelectedInvalidFileNames(selectAllInvalidInspectionAccountFileNames(invalidFileNames))
  }
  const invertInvalidFileNames = () => {
    setSelectedInvalidFileNames((current) => invertInvalidInspectionAccountFileNames(invalidFileNames, current))
  }
  const closeInvalidAccountAction = () => {
    if (invalidAccountSubmitting) {
      return
    }
    setInvalidAccountAction(null)
    setSelectedInvalidFileNames([])
    setInvalidAccountError('')
  }
  const toggleInvalidFileName = (fileName: string, checked: boolean) => {
    setSelectedInvalidFileNames((current) => {
      if (checked) {
        return current.includes(fileName) ? current : [...current, fileName]
      }
      return current.filter((name) => name !== fileName)
    })
  }
  const handleConfirmInvalidAccountAction = async () => {
    if (!invalidAccountAction || selectedInvalidFileNames.length === 0) {
      return
    }
    setInvalidAccountSubmitting(true)
    setInvalidAccountError('')
    try {
      if (invalidAccountAction === 'disable') {
        await setAuthFilesDisabled(selectedInvalidFileNames, true)
      } else {
        await deleteAuthFiles(selectedInvalidFileNames)
      }
      await Promise.all([onRefreshStatus(), onAfterInvalidAccountAction?.()])
      setInvalidAccountAction(null)
      setSelectedInvalidFileNames([])
    } catch (nextError) {
      setInvalidAccountError(formatUserActionableError(nextError, t('usage_stats.credentials_inspection_invalid_accounts_failed')))
    } finally {
      setInvalidAccountSubmitting(false)
    }
  }
  const inspectionCloseDisabled = invalidAccountAction !== null || invalidAccountSubmitting

  return (
    <Modal open={open} title={t('usage_stats.credentials_inspection_title')} onClose={inspectionCloseDisabled ? () => undefined : onClose} width={820} className={styles.credentialInspectionModal} closeDisabled={inspectionCloseDisabled}>
      <div className={styles.credentialInspectionPanel}>
        <div className={styles.credentialInspectionSummary}>
          <div className={styles.credentialInspectionMetric}>
            <span>{t('usage_stats.credentials_inspection_total')}</span>
            <strong>{total}</strong>
          </div>
          <div className={styles.credentialInspectionProgressBlock}>
            <div className={styles.credentialInspectionProgressHeader}>
              <span>{t('usage_stats.credentials_inspection_progress')}</span>
              <strong>{cached} / {progressTotal} ({progress}%)</strong>
            </div>
            <div
              className={styles.credentialInspectionProgressTrack}
              role="progressbar"
              aria-label={t('usage_stats.credentials_inspection_progress_aria', { progress: String(progress) })}
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span className={styles.credentialInspectionProgressFill} style={{ width: `${progress}%` }} />
            </div>
            <div className={styles.credentialInspectionCompletedAt}>
              <span>{t('usage_stats.credentials_inspection_completed_at')}</span>
              <strong>{formatInspectionCompletedAt(status?.completed_at) || t('usage_stats.credentials_inspection_not_completed')}</strong>
            </div>
          </div>
          <button
            type="button"
            className={`${styles.credentialActionButton} ${styles.credentialInspectionStartButton}`.trim()}
            onClick={() => void onStart()}
            disabled={startDisabled}
            aria-busy={starting}
          >
            {starting ? <LoadingSpinner size={13} /> : <IconSearch size={13} />}
            <span>{startLabel}</span>
          </button>
        </div>

        {error && <div className={styles.credentialInlineError}>{error}</div>}
        {loading && !status && <div className={styles.credentialEmptyState}>{t('common.loading')}</div>}

        <div className={styles.credentialInspectionStatsGrid}>
          <InspectionStatCard tone="normal" label={t('usage_stats.credentials_inspection_normal')} value={status?.normal ?? 0} total={total} filterStatus="normal" active={resultStatusFilter === 'normal'} onSelect={handleSelectResultStatus} />
          <InspectionStatCard tone="limitReached" label={t('usage_stats.credentials_inspection_limit_reached')} value={status?.limit_reached ?? 0} total={total} filterStatus="limit_reached" active={resultStatusFilter === 'limit_reached'} onSelect={handleSelectResultStatus} />
          <InspectionStatCard tone="unauthorized" label={t('usage_stats.credentials_inspection_401_402')} value={status?.unauthorized_401_402 ?? 0} total={total} filterStatus="unauthorized_401_402" active={resultStatusFilter === 'unauthorized_401_402'} onSelect={handleSelectResultStatus} />
          <InspectionStatCard tone="failed" label={t('usage_stats.credentials_inspection_other_failed')} value={status?.other_failed ?? 0} total={total} filterStatus="other_failed" active={resultStatusFilter === 'other_failed'} onSelect={handleSelectResultStatus} />
          <InspectionStatCard tone="unknown" label={t('usage_stats.credentials_inspection_unknown')} value={status?.unknown ?? 0} total={total} />
        </div>

        <div className={styles.credentialInspectionResultsBlock}>
          <div className={styles.credentialInspectionResultsHeader}>
            <div className={styles.credentialInspectionResultsTitle}>{t('usage_stats.credentials_inspection_recent_results')}</div>
            {results.length > 0 && (
              <div className={styles.credentialInspectionResultControls}>
                <div className={styles.credentialInspectionInvalidActions}>
                  <button
                    type="button"
                    className={styles.credentialInspectionInvalidActionButton}
                    onClick={() => openInvalidAccountAction('disable')}
                    disabled={invalidFileNames.length === 0 || invalidAccountSubmitting}
                  >
                    <IconShield size={13} />
                    <span>{t('usage_stats.credentials_inspection_disable_invalid')}</span>
                  </button>
                  <button
                    type="button"
                    className={`${styles.credentialInspectionInvalidActionButton} ${styles.credentialInspectionInvalidActionButtonDanger}`.trim()}
                    onClick={() => openInvalidAccountAction('delete')}
                    disabled={invalidFileNames.length === 0 || invalidAccountSubmitting}
                  >
                    <IconTrash2 size={13} />
                    <span>{t('usage_stats.credentials_inspection_delete_invalid')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          {resultPageData.total === 0 ? (
            <div className={styles.credentialEmptyState}>{t('usage_stats.credentials_inspection_empty_results')}</div>
          ) : (
            <>
              <div className={styles.credentialInspectionResultsTable}>
                {resultPageData.results.map((result) => <InspectionResultRow key={result.auth_index} result={result} />)}
              </div>
              <div className={styles.credentialInspectionResultsFooter}>
                <label className={styles.credentialInspectionPageSizeControl}>
                  <span>{t('usage_stats.rows_per_page')}</span>
                  <select value={resultPageData.pageSize} onChange={(event) => handleResultPageSizeChange(Number(event.target.value))}>
                    {INSPECTION_RESULT_PAGE_SIZE_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <div className={styles.credentialInspectionPagination}>
                  <button type="button" onClick={() => setResultPage(resultPageData.page - 1)} disabled={resultPageData.page <= 1}>{t('usage_stats.previous_page')}</button>
                  <span>{resultPageData.page} / {resultPageData.totalPages}</span>
                  <button type="button" onClick={() => setResultPage(resultPageData.page + 1)} disabled={resultPageData.page >= resultPageData.totalPages}>{t('usage_stats.next_page')}</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <InvalidInspectionAccountModal
        open={invalidAccountAction !== null}
        action={invalidAccountAction}
        fileNames={invalidFileNames}
        selectedFileNames={selectedInvalidFileNames}
        submitting={invalidAccountSubmitting}
        error={invalidAccountError}
        onToggleFileName={toggleInvalidFileName}
        onSelectAll={selectAllInvalidFileNames}
        onInvertSelection={invertInvalidFileNames}
        onCancel={closeInvalidAccountAction}
        onConfirm={handleConfirmInvalidAccountAction}
      />
    </Modal>
  )
}

function InvalidInspectionAccountModal({
  open,
  action,
  fileNames,
  selectedFileNames,
  submitting,
  error,
  onToggleFileName,
  onSelectAll,
  onInvertSelection,
  onCancel,
  onConfirm,
}: {
  open: boolean
  action: InvalidInspectionAccountAction | null
  fileNames: string[]
  selectedFileNames: string[]
  submitting: boolean
  error: string
  onToggleFileName: (fileName: string, checked: boolean) => void
  onSelectAll: () => void
  onInvertSelection: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const actionLabel = action === 'delete' ? t('usage_stats.credentials_inspection_delete_action') : t('usage_stats.credentials_inspection_disable_action')
  return (
    <Modal
      open={open}
      title={t('usage_stats.credentials_inspection_invalid_accounts_title', { action: actionLabel })}
      onClose={onCancel}
      width={600}
      className={styles.credentialInvalidAccountModal}
      closeDisabled={submitting}
      footer={(
        <div className={styles.credentialInvalidAccountFooter}>
          <button type="button" className={styles.credentialInvalidAccountCancelButton} onClick={onCancel} disabled={submitting}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className={`${styles.credentialInvalidAccountConfirmButton} ${action === 'delete' ? styles.credentialInvalidAccountConfirmButtonDanger : ''}`.trim()}
            onClick={onConfirm}
            disabled={submitting || selectedFileNames.length === 0}
            aria-busy={submitting}
          >
            {submitting && <LoadingSpinner size={13} />}
            <span>{t('usage_stats.credentials_inspection_invalid_accounts_confirm', { action: actionLabel })}</span>
          </button>
        </div>
      )}
    >
      <div className={styles.credentialInvalidAccountPanel}>
        <p>{t(action === 'delete' ? 'usage_stats.credentials_inspection_delete_invalid_confirm' : 'usage_stats.credentials_inspection_disable_invalid_confirm')}</p>
        <div className={styles.credentialInvalidAccountTip}>{t('usage_stats.credentials_inspection_invalid_accounts_sync_tip')}</div>
        {error && <div className={styles.credentialInlineError}>{error}</div>}
        <div className={styles.credentialInvalidAccountToolbar}>
          <span>{selectedFileNames.length} / {fileNames.length}</span>
          <div className={styles.credentialInvalidAccountToolbarActions}>
            <button type="button" onClick={onSelectAll} disabled={submitting || fileNames.length === 0}>
              {t('usage_stats.credentials_inspection_invalid_accounts_select_all')}
            </button>
            <button type="button" onClick={onInvertSelection} disabled={submitting || fileNames.length === 0}>
              {t('usage_stats.credentials_inspection_invalid_accounts_invert_selection')}
            </button>
          </div>
        </div>
        <div className={styles.credentialInvalidAccountList}>
          {fileNames.map((fileName) => (
            <label key={fileName} className={styles.credentialInvalidAccountItem}>
              <input
                type="checkbox"
                checked={selectedFileNames.includes(fileName)}
                onChange={(event) => onToggleFileName(fileName, event.target.checked)}
                disabled={submitting}
              />
              <span>{fileName}</span>
            </label>
          ))}
        </div>
      </div>
    </Modal>
  )
}

function InspectionStatCard({ tone, label, value, total, filterStatus, active = false, onSelect }: { tone: InspectionStatTone; label: string; value: number; total: number; filterStatus?: InspectionResultStatusFilter; active?: boolean; onSelect?: (status: InspectionResultStatusFilter) => void }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{percent}%</small>
    </>
  )
  const cardClassName = `${styles.credentialInspectionStatCard} ${styles[`credentialInspectionStatCard${capitalize(tone)}`]}`.trim()
  if (filterStatus && onSelect && isSelectableInspectionStatusFilter(filterStatus)) {
    return (
      <button
        type="button"
        className={`${cardClassName} ${styles.credentialInspectionStatButton} ${active ? styles.credentialInspectionStatButtonActive : ''}`.trim()}
        onClick={() => onSelect(filterStatus)}
        aria-pressed={active}
      >
        {content}
      </button>
    )
  }
  return (
    <div className={cardClassName}>
      {content}
    </div>
  )
}

function InspectionResultRow({ result }: { result: UsageQuotaInspectionResult }) {
  const { t } = useTranslation()
  return (
    <div className={styles.credentialInspectionResultRow}>
      <span className={styles.credentialInspectionTypeIcon}>
        <CredentialProviderFilterIcon provider={result.type} />
      </span>
      <span className={styles.credentialInspectionIdentity}>
        <strong>{result.name || result.file_name || '-'}</strong>
      </span>
      <span className={`${styles.credentialInspectionStatusPill} ${inspectionResultStatusClassName(result.status)}`.trim()}>
        {t(inspectionResultLabelKey(result.status))}
      </span>
      <span className={styles.credentialInspectionCheckedAt}>{formatInspectionDate(result.refreshed_at)}</span>
    </div>
  )
}

function inspectionResultLabelKey(status: UsageQuotaInspectionResult['status']): string {
  switch (status) {
    case 'normal':
      return 'usage_stats.credentials_inspection_normal'
    case 'limit_reached':
      return 'usage_stats.credentials_inspection_limit_reached'
    case 'unauthorized_401':
      return 'usage_stats.credentials_inspection_401'
    case 'payment_required_402':
      return 'usage_stats.credentials_inspection_402'
    default:
      return 'usage_stats.credentials_inspection_other_failed'
  }
}

function inspectionResultStatusClassName(status: UsageQuotaInspectionResult['status']): string {
  switch (status) {
    case 'normal':
      return styles.credentialInspectionStatusNormal
    case 'limit_reached':
      return styles.credentialInspectionStatusLimitReached
    case 'unauthorized_401':
      return styles.credentialInspectionStatusUnauthorized
    case 'payment_required_402':
      return styles.credentialInspectionStatusPayment
    default:
      return styles.credentialInspectionStatusFailed
  }
}

export function formatInspectionCompletedAt(value: string | undefined): string {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString()
}

export function formatCooldownRestoreAt(value: string | undefined): string {
  return formatInspectionCompletedAt(value) || '到期后'
}

function formatInspectionDate(value: string | undefined): string {
  return formatInspectionCompletedAt(value)
}

function CredentialPlanBadge({ children, tone = 'neutral' }: { children: string; tone?: PlanTypeTone }) {
  return <span className={`${styles.credentialPlanBadge} ${styles[`credentialPlanBadge${capitalize(tone)}`]}`.trim()}>{children}</span>
}

function QuotaUsageModeSwitch({ label, mode, onChange }: { label: string; mode: QuotaUsageMode; onChange: (mode: QuotaUsageMode) => void }) {
  const { t } = useTranslation()

  return (
    <div className={styles.credentialQuotaModeControl}>
      <span>{label}</span>
      <div className={styles.credentialQuotaModeSwitcher} role="group" aria-label={t('usage_stats.credentials_quota_usage_mode_aria')}>
        <span className={`${styles.credentialQuotaModeThumb} ${mode === 'estimated' ? styles.credentialQuotaModeThumbEstimated : ''}`.trim()} aria-hidden="true" />
        <button
          type="button"
          className={mode === 'current' ? styles.credentialQuotaModeButtonActive : undefined}
          onClick={() => onChange('current')}
          aria-pressed={mode === 'current'}
        >
          {t('usage_stats.credentials_quota_usage_mode_current')}
        </button>
        <button
          type="button"
          className={mode === 'estimated' ? styles.credentialQuotaModeButtonActive : undefined}
          onClick={() => onChange('estimated')}
          aria-pressed={mode === 'estimated'}
        >
          {t('usage_stats.credentials_quota_usage_mode_estimated')}
        </button>
      </div>
    </div>
  )
}

function AuthFileDisplayModeSwitch({ mode, onChange }: { mode: AuthFileDisplayMode; onChange: (mode: AuthFileDisplayMode) => void }) {
  const { t } = useTranslation()

  return (
    <div className={styles.credentialDisplayModeControl}>
      <div className={styles.credentialDisplayModeSwitcher} role="group" aria-label={t('usage_stats.credentials_auth_files_display_mode_aria')}>
        <span className={`${styles.credentialDisplayModeThumb} ${mode === 'health' ? styles.credentialDisplayModeThumbHealth : ''}`.trim()} aria-hidden="true" />
        <button
          type="button"
          className={mode === 'quota' ? styles.credentialDisplayModeButtonActive : undefined}
          onClick={() => onChange('quota')}
          aria-pressed={mode === 'quota'}
        >
          <IconShield size={12} />
          <span>{t('usage_stats.credentials_auth_files_display_mode_quota')}</span>
        </button>
        <button
          type="button"
          className={mode === 'health' ? styles.credentialDisplayModeButtonActive : undefined}
          onClick={() => onChange('health')}
          aria-pressed={mode === 'health'}
        >
          <IconChartLine size={12} />
          <span>{t('usage_stats.credentials_auth_files_display_mode_health')}</span>
        </button>
      </div>
    </div>
  )
}

export function readStoredAuthFileDisplayMode(): AuthFileDisplayMode {
  if (typeof window === 'undefined') {
    return 'quota'
  }
  try {
    const storedMode = window.localStorage?.getItem(AUTH_FILE_DISPLAY_MODE_STORAGE_KEY)
    return isAuthFileDisplayMode(storedMode) ? storedMode : 'quota'
  } catch {
    return 'quota'
  }
}

export function persistAuthFileDisplayMode(mode: AuthFileDisplayMode): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage?.setItem(AUTH_FILE_DISPLAY_MODE_STORAGE_KEY, mode)
  } catch {
    // localStorage 可能被隐私模式或浏览器策略禁用，忽略后保持本次页面内状态。
  }
}

function isAuthFileDisplayMode(value: string | null | undefined): value is AuthFileDisplayMode {
  return value === 'quota' || value === 'health'
}

function isProxyPoolTestTargetResult(value: unknown): value is ProxyPoolTestTargetResult {
  if (!value || typeof value !== 'object') return false
  const target = value as Partial<ProxyPoolTestTargetResult>
  return typeof target.ok === 'boolean' && typeof target.duration_ms === 'number' && typeof target.status_code === 'number'
}

function isProxyPoolTestResponse(value: unknown): value is ProxyPoolTestResponse {
  if (!value || typeof value !== 'object') return false
  const response = value as Partial<ProxyPoolTestResponse>
  const targets = response.targets as Partial<ProxyPoolTestResponse['targets']> | undefined
  return typeof response.checked_at === 'string' &&
    typeof response.duration_ms === 'number' &&
    !!targets &&
    isProxyPoolTestTargetResult(targets.latency) &&
    isProxyPoolTestTargetResult(targets.gpt) &&
    isProxyPoolTestTargetResult(targets.claude)
}

function normalizeProxyPoolTestHistory(value: unknown): ProxyPoolTestHistoryMap {
  if (!value || typeof value !== 'object') return {}
  return Object.entries(value as Record<string, unknown>).reduce<ProxyPoolTestHistoryMap>((next, [poolId, entries]) => {
    if (!Array.isArray(entries)) return next
    const validEntries = entries.filter(isProxyPoolTestResponse).slice(-PROXY_POOL_TEST_HISTORY_LIMIT)
    if (validEntries.length > 0) {
      next[poolId] = validEntries
    }
    return next
  }, {})
}

export function readStoredProxyPoolTestHistory(): ProxyPoolTestHistoryMap {
  if (typeof window === 'undefined') {
    return {}
  }
  try {
    const rawValue = window.localStorage?.getItem(PROXY_POOL_TEST_HISTORY_STORAGE_KEY)
    if (!rawValue) return {}
    return normalizeProxyPoolTestHistory(JSON.parse(rawValue))
  } catch {
    return {}
  }
}

export function persistProxyPoolTestHistory(history: ProxyPoolTestHistoryMap): void {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage?.setItem(PROXY_POOL_TEST_HISTORY_STORAGE_KEY, JSON.stringify(history))
  } catch {
    // localStorage 不可用时仍保留当前页面内测试结果。
  }
}

export function buildProxyPoolTestHistory(current: ProxyPoolTestHistoryMap, poolId: string, result: ProxyPoolTestResponse): ProxyPoolTestHistoryMap {
  const nextHistory = [
    ...(current[poolId] ?? []),
    result,
  ].slice(-PROXY_POOL_TEST_HISTORY_LIMIT)
  return {
    ...current,
    [poolId]: nextHistory,
  }
}

export function readProxyPoolTestHistory(history: ProxyPoolTestHistoryMap): Record<string, ProxyPoolTestResponse> {
  return Object.entries(history).reduce<Record<string, ProxyPoolTestResponse>>((next, [poolId, entries]) => {
    const latest = entries.at(-1)
    if (latest) {
      next[poolId] = latest
    }
    return next
  }, {})
}

export function AuthFileQuotaPanel({ row, quotaUsageMode }: { row: AuthFileCredentialRow; quotaUsageMode: QuotaUsageMode }) {
  const { t } = useTranslation()

  // 限额区域按加载、错误、刷新中、无缓存、可展示数据的顺序降级。
  if (row.quotaLoading) {
    return <div className={styles.credentialQuotaStateSlot}><div className={styles.credentialQuotaState}>{t('usage_stats.credentials_quota_loading')}</div></div>
  }
  if (row.quotaError) {
    const errorDisplay = formatQuotaErrorDisplay(row.quotaError)
    return (
      <div className={styles.credentialQuotaStateSlot}>
        <div className={styles.credentialQuotaErrorSummary} title={errorDisplay.title}>
          {errorDisplay.code && <span className={styles.credentialQuotaErrorCode}>{errorDisplay.code}</span>}
          <span className={styles.credentialQuotaErrorMessage}>{errorDisplay.message}</span>
        </div>
      </div>
    )
  }
  if (row.refreshStatus === 'queued' || row.refreshStatus === 'running') {
    return <div className={styles.credentialQuotaStateSlot}><div className={styles.credentialQuotaRefreshStatus}>{t(`usage_stats.credentials_refresh_status_${row.refreshStatus}`)}</div></div>
  }
  if (row.displayQuotas.length === 0) {
    return <div className={styles.credentialQuotaStateSlot}><div className={styles.credentialQuotaState}>{t('usage_stats.credentials_quota_unavailable')}</div></div>
  }

  return (
    <div className={styles.credentialQuotaPanel}>
      <div className={styles.credentialQuotaBars}>
        {/* 每个可计算进度的 quota 都独占一个稳定块；不可进度化 quota 在 view model 中已过滤。 */}
        {row.displayQuotas.map((quota) => <QuotaBar key={quota.key} quota={quota} quotaUsageMode={quotaUsageMode} />)}
      </div>
    </div>
  )
}

export function formatQuotaErrorDisplay(error: string | undefined): QuotaErrorDisplay {
  const title = (error || '').trim()
  const raw = title || '限额刷新失败，请稍后重试。'
  const { code, message } = splitHTTPStatus(raw)
  const structured = quotaErrorDetailsFromStructuredValue(message || raw)
  const displayCode = code || structured.code
  const sourceMessage = structured.message || (isStructuredQuotaErrorValue(message || raw) ? '' : (message || raw))
  const readableMessage = readableQuotaErrorMessage(sourceMessage, displayCode ? `HTTP ${displayCode}` : '限额刷新失败，请稍后重试。')
  return {
    code: displayCode,
    message: readableMessage,
    title: raw,
  }
}

function splitHTTPStatus(value: string): { code?: string; message: string } {
  const trimmed = value.trim()
  const match = trimmed.match(/^HTTP\s+(\d{3})(?=\D|$)(?::|\s+-)?\s*([\s\S]*)$/i) ?? trimmed.match(/^(\d{3})(?=\D|$)(?::|\s+-)?\s*([\s\S]*)$/)
  if (!match) {
    return { message: trimmed }
  }
  return { code: match[1], message: match[2].trim() }
}

function readableQuotaErrorMessage(value: string, fallback: string): string {
  const normalized = (value || fallback).replace(/\s+/g, ' ').trim() || fallback
  return truncateQuotaErrorMessage(normalized)
}

function quotaErrorDetailsFromStructuredValue(value: string, depth = 0): QuotaErrorDetails {
  const trimmed = value.trim()
  if (!trimmed || depth > QUOTA_ERROR_PARSE_MAX_DEPTH || !isStructuredQuotaErrorValue(trimmed)) {
    return {}
  }
  try {
    return quotaErrorDetailsFromParsedValue(JSON.parse(trimmed), depth + 1)
  } catch {
    return {}
  }
}

function quotaErrorDetailsFromParsedValue(value: unknown, depth: number): QuotaErrorDetails {
  if (depth > QUOTA_ERROR_PARSE_MAX_DEPTH) {
    return {}
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return {}
    }
    if (isStructuredQuotaErrorValue(trimmed)) {
      const structured = quotaErrorDetailsFromStructuredValue(trimmed, depth + 1)
      if (structured.code || structured.message) {
        return structured
      }
    }
    const httpStatus = splitHTTPStatus(trimmed)
    if (httpStatus.code) {
      return mergeQuotaErrorDetails({ code: httpStatus.code }, quotaErrorDetailsFromStructuredValue(httpStatus.message, depth + 1), { message: httpStatus.message })
    }
    return { message: trimmed }
  }
  if (Array.isArray(value)) {
    return value.reduce<QuotaErrorDetails>((current, item) => mergeQuotaErrorDetails(current, quotaErrorDetailsFromParsedValue(item, depth + 1)), {})
  }
  if (!value || typeof value !== 'object') {
    return {}
  }
  const record = value as Record<string, unknown>
  let details: QuotaErrorDetails = { code: quotaHTTPStatusCodeFromRecord(record) }
  const nestedKeys = ['body', 'body_text', 'bodyText', 'response', 'data', 'payload', 'error', 'errors']
  // provider 错误常带一层通用 message，真实上游错误在 body/error 等字段里，先解析内层响应体。
  for (const key of nestedKeys) {
    if (!isPreferredNestedQuotaErrorValue(key, record[key])) {
      continue
    }
    details = mergeQuotaErrorDetails(details, quotaErrorDetailsFromParsedValue(record[key], depth + 1))
    if (details.message) {
      break
    }
  }
  if (!details.message) {
    for (const key of ['message', 'error_description', 'detail', 'description', 'title', 'reason']) {
      const value = record[key]
      if (typeof value !== 'string') {
        continue
      }
      const nested = quotaErrorDetailsFromParsedValue(value, depth + 1)
      details = mergeQuotaErrorDetails(details, nested.message === value.trim() ? { message: value.trim() } : nested)
      if (details.message) {
        break
      }
    }
  }
  for (const key of nestedKeys) {
    if (record[key] === undefined) {
      continue
    }
    details = mergeQuotaErrorDetails(details, quotaErrorDetailsFromParsedValue(record[key], depth + 1))
    if (details.code && details.message) {
      break
    }
  }
  return details
}

function isPreferredNestedQuotaErrorValue(key: string, value: unknown): boolean {
  if (value === undefined || value === null) {
    return false
  }
  if (typeof value !== 'string') {
    return typeof value === 'object'
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }
  if (['body', 'body_text', 'bodyText', 'response', 'data', 'payload'].includes(key)) {
    return true
  }
  return isStructuredQuotaErrorValue(trimmed) || Boolean(splitHTTPStatus(trimmed).code)
}

function isStructuredQuotaErrorValue(value: string): boolean {
  const trimmed = value.trim()
  return ['{', '[', '"'].includes(trimmed[0] ?? '')
}

function quotaHTTPStatusCodeFromRecord(record: Record<string, unknown>): string | undefined {
  for (const key of ['http_status_code', 'status_code', 'statusCode', 'status', 'code']) {
    const code = quotaHTTPStatusCode(record[key])
    if (code) {
      return code
    }
  }
  return undefined
}

function quotaHTTPStatusCode(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
    return String(value)
  }
  if (typeof value !== 'string') {
    return undefined
  }
  const match = value.trim().match(/^(?:HTTP\s+)?(\d{3})(?:\D|$)/i)
  if (!match) {
    return undefined
  }
  const status = Number(match[1])
  if (status < 100 || status > 599) {
    return undefined
  }
  return match[1]
}

function mergeQuotaErrorDetails(...items: QuotaErrorDetails[]): QuotaErrorDetails {
  return items.reduce<QuotaErrorDetails>((current, item) => ({
    code: current.code || item.code,
    message: current.message || item.message,
  }), {})
}

function truncateQuotaErrorMessage(value: string): string {
  if (value.length <= QUOTA_ERROR_MESSAGE_MAX_LENGTH) {
    return value
  }
  return `${value.slice(0, QUOTA_ERROR_MESSAGE_MAX_LENGTH).trimEnd()}...`
}

export function formatQuotaResetLabel(resetAt: string): string {
  const resetTime = new Date(resetAt)
  const resetMs = resetTime.getTime()
  if (!Number.isFinite(resetMs)) {
    return ''
  }
  const month = String(resetTime.getMonth() + 1).padStart(2, '0')
  const day = String(resetTime.getDate()).padStart(2, '0')
  const hour = String(resetTime.getHours()).padStart(2, '0')
  const minute = String(resetTime.getMinutes()).padStart(2, '0')
  return `${month}/${day} ${hour}:${minute}`
}

export function formatQuotaResetDuration(resetAt: string): string {
  const resetMs = new Date(resetAt).getTime()
  if (!Number.isFinite(resetMs)) {
    return ''
  }
  const remainingMinutes = Math.max(0, Math.ceil((resetMs - Date.now()) / 60_000))
  const days = Math.floor(remainingMinutes / 1_440)
  const hours = Math.floor((remainingMinutes % 1_440) / 60)
  const minutes = remainingMinutes % 60
  return days > 0 ? `${days}d${hours}h${minutes}m` : `${hours}h${minutes}m`
}

export function formatQuotaWindowUsageAriaLabel(t: Translate, windowUsage: NonNullable<DisplayQuota['windowUsage']>): string {
  return t('usage_stats.credentials_quota_window_usage_aria', {
    tokens: windowUsage.tokens,
    cost: windowUsage.cost,
  })
}

export function formatQuotaBillingUsageAriaLabel(t: Translate, billingUsage: NonNullable<DisplayQuota['billingUsage']>): string {
  return t('usage_stats.credentials_quota_billing_usage_aria', {
    used: billingUsage.used ?? '-',
    limit: billingUsage.limit ?? '-',
    remaining: billingUsage.remaining ?? '-',
  })
}

function QuotaBar({ quota, quotaUsageMode }: { quota: DisplayQuota; quotaUsageMode: QuotaUsageMode }) {
  const { t } = useTranslation()
  // 条宽使用剩余额度百分比，颜色跟随剩余风险状态从绿到黄到红。
  const percent = quota.barPercent ?? 0
  const width = `${Math.max(0, Math.min(100, percent))}%`
  const percentLabel = quota.barPercent === null ? '' : `${Math.round(quota.barPercent)}%`
  const resetLabel = quota.resetText ? formatQuotaResetLabel(quota.resetText) : ''
  const resetDuration = quota.resetText ? formatQuotaResetDuration(quota.resetText) : ''
  const billingUsage = quota.billingUsage
  const windowUsage = billingUsage ? undefined : quotaWindowUsageForMode(quota, quotaUsageMode)

  return (
    <div className={styles.credentialQuotaBarBlock}>
      <div className={styles.credentialQuotaBarHeader}>
        <span className={styles.credentialQuotaLabelGroup}>
          <span>{quota.label}</span>
        </span>
        {(resetDuration || percentLabel) && (
          <span className={styles.credentialQuotaValueGroup}>
            {resetDuration && <span className={styles.credentialQuotaResetDuration}>{resetDuration}</span>}
            {percentLabel && <strong>{percentLabel}</strong>}
          </span>
        )}
      </div>
      <div className={styles.credentialQuotaTrack}>
        <span className={`${styles.credentialQuotaFill} ${credentialToneClassName('credentialQuotaFill', quota.status)}`.trim()} style={{ width }} />
      </div>
      <div className={styles.credentialQuotaMeta}>
        {billingUsage && (
          <strong className={styles.credentialQuotaWindowUsage} aria-label={formatQuotaBillingUsageAriaLabel(t, billingUsage)}>
            <span className={styles.credentialQuotaUsageMetric}>
              <img src={quotaCostIcon} alt="" aria-hidden="true" />
              <span>{formatQuotaBillingUsageText(billingUsage)}</span>
            </span>
          </strong>
        )}
        {windowUsage && (
          <strong className={styles.credentialQuotaWindowUsage} aria-label={formatQuotaWindowUsageAriaLabel(t, windowUsage)}>
            <span className={styles.credentialQuotaUsageMetric}>
              <img src={quotaTokenIcon} alt="" aria-hidden="true" />
              <span>{windowUsage.tokens}</span>
            </span>
            <span className={styles.credentialQuotaUsageMetric}>
              <img src={quotaCostIcon} alt="" aria-hidden="true" />
              <span>{windowUsage.cost}</span>
            </span>
          </strong>
        )}
        {resetLabel && <span>{resetLabel}</span>}
      </div>
    </div>
  )
}

function formatQuotaBillingUsageText(billingUsage: NonNullable<DisplayQuota['billingUsage']>): string {
  if (billingUsage.used && billingUsage.limit) {
    return `${billingUsage.used} / ${billingUsage.limit}`
  }
  return billingUsage.used ?? billingUsage.remaining ?? billingUsage.limit ?? ''
}

function quotaWindowUsageForMode(quota: DisplayQuota, mode: QuotaUsageMode): DisplayQuota['windowUsage'] {
  if (mode === 'estimated' && quota.windowUsageEstimate) {
    return quota.windowUsageEstimate
  }
  return quota.windowUsage
}

function AuthFileLayoutModeSwitch({ mode, onChange }: { mode: 'list' | 'card'; onChange: (mode: 'list' | 'card') => void }) {
  return (
    <div className={styles.credentialDisplayModeControl}>
      <div className={styles.credentialDisplayModeSwitcher} role="group" aria-label="布局模式">
        <span className={`${styles.credentialDisplayModeThumb} ${mode === 'card' ? styles.credentialDisplayModeThumbHealth : ''}`.trim()} aria-hidden="true" />
        <button
          type="button"
          className={mode === 'list' ? styles.credentialDisplayModeButtonActive : undefined}
          onClick={() => onChange('list')}
          aria-pressed={mode === 'list'}
          title="列表视图"
        >
          <IconLayoutList size={12} />
          <span>列表</span>
        </button>
        <button
          type="button"
          className={mode === 'card' ? styles.credentialDisplayModeButtonActive : undefined}
          onClick={() => onChange('card')}
          aria-pressed={mode === 'card'}
          title="卡片视图"
        >
          <IconLayoutGrid size={12} />
          <span>卡片</span>
        </button>
      </div>
    </div>
  )
}
