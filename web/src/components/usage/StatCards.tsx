import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  IconDiamond,
  IconDollarSign,
  IconPercent,
  IconSatellite,
} from '@/components/ui/icons';
import {
  calculateCacheRate,
  formatCompactNumber,
  formatFixedTwoDecimals,
  formatUsd,
} from '@/utils/usage';
import type { UsageOverviewPayload, UsagePayload } from './hooks/useUsageData';
import type { OverviewRealtimeBlock } from '@/lib/types';
import styles from '@/pages/UsagePage.module.scss';

interface StatCardData {
  key: string;
  label: string;
  icon: ReactNode;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  value: string;
  meta?: ReactNode;
}

export interface StatCardsProps {
  usage: UsageOverviewPayload | null;
  realtime?: OverviewRealtimeBlock | null;
  loading: boolean;
}

interface StatCardMetrics {
  requestStats: { successRate: number | null };
  rateStats: { tokenCount: number; cacheRate: number | null };
  totalCost: number;
  costAvailable: boolean;
}

const safeNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const calculateSuccessRate = (usageSnapshot: UsagePayload | null): number | null => {
  const totalRequests = Math.max(safeNumber(usageSnapshot?.total_requests), 0);
  if (totalRequests <= 0) {
    return null;
  }
  return (Math.max(safeNumber(usageSnapshot?.success_count), 0) / totalRequests) * 100;
};

export function buildStatCardMetrics({
  usage,
}: {
  usage: UsageOverviewPayload | null;
}): StatCardMetrics {
  // overview 运行态和旧测试夹具的 snapshot 位置不同，这里统一后再计算请求成功率。
  const usageSnapshot = (usage?.usage ?? usage) as UsagePayload | null;
  const requestStats = { successRate: calculateSuccessRate(usageSnapshot) };

  if (!usage?.summary) {
    return {
      requestStats,
      rateStats: { tokenCount: 0, cacheRate: null },
      totalCost: 0,
      costAvailable: false,
    };
  }

  return {
    requestStats,
    rateStats: {
      tokenCount: usage.summary.token_count ?? 0,
      cacheRate: calculateCacheRate({
        inputTokens: usage.summary.input_tokens,
        cachedTokens: usage.summary.cached_tokens,
      }),
    },
    totalCost: usage.summary.total_cost ?? 0,
    costAvailable: usage.summary.cost_available === true,
  };
}

export function StatCards({ usage, loading }: StatCardsProps) {
  const { t } = useTranslation();
  const usageSnapshot = usage?.usage ?? null;
  const { requestStats, rateStats, totalCost, costAvailable } = useMemo(
    () => buildStatCardMetrics({ usage }),
    [usage]
  );

  const statsCards: StatCardData[] = [
    {
      key: 'requests',
      label: t('usage_stats.stat_total_requests'),
      icon: <IconSatellite size={16} />,
      accent: '#3b82f6',
      accentSoft: 'rgba(59, 130, 246, 0.18)',
      accentBorder: 'rgba(59, 130, 246, 0.34)',
      value: loading ? '-' : (usageSnapshot?.total_requests ?? 0).toLocaleString(),
    },
    {
      key: 'total-tokens',
      label: t('usage_stats.total_tokens'),
      icon: <IconDiamond size={16} />,
      accent: '#8b5cf6',
      accentSoft: 'rgba(139, 92, 246, 0.18)',
      accentBorder: 'rgba(139, 92, 246, 0.35)',
      value: loading ? '-' : formatCompactNumber(usageSnapshot?.total_tokens ?? rateStats.tokenCount),
      meta: (
        <span className={styles.statMetaItem}>
          {t('usage_stats.cache_rate')}: {loading || rateStats.cacheRate === null ? '-' : `${formatFixedTwoDecimals(rateStats.cacheRate)}%`}
        </span>
      ),
    },
    {
      key: 'cost',
      label: t('usage_stats.stat_estimated_cost'),
      icon: <IconDollarSign size={16} />,
      accent: '#f59e0b',
      accentSoft: 'rgba(245, 158, 11, 0.18)',
      accentBorder: 'rgba(245, 158, 11, 0.32)',
      value: loading ? '-' : formatUsd(totalCost),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.total_tokens')}:{' '}
            {loading ? '-' : formatCompactNumber(usageSnapshot?.total_tokens ?? 0)}
          </span>
          {!costAvailable && (
            <span className={`${styles.statMetaItem} ${styles.statSubtle}`}>
              {t('usage_stats.cost_need_price')}
            </span>
          )}
        </>
      ),
    },
    {
      key: 'success-rate',
      label: t('usage_stats.stat_success_rate'),
      icon: <IconPercent size={16} />,
      accent: '#14b8a6',
      accentSoft: 'rgba(20, 184, 166, 0.18)',
      accentBorder: 'rgba(20, 184, 166, 0.34)',
      value: loading || requestStats.successRate === null ? '-' : `${formatFixedTwoDecimals(requestStats.successRate)}%`,
      meta: (
        <>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#10b981' }} />
            {t('usage_stats.success_requests')}: {loading ? '-' : (usageSnapshot?.success_count ?? 0)}
          </span>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#c65746' }} />
            {t('usage_stats.failed_requests')}: {loading ? '-' : (usageSnapshot?.failure_count ?? 0)}
          </span>
        </>
      ),
    },
  ];

  return (
    <div className={styles.statsGrid}>
      {statsCards.map((card) => (
        <div
          key={card.key}
          className={styles.statCard}
          style={
            {
              '--accent': card.accent,
              '--accent-soft': card.accentSoft,
              '--accent-border': card.accentBorder,
            } as CSSProperties
          }
        >
          <div className={styles.statCardHeader}>
            <div className={styles.statLabelGroup}>
              <span className={styles.statLabel}>{card.label}</span>
            </div>
            <span className={styles.statIconBadge}>{card.icon}</span>
          </div>
          <div className={styles.statValue}>{card.value}</div>
          {card.meta && <div className={styles.statMetaRow}>{card.meta}</div>}
        </div>
      ))}
    </div>
  );
}
