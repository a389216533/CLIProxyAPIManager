import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { CpaApiKeyManagerCard } from '@/components/usage';
import type { CpaRuntimeStatusResponse, CpaUpdateEvent, CpaApiKeySettingsItem } from '@/lib/types';
import styles from '../UsagePage.module.scss';

interface UsageCpaManagerTabProps {
  cpaRuntimeError: string;
  cpaRuntime: CpaRuntimeStatusResponse | null;
  cpaRuntimeLoading: boolean;
  loadCpaRuntime: () => Promise<void>;
  cpaActionLoading: string;
  runCpaAction: (action: 'start' | 'stop' | 'restart' | 'update', runner: () => Promise<CpaRuntimeStatusResponse>) => Promise<void>;
  startCpaRuntime: () => Promise<CpaRuntimeStatusResponse>;
  restartCpaRuntime: () => Promise<CpaRuntimeStatusResponse>;
  stopCpaRuntime: () => Promise<CpaRuntimeStatusResponse>;
  updateCpaRuntime: () => Promise<CpaRuntimeStatusResponse>;
  cpaManagementURL: string;
  apiKeySettings: CpaApiKeySettingsItem[];
  apiKeySettingsLoading: boolean;
  apiKeySettingsCreating: boolean;
  apiKeySettingsSavingId: string | null;
  apiKeySettingsDeletingId: string | null;
  handleCreateApiKey: (keyAlias: string, apiKey: string) => Promise<void>;
  handleSaveApiKey: (id: string, keyAlias: string, apiKey: string) => Promise<void>;
  handleDeleteApiKey: (id: string) => Promise<void>;
  showTopNotice: (kind: 'success' | 'info' | 'error', message: string) => void;
  cpaEvents: CpaUpdateEvent[];
}

