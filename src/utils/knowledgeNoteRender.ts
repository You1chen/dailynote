import katex from 'katex';
import 'katex/dist/katex.min.css';

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
}

export function renderKnowledgeNoteText(source: string): string {
  let output = '';
  let cursor = 0;
  const pattern = /\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$|\\\(([^]*?)\\\)|\\\[([^]*?)\\\]/g;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    output += escapeHtml(source.slice(cursor, start));
    const formula = match[1] ?? match[2] ?? match[3] ?? match[4];
    const display = match[1] !== undefined || match[4] !== undefined;
    try {
      output += katex.renderToString(formula, { displayMode: display, throwOnError: true, trust: false });
    } catch {
      output += escapeHtml(match[0]);
    }
    cursor = start + match[0].length;
  }
  return output + escapeHtml(source.slice(cursor));
}
