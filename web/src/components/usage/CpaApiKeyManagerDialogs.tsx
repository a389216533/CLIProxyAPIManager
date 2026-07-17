import { useId, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import type { CpaApiKeySettingsItem } from '@/lib/types';
import styles from '@/pages/UsagePage.module.scss';

export interface CpaApiKeyDraft {
  readonly keyAlias: string;
  readonly apiKey: string;
}

interface CpaApiKeyEditorDialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly draft: CpaApiKeyDraft;
  readonly error: string;
  readonly submitting: boolean;
  readonly submitLabel: string;
  readonly cancelLabel: string;
  readonly nameLabel: string;
  readonly namePlaceholder: string;
  readonly keyLabel: string;
  readonly keyPlaceholder: string;
  readonly showKeyLabel: string;
  readonly hideKeyLabel: string;
  readonly onDraftChange: (draft: CpaApiKeyDraft) => void;
  readonly onClose: () => void;
  readonly onSubmit: () => void;
}

export function CpaApiKeyEditorDialog({
  open,
  title,
  draft,
  error,
  submitting,
  submitLabel,
  cancelLabel,
  nameLabel,
  namePlaceholder,
  keyLabel,
  keyPlaceholder,
  showKeyLabel,
  hideKeyLabel,
  onDraftChange,
  onClose,
  onSubmit,
}: CpaApiKeyEditorDialogProps) {
  const canSubmit = draft.keyAlias.trim() !== '' && draft.apiKey.trim() !== '';
  const [keyVisible, setKeyVisible] = useState(false);
  const errorId = `${useId()}-error`;
  const errorDescription = error ? errorId : undefined;
  const visibilityLabel = keyVisible ? hideKeyLabel : showKeyLabel;

  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      className={styles.cpaApiKeyModal}
      closeDisabled={submitting}
      footer={(
        <div className={styles.cpaApiKeyDialogActions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="primary" onClick={onSubmit} loading={submitting} disabled={!canSubmit}>
            {submitLabel}
          </Button>
        </div>
      )}
    >
      <div className={styles.cpaApiKeyDialogBody}>
        <Input
          value={draft.keyAlias}
          onChange={(event) => onDraftChange({ ...draft, keyAlias: event.target.value })}
          label={nameLabel}
          placeholder={namePlaceholder}
          disabled={submitting}
          required
          aria-describedby={errorDescription}
        />
        <Input
          value={draft.apiKey}
          onChange={(event) => onDraftChange({ ...draft, apiKey: event.target.value })}
          type={keyVisible ? 'text' : 'password'}
          label={keyLabel}
          placeholder={keyPlaceholder}
          disabled={submitting}
          required
          aria-describedby={errorDescription}
          autoComplete="off"
          rightElement={(
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={styles.cpaApiKeyInputReveal}
              onClick={() => setKeyVisible((current) => !current)}
              disabled={submitting}
              aria-label={visibilityLabel}
              aria-pressed={keyVisible}
              title={visibilityLabel}
            >
              {keyVisible ? <IconEyeOff size={15} /> : <IconEye size={15} />}
            </Button>
          )}
        />
        {error && <p id={errorId} className={styles.cpaApiKeyDialogError} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

interface CpaApiKeyDeleteDialogProps {
  readonly target: CpaApiKeySettingsItem | null;
  readonly error: string;
  readonly deleting: boolean;
  readonly title: string;
  readonly body: string;
  readonly cancelLabel: string;
  readonly deleteLabel: string;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function CpaApiKeyDeleteDialog({
  target,
  error,
  deleting,
  title,
  body,
  cancelLabel,
  deleteLabel,
  onClose,
  onConfirm,
}: CpaApiKeyDeleteDialogProps) {
  return (
    <Modal
      open={target !== null}
      title={title}
      onClose={onClose}
      className={styles.cpaApiKeyModal}
      closeDisabled={deleting}
      footer={(
        <div className={styles.cpaApiKeyDialogActions}>
          <Button type="button" variant="secondary" onClick={onClose} disabled={deleting}>
            {cancelLabel}
          </Button>
          <Button type="button" variant="danger" onClick={onConfirm} loading={deleting}>
            {deleteLabel}
          </Button>
        </div>
      )}
    >
      <div className={styles.cpaApiKeyDialogBody}>
        <p>{body}</p>
        {target && (
          <div className={styles.cpaApiKeyDeleteSummary}>
            <strong>{target.keyAlias}</strong>
            <code>{target.displayKey}</code>
          </div>
        )}
        {error && <p className={styles.cpaApiKeyDialogError} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
