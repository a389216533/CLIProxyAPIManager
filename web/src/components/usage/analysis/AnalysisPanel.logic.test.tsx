import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChartData, ChartOptions, Plugin } from 'chart.js';
import type { AnalysisResponse } from '@/lib/types';

type TokenAverageLinePluginOptions = {
  value: number;
  color: string;
};

const chartCapture = vi.hoisted(() => ({
  barData: null as ChartData<'bar', Array<number | null>, string> | null,
  barOptions: null as ChartOptions<'bar'> | null,
  barPlugins: undefined as Plugin<'bar'>[] | undefined,
  doughnutData: null as ChartData<'doughnut', number[], string> | null,
  doughnutCount: 0,
  scatterData: [] as ChartData<'scatter'>[],
  scatterOptions: [] as ChartOptions<'scatter'>[],
  scatterPlugins: [] as Array<Plugin<'scatter'>[] | undefined>,
}));

vi.mock('react-chartjs-2', () => ({
  Bar: (props: { data: ChartData<'bar', Array<number | null>, string>; options: ChartOptions<'bar'>; plugins?: Plugin<'bar'>[] }) => {
    chartCapture.barData = props.data;
    chartCapture.barOptions = props.options;
    chartCapture.barPlugins = props.plugins;
    return React.createElement('div');
  },
  Doughnut: (props: { data: ChartData<'doughnut', number[], string> }) => {
    chartCapture.doughnutData = props.data;
    chartCapture.doughnutCount += 1;
    return React.createElement('div');
  },
  Scatter: (props: { data: ChartData<'scatter'>; options: ChartOptions<'scatter'>; plugins?: Plugin<'scatter'>[] }) => {
    chartCapture.scatterData.push(props.data);
    chartCapture.scatterOptions.push(props.options);
    chartCapture.scatterPlugins.push(props.plugins);
    return React.createElement('div');
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { AnalysisPanel, AnalysisTokenUsagePanel, UsageCompositionPanel } from './AnalysisPanel';

const emptyAnalysis: AnalysisResponse = {
  granularity: 'hourly',
  timezone: 'UTC',
  token_usage: [],
  api_key_composition: [],
  model_composition: [],
  auth_files_composition: [],
  ai_provider_composition: [],
  cost_breakdown: {
    input_cost_usd: 0,
    output_cost_usd: 0,
    cached_cost_usd: 0,
    total_cost_usd: 0,
    cost_available: true,
  },
  model_efficiency: [],
  heatmap: {
    api_keys: [],
    api_key_labels: {},
    models: [],
    cells: [],
  },
  latency_diagnostics: {
    points: [],
    density: [],
    total_points: 0,
    sampled: false,
    p95_ttft_ms: 0,
    p95_latency_ms: 0,
    max_ttft_ms: 0,
    max_latency_ms: 0,
  },
};

describe('AnalysisPanel token chart data', () => {
  beforeEach(() => {
    chartCapture.barData = null;
    chartCapture.barOptions = null;
    chartCapture.barPlugins = undefined;
    chartCapture.doughnutData = null;
    chartCapture.doughnutCount = 0;
    chartCapture.scatterData = [];
    chartCapture.scatterOptions = [];
    chartCapture.scatterPlugins = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('subtracts cached and reasoning tokens from displayed token series while keeping total tooltip values', () => {
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      token_usage: [{
        bucket: '2026-05-28T01:00:00Z',
        input_tokens: 1000,
        output_tokens: 100,
        cached_tokens: 600,
        reasoning_tokens: 50,
        total_tokens: 1150,
        requests: 3,
        cost_usd: 0.0123,
        cost_available: true,
      }],
    };

    renderToStaticMarkup(<AnalysisTokenUsagePanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);

    const datasets = chartCapture.barData?.datasets ?? [];
    expect(datasets.find((dataset) => dataset.label === 'usage_stats.input_tokens')?.data).toEqual([400]);
    expect(datasets.find((dataset) => dataset.label === 'usage_stats.cached_tokens')?.data).toEqual([600]);
    expect(datasets.find((dataset) => dataset.label === 'usage_stats.output_tokens')?.data).toEqual([50]);
    expect(datasets.find((dataset) => dataset.label === 'usage_stats.reasoning_tokens')?.data).toEqual([50]);
    expect(datasets.find((dataset) => dataset.label === 'usage_stats.total_cost')?.data).toEqual([0.0123]);
    expect(datasets.find((dataset) => dataset.label === 'usage_stats.total_cost')?.yAxisID).toBe('cost');
    expect(datasets.find((dataset) => dataset.label === 'usage_stats.total_cost')?.borderColor).toBe('#14b8a6');
    expect(chartCapture.barOptions?.scales).toHaveProperty('cost');
    expect(chartCapture.barOptions?.scales?.cost?.ticks?.color).not.toBe('#14b8a6');
    const tooltipLabel = chartCapture.barOptions?.plugins?.tooltip?.callbacks?.label;
    expect(typeof tooltipLabel).toBe('function');
    expect(tooltipLabel?.({
      dataset: { label: 'usage_stats.input_tokens', tooltipData: [1000] },
      dataIndex: 0,
      parsed: { y: 400 },
    } as never)).toBe('usage_stats.input_tokens: 1,000');
    expect(tooltipLabel?.({
      dataset: { label: 'usage_stats.output_tokens', tooltipData: [100] },
      dataIndex: 0,
      parsed: { y: 50 },
    } as never)).toBe('usage_stats.output_tokens: 100');
    expect(tooltipLabel?.({
      dataset: null,
      dataIndex: 0,
      parsed: { y: 125 },
    } as never)).toBe('125');
    const tooltipFooter = chartCapture.barOptions?.plugins?.tooltip?.callbacks?.footer;
    expect(typeof tooltipFooter).toBe('function');
    expect(tooltipFooter?.([{ dataIndex: 0 }] as never)).toBe('usage_stats.total_tokens: 1,150');
    expect(chartCapture.barOptions?.plugins?.tooltip?.footerColor).toBe('#374151');
  });

  it('shows the average total token value as a legend chip while keeping the chart reference line label-free', () => {
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      token_usage: [
        {
          bucket: '2026-05-28T01:00:00Z',
          input_tokens: 100,
          output_tokens: 0,
          cached_tokens: 0,
          reasoning_tokens: 0,
          total_tokens: 100,
          requests: 1,
          cost_usd: 0,
          cost_available: true,
        },
        {
          bucket: '2026-05-28T02:00:00Z',
          input_tokens: 0,
          output_tokens: 0,
          cached_tokens: 0,
          reasoning_tokens: 0,
          total_tokens: 0,
          requests: 0,
          cost_usd: 0,
          cost_available: true,
        },
        {
          bucket: '2026-05-28T03:00:00Z',
          input_tokens: 400,
          output_tokens: 100,
          cached_tokens: 0,
          reasoning_tokens: 0,
          total_tokens: 500,
          requests: 2,
          cost_usd: 0,
          cost_available: true,
        },
      ],
    };

    const markup = renderToStaticMarkup(<AnalysisTokenUsagePanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);
    const plugins = chartCapture.barOptions?.plugins as (ChartOptions<'bar'>['plugins'] & {
      analysisTokenAverageLine?: TokenAverageLinePluginOptions;
    }) | undefined;

    expect(chartCapture.barPlugins?.map((plugin) => plugin.id)).toContain('analysis-token-average-line');
    expect(plugins?.analysisTokenAverageLine).toMatchObject({
      value: 200,
      color: 'rgba(71, 85, 105, 0.62)',
    });
    expect(plugins?.analysisTokenAverageLine).not.toHaveProperty('label');
    expect(plugins?.analysisTokenAverageLine).not.toHaveProperty('labelBackgroundColor');
    expect(markup).toContain('usage_stats.analysis_token_average: 200');
  });

  it('renders usage distribution as a standalone tabbed composition table', () => {
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      api_key_composition: [{
        key: '1',
        label: 'Primary Key',
        total_tokens: 1000,
        requests: 4,
        percent: 100,
        input_tokens: 700,
        output_tokens: 200,
        cached_tokens: 50,
        reasoning_tokens: 50,
        cost_usd: 0.42,
        cost_available: true,
      }],
      model_composition: [{
        key: 'gpt-4o',
        label: 'gpt-4o',
        total_tokens: 1000,
        requests: 4,
        percent: 100,
        input_tokens: 700,
        output_tokens: 200,
        cached_tokens: 50,
        reasoning_tokens: 50,
        cost_usd: 0.42,
        cost_available: true,
      }],
    };

    chartCapture.doughnutCount = 0;
    const markup = renderToStaticMarkup(<UsageCompositionPanel analysis={analysis} loading={false} isDark={false} />);

    expect(chartCapture.doughnutCount).toBe(1);
    expect(chartCapture.doughnutData?.labels).toEqual(['Primary Key']);
    expect(chartCapture.doughnutData?.datasets[0]?.data).toEqual([1000]);
    expect(markup).toContain('usage_stats.analysis_composition_title');
    expect(markup).toContain('usage_stats.analysis_composition_api_key_tab');
    expect(markup).toContain('usage_stats.analysis_composition_token_percent');
    expect(markup).toContain('Primary Key');
    expect(markup).not.toContain('gpt-4o');
    expect(markup).not.toContain('usage_stats.analysis_model_composition_title');
    expect(markup).not.toContain('usage_stats.analysis_auth_files_composition_title');
    expect(markup).not.toContain('usage_stats.analysis_ai_provider_composition_title');
  });

  it('uses a distinct sixth composition color when others are collapsed', () => {
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      api_key_composition: Array.from({ length: 7 }, (_, index) => ({
        key: `key-${index + 1}`,
        label: `Key ${index + 1}`,
        total_tokens: 700 - (index * 100),
        requests: 7 - index,
        percent: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        reasoning_tokens: 0,
        cost_usd: 0,
        cost_available: true,
      })),
    };

    const markup = renderToStaticMarkup(<UsageCompositionPanel analysis={analysis} loading={false} isDark={false} />);
    const compositionColors = Array.from(markup.matchAll(/background-color:\s*([^;"']+)/g), (match) => match[1].trim());

    expect(markup).toContain('usage_stats.analysis_others');
    expect(compositionColors).toHaveLength(6);
    expect(new Set(compositionColors).size).toBe(6);
  });

  it('hides latency diagnostics from the simplified analysis dashboard', () => {
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      latency_diagnostics: {
        total_points: 1,
        sampled: false,
        p95_ttft_ms: 300,
        p95_latency_ms: 1400,
        max_ttft_ms: 300,
        max_latency_ms: 1400,
        points: [{ ttft_ms: 300, latency_ms: 1400 }],
        density: [],
      },
    };

    const markup = renderToStaticMarkup(<AnalysisTokenUsagePanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);

    expect(markup).not.toContain('usage_stats.analysis_latency_title');
    expect(chartCapture.scatterData.findIndex((data) => data.datasets[0]?.label === 'usage_stats.analysis_latency_samples')).toBe(-1);
  });
  it('does not render latency diagnostics in the simplified analysis dashboard', () => {
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      latency_diagnostics: {
        total_points: 1,
        sampled: false,
        p95_ttft_ms: 300,
        p95_latency_ms: 1400,
        max_ttft_ms: 300,
        max_latency_ms: 1400,
        points: [{ ttft_ms: 300, latency_ms: 1400 }],
        density: [],
      },
    };

    renderToStaticMarkup(<AnalysisTokenUsagePanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);

    expect(chartCapture.scatterData.findIndex((data) => data.datasets[0]?.label === 'usage_stats.analysis_latency_samples')).toBe(-1);
  });
  it('keeps latency diagnostics hidden in both themes', () => {
    const analysis: AnalysisResponse = { ...emptyAnalysis };

    const lightMarkup = renderToStaticMarkup(<AnalysisPanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);
    const darkMarkup = renderToStaticMarkup(<AnalysisPanel analysis={analysis} loading={false} isDark isMobile={false} />);

    expect(lightMarkup).not.toContain('usage_stats.analysis_latency_title');
    expect(darkMarkup).not.toContain('usage_stats.analysis_latency_title');
  });
  it('renders cost breakdown with total beside blended rate, segment percentages and sparkline', () => {
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      timezone: 'Asia/Shanghai',
      token_usage: [{
        bucket: '2026-05-28T01:00:00Z',
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        cached_tokens: 500_000,
        reasoning_tokens: 100_000,
        total_tokens: 3_000_000,
        requests: 10,
        cost_usd: 6,
        cost_available: true,
      }],
      cost_breakdown: {
        input_cost_usd: 1,
        output_cost_usd: 3,
        cached_cost_usd: 2,
        total_cost_usd: 6,
        cost_available: true,
      },
    };

    const markup = renderToStaticMarkup(<AnalysisPanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);

    expect(markup).not.toContain('costHeaderTotal');
    expect(markup).toContain('costRateMetric');
    expect(markup).toContain('usage_stats.analysis_cost_per_million_tokens');
    expect(markup).toContain('usage_stats.analysis_blended_rate');
    expect(markup.indexOf('usage_stats.total_cost')).toBeLessThan(markup.indexOf('usage_stats.analysis_cost_per_million_tokens'));
    expect(markup).toContain('--cost-segment-color:#2563eb');
    expect(markup).toContain('--cost-segment-color:#16a34a');
    expect(markup).toContain('--cost-segment-color:#d97706');
    expect(markup).toContain('background-color:#2563eb');
    expect(markup).toContain('background-color:#16a34a');
    expect(markup).toContain('background-color:#d97706');
    expect(markup).not.toContain('filter:saturate');
    expect(markup).toContain('usage_stats.analysis_cost_share: 16.67%');
    expect(markup).toContain('usage_stats.input_tokens · usage_stats.analysis_cost_share');
    expect(markup).not.toContain('title="usage_stats.input_tokens · usage_stats.analysis_cost_share');
    expect(markup).toContain('usage_stats.analysis_cost_per_million_tokens: $4.00');
    expect(markup).toContain('usage_stats.total_tokens: 50万');
    expect(markup).toContain('usage_stats.analysis_cost_rate_sparkline_hint');
    expect(markup).toContain('usage_stats.analysis_cost_per_million_tokens: $2.00');
    expect(markup).toContain('usage_stats.total_cost: $6.00');
    expect(markup).toContain('usage_stats.total_tokens: 300万');
    expect(markup).toContain('aria-label="09:00, usage_stats.analysis_cost_per_million_tokens: $2.00, usage_stats.total_cost: $6.00, usage_stats.total_tokens: 300万"');
    expect(markup).toContain('class="_costRateSparkBar_');
    expect(markup).toContain('tabindex="0"');
    expect(markup).toContain('$6.00');
    expect(markup).toContain('$2.00');
    expect(markup).toContain('16.67%');
    expect(markup).toContain('50.00%');
    expect(markup).toContain('33.33%');
  });

  it('hides model efficiency from the simplified analysis dashboard', () => {
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      model_efficiency: [{
        model: 'gpt-5',
        requests: 10,
        input_tokens: 1000,
        output_tokens: 500,
        cached_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 1500,
        cost_usd: 0.5,
        cost_available: true,
        cost_per_request_usd: 0.05,
        output_tokens_per_request: 50,
        cache_rate: 0,
      }],
    };

    const markup = renderToStaticMarkup(<AnalysisTokenUsagePanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);

    expect(markup).not.toContain('usage_stats.analysis_model_efficiency_title');
    expect(chartCapture.scatterData.findIndex((data) => data.datasets[0]?.label === 'usage_stats.analysis_model_efficiency_title')).toBe(-1);
  });
  it('does not render model efficiency tooltips in the simplified analysis dashboard', () => {
    const analysis: AnalysisResponse = { ...emptyAnalysis };

    renderToStaticMarkup(<AnalysisTokenUsagePanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);

    expect(chartCapture.scatterData.findIndex((data) => data.datasets[0]?.label === 'usage_stats.analysis_model_efficiency_title')).toBe(-1);
  });
  it('keeps partial cost values visible and shows pricing hints near analysis charts', () => {
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      token_usage: [{
        bucket: '2026-05-28T01:00:00Z',
        input_tokens: 1000,
        output_tokens: 100,
        cached_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 1100,
        requests: 3,
        cost_usd: 0,
        cost_available: false,
      }],
      api_key_composition: [{
        key: 'unpriced-key',
        label: 'Unpriced Key',
        requests: 3,
        input_tokens: 1000,
        output_tokens: 100,
        cached_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 1100,
        percent: 100,
        cost_usd: 0,
        cost_available: false,
      }],
      model_efficiency: [{
        model: 'unpriced-model',
        requests: 3,
        input_tokens: 1000,
        output_tokens: 100,
        cached_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 1_000_000,
        cost_usd: 0,
        cost_available: false,
        cost_per_request_usd: 0,
        output_tokens_per_request: 33.33,
        cache_rate: 0,
      }],
      cost_breakdown: {
        input_cost_usd: 0,
        output_cost_usd: 0,
        cached_cost_usd: 0,
        total_cost_usd: 0,
        cost_available: false,
      },
      heatmap: {
        api_keys: ['unpriced-key'],
        api_key_labels: { 'unpriced-key': 'Unpriced Key' },
        models: ['unpriced-model'],
        cells: [{
          api_key: 'unpriced-key',
          model: 'unpriced-model',
          input_tokens: 1000,
          output_tokens: 100,
          cached_tokens: 0,
          reasoning_tokens: 0,
          total_tokens: 1100,
          requests: 3,
          cost_usd: 0,
          cost_available: false,
          intensity: 1,
        }],
      },
    };

    const tokenMarkup = renderToStaticMarkup(<AnalysisTokenUsagePanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);
    const markup = `${tokenMarkup}${renderToStaticMarkup(<AnalysisPanel analysis={analysis} loading={false} isDark={false} isMobile={false} />)}`;

    const costDataset = chartCapture.barData?.datasets.find((dataset) => dataset.label === 'usage_stats.total_cost');
    expect(costDataset?.data).toEqual([0]);
    expect(chartCapture.scatterData).toHaveLength(0);
    expect(markup).toMatch(/Unpriced Key[\s\S]*\$0\.0000/);
    expect(markup).toContain('usage_stats.cost_need_price');
    expect(markup).toContain('<div class="_cardTitleLine_');
    expect(markup).toContain('<h2>usage_stats.analysis_token_usage_title</h2><small class="_costHeaderHint_');
    expect(markup).toContain('</small></div><p>usage_stats.analysis_token_usage_subtitle</p>');
    expect(markup).not.toContain('usage_stats.analysis_token_usage_subtitle (usage_stats.cost_need_price)');
    expect(markup.match(/costHeaderHint/g)?.length).toBe(3);
    expect(markup).not.toContain('costWarning');
    expect(markup).toContain('usage_stats.analysis_cost_per_million_tokens</span><strong>$0.0000</strong>');
    expect(markup).toContain('usage_stats.total_cost: $0.0000');
  });

  it('keeps partially priced cost breakdown rates visible under the card-level pricing hint', () => {
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      token_usage: [{
        bucket: '2026-05-28T01:00:00Z',
        input_tokens: 1000,
        output_tokens: 100,
        cached_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 1100,
        requests: 3,
        cost_usd: 9,
        cost_available: false,
      }],
      cost_breakdown: {
        input_cost_usd: 9,
        output_cost_usd: 0,
        cached_cost_usd: 0,
        total_cost_usd: 9,
        cost_available: false,
      },
    };

    renderToStaticMarkup(<AnalysisTokenUsagePanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);
    const markup = renderToStaticMarkup(<AnalysisPanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);

    const costDataset = chartCapture.barData?.datasets.find((dataset) => dataset.label === 'usage_stats.total_cost');
    expect(costDataset?.data).toEqual([9]);
    expect(markup).toContain('<h2>usage_stats.analysis_cost_breakdown_title</h2><small class="_costHeaderHint_');
    expect(markup).toContain('usage_stats.cost_need_price');
    expect(markup).toContain('usage_stats.total_cost</span><strong>$9.00</strong>');
    expect(markup).toContain('usage_stats.analysis_cost_per_million_tokens</span><strong>$8,181.82</strong>');
    expect(markup).not.toContain('usage_stats.analysis_cost_per_million_tokens</span><strong>usage_stats.cost_need_price</strong>');
    expect(markup).not.toContain('costWarning');
  });

  it('hides heatmap cells from the simplified analysis dashboard', () => {
    const responseKey = '9007199254740993';
    const analysis: AnalysisResponse = {
      ...emptyAnalysis,
      heatmap: {
        api_keys: [responseKey],
        api_key_labels: { [responseKey]: 'Primary Key' },
        models: ['claude-3-7-sonnet-20250219-long-context'],
        cells: [{
          api_key: responseKey,
          model: 'claude-3-7-sonnet-20250219-long-context',
          input_tokens: 1000,
          output_tokens: 200,
          reasoning_tokens: 30,
          cached_tokens: 100,
          total_tokens: 1330,
          requests: 3,
          cost_usd: 0.1234,
          cost_available: true,
          intensity: 1,
        }],
      },
    };

    const markup = renderToStaticMarkup(<AnalysisTokenUsagePanel analysis={analysis} loading={false} isDark={false} isMobile={false} />);

    expect(markup).not.toContain('usage_stats.analysis_heatmap_title');
    expect(markup).not.toContain('1,330');
    expect(markup).not.toContain('Primary Key');
  });
  it('keeps rendering when an older analysis response omits heatmap', () => {
    const analysis = { ...emptyAnalysis, heatmap: undefined } as unknown as AnalysisResponse;

    expect(() => renderToStaticMarkup(<AnalysisPanel analysis={analysis} loading={false} isDark={false} isMobile={false} />)).not.toThrow();
  });
});
