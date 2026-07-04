import { describe, expect, it } from 'vitest';
import i18n, { SUPPORTED_LANGUAGES, isSupportedLanguage } from './index';

const flattenKeys = (value: unknown, prefix = ''): string[] => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return flattenKeys(child, path);
  });
};

describe('i18n resources', () => {
  it('only supports simplified Chinese', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['zh']);
    expect(isSupportedLanguage('zh')).toBe(true);
    expect(isSupportedLanguage('en')).toBe(false);
    expect(isSupportedLanguage('zh-TW')).toBe(false);
    expect(i18n.getResourceBundle('en', 'translation')).toBeUndefined();
    expect(i18n.getResourceBundle('zh-TW', 'translation')).toBeUndefined();
  });

  it('keeps the simplified Chinese resource populated', () => {
    const zh = i18n.getResourceBundle('zh', 'translation');
    expect(flattenKeys(zh).length).toBeGreaterThan(400);
    expect(zh.auth.login_title).toBe('CPA 用量统计仪表盘');
    expect(zh.usage_stats.credentials_auth_files_display_mode_aria).toBe('认证文件显示模式');
  });

  it('includes first-run setup copy', () => {
    expect(i18n.getResource('zh', 'translation', 'auth.setup_title')).toBe('首次配置');
    expect(i18n.getResource('zh', 'translation', 'auth.setup_cpa_key_label')).toBe('CPA Management Center 密钥');
    expect(i18n.getResource('zh', 'translation', 'auth.setup_password_mismatch')).toBe('两次输入的密码不一致');
    expect(i18n.getResource('zh', 'translation', 'auth.setup_cpa_key_mismatch')).toBe('两次输入的 CPA 密钥不一致');
  });

  it('removes obsolete labels', () => {
    const usageStats = i18n.getResourceBundle('zh', 'translation').usage_stats;
    expect(usageStats).not.toHaveProperty('api_details');
    expect(usageStats).not.toHaveProperty('model_stats');
    expect(usageStats).not.toHaveProperty('tab_analysis');
    expect(usageStats).not.toHaveProperty('overview_realtime_response_level');
  });
});
