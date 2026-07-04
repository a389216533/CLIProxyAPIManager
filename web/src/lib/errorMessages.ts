import { ApiError } from './api';

const MANAGEMENT_KEY_HINT = '请打开“配置诊断”检查 Keeper 的 CPA_MANAGED_SECRET_KEY 与 CPA config.yaml 中的管理密钥是否一致。';

const MANAGEMENT_KEY_PATTERNS = [
  /CPA_MANAGED_SECRET_KEY/i,
  /management\s+key/i,
  /managed\s+secret/i,
  /manager\s+secret/i,
  /invalid\s+secret/i,
  /missing\s+secret/i,
];

function trimSentenceEnding(message: string): string {
  return message.replace(/[。.!！\s]+$/u, '');
}

function rawErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return '';
}

export function formatUserActionableError(error: unknown, fallback: string): string {
  const message = rawErrorMessage(error).trim();

  if (error instanceof ApiError) {
    if (error.status === 401) {
      if (MANAGEMENT_KEY_PATTERNS.some((pattern) => pattern.test(message))) {
        return `CPA 管理密钥缺失或不匹配，管理操作未通过授权。${MANAGEMENT_KEY_HINT}`;
      }
      return '登录状态已失效，请重新登录后再操作。';
    }

    if (error.status === 403) {
      return '当前账号没有执行此管理操作的权限，请使用管理员账号登录。';
    }

    if (error.status === 404) {
      return `${trimSentenceEnding(fallback)}：接口暂未迁移或当前版本不支持，请先更新到包含该功能的版本。`;
    }

    if (error.status >= 500) {
      return `${trimSentenceEnding(fallback)}：后端服务暂时不可用，请稍后重试；如果持续失败，请查看配置诊断和服务日志。`;
    }
  }

  if (/^HTTP\s+401\b/i.test(message) || /\b(status|statusCode)["':\s]+401\b/i.test(message)) {
    return `CPA 管理授权失败。${MANAGEMENT_KEY_HINT}`;
  }

  if (MANAGEMENT_KEY_PATTERNS.some((pattern) => pattern.test(message))) {
    return `CPA 管理密钥缺失或不匹配。${MANAGEMENT_KEY_HINT}`;
  }

  if (!message) return fallback;
  if (/^Failed to\b/i.test(message)) return fallback;
  return message;
}
