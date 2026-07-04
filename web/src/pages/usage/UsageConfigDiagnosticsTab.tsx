import { ConfigDiagnosticsPanel } from '@/components/usage';

interface UsageConfigDiagnosticsTabProps {
  configDiagnosticsRefreshKey: number;
  onAuthRequired?: () => void;
}

export function UsageConfigDiagnosticsTab({
  configDiagnosticsRefreshKey,
  onAuthRequired,
}: UsageConfigDiagnosticsTabProps) {
  return (
    <ConfigDiagnosticsPanel
      refreshKey={configDiagnosticsRefreshKey}
      onAuthRequired={onAuthRequired}
    />
  );
}
