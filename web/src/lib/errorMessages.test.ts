import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { formatUserActionableError } from './errorMessages';

describe('formatUserActionableError', () => {
  it('maps management key authorization failures to a config diagnostics action', () => {
    const message = formatUserActionableError(
      new ApiError('HTTP 401: missing CPA_MANAGED_SECRET_KEY', 401),
      '无法启动 CPA。',
    );

    expect(message).toContain('CPA 管理密钥缺失或不匹配');
    expect(message).toContain('配置诊断');
    expect(message).toContain('CPA_MANAGED_SECRET_KEY');
  });

  it('asks users to log in again for ordinary dashboard 401 errors', () => {
    expect(formatUserActionableError(new ApiError('expired', 401), '刷新失败')).toBe('登录状态已失效，请重新登录后再操作。');
  });

  it('marks missing endpoints as not migrated or unsupported', () => {
    expect(formatUserActionableError(new ApiError('not found', 404), '无法加载 CPA 运行状态。')).toBe(
      '无法加载 CPA 运行状态：接口暂未迁移或当前版本不支持，请先更新到包含该功能的版本。',
    );
  });

  it('keeps raw English fetch fallbacks out of user-facing text', () => {
    expect(formatUserActionableError(new Error('Failed to load CPA runtime: 500'), '无法加载 CPA 运行状态。')).toBe('无法加载 CPA 运行状态。');
  });

  it('keeps specific non-HTTP messages visible', () => {
    expect(formatUserActionableError(new Error('配置文件不存在'), '无法加载配置诊断。')).toBe('配置文件不存在');
  });
});
