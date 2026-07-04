import { RequestEventsDetailsCard } from '@/components/usage/RequestEventsDetailsCard';
import type { UsageEvent, UsageSourceFilterOption } from '@/lib/types';
import type { UsageEventsExportFormat } from '@/lib/api';
import type { RequestEventColumnId } from '@/components/usage/RequestEventsDetailsCard';
import styles from '../UsagePage.module.scss';

interface UsageEventsTabProps {
  eventsError: string;
  eventsData: UsageEvent[];
  eventsLoading: boolean;
  eventsPage: number;
  eventsPageSize: number;
  eventsPageSizes: readonly number[];
  eventsTotalCount: number;
  eventsTotalPages: number;
  eventsModelOptions: string[];
  eventsSourceOptions: UsageSourceFilterOption[];
  eventsModelFilter: string;
  eventsSourceFilter: string;
  eventsResultFilter: string;
  eventsExportingFormat: UsageEventsExportFormat | null;
  eventsVisibleColumnIds: RequestEventColumnId[];
  isPublicMode: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onModelFilterChange: (model: string) => void;
  onSourceFilterChange: (source: string) => void;
  onResultFilterChange: (result: string) => void;
  onExport: ((format: UsageEventsExportFormat) => Promise<void>) | undefined;
  onVisibleColumnIdsChange: (columnIds: RequestEventColumnId[]) => void;
}

export function UsageEventsTab({
  eventsError,
  eventsData,
  eventsLoading,
  eventsPage,
  eventsPageSize,
  eventsPageSizes,
  eventsTotalCount,
  eventsTotalPages,
  eventsModelOptions,
  eventsSourceOptions,
  eventsModelFilter,
  eventsSourceFilter,
  eventsResultFilter,
  eventsExportingFormat,
  eventsVisibleColumnIds,
  isPublicMode,
  onPageChange,
  onPageSizeChange,
  onModelFilterChange,
  onSourceFilterChange,
  onResultFilterChange,
  onExport,
  onVisibleColumnIdsChange,
}: UsageEventsTabProps) {
  return (
    <>
      {eventsError && <div className={styles.errorBox}>{eventsError}</div>}
      <RequestEventsDetailsCard
        events={eventsData}
        loading={eventsLoading}
        page={eventsPage}
        pageSize={eventsPageSize}
        pageSizeOptions={eventsPageSizes}
        totalCount={eventsTotalCount}
        totalPages={eventsTotalPages}
        modelOptions={eventsModelOptions}
        sourceOptions={eventsSourceOptions}
        modelFilter={eventsModelFilter}
        sourceFilter={eventsSourceFilter}
        resultFilter={eventsResultFilter}
        exportingFormat={eventsExportingFormat}
        visibleColumnIds={eventsVisibleColumnIds}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        onModelFilterChange={onModelFilterChange}
        onSourceFilterChange={onSourceFilterChange}
        onResultFilterChange={onResultFilterChange}
        onExport={isPublicMode ? undefined : onExport}
        onVisibleColumnIdsChange={onVisibleColumnIdsChange}
      />
    </>
  );
}
