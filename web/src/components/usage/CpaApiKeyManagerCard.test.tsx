import React from 'react';
import '@/i18n';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CpaApiKeyManagerCard, copyApiKeyToClipboard, getCpaApiKeyManagerCanSave } from './CpaApiKeyManagerCard';
import { CpaApiKeyDeleteDialog, CpaApiKeyEditorDialog } from './CpaApiKeyManagerDialogs';
import type { CpaApiKeySettingsItem } from '@/lib/types';

const apiKeys: CpaApiKeySettingsItem[] = [
  { id: '9007199254740993', apiKey: 'sk-alpha123456', keyAlias: 'Primary', displayKey: 'sk-*********123456', label: 'Primary', lastSyncedAt: null },
];

const renderCard = (props: Partial<React.ComponentProps<typeof CpaApiKeyManagerCard>> = {}) => renderToStaticMarkup(
  <CpaApiKeyManagerCard
    apiKeys={apiKeys}
    loading={false}
    creating={false}
    savingId={null}
    deletingId={null}
    onCreate={() => undefined}
    onSave={() => undefined}
    onDelete={() => undefined}
    {...props}
  />,
);

describe('CpaApiKeyManagerCard', () => {
  it('renders credential hierarchy with read-only, secret-safe API key rows by default', () => {
    const html = renderCard();

    expect(html).toContain('CPA API Key 管理');
    expect(html).toContain('<section');
    expect(html).toContain('名称');
    expect(html).toContain('Key 值');
    expect(html).toContain('Primary');
    expect(html).toContain('sk-*********123456');
    expect(html).toContain('新建 API Key');
    expect(html).toContain('复制');
    expect(html).toContain('编辑');
    expect(html).toContain('删除');
    expect(html).toContain('显示 Key 值');
    expect(html).toContain('aria-pressed="false"');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('sk-alpha123456');
    expect(html).not.toContain('9007199254740993');
  });

  it('renders a delete target summary without exposing its raw key', () => {
    const html = renderToStaticMarkup(
      <CpaApiKeyDeleteDialog
        target={apiKeys[0]}
        error=""
        deleting={false}
        title="删除 CPA API Key"
        body="删除后无法恢复，请确认是否继续。"
        cancelLabel="取消"
        deleteLabel="删除"
        onClose={() => undefined}
        onConfirm={() => undefined}
      />,
    );

    expect(html).toContain('Primary');
    expect(html).toContain('sk-*********123456');
    expect(html).not.toContain('sk-alpha123456');
  });

  it('marks editor fields required and associates callback errors with both fields', () => {
    const html = renderToStaticMarkup(
      <CpaApiKeyEditorDialog
        open
        title="编辑 CPA API Key"
        draft={{ keyAlias: 'Primary', apiKey: 'sk-alpha123456' }}
        error="保存失败"
        submitting={false}
        submitLabel="保存"
        cancelLabel="取消"
        nameLabel="名称"
        namePlaceholder="例如：主账号"
        keyLabel="Key 值"
        keyPlaceholder="粘贴完整 API Key"
        showKeyLabel="显示 Key 值"
        hideKeyLabel="隐藏 Key 值"
        onDraftChange={() => undefined}
        onClose={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    const errorId = html.match(/id="([^"]+-error)"/)?.[1] ?? '';

    expect(html.match(/required=""/g)).toHaveLength(2);
    expect(errorId).not.toBe('');
    expect(html.match(new RegExp(`aria-describedby="${errorId}"`, 'g'))).toHaveLength(2);
  });

  it('renders loading and empty states', () => {
    expect(renderCard({ apiKeys: [], loading: true })).toContain('加载中...');
    expect(renderCard({ apiKeys: [], loading: false })).toContain('暂无 CPA API Key。');
  });

  it('requires both name and key before saving', () => {
    expect(getCpaApiKeyManagerCanSave({ keyAlias: 'Name', apiKey: 'sk-value' })).toBe(true);
    expect(getCpaApiKeyManagerCanSave({ keyAlias: '', apiKey: 'sk-value' })).toBe(false);
    expect(getCpaApiKeyManagerCanSave({ keyAlias: 'Name', apiKey: ' ' })).toBe(false);
  });

  it('copies the raw key value', async () => {
    const writes: string[] = [];

    await copyApiKeyToClipboard(apiKeys[0].apiKey, { clipboard: { writeText: async (value) => { writes.push(value); } } });

    expect(writes).toEqual(['sk-alpha123456']);
  });

  it('falls back to textarea copy when Clipboard API writes are blocked', async () => {
    const textarea = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      select: vi.fn(),
    };
    const documentRef = {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => true),
    };
    const clipboard = { writeText: vi.fn(async () => { throw new Error('blocked'); }) };

    await copyApiKeyToClipboard(apiKeys[0].apiKey, { clipboard, document: documentRef });

    expect(clipboard.writeText).toHaveBeenCalledWith('sk-alpha123456');
    expect(textarea.value).toBe('sk-alpha123456');
    expect(documentRef.body.appendChild).toHaveBeenCalledWith(textarea);
    expect(documentRef.execCommand).toHaveBeenCalledWith('copy');
    expect(documentRef.body.removeChild).toHaveBeenCalledWith(textarea);
  });
});
