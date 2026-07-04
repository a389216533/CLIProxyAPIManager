import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconEye, IconEyeOff, IconTrash2 } from '@/components/ui/icons';
import type { CpaApiKeySettingsItem } from '@/lib/types';
import { scheduleEffectTask } from '@/utils/effects';
import styles from '@/pages/UsagePage.module.scss';

interface CpaApiKeyDraft {
  keyAlias: string;
  apiKey: string;
}

type ClipboardWriter = Pick<Clipboard, 'writeText'>;
type CopyTextArea = {
  value: string;
  style: {
    position?: string;
    opacity?: string;
    top?: string;
  };
  setAttribute: (name: string, value: string) => void;
  select: () => void;
};
type CopyDocument = {
  body: {
    appendChild: (node: CopyTextArea) => unknown;
    removeChild: (node: CopyTextArea) => unknown;
  };
  createElement: (tagName: 'textarea') => CopyTextArea;
  execCommand: (command: string) => boolean;
};
type CopyContext = {
  clipboard?: ClipboardWriter;
  document?: CopyDocument;
};

export interface CpaApiKeyManagerCardProps {
  apiKeys: CpaApiKeySettingsItem[];
  loading?: boolean;
  creating?: boolean;
  savingId?: string | null;
  deletingId?: string | null;
  onCreate: (keyAlias: string, apiKey: string) => void | Promise<void>;
  onSave: (id: string, keyAlias: string, apiKey: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onNotice?: (kind: 'success' | 'info' | 'error', message: string) => void;
}

const emptyDraft: CpaApiKeyDraft = { keyAlias: '', apiKey: '' };

export function getCpaApiKeyManagerCanSave(draft: CpaApiKeyDraft) {
  return draft.keyAlias.trim() !== '' && draft.apiKey.trim() !== '';
}

export async function copyApiKeyToClipboard(apiKey: string, context: CopyContext = {}) {
  if (!apiKey) {
    throw new Error('API key is required');
  }

  const clipboard = context.clipboard ?? (typeof navigator !== 'undefined' ? navigator.clipboard : undefined);
  let clipboardError: unknown;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(apiKey);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  const documentRef = context.document ?? (typeof document !== 'undefined' ? document as unknown as CopyDocument : undefined);
  if (!documentRef) {
    throw clipboardError instanceof Error ? clipboardError : new Error('Clipboard API is unavailable');
  }

  const textarea = documentRef.createElement('textarea');
  textarea.value = apiKey;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.opacity = '0';
  documentRef.body.appendChild(textarea);
  textarea.select();
  try {
    const copied = documentRef.execCommand('copy');
    if (!copied) {
      throw new Error('copy command failed');
    }
  } finally {
    documentRef.body.removeChild(textarea);
  }
}

export function CpaApiKeyManagerCard({
  apiKeys,
  loading = false,
  creating = false,
  savingId = null,
  deletingId = null,
  onCreate,
  onSave,
  onDelete,
  onNotice,
}: CpaApiKeyManagerCardProps) {
  const { t } = useTranslation();
  const [showFullApiKeys, setShowFullApiKeys] = useState(false);
  const [newDraft, setNewDraft] = useState<CpaApiKeyDraft>(emptyDraft);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialDrafts = useMemo(
    () => Object.fromEntries(apiKeys.map((item) => [item.id, { keyAlias: item.keyAlias, apiKey: item.apiKey }])),
    [apiKeys],
  );
  const [drafts, setDrafts] = useState<Record<string, CpaApiKeyDraft>>(initialDrafts);

  useEffect(() => {
    return scheduleEffectTask(() => {
      setDrafts(initialDrafts);
    });
  }, [initialDrafts]);

  useEffect(() => () => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    const draft = { keyAlias: newDraft.keyAlias.trim(), apiKey: newDraft.apiKey.trim() };
    if (!getCpaApiKeyManagerCanSave(draft)) {
      return;
    }
    try {
      await onCreate(draft.keyAlias, draft.apiKey);
      setNewDraft(emptyDraft);
    } catch {
      // The page-level handler owns the visible error state.
    }
  }, [newDraft.apiKey, newDraft.keyAlias, onCreate]);

  const handleCopyApiKey = useCallback(async (item: CpaApiKeySettingsItem) => {
    try {
      await copyApiKeyToClipboard(item.apiKey);
      setCopiedId(item.id);
      onNotice?.('success', t('usage_stats.api_key_settings_copy_success'));
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
      copyResetTimerRef.current = setTimeout(() => setCopiedId(null), 1600);
    } catch {
      setCopiedId(null);
      onNotice?.('error', t('usage_stats.api_key_settings_copy_failed'));
    }
  }, [onNotice, t]);

  const canCreate = getCpaApiKeyManagerCanSave(newDraft);
  const keyInputType = showFullApiKeys ? 'text' : 'password';
  const toggleLabel = showFullApiKeys ? t('usage_stats.api_key_settings_hide_full') : t('usage_stats.api_key_settings_show_full');

