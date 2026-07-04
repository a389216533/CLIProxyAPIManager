import { CredentialProviderFilterBar, AuthFileCredentialsSection, AiProviderCredentialsSection } from '@/components/usage';
import type { StatusResponse, UsageIdentityTypeCount } from '@/lib/types';
import type { CredentialsTabData } from '@/components/usage/credentials/useCredentialsTabData';
import type { CredentialProviderFilterKey } from '@/components/usage/credentials/credentialProviderFilters';
import styles from '../UsagePage.module.scss';

interface UsageCredentialsTabProps {
  credentialSectionVisibility: {
    enabled: boolean;
    showAuthFiles: boolean;
    showAiProvider: boolean;
  };
  credentialsData: CredentialsTabData;
  status: StatusResponse | null;
  activeCredentialProviderFilterScope: 'auth-files' | 'ai-provider';
  credentialTypeCountsForProviderFilter: UsageIdentityTypeCount[];
  activeCredentialProviderFilter: CredentialProviderFilterKey;
  setActiveCredentialProviderFilter: (filter: CredentialProviderFilterKey) => void;
}

export function UsageCredentialsTab({
  credentialSectionVisibility,
  credentialsData,
  status,
  activeCredentialProviderFilterScope,
  credentialTypeCountsForProviderFilter,
  activeCredentialProviderFilter,
  setActiveCredentialProviderFilter,
}: UsageCredentialsTabProps) {
  return (
    <>
      {credentialsData.error && <div className={styles.errorBox}>{credentialsData.error}</div>}
      <CredentialProviderFilterBar
        scope={activeCredentialProviderFilterScope}
        typeCounts={credentialTypeCountsForProviderFilter}
        value={activeCredentialProviderFilter}
        onChange={setActiveCredentialProviderFilter}
      />
      <div className={styles.credentialsSections}>
        {credentialSectionVisibility.showAuthFiles && (
          <AuthFileCredentialsSection
            rows={credentialsData.authFileRows}
            total={credentialsData.authFileTotal}
            page={credentialsData.authFilePage}
            totalPages={credentialsData.authFileTotalPages}
            pageSize={credentialsData.authFilePageSize}
            activeOnly={credentialsData.authFileActiveOnly}
            sort={credentialsData.authFileSort}
            loading={credentialsData.loading}
            quotaRefreshing={credentialsData.quotaRefreshing}
            quotaRefreshError={credentialsData.quotaRefreshError}
            quotaAutoRefreshEnabled={status?.quotaAutoRefreshEnabled === true}
            quotaInspectionStatus={credentialsData.quotaInspectionStatus}
            quotaInspectionLoading={credentialsData.quotaInspectionLoading}
            quotaInspectionStarting={credentialsData.quotaInspectionStarting}
            quotaInspectionError={credentialsData.quotaInspectionError}
            authFileCooldownsLoading={credentialsData.authFileCooldownsLoading}
            authFileCooldownsError={credentialsData.authFileCooldownsError}
            proxyPools={credentialsData.proxyPools}
            proxyPoolsLoading={credentialsData.proxyPoolsLoading}
            proxyPoolsError={credentialsData.proxyPoolsError}
            proxyPoolFilterId={credentialsData.authFileProxyPoolFilterId}
            onPageChange={credentialsData.setAuthFilePage}
            onPageSizeChange={credentialsData.setAuthFilePageSize}
            onActiveOnlyChange={credentialsData.setAuthFileActiveOnly}
            onSortChange={credentialsData.setAuthFileSort}
            onRefreshQuota={credentialsData.refreshQuotaForCurrentAuthFilePage}
            onRefreshQuotaForAuthIndex={credentialsData.refreshQuotaForAuthIndex}
            onResetQuotaForAuthIndex={credentialsData.resetQuotaForAuthIndex}
            onStartCooldownForAuthFile={credentialsData.startCooldownForAuthFile}
            onRestoreCooldownForAuthFile={credentialsData.restoreCooldownForAuthFile}
            aliasSavingId={credentialsData.aliasSavingId}
            onSaveAlias={credentialsData.saveUsageIdentityAlias}
            onSaveNote={credentialsData.saveAuthFileNote}
            onRefreshInspectionStatus={credentialsData.refreshQuotaInspectionStatus}
            onStartInspection={credentialsData.startQuotaInspection}
            onAfterInvalidAccountAction={credentialsData.refresh}
            onProxyPoolFilterChange={credentialsData.setAuthFileProxyPoolFilterId}
            onApplyProxyPool={credentialsData.applyProxyPoolToAuthFiles}
            authFileQuery={credentialsData.authFileQuery}
            onAuthFileQueryChange={credentialsData.setAuthFileQuery}
          />
        )}
        {credentialSectionVisibility.showAiProvider && (
          <AiProviderCredentialsSection
            rows={credentialsData.aiProviderRows}
            total={credentialsData.aiProviderTotal}
            page={credentialsData.aiProviderPage}
            totalPages={credentialsData.aiProviderTotalPages}
            pageSize={credentialsData.aiProviderPageSize}
            sort={credentialsData.aiProviderSort}
            loading={credentialsData.loading}
            aliasSavingId={credentialsData.aliasSavingId}
            onSaveAlias={credentialsData.saveUsageIdentityAlias}
            onPageChange={credentialsData.setAiProviderPage}
            onPageSizeChange={credentialsData.setAiProviderPageSize}
            onSortChange={credentialsData.setAiProviderSort}
          />
        )}
      </div>
    </>
  );
}
