import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import './App.css';
import { ApiError, appPath, getSession, login, loginWithCPAAPIKey, setupFirstRun } from './lib/api';
import type { AuthRole, AuthSessionAPIKeySummary } from './lib/types';
import { AppFooter } from './components/AppFooter';
import { KeyOverviewPage } from './pages/KeyOverviewPage';
import { LoginPage } from './pages/LoginPage';
import { UsagePage } from './pages/UsagePage';
import { useUsageStatsStore } from './stores/useUsageStatsStore';
import { scheduleEffectTask } from './utils/effects';

type AuthState = 'checking' | 'authenticated' | 'unauthenticated';

export const getRoleHomePath = (role: AuthRole): '/' | '/key-overview' => (
  role === 'api_key_viewer' ? '/key-overview' : '/'
);

const stripBasePath = (pathname: string, basePath: string | undefined): string => {
  if (!basePath || basePath === '/' || basePath === '__APP_BASE_PATH__') return pathname || '/';
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  if (!pathname.startsWith(normalizedBase)) return pathname || '/';
  const stripped = pathname.slice(normalizedBase.length);
  return stripped || '/';
};

export const shouldNormalizeRolePath = (role: AuthRole, currentPath: string): boolean => currentPath !== getRoleHomePath(role);

function App() {
  const { t } = useTranslation();
  const [authState, setAuthState] = useState<AuthState>('checking');
  const [authRole, setAuthRole] = useState<AuthRole | null>(null);
  const [sessionAPIKey, setSessionAPIKey] = useState<AuthSessionAPIKeySummary | undefined>();
  const [setupRequired, setSetupRequired] = useState(false);
  const [adminLoginError, setAdminLoginError] = useState('');
  const [apiKeyLoginError, setAPIKeyLoginError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [currentPath, setCurrentPath] = useState(() => stripBasePath(window.location.pathname, window.__APP_BASE_PATH__));
  const clearUsageStats = useUsageStatsStore((state) => state.clearUsageStats);

  const clearSession = useCallback(() => {
    clearUsageStats();
    setAuthState('unauthenticated');
    setAuthRole(null);
    setSessionAPIKey(undefined);
  }, [clearUsageStats]);

  const applySession = useCallback((session: Awaited<ReturnType<typeof getSession>>) => {
    if (!session.authenticated) {
      clearSession();
      setSetupRequired(Boolean(session.setupRequired));
      return;
    }
    setSetupRequired(false);
    setAuthState('authenticated');
    setAuthRole(session.role ?? 'admin');
    setSessionAPIKey(session.api_key);
  }, [clearSession]);

  const loadSession = useCallback(async () => {
    const session = await getSession();
    applySession(session);
    return session;
  }, [applySession]);

  useEffect(() => {
    return scheduleEffectTask(() => {
      void loadSession().catch(() => {
        clearSession();
      });
    });
  }, [clearSession, loadSession]);

  useEffect(() => {
    const syncPath = () => setCurrentPath(stripBasePath(window.location.pathname, window.__APP_BASE_PATH__));
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  useEffect(() => {
    if (authState !== 'authenticated' || !authRole) return;
    const currentPath = stripBasePath(window.location.pathname, window.__APP_BASE_PATH__);
    if (!shouldNormalizeRolePath(authRole, currentPath)) return;
    window.history.replaceState(null, '', appPath(getRoleHomePath(authRole)));
  }, [authRole, authState]);

  const handlePasswordLogin = useCallback(async (password: string) => {
    setSubmitting(true);
    setAdminLoginError('');
    try {
      await login(password);
      const session = await loadSession();
      if (!session.authenticated) {
        setAdminLoginError(t('auth.login_failed'));
        clearSession();
        return;
      }
      window.history.replaceState(null, '', appPath('/'));
      setCurrentPath('/');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAdminLoginError(t('auth.invalid_password'));
      } else {
        setAdminLoginError(t('auth.login_failed'));
      }
      clearSession();
    } finally {
      setSubmitting(false);
    }
  }, [clearSession, loadSession, t]);

  const handleSetupPassword = useCallback(async (password: string, cpaManagementKey: string) => {
    setSubmitting(true);
    setAdminLoginError('');
    try {
      await setupFirstRun(password, cpaManagementKey);
      const session = await loadSession();
      if (!session.authenticated) {
        setAdminLoginError(t('auth.setup_failed'));
        clearSession();
        return;
      }
      setSetupRequired(false);
      window.history.replaceState(null, '', appPath('/'));
      setCurrentPath('/');
    } catch {
      setAdminLoginError(t('auth.setup_failed'));
      clearSession();
      setSetupRequired(true);
    } finally {
      setSubmitting(false);
    }
  }, [clearSession, loadSession, t]);

  const handleAPIKeyLogin = useCallback(async (apiKey: string) => {
    setSubmitting(true);
    setAPIKeyLoginError('');
    try {
      await loginWithCPAAPIKey(apiKey);
      const session = await loadSession();
      if (!session.authenticated || session.role !== 'api_key_viewer') {
        setAPIKeyLoginError(t('auth.api_key_login_failed'));
        clearSession();
        return;
      }
      window.history.replaceState(null, '', appPath('/key-overview'));
      setCurrentPath('/key-overview');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setAPIKeyLoginError(t('auth.invalid_api_key'));
      } else if (error instanceof ApiError && error.status === 429) {
        setAPIKeyLoginError(t('auth.login_rate_limited'));
      } else {
        setAPIKeyLoginError(t('auth.api_key_login_failed'));
      }
      clearSession();
    } finally {
      setSubmitting(false);
    }
  }, [clearSession, loadSession, t]);

  let page: ReactNode;
  let showFooter = true;
  if (authState === 'checking') {
    page = <div className="app-checking" aria-busy="true" />;
  } else if (authState === 'unauthenticated' && setupRequired) {
    page = <LoginPage loading={submitting} setupRequired={setupRequired} adminError={adminLoginError} apiKeyError={apiKeyLoginError} onPasswordSubmit={handlePasswordLogin} onSetupSubmit={handleSetupPassword} onAPIKeySubmit={handleAPIKeyLogin} />;
  } else if (authState === 'unauthenticated') {
    const loginPath = appPath('/login');
    if (currentPath === '/login') {
      page = <LoginPage loading={submitting} setupRequired={false} adminError={adminLoginError} apiKeyError={apiKeyLoginError} onPasswordSubmit={handlePasswordLogin} onSetupSubmit={handleSetupPassword} onAPIKeySubmit={handleAPIKeyLogin} />;
    } else {
      showFooter = false;
      page = <UsagePage mode="public" onLoginClick={() => {
        window.history.pushState(null, '', loginPath);
        setCurrentPath('/login');
      }} />;
    }
  } else if (authRole === 'api_key_viewer') {
    page = <KeyOverviewPage apiKey={sessionAPIKey} onAuthRequired={clearSession} />;
  } else {
    showFooter = false;
    page = <UsagePage onAuthRequired={clearSession} />;
  }

  return (
    <div className="app-frame">
      <main className="app-main">{page}</main>
      {showFooter && <AppFooter loadVersion={authState === 'authenticated'} />}
    </div>
  );
}

export default App;
