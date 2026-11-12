import { describe, expect, it } from 'vitest';
import { buildKnowledgeNodes, nodesToMarkdown, parseKnowledgeMarkdown, parseNoteBlocks } from '../src/utils/knowledgeMap';
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

  it('preserves IDs, status and notes on matching reparse', () => {
    const first = buildKnowledgeNodes('- A\n  - B').nodes;
    first[1].status = 'learned';
    first[1].note = { blocks: [{ id: 'note', text: 'x', checklist: false }], updatedAt: 1 };
    const next = buildKnowledgeNodes('- A renamed\n  - B', first).nodes.find(node => node.title === 'B');
    expect(next?.id).toBe(first[1].id);
    expect(next?.status).toBe('learned');
    expect(next?.note?.blocks[0].text).toBe('x');
  });

  it('uses three or more trailing ASCII spaces as a checklist marker', () => {
    const note = parseNoteBlocks('zero\none \ntwo  \nthree   \nwide　');
    expect(note.blocks.map(block => block.checklist)).toEqual([false, false, false, true, false]);
    expect(note.blocks[3].text).toBe('three');
    expect(parseNoteBlocks('three   ', note).blocks[0].checked).toBe(false);
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
