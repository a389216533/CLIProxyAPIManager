import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, fetchConfigDiagnostics, fetchConfigStatus } from '@/lib/api';
import { formatUserActionableError } from '@/lib/errorMessages';
import type { ConfigDiagnosticCheck, ConfigDiagnosticsResponse, ConfigStatusResponse } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { scheduleEffectTask } from '@/utils/effects';
import styles from '@/pages/UsagePage.module.scss';

export interface ConfigDiagnosticsPanelProps {
  refreshKey?: number;
  onAuthRequired?: () => void;
}

const CHECK_LEVEL_RANK: Record<ConfigDiagnosticCheck['level'], number> = {
  error: 0,
  warning: 1,
  info: 2,
};

export const sortConfigDiagnosticChecks = (checks: ConfigDiagnosticCheck[]) =>
  [...checks].sort((left, right) => {
    if (left.ok !== right.ok) return left.ok ? 1 : -1;
    const levelDiff = CHECK_LEVEL_RANK[left.level] - CHECK_LEVEL_RANK[right.level];
    return levelDiff === 0 ? left.code.localeCompare(right.code) : levelDiff;
  });

function getCheckStatusClass(check: ConfigDiagnosticCheck) {
  if (check.ok) return styles.configDiagnosticsCheckOk;
  if (check.level === 'error') return styles.configDiagnosticsCheckError;
  if (check.level === 'warning') return styles.configDiagnosticsCheckWarning;
  return styles.configDiagnosticsCheckInfo;
}

export function ConfigDiagnosticsPanel({ refreshKey = 0, onAuthRequired }: ConfigDiagnosticsPanelProps) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<ConfigStatusResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<ConfigDiagnosticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const requestControllerRef = useRef<AbortController | null>(null);

  const loadDiagnostics = useCallback(async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoading(true);
    setError('');

    try {
      const [nextStatus, nextDiagnostics] = await Promise.all([
        fetchConfigStatus(controller.signal),
        fetchConfigDiagnostics(controller.signal),
      ]);
      if (controller.signal.aborted) return;
      setStatus(nextStatus);
      setDiagnostics(nextDiagnostics);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 401) {
        onAuthRequired?.();
        return;
      }
      setError(formatUserActionableError(error, t('usage_stats.config_diagnostics_load_failed')));
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        setLoading(false);
      }
    }
  }, [onAuthRequired, t]);

  useEffect(() => {
    const cancelLoad = scheduleEffectTask(() => {
      void loadDiagnostics();
    });
    return () => {
      cancelLoad();
      requestControllerRef.current?.abort();
      requestControllerRef.current = null;
    };
  }, [loadDiagnostics, refreshKey]);

  const checks = sortConfigDiagnosticChecks(diagnostics?.checks ?? []);
  const failedChecks = checks.filter((check) => !check.ok).length;
  const passedChecks = checks.length - failedChecks;
  const effectiveStatus = diagnostics ?? status;

  return (
    <section className={`card ${styles.configDiagnosticsCard}`}>
      <div className="card-header">
        <div className={styles.sectionTitleBlock}>
          <h3 className={styles.sectionTitle}>{t('usage_stats.config_diagnostics_title')}</h3>
          <p className={styles.sectionSubtitle}>{t('usage_stats.config_diagnostics_subtitle')}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void loadDiagnostics()} loading={loading}>
          {t('usage_stats.refresh')}
        </Button>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.configDiagnosticsSummary}>
        <div className={styles.configDiagnosticsStatus}>
          <span>{t('usage_stats.config_diagnostics_status')}</span>
          <strong className={effectiveStatus?.ok ? styles.configDiagnosticsHealthy : styles.configDiagnosticsUnhealthy}>
            {effectiveStatus?.status || (loading ? t('common.loading') : '-')}
          </strong>
        </div>
        <div className={styles.configDiagnosticsStatus}>
          <span>{t('usage_stats.config_diagnostics_passed')}</span>
          <strong>{passedChecks}</strong>
        </div>
        <div className={styles.configDiagnosticsStatus}>
          <span>{t('usage_stats.config_diagnostics_failed')}</span>
          <strong>{failedChecks}</strong>
        </div>
      </div>

      <div className={styles.configDiagnosticsList}>
        {loading && checks.length === 0 ? (
          <div className={styles.hint}>{t('common.loading')}</div>
        ) : checks.length === 0 ? (
          <div className={styles.hint}>{t('usage_stats.config_diagnostics_empty')}</div>
        ) : (
          checks.map((check) => (
            <div key={check.code} className={`${styles.configDiagnosticsCheck} ${getCheckStatusClass(check)}`.trim()}>
              <div className={styles.configDiagnosticsCheckHead}>
                <code>{check.code}</code>
                <span>{check.ok ? t('usage_stats.config_diagnostics_check_ok') : t(`usage_stats.config_diagnostics_level_${check.level}`)}</span>
              </div>
              <p>{check.message}</p>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