  return (
    <Card
      title={
        <div className={styles.sectionTitleBlock}>
          <div className={styles.apiKeySettingsTitleRow}>
            <h3 className={styles.sectionTitle}>{t('usage_stats.cpa_api_key_manager_title')}</h3>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={`${styles.apiKeyVisibilityToggle} ${showFullApiKeys ? styles.apiKeyVisibilityToggleActive : ''}`.trim()}
              onClick={() => setShowFullApiKeys((current) => !current)}
              aria-label={toggleLabel}
              aria-pressed={showFullApiKeys}
              title={toggleLabel}
            >
              {showFullApiKeys ? <IconEye size={16} /> : <IconEyeOff size={16} />}
            </Button>
          </div>
          <p className={styles.sectionSubtitle}>{t('usage_stats.cpa_api_key_manager_subtitle')}</p>
        </div>
      }
      className={`${styles.cpaManagerCard} ${styles.cpaApiKeyManagerCard}`}
    >
      <div className={styles.cpaApiKeyManagerBody}>
        <div className={styles.cpaApiKeyCreateRow}>
          <Input
            value={newDraft.keyAlias}
            onChange={(event) => setNewDraft((current) => ({ ...current, keyAlias: event.target.value }))}
            label={t('usage_stats.cpa_api_key_name')}
            placeholder={t('usage_stats.cpa_api_key_name_placeholder')}
            disabled={creating}
          />
          <Input
            value={newDraft.apiKey}
            onChange={(event) => setNewDraft((current) => ({ ...current, apiKey: event.target.value }))}
            type={keyInputType}
            label={t('usage_stats.cpa_api_key_value')}
            placeholder={t('usage_stats.cpa_api_key_value_placeholder')}
            disabled={creating}
            autoComplete="off"
          />
          <Button type="button" variant="primary" onClick={() => void handleCreate()} loading={creating} disabled={!canCreate}>
            {t('usage_stats.cpa_api_key_create')}
          </Button>
        </div>

        {loading && apiKeys.length === 0 ? (
          <div className={styles.hint}>{t('common.loading')}</div>
        ) : apiKeys.length === 0 ? (
          <div className={styles.hint}>{t('usage_stats.cpa_api_key_manager_empty')}</div>
        ) : (
          <div className={styles.cpaApiKeyManagerList}>
            <div className={styles.cpaApiKeyListHeader}>
              <span>{t('usage_stats.cpa_api_key_name')}</span>
              <span>{t('usage_stats.cpa_api_key_value')}</span>
              <span style={{ textAlign: 'right', paddingRight: '12px' }}>{t('common.actions') || '操作'}</span>
            </div>
            {apiKeys.map((item) => {
              const draft = drafts[item.id] ?? { keyAlias: item.keyAlias, apiKey: item.apiKey };
              const busy = savingId === item.id || deletingId === item.id;
              const canSave = getCpaApiKeyManagerCanSave(draft);
              const copyLabel = copiedId === item.id ? t('usage_stats.api_key_settings_copied') : t('usage_stats.api_key_settings_copy');
              return (
                <div key={item.id} className={styles.cpaApiKeyManagerItem}>
                  <div className={styles.cpaApiKeyColName}>
                    <Input
                      value={draft.keyAlias}
                      onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, keyAlias: event.target.value } }))}
                      label={t('usage_stats.cpa_api_key_name')}
                      disabled={busy}
                    />
                  </div>
                  <div className={styles.cpaApiKeyColKey}>
                    {showFullApiKeys ? (
                      <Input
                        value={draft.apiKey}
                        onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, apiKey: event.target.value } }))}
                        type="text"
                        label={t('usage_stats.cpa_api_key_value')}
                        disabled={busy}
                        autoComplete="off"
                      />
                    ) : (
                      <div className={styles.cpaApiKeyMaskedField}>
                        <span>{t('usage_stats.cpa_api_key_value')}</span>
                        <strong title={item.displayKey}>{item.displayKey}</strong>
                      </div>
                    )}
                  </div>
                  <div className={styles.cpaApiKeyManagerActions}>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleCopyApiKey(item)}
                      disabled={!item.apiKey || busy}
                    >
                      {copyLabel}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => void onSave(item.id, draft.keyAlias, draft.apiKey)}
                      loading={savingId === item.id}
                      disabled={!canSave || deletingId === item.id}
                    >
                      {t('common.save')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        if (typeof window === 'undefined' || window.confirm(t('usage_stats.cpa_api_key_delete_confirm'))) {
                          void onDelete(item.id);
                        }
                      }}
                      loading={deletingId === item.id}
                      disabled={savingId === item.id}
                      title={t('usage_stats.cpa_api_key_delete')}
                    >
                      <IconTrash2 size={13} />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
}
