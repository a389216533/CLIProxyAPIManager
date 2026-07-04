import { createElement } from 'react';
import '@/i18n';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ConfigDiagnosticsPanel, sortConfigDiagnosticChecks } from './ConfigDiagnosticsPanel';
import type { ConfigDiagnosticCheck } from '@/lib/types';

describe('ConfigDiagnosticsPanel check sorting', () => {
  it('places failed error and warning checks before passing checks', () => {
    const checks: ConfigDiagnosticCheck[] = [
      { code: 'ok.config', ok: true, level: 'info', message: 'ok' },
      { code: 'warn.config', ok: false, level: 'warning', message: 'warning' },
      { code: 'error.config', ok: false, level: 'error', message: 'error' },
    ];

    expect(sortConfigDiagnosticChecks(checks).map((check) => check.code)).toEqual([
      'error.config',
      'warn.config',
      'ok.config',
    ]);
  });
});

describe('ConfigDiagnosticsPanel rendering', () => {
  it('renders the config diagnostics title and refresh action', () => {
    const html = renderToStaticMarkup(createElement(ConfigDiagnosticsPanel));

    expect(html).toContain('配置诊断');
    expect(html).toContain('刷新');
  });
});
