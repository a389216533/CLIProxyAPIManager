import { ProxyPoolManagerPanel } from '@/components/usage';
import type { CredentialsTabData } from '@/components/usage/credentials/useCredentialsTabData';
import styles from '../UsagePage.module.scss';

interface UsageProxyPoolsTabProps {
  credentialsData: CredentialsTabData;
}

export function UsageProxyPoolsTab({ credentialsData }: UsageProxyPoolsTabProps) {
  return (
    <div className={styles.proxyPoolSections}>
      {credentialsData.error && <div className={styles.errorBox}>{credentialsData.error}</div>}
      <section className="card">
        <ProxyPoolManagerPanel
          rows={credentialsData.authFileRows}
          pools={credentialsData.proxyPools}
          loading={credentialsData.proxyPoolsLoading}
          error={credentialsData.proxyPoolsError}
          onSavePool={credentialsData.saveProxyPool}
          onDeletePool={credentialsData.removeProxyPool}
          onApplyPool={credentialsData.applyProxyPoolToAuthFiles}
        />
      </section>
    </div>
  );
}