export function UsageCpaManagerTab({
  cpaRuntimeError,
  cpaRuntime,
  cpaRuntimeLoading,
  loadCpaRuntime,
  cpaActionLoading,
  runCpaAction,
  startCpaRuntime,
  restartCpaRuntime,
  stopCpaRuntime,
  updateCpaRuntime,
  cpaManagementURL,
  apiKeySettings,
  apiKeySettingsLoading,
  apiKeySettingsCreating,
  apiKeySettingsSavingId,
  apiKeySettingsDeletingId,
  handleCreateApiKey,
  handleSaveApiKey,
  handleDeleteApiKey,
  showTopNotice,
  cpaEvents,
}: UsageCpaManagerTabProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.cpaManagerSections}>
      {cpaRuntimeError && <div className={styles.errorBox}>{cpaRuntimeError}</div>}
      <section className={`card ${styles.cpaManagerCard}`}>
        <div className="card-header">
          <div>
            <h3>{t('usage_stats.cpa_manager_title')}</h3>
            <p>{t('usage_stats.cpa_manager_subtitle')}</p>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadCpaRuntime()}
            loading={cpaRuntimeLoading}
          >
            {t('usage_stats.refresh')}
          </Button>
        </div>
        <div className={styles.cpaManagerBody}>
          <div className={styles.cpaStatusGrid}>
            <div className={styles.cpaStatusItem}>
              <span>{t('usage_stats.cpa_status')}</span>
              <strong className={cpaRuntime?.running ? styles.cpaStatusRunning : styles.cpaStatusStopped}>
                {cpaRuntime?.running ? t('usage_stats.cpa_running') : t('usage_stats.cpa_stopped')}
              </strong>
            </div>
            <div className={styles.cpaStatusItem}>
              <span>{t('usage_stats.cpa_pid')}</span>
              <strong>{cpaRuntime?.pid ?? '-'}</strong>
            </div>
            <div className={styles.cpaStatusItem}>
              <span>{t('usage_stats.cpa_current_version')}</span>
              <strong>{cpaRuntime?.currentVersion || '-'}</strong>
            </div>
            <div className={styles.cpaStatusItem}>
              <span>{t('usage_stats.cpa_latest_version')}</span>
              <strong>{cpaRuntime?.latestVersion || '-'}</strong>
            </div>
            <div className={styles.cpaStatusItem}>
              <span>{t('usage_stats.cpa_started_at')}</span>
              <strong>{cpaRuntime?.startedAt ? new Date(cpaRuntime.startedAt).toLocaleString() : '-'}</strong>
            </div>
            <div className={styles.cpaStatusItem}>
              <span>{t('usage_stats.cpa_exited_at')}</span>
              <strong>{cpaRuntime?.exitedAt ? new Date(cpaRuntime.exitedAt).toLocaleString() : '-'}</strong>
            </div>
            <div className={styles.cpaStatusItem}>
              <span>{t('usage_stats.cpa_exit_code')}</span>
              <strong>{cpaRuntime?.exitCode ?? cpaRuntime?.exitSignal ?? '-'}</strong>
            </div>
          </div>
          {cpaRuntime?.updateAvailable && (
            <div className={styles.cpaUpdateBanner}>
              {t('usage_stats.cpa_update_available', { version: cpaRuntime.latestVersion })}
            </div>
          )}
          {cpaRuntime?.lastError?.message && (
            <div className={styles.cpaUpdateBanner}>
              {t('usage_stats.cpa_last_error')}：{cpaRuntime.lastError.message}
            </div>
          )}
          <div className={styles.cpaPathList}>
            <div>
              <span>{t('usage_stats.cpa_exe_path')}</span>
              <code>{cpaRuntime?.exePath || '-'}</code>
            </div>
            <div>
              <span>{t('usage_stats.cpa_config_path')}</span>
              <code>{cpaRuntime?.configPath || '-'}</code>
            </div>
          </div>
          <div className={styles.cpaActionRow}>
            <Button
              type="button"
              variant="primary"
              onClick={() => void runCpaAction('start', startCpaRuntime)}
              loading={cpaActionLoading === 'start'}
              disabled={cpaRuntime?.running === true || Boolean(cpaActionLoading)}
            >
              {t('usage_stats.cpa_start')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void runCpaAction('restart', restartCpaRuntime)}
              loading={cpaActionLoading === 'restart'}
              disabled={!cpaRuntime?.enabled || Boolean(cpaActionLoading)}
            >
              {t('usage_stats.cpa_restart')}
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void runCpaAction('stop', stopCpaRuntime)}
              loading={cpaActionLoading === 'stop'}
              disabled={cpaRuntime?.running !== true || Boolean(cpaActionLoading)}
            >
              {t('usage_stats.cpa_stop')}
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => void runCpaAction('update', updateCpaRuntime)}
              loading={cpaActionLoading === 'update'}
              disabled={!cpaRuntime?.enabled || Boolean(cpaActionLoading)}
            >
              {t('usage_stats.cpa_update')}
            </Button>
            <a
              className={`btn btn-secondary ${!cpaRuntime?.enabled ? styles.cpaManagementLinkDisabled : ''}`.trim()}
              href={cpaRuntime?.enabled ? cpaManagementURL || 'http://127.0.0.1:18218/management.html' : undefined}
              aria-disabled={!cpaRuntime?.enabled}
            >
              <span>{t('usage_stats.cpa_open_management_center')}</span>
            </a>
          </div>
        </div>
      </section>

      <CpaApiKeyManagerCard
        apiKeys={apiKeySettings}
        loading={apiKeySettingsLoading}
        creating={apiKeySettingsCreating}
        savingId={apiKeySettingsSavingId}
        deletingId={apiKeySettingsDeletingId}
        onCreate={handleCreateApiKey}
        onSave={handleSaveApiKey}
        onDelete={handleDeleteApiKey}
        onNotice={showTopNotice}
      />

      <section className={`card ${styles.cpaManagerCard}`}>
        <div className="card-header">
          <div>
            <h3>{t('usage_stats.cpa_runtime_logs')}</h3>
            <p>{t('usage_stats.cpa_runtime_logs_hint')}</p>
          </div>
        </div>
        <div className={styles.cpaEventList}>
          {!cpaRuntime?.recentLogs?.length ? (
            <span className={styles.cpaEventEmpty}>{t('usage_stats.no_data')}</span>
          ) : (
            cpaRuntime.recentLogs.slice().reverse().map((log, index) => (
              <div key={`${log.time}-${index}`} className={`${styles.cpaEventItem} ${log.stream === 'stderr' ? styles.cpaEventError : ''}`.trim()}>
                <span>{new Date(log.time).toLocaleString()}</span>
                <strong>{log.stream === 'stderr' ? '错误输出' : '标准输出'}</strong>
                <p>{log.message}</p>
              </div>
            ))
          )}
        </div>
      </section>

      <section className={`card ${styles.cpaManagerCard}`}>
        <div className="card-header">
          <div>
            <h3>{t('usage_stats.cpa_update_events')}</h3>
            <p>{t('usage_stats.cpa_update_events_hint')}</p>
          </div>
        </div>
        <div className={styles.cpaEventList}>
          {cpaEvents.length === 0 ? (
            <span className={styles.cpaEventEmpty}>{t('usage_stats.no_data')}</span>
          ) : (
            cpaEvents.slice().reverse().map((event, index) => (
              <div key={`${event.time}-${index}`} className={`${styles.cpaEventItem} ${event.error ? styles.cpaEventError : ''}`.trim()}>
                <span>{new Date(event.time).toLocaleString()}</span>
                <strong>{event.stage}</strong>
                <p>{event.message}</p>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
