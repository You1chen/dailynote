/**
 * 极简 Markdown 渲染（无第三方依赖）
 *
 * 只支持备注里真正会用到的：标题、粗体/斜体/删除线、行内代码、代码块、
 * 有序/无序列表、引用、分割线、链接、换行。
 *
 * 安全：先整体转义 HTML，再按标记生成标签，因此用户写 <script> 也不会被执行。
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内标记：先转义，再套标签（转义不影响 * ` ~ [ ] 等标记字符） */
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

/** Markdown → HTML 字符串（内容已转义，可安全放进 dangerouslySetInnerHTML） */
export function renderMarkdown(src: string): string {
  if (!src || !src.trim()) return '';

  // 结构判断用原始行（否则 > 引用会被转义成 &gt; 而失效），内容再逐段转义
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  let code: string[] | null = null;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.join('<br />')}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (list) { out.push(`</${list}>`); list = null; }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');

    // 代码块护栏
    if (/^```/.test(line)) {
      if (code) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = null;
      } else {
        flushPara(); closeList(); code = [];
      }
      continue;
    }
    if (code) { code.push(line); continue; }

    if (!line.trim()) { flushPara(); closeList(); continue; }

    // 分割线
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      flushPara(); closeList(); out.push('<hr />'); continue;
    }

    // 标题
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      flushPara(); closeList();
      const lv = h[1].length;
      out.push(`<h${lv}>${inline(h[2])}</h${lv}>`);
      continue;
    }

    // 引用
    const q = /^>\s?(.*)$/.exec(line);
    if (q) {
      flushPara(); closeList();
      out.push(`<blockquote>${inline(q[1])}</blockquote>`);
      continue;
    }

    // 无序列表
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ul) {
      flushPara();
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    // 有序列表
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ol) {
      flushPara();
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    closeList();
    para.push(inline(line));
  }

  if (code) out.push(`<pre><code>${code.join('\n')}</code></pre>`);
  flushPara();
  closeList();
  return out.join('');
}

/** Markdown → 单行纯文本（用于列表里的摘要，不显示标记符号） */
export function markdownToPlain(src: string): string {
  if (!src) return '';
  return src
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
