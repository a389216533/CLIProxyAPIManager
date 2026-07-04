import { SessionSettingsCard, PriceSettingsCard } from '@/components/usage';
import type { AuthManagedSessionItem, ModelPrice, PricingSaveResult, PricingSyncPreviewResponse } from '@/lib/types';
import styles from '../UsagePage.module.scss';

interface UsageSettingsTabProps {
  authSessions: AuthManagedSessionItem[];
  authSessionsLoading: boolean;
  authSessionRevokingId: string | null;
  handleRevokeAuthSession: (session: AuthManagedSessionItem) => Promise<void>;
  modelNames: string[];
  modelPrices: Record<string, ModelPrice>;
  setModelPrices: (prices: Record<string, ModelPrice>) => void | Promise<void>;
  syncModelPrices: (prices: Record<string, ModelPrice>) => Promise<PricingSaveResult>;
  previewPricingSync: () => Promise<PricingSyncPreviewResponse>;
  showTopNotice: (kind: 'success' | 'info' | 'error', message: string) => void;
  pricingLoading: boolean;
}

export function UsageSettingsTab({
  authSessions,
  authSessionsLoading,
  authSessionRevokingId,
  handleRevokeAuthSession,
  modelNames,
  modelPrices,
  setModelPrices,
  syncModelPrices,
  previewPricingSync,
  showTopNotice,
  pricingLoading,
}: UsageSettingsTabProps) {
  return (
    <div className={styles.settingsSections}>
      <SessionSettingsCard
        sessions={authSessions}
        loading={authSessionsLoading}
        revokingId={authSessionRevokingId}
        onLogout={handleRevokeAuthSession}
      />
      <PriceSettingsCard
        modelNames={modelNames}
        modelPrices={modelPrices}
        onPricesChange={setModelPrices}
        onSyncPricesChange={syncModelPrices}
        onSyncPreview={previewPricingSync}
        onNotice={showTopNotice}
        loading={pricingLoading}
      />
    </div>
  );
}
