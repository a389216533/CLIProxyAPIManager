import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { IconEye, IconEyeOff, IconPencil, IconTrash2 } from '@/components/ui/icons';
import type { CpaApiKeySettingsItem } from '@/lib/types';
import { CredentialSectionShell } from '@/components/usage/credentials/CredentialSectionShell';
import styles from '@/pages/UsagePage.module.scss';
import { CpaApiKeyDeleteDialog, CpaApiKeyEditorDialog, type CpaApiKeyDraft } from './CpaApiKeyManagerDialogs';

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
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CpaApiKeyDraft>(emptyDraft);
  const [editTarget, setEditTarget] = useState<CpaApiKeySettingsItem | null>(null);
  const [editDraft, setEditDraft] = useState<CpaApiKeyDraft>(emptyDraft);
  const [deleteTarget, setDeleteTarget] = useState<CpaApiKeySettingsItem | null>(null);
  const [formError, setFormError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [visibleApiKeyIds, setVisibleApiKeyIds] = useState<Set<string>>(() => new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
  }, []);

  const handleCreate = useCallback(async () => {
    const draft = { keyAlias: createDraft.keyAlias.trim(), apiKey: createDraft.apiKey.trim() };
    if (!getCpaApiKeyManagerCanSave(draft)) {
      setFormError(t('usage_stats.cpa_api_key_required'));
      return;
    }
    setFormError('');
    try {
      await onCreate(draft.keyAlias, draft.apiKey);
      setCreateDraft(emptyDraft);
      setCreateOpen(false);
    } catch {
      setFormError(t('usage_stats.cpa_api_key_create_failed'));
    }
  }, [createDraft.apiKey, createDraft.keyAlias, onCreate, t]);

  const handleSave = useCallback(async () => {
    if (!editTarget) return;
    const draft = { keyAlias: editDraft.keyAlias.trim(), apiKey: editDraft.apiKey.trim() };
    if (!getCpaApiKeyManagerCanSave(draft)) {
      setFormError(t('usage_stats.cpa_api_key_required'));
      return;
    }
    setFormError('');
    try {
      await onSave(editTarget.id, draft.keyAlias, draft.apiKey);
      setEditDraft(emptyDraft);
      setEditTarget(null);
      setVisibleApiKeyIds((current) => {
        const next = new Set(current);
        next.delete(editTarget.id);
        return next;
      });
    } catch {
      setFormError(t('usage_stats.cpa_api_key_save_failed'));
    }
  }, [editDraft.apiKey, editDraft.keyAlias, editTarget, onSave, t]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleteError('');
    try {
      await onDelete(deleteTarget.id);
      setVisibleApiKeyIds((current) => {
        const next = new Set(current);
        next.delete(deleteTarget.id);
        return next;
      });
      setDeleteTarget(null);
    } catch {
      setDeleteError(t('usage_stats.cpa_api_key_delete_failed'));
    }
  }, [deleteTarget, onDelete, t]);

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

  return (
    <>
      <CredentialSectionShell
        title={t('usage_stats.cpa_api_key_manager_title')}
        subtitle={t('usage_stats.cpa_api_key_manager_subtitle')}
        countLabel={t('usage_stats.credentials_count', { count: apiKeys.length })}
        actions={(
          <Button type="button" variant="primary" className={styles.cpaApiKeyHeaderCreate} onClick={() => { setFormError(''); setCreateOpen(true); }} disabled={creating}>
            {t('usage_stats.cpa_api_key_create_action')}
          </Button>
        )}
      >
        {loading && apiKeys.length === 0 ? <div className={styles.cpaApiKeyEmptyState}>{t('common.loading')}</div> : null}
        {!loading && apiKeys.length === 0 ? <div className={styles.cpaApiKeyEmptyState}>{t('usage_stats.cpa_api_key_manager_empty')}</div> : null}
        {apiKeys.map((item) => {
          const busy = savingId === item.id || deletingId === item.id;
          const visible = visibleApiKeyIds.has(item.id);
          const visibilityLabel = visible ? t('usage_stats.cpa_api_key_hide_value') : t('usage_stats.cpa_api_key_show_value');
          const copyLabel = copiedId === item.id ? t('usage_stats.api_key_settings_copied') : t('usage_stats.api_key_settings_copy');
          return (
            <article key={item.id} className={styles.cpaApiKeyRow}>
              <div className={styles.cpaApiKeyIdentity}>
                <span className={styles.cpaApiKeyFieldLabel}>{t('usage_stats.cpa_api_key_name')}</span>
                <strong>{item.keyAlias}</strong>
              </div>
              <div className={styles.cpaApiKeySecret}>
                <span className={styles.cpaApiKeyFieldLabel}>{t('usage_stats.cpa_api_key_value')}</span>
                <code>{visible ? item.apiKey : item.displayKey}</code>
              </div>
              <div className={styles.cpaApiKeyActions} role="group" aria-label={t('common.actions')}>
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleCopyApiKey(item)} disabled={!item.apiKey || busy}>
                  {copyLabel}
                </Button>
                <Button type="button" variant="ghost" size="sm" className={styles.cpaApiKeyIconAction} onClick={() => setVisibleApiKeyIds((current) => {
                  const next = new Set(current);
                  if (visible) next.delete(item.id); else next.add(item.id);
                  return next;
                })} disabled={busy} aria-label={visibilityLabel} aria-pressed={visible} title={visibilityLabel}>
                  {visible ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                </Button>
                <Button type="button" variant="ghost" size="sm" className={styles.cpaApiKeyIconAction} onClick={() => {
                  setFormError('');
                  setEditDraft({ keyAlias: item.keyAlias, apiKey: item.apiKey });
                  setEditTarget(item);
                }} disabled={busy} aria-label={t('common.edit')} title={t('common.edit')}>
                  <IconPencil size={15} />
                </Button>
                <Button type="button" variant="danger" size="sm" className={styles.cpaApiKeyIconAction} onClick={() => { setDeleteError(''); setDeleteTarget(item); }} disabled={busy} aria-label={t('common.delete')} title={t('common.delete')}>
                  <IconTrash2 size={15} />
                </Button>
              </div>
            </article>
          );
        })}
      </CredentialSectionShell>
      <CpaApiKeyEditorDialog key={createOpen ? 'create-open' : 'create-closed'} open={createOpen} title={t('usage_stats.cpa_api_key_create_title')} draft={createDraft} error={formError} submitting={creating} submitLabel={t('usage_stats.cpa_api_key_create')} cancelLabel={t('common.cancel')} nameLabel={t('usage_stats.cpa_api_key_name')} namePlaceholder={t('usage_stats.cpa_api_key_name_placeholder')} keyLabel={t('usage_stats.cpa_api_key_value')} keyPlaceholder={t('usage_stats.cpa_api_key_value_placeholder')} showKeyLabel={t('usage_stats.cpa_api_key_show_value')} hideKeyLabel={t('usage_stats.cpa_api_key_hide_value')} onDraftChange={setCreateDraft} onClose={() => { if (creating) return; setCreateDraft(emptyDraft); setFormError(''); setCreateOpen(false); }} onSubmit={() => void handleCreate()} />
      <CpaApiKeyEditorDialog key={editTarget?.id ?? 'edit-closed'} open={editTarget !== null} title={t('usage_stats.cpa_api_key_edit_title')} draft={editDraft} error={formError} submitting={savingId === editTarget?.id} submitLabel={t('common.save')} cancelLabel={t('common.cancel')} nameLabel={t('usage_stats.cpa_api_key_name')} namePlaceholder={t('usage_stats.cpa_api_key_name_placeholder')} keyLabel={t('usage_stats.cpa_api_key_value')} keyPlaceholder={t('usage_stats.cpa_api_key_value_placeholder')} showKeyLabel={t('usage_stats.cpa_api_key_show_value')} hideKeyLabel={t('usage_stats.cpa_api_key_hide_value')} onDraftChange={setEditDraft} onClose={() => { if (savingId === editTarget?.id) return; setEditDraft(emptyDraft); setEditTarget(null); setFormError(''); }} onSubmit={() => void handleSave()} />
      <CpaApiKeyDeleteDialog target={deleteTarget} error={deleteError} deleting={deletingId === deleteTarget?.id} title={t('usage_stats.cpa_api_key_delete_title')} body={t('usage_stats.cpa_api_key_delete_dialog_body')} cancelLabel={t('common.cancel')} deleteLabel={t('common.delete')} onClose={() => { if (deletingId !== deleteTarget?.id) setDeleteTarget(null); }} onConfirm={() => void handleDelete()} />
    </>
  );
}
