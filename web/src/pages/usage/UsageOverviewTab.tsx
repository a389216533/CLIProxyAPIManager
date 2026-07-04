import { DailyAveragePanel, StatCards, ServiceHealthCard, OverviewUsageSummary, AnalysisTokenUsagePanel } from '@/components/usage';
import type { AnalysisResponse, OverviewRealtimeBlock } from '@/lib/types';
import type { UsageOverviewPayload } from '@/components/usage/hooks/useUsageData';

interface UsageOverviewTabProps {
  usage: UsageOverviewPayload | null;
  currentRealtime: OverviewRealtimeBlock | null;
  overviewDisplayLoading: boolean;
  reserveDailyAveragePanel: boolean;
  dailyAveragePanelUsage: UsageOverviewPayload | null;
  analysisData: AnalysisResponse | null;
  analysisLoading: boolean;
  isDark: boolean;
  isMobile: boolean;
}

export function UsageOverviewTab({
  usage,
  currentRealtime,
  overviewDisplayLoading,
  reserveDailyAveragePanel,
  dailyAveragePanelUsage,
  analysisData,
  analysisLoading,
  isDark,
  isMobile,
}: UsageOverviewTabProps) {
  return (
    <>
      <DailyAveragePanel
        usage={dailyAveragePanelUsage}
        loading={overviewDisplayLoading}
        reserveVisible={reserveDailyAveragePanel}
      />

      <StatCards
        usage={usage}
        realtime={currentRealtime}
        loading={overviewDisplayLoading}
      />

      <ServiceHealthCard
        usage={usage}
        loading={overviewDisplayLoading}
      />

      <OverviewUsageSummary
        analysis={analysisData}
        loading={analysisLoading}
      />

      <AnalysisTokenUsagePanel
        analysis={analysisData}
        loading={analysisLoading}
        isDark={isDark}
        isMobile={isMobile}
      />
    </>
  );
}
