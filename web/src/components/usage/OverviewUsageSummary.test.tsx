import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnalysisCompositionItem, AnalysisResponse } from '@/lib/types';
import { OverviewUsageSummary } from './OverviewUsageSummary';

vi.mock('react-i18next', () => ({
  initReactI18next: {
    type: '3rdParty',
    init: () => {},
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function compositionItem(key: string, label: string, totalTokens: number): AnalysisCompositionItem {
  return {
    key,
    label,
    percent: 100,
    input_tokens: totalTokens,
    output_tokens: 0,
    cached_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: totalTokens,
    requests: 1,
    cost_usd: 0,
    cost_available: true,
  };
}

const analysis: AnalysisResponse = {
  granularity: 'hourly',
  timezone: 'Asia/Shanghai',
  token_usage: [],
  api_key_composition: [compositionItem('api-key-1', 'Primary API Key', 100)],
  model_composition: [compositionItem('gpt-5', 'gpt-5', 100)],
  auth_files_composition: [compositionItem('auth-1', 'Auth File Account', 200)],
  ai_provider_composition: [],
  heatmap: { api_keys: [], api_key_labels: {}, models: [], cells: [] },
  cost_breakdown: {
    input_cost_usd: 0,
    output_cost_usd: 0,
    cached_cost_usd: 0,
    total_cost_usd: 0,
    cost_available: true,
  },
  model_efficiency: [],
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

describe('OverviewUsageSummary', () => {
  it('uses API Key composition for the consumption ranking', () => {
    const html = renderToStaticMarkup(<OverviewUsageSummary analysis={analysis} loading={false} />);

    expect(html).toContain('usage_stats.overview_account_ranking_title');
    expect(html).toContain('Primary API Key');
    expect(html).not.toContain('Auth File Account');
  });
});
