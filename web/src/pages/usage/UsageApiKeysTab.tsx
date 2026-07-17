import { CpaApiKeyManagerCard } from '@/components/usage';
import type { CpaApiKeySettingsItem } from '@/lib/types';
import styles from '../UsagePage.module.scss';

interface UsageApiKeysTabProps {
  apiKeySettings: CpaApiKeySettingsItem[];
  apiKeySettingsLoading: boolean;
  apiKeySettingsCreating: boolean;
  apiKeySettingsSavingId: string | null;
  apiKeySettingsDeletingId: string | null;
  handleCreateApiKey: (keyAlias: string, apiKey: string) => Promise<void>;
  handleSaveApiKey: (id: string, keyAlias: string, apiKey: string) => Promise<void>;
  handleDeleteApiKey: (id: string) => Promise<void>;
  showTopNotice: (kind: 'success' | 'info' | 'error', message: string) => void;
}

export function UsageApiKeysTab({
  apiKeySettings,
  apiKeySettingsLoading,
  apiKeySettingsCreating,
  apiKeySettingsSavingId,
  apiKeySettingsDeletingId,
  handleCreateApiKey,
  handleSaveApiKey,
  handleDeleteApiKey,
  showTopNotice,
}: UsageApiKeysTabProps) {
  return (
    <div className={styles.cpaManagerSections}>
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
    </div>
  );
}
