import { describe, expect, it } from 'vitest';
import { buildKnowledgeNodes, nodesToMarkdown, parseKnowledgeMarkdown, parseNoteBlocks } from '../src/utils/knowledgeMap';
import type { KnowledgeNode } from '../src/types/knowledge';
import { renderKnowledgeNoteText } from '../src/utils/knowledgeNoteRender';

const source = '- 绪论 p1\n- 第一章 数制和码制 p4\n  - 1.1 概述 p4\n    - 1.1.1 二进制 p6\n';

describe('knowledge map parser', () => {
  it('parses list markers, hierarchy and page metadata', () => {
    const result = parseKnowledgeMarkdown(source);
    expect(result.error).toBeUndefined();
    expect(result.lines).toEqual(expect.arrayContaining([
      { depth: 0, title: '绪论 p1', page: 'p1' },
      { depth: 1, title: '1.1 概述 p4', page: 'p4' },
    ]));
    const nodes = buildKnowledgeNodes(source).nodes;
    expect(nodes.filter(node => !node.parentId)).toHaveLength(2);
    expect(nodes.find(node => node.title === '1.1.1 二进制 p6')?.depth).toBe(2);
  });

  it('rejects non-list lines and level jumps', () => {
    expect(parseKnowledgeMarkdown('- a\n    - jump').error).toContain('层级跳跃');
    expect(parseKnowledgeMarkdown('- a\ntext').error).toContain('不是无序列表');
  });

  it('preserves IDs, status and collector links on matching reparse', () => {
    const first = buildKnowledgeNodes('- A\n  - B').nodes;
    first[1].status = 'learned';
    first[1].cardIds = ['card-b'];
    const next = buildKnowledgeNodes('- A renamed\n  - B', first).nodes.find(node => node.title === 'B');
    expect(next?.id).toBe(first[1].id);
    expect(next?.status).toBe('learned');
    expect(next?.cardIds).toEqual(['card-b']);
  });

  it('keeps collector card references when reparsing the tree', () => {
    const old = buildKnowledgeNodes('- Chapter').nodes;
    old[0].cardIds = ['card-1'];
    const next = buildKnowledgeNodes('- Chapter renamed', old).nodes;
    expect(next[0].cardIds).toEqual(['card-1']);
  });

  it('roundtrips tree markdown and renders LaTeX safely', () => {
    const nodes = buildKnowledgeNodes(source).nodes;
    expect(nodesToMarkdown(nodes)).toContain('- 绪论 p1');
    const html = renderKnowledgeNoteText('公式 $x^2$ <img src=x onerror=alert(1)>');
    expect(html).toContain('katex');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
