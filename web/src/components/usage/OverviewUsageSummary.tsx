import { type CSSProperties, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { AnalysisCompositionItem, AnalysisResponse } from '@/lib/types';
import { formatCompactNumber, formatUsd } from '@/utils/usage';
import styles from './OverviewUsageSummary.module.scss';

const SUMMARY_COLORS = ['#3b82f6', '#10b981', '#06b6d4', '#8b5cf6', '#f59e0b', '#ef4444', '#14b8a6', '#64748b'];

const toNumber = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatPercent = (value: number) => `${value.toFixed(1)}%`;

const getTopItems = (items: AnalysisCompositionItem[] | undefined, limit: number) => (
  (items ?? [])
    .filter((item) => toNumber(item.total_tokens) > 0 || toNumber(item.requests) > 0)
    .slice()
    .sort((a, b) => toNumber(b.total_tokens) - toNumber(a.total_tokens))
    .slice(0, limit)
);

const buildDonutBackground = (items: AnalysisCompositionItem[]) => {
  const total = items.reduce((sum, item) => sum + Math.max(toNumber(item.total_tokens), 0), 0);
  if (total <= 0) {
    return 'conic-gradient(var(--border-color) 0 100%)';
  }

  let cursor = 0;
  const segments = items.map((item, index) => {
    const value = Math.max(toNumber(item.total_tokens), 0);
    const start = cursor;
    cursor += (value / total) * 100;
    return `${SUMMARY_COLORS[index % SUMMARY_COLORS.length]} ${start.toFixed(3)}% ${cursor.toFixed(3)}%`;
  });

  return `conic-gradient(${segments.join(', ')})`;
};

function OverviewSummaryTable({ items, nameLabel }: { items: AnalysisCompositionItem[]; nameLabel: string }) {
  const { t } = useTranslation();

  return (
    <div className={styles.tableWrap}>
      <table className={styles.summaryTable}>
        <thead>
          <tr>
            <th>{nameLabel}</th>
            <th>{t('usage_stats.requests_count')}</th>
            <th>{t('usage_stats.total_tokens')}</th>
            <th>{t('usage_stats.total_cost')}</th>
            <th>{t('usage_stats.analysis_cost_share')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.key || `${item.label}-${index}`}>
              <td>
                <span className={styles.legendDot} style={{ backgroundColor: SUMMARY_COLORS[index % SUMMARY_COLORS.length] }} />
                <span className={styles.itemName} title={item.label}>{item.label}</span>
              </td>
              <td>{formatCompactNumber(toNumber(item.requests))}</td>
              <td>{formatCompactNumber(toNumber(item.total_tokens))}</td>
              <td className={styles.costCell}>{formatUsd(toNumber(item.cost_usd))}</td>
              <td className={styles.percentCell}>{formatPercent(toNumber(item.percent))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function OverviewUsageSummary({ analysis, loading }: { analysis: AnalysisResponse | null; loading: boolean }) {
  const { t } = useTranslation();
  const modelItems = useMemo(() => getTopItems(analysis?.model_composition, 5), [analysis]);
  const apiKeyItems = useMemo(() => getTopItems(analysis?.api_key_composition, 8), [analysis]);
  const modelRequests = useMemo(() => (analysis?.model_composition ?? []).reduce((sum, item) => sum + toNumber(item.requests), 0), [analysis]);
  const donutStyle = useMemo(() => ({
    '--overview-donut-background': buildDonutBackground(modelItems),
  }) as CSSProperties, [modelItems]);

  return (
    <div className={styles.overviewSummaryGrid}>
      <section className={styles.summaryCard}>
        <div className={styles.summaryHeader}>
          <h3>{t('usage_stats.overview_model_distribution_title')}</h3>
          <span>{t('usage_stats.overview_default_tokens_sort')}</span>
        </div>
        {loading ? (
          <div className={styles.emptyState}>{t('common.loading')}</div>
        ) : modelItems.length === 0 ? (
          <div className={styles.emptyState}>{t('usage_stats.no_data')}</div>
        ) : (
          <div className={styles.modelSummaryLayout}>
            <div className={styles.donutWrap}>
              <div className={styles.donut} style={donutStyle}>
                <div className={styles.donutCenter}>
                  <strong>{formatCompactNumber(modelRequests)}</strong>
                  <span>{t('usage_stats.requests_count')}</span>
                </div>
              </div>
            </div>
            <OverviewSummaryTable items={modelItems} nameLabel={t('usage_stats.analysis_composition_name')} />
          </div>
        )}
      </section>

      <section className={styles.summaryCard}>
        <div className={styles.summaryHeader}>
          <h3>{t('usage_stats.overview_account_ranking_title')}</h3>
          <span>{t('usage_stats.overview_default_tokens_sort')}</span>
        </div>
        {loading ? (
          <div className={styles.emptyState}>{t('common.loading')}</div>
        ) : apiKeyItems.length === 0 ? (
          <div className={styles.emptyState}>{t('usage_stats.no_data')}</div>
        ) : (
          <OverviewSummaryTable items={apiKeyItems} nameLabel={t('usage_stats.overview_account_column')} />
        )}
      </section>
    </div>
  );
}
