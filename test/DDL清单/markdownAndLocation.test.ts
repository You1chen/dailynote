/**
 * Markdown 渲染测试 + 地点字段往返
 *
 * 验证：
 *   1. 段落 / 换行 / 粗斜体 / 删除线 / 行内代码
 *   2. 标题、列表、引用、分割线、代码块、链接
 *   3. XSS：用户写 <script> 只会变成转义文本
 *   4. markdownToPlain 去掉标记
 *   5. DDL / 重要的事 保存 location 后能读回（共用同一套组件与字段）
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';

const memStore: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (Object.prototype.hasOwnProperty.call(memStore, k) ? memStore[k] : null),
  setItem: (k: string, v: string) => { memStore[k] = v; },
  removeItem: (k: string) => { delete memStore[k]; },
  clear: () => { Object.keys(memStore).forEach(k => delete memStore[k]); },
};

import { _resetForTest } from '../../src/services/store';
import * as db from '../../src/db';
import { renderMarkdown, markdownToPlain } from '../../src/utils/markdown';

beforeEach(async () => {
  Object.keys(memStore).forEach(k => delete memStore[k]);
  await _resetForTest();
});

describe('Markdown 渲染', () => {
  it('空内容返回空串', () => {
    expect(renderMarkdown('')).toBe('');
    expect(renderMarkdown('   ')).toBe('');
  });

  it('段落与换行', () => {
    expect(renderMarkdown('第一行\n第二行')).toBe('<p>第一行<br />第二行</p>');
    expect(renderMarkdown('段落一\n\n段落二')).toBe('<p>段落一</p><p>段落二</p>');
  });

  it('粗体、斜体、删除线、行内代码', () => {
    expect(renderMarkdown('**粗**')).toBe('<p><strong>粗</strong></p>');
    expect(renderMarkdown('*斜*')).toBe('<p><em>斜</em></p>');
    expect(renderMarkdown('~~删~~')).toBe('<p><del>删</del></p>');
    expect(renderMarkdown('`code`')).toBe('<p><code>code</code></p>');
  });

  it('标题 / 无序列表 / 有序列表', () => {
    expect(renderMarkdown('## 标题')).toBe('<h2>标题</h2>');
    expect(renderMarkdown('- A\n- B')).toBe('<ul><li>A</li><li>B</li></ul>');
    expect(renderMarkdown('1. A\n2. B')).toBe('<ol><li>A</li><li>B</li></ol>');
  });

  it('引用 / 分割线 / 代码块', () => {
    expect(renderMarkdown('> 引用')).toBe('<blockquote>引用</blockquote>');
    expect(renderMarkdown('---')).toBe('<hr />');
    expect(renderMarkdown('```\nconst a = 1;\n```')).toBe('<pre><code>const a = 1;</code></pre>');
  });

  it('链接只认 http(s)', () => {
    expect(renderMarkdown('[站点](https://example.com)'))
      .toContain('<a href="https://example.com" target="_blank" rel="noreferrer">站点</a>');
    expect(renderMarkdown('[坏](javascript:alert(1))')).not.toContain('<a');
  });

  it('用户写的 HTML 会被转义（不会执行）', () => {
    const html = renderMarkdown('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('markdownToPlain 去掉标记', () => {
    expect(markdownToPlain('## 标题\n- **重点** `x`')).toBe('标题 重点 x');
    expect(markdownToPlain('')).toBe('');
  });
});

describe('地点字段往返', () => {
  it('DDL 保存地点后能读回', async () => {
    const id = await db.saveDdl({
      name: '交报告',
      deadlineDate: '2026-11-01',
      deadlineTime: '18:00',
      location: '三教 302',
      notes: '',
      images: [],
      createdAt: 0,
      updatedAt: 0,
    });
    const item = (await db.getAllDdls()).find(x => x.id === id)!;
    expect(item.location).toBe('三教 302');
  });

  it('重要的事保存地点与 Markdown 备注后能读回', async () => {
    const id = await db.saveImportant({
      name: '答辩',
      deadlineDate: '2026-11-02',
      deadlineTime: '',
      location: '一教 101',
      notes: '## 材料\n- 三份',
      images: [],
      createdAt: 0,
      updatedAt: 0,
    });
    const item = (await db.getAllImportant()).find(x => x.id === id)!;
    expect(item.location).toBe('一教 101');
    expect(item.notes).toContain('## 材料');
    expect(renderMarkdown(item.notes)).toContain('<h2>材料</h2>');
  });
});
