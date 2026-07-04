import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { useThemeStore } from '@/stores';
import type { Theme } from '@/types';
import { BrandLink } from '@/components/BrandLink';
import styles from './LoginPage.module.scss';

type LoginMode = 'admin' | 'api_key';

const THEME_OPTIONS: ReadonlyArray<{ value: Theme; labelKey: string }> = [
  { value: 'white', labelKey: 'usage_stats.theme_light' },
  { value: 'dark', labelKey: 'usage_stats.theme_dark' },
  { value: 'auto', labelKey: 'usage_stats.theme_auto' },
];

type LoginErrors = {
  adminError?: string;
  apiKeyError?: string;
};

interface LoginPageProps extends LoginErrors {
  loading?: boolean;
  setupRequired?: boolean;
  onPasswordSubmit: (password: string) => Promise<void>;
  onSetupSubmit: (password: string, cpaManagementKey: string) => Promise<void>;
  onAPIKeySubmit: (apiKey: string) => Promise<void>;
}

export const getLoginErrorForMode = (mode: LoginMode, { adminError = '', apiKeyError = '' }: LoginErrors) => (
  mode === 'api_key' ? apiKeyError : adminError
);

export function generateCpaManagementKey(length = 32): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const cryptoRef = globalThis.crypto;
  const bytes = new Uint8Array(length);
  if (cryptoRef?.getRandomValues) {
    cryptoRef.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join('');
}

export function LoginPage({ loading = false, setupRequired = false, adminError = '', apiKeyError = '', onPasswordSubmit, onSetupSubmit, onAPIKeySubmit }: LoginPageProps) {
  const { t } = useTranslation();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const [mode, setMode] = useState<LoginMode>('admin');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [cpaManagementKey, setCpaManagementKey] = useState('');
  const [confirmCpaManagementKey, setConfirmCpaManagementKey] = useState('');
  const [apiKey, setApiKey] = useState('');
  const activeError = getLoginErrorForMode(mode, { adminError, apiKeyError });
  const passwordMismatch = setupRequired && password && confirmPassword && password !== confirmPassword;
  const cpaKeyMismatch = setupRequired && cpaManagementKey && confirmCpaManagementKey && cpaManagementKey !== confirmCpaManagementKey;
  const setupError = passwordMismatch ? t('auth.setup_password_mismatch') : cpaKeyMismatch ? t('auth.setup_cpa_key_mismatch') : activeError;
  const themeOptions = useMemo(
    () => THEME_OPTIONS.map((option) => ({ ...option, label: t(option.labelKey) })),
    [t]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (setupRequired) {
      if (password !== confirmPassword) return;
      if (cpaManagementKey !== confirmCpaManagementKey) return;
      await onSetupSubmit(password, cpaManagementKey);
      return;
    }
    if (mode === 'api_key') {
      await onAPIKeySubmit(apiKey);
      return;
    }
    await onPasswordSubmit(password);
  };

  const handleGenerateCpaKey = () => {
    const nextKey = generateCpaManagementKey();
    setCpaManagementKey(nextKey);
    setConfirmCpaManagementKey(nextKey);
  };

  const canSubmit = setupRequired
    ? password.trim().length >= 6 && password === confirmPassword && cpaManagementKey.trim().length >= 8 && cpaManagementKey === confirmCpaManagementKey
    : mode === 'api_key' ? Boolean(apiKey.trim()) : Boolean(password.trim());

  return (
    <div className={styles.pageShell}>
      <div className={styles.frame}>
        <div className={styles.utilityDock}>
          <div className={styles.themeSwitcher} role="tablist" aria-label={t('usage_stats.theme_switch')}>
            {themeOptions.map((option) => {
              const active = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`${styles.themePill} ${active ? styles.themePillActive : ''}`.trim()}
                  onClick={() => setTheme(option.value)}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className={styles.brandBlock}>
          <BrandLink className={styles.eyebrow} />
          <h1 className={styles.title}>{t('auth.login_title')}</h1>
          <p className={styles.subtitle}>{t('auth.login_subtitle')}</p>
        </div>

        <Card className={styles.loginCard}>
          <div className={styles.cardHeader}>
            <span className={styles.cardKicker}>{t('auth.console_kicker')}</span>
            <h2 className={styles.cardTitle}>{t(setupRequired ? 'auth.setup_title' : 'auth.console_title')}</h2>
            <p className={styles.cardHint}>{t(setupRequired ? 'auth.setup_hint' : 'auth.console_hint')}</p>
          </div>

          {!setupRequired && <div className={styles.tabs} role="tablist" aria-label={t('auth.login_method')}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'admin'}
              className={`${styles.tab} ${mode === 'admin' ? styles.tabActive : ''}`.trim()}
              onClick={() => setMode('admin')}
              disabled={loading}
            >
              {t('auth.admin_tab')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'api_key'}
              className={`${styles.tab} ${mode === 'api_key' ? styles.tabActive : ''}`.trim()}
              onClick={() => setMode('api_key')}
              disabled={loading}
            >
              {t('auth.api_key_tab')}
            </button>
          </div>}

          <form className={styles.form} onSubmit={(event) => void handleSubmit(event)}>
            {setupRequired ? (
              <>
                <Input
                  type="password"
                  autoComplete="new-password"
                  label={t('auth.setup_password_label')}
                  placeholder={t('auth.setup_password_placeholder')}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  error={setupError || undefined}
                  disabled={loading}
                />
                <Input
                  type="password"
                  autoComplete="new-password"
                  label={t('auth.setup_confirm_label')}
                  placeholder={t('auth.setup_confirm_placeholder')}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  disabled={loading}
                />
                <Input
                  type="password"
                  autoComplete="new-password"
                  label={t('auth.setup_cpa_key_label')}
                  placeholder={t('auth.setup_cpa_key_placeholder')}
                  value={cpaManagementKey}
                  onChange={(event) => setCpaManagementKey(event.target.value)}
                  error={cpaKeyMismatch ? setupError || undefined : undefined}
                  disabled={loading}
                />
                <button
                  type="button"
                  className={styles.generateKeyButton}
                  onClick={handleGenerateCpaKey}
                  disabled={loading}
                >
                  {t('auth.setup_generate_cpa_key')}
                </button>
                <Input
                  type="password"
                  autoComplete="new-password"
                  label={t('auth.setup_cpa_key_confirm_label')}
                  placeholder={t('auth.setup_cpa_key_confirm_placeholder')}
                  value={confirmCpaManagementKey}
                  onChange={(event) => setConfirmCpaManagementKey(event.target.value)}
                  disabled={loading}
                />
                <p className={styles.formHint}>{t('auth.setup_password_hint')}</p>
              </>
            ) : mode === 'api_key' ? (
              <>
                <Input
                  type="password"
                  autoComplete="off"
                  label={t('auth.api_key_label')}
                  placeholder={t('auth.api_key_placeholder')}
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  error={activeError || undefined}
                  disabled={loading}
                />
                <p className={styles.formHint}>{t('auth.api_key_hint')}</p>
              </>
            ) : (
              <>
                <Input
                  type="password"
                  autoComplete="current-password"
                  label={t('auth.password_label')}
                  placeholder={t('auth.password_placeholder')}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  error={activeError || undefined}
                  disabled={loading}
                />
                <p className={styles.formHint}>{t('auth.password_hint')}</p>
              </>
            )}
            <Button type="submit" fullWidth loading={loading} disabled={!canSubmit}>
              {setupRequired ? t('auth.setup_submit') : mode === 'api_key' ? t('auth.api_key_login_submit') : t('auth.login_submit')}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
