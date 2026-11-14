import { describe, expect, it } from 'vitest';
import type { KnowledgeNode } from '../src/types/knowledge';
import { deleteKnowledgeNodes, duplicateKnowledgeLeaf, mergeKnowledgeLeaves, moveKnowledgeLeaves, renameKnowledgeNode } from '../src/utils/knowledgeTreeOps';

const nodes: KnowledgeNode[] = [
  { id: 'root', title: 'Root', depth: 0, status: 'todo', children: ['a','b','target'], cardIds: [] },
  { id: 'a', title: 'A', parentId: 'root', depth: 1, status: 'todo', children: [], cardIds: ['ca'] },
  { id: 'b', title: 'B', parentId: 'root', depth: 1, status: 'todo', children: [], cardIds: ['cb'] },
  { id: 'target', title: 'Target', parentId: 'root', depth: 1, status: 'todo', children: [], cardIds: [] },
];

describe('knowledge node operations', () => {
  it('renames and rejects empty names', () => {
    expect(renameKnowledgeNode(nodes, 'a', 'Renamed').nodes.find(n => n.id === 'a')?.title).toBe('Renamed');
    expect(renameKnowledgeNode(nodes, 'a', '   ').error).toBeTruthy();
  });

  it('deletes selected nodes and descendants while repairing parent children', () => {
    const next = deleteKnowledgeNodes(nodes, ['root']).nodes;
    expect(next).toHaveLength(0);
    const leaf = deleteKnowledgeNodes(nodes, ['a']).nodes;
    expect(leaf.find(n => n.id === 'root')?.children).toEqual(['b','target']);
  });

  it('duplicates a leaf with the same collector card references in order', () => {
    const result = duplicateKnowledgeLeaf(nodes, 'a', 'A copy');
    const copy = result.nodes.find(n => n.title === 'A copy')!;
    expect(copy.cardIds).toEqual(['ca']);
    expect(result.nodes.find(n => n.id === 'root')?.children).toEqual(['a',copy.id,'b','target']);
  });

  it('merges no-child siblings in tree order into the chosen target', () => {
    const result = mergeKnowledgeLeaves(nodes, ['b'], 'a', 'Combined');
    expect(result.error).toBeUndefined();
    expect(result.nodes.find(n => n.id === 'a')?.title).toBe('Combined');
    expect(result.nodes.find(n => n.id === 'a')?.cardIds).toEqual(['ca','cb']);
    expect(result.nodes.find(n => n.id === 'root')?.children).toEqual(['a','target']);
  });

  it('moves selected leaves under a no-card target preserving order', () => {
    const result = moveKnowledgeLeaves(nodes, ['a','b'], 'target');
    expect(result.error).toBeUndefined();
    expect(result.nodes.find(n => n.id === 'target')?.children).toEqual(['a','b']);
    expect(result.nodes.find(n => n.id === 'a')?.parentId).toBe('target');
    expect(result.nodes.find(n => n.id === 'a')?.cardIds).toEqual(['ca']);
  });

  it('rejects card-bearing move targets and non-leaf merge targets', () => {
    expect(moveKnowledgeLeaves(nodes, ['a'], 'b').error).toContain('关联卡片');
    const parent: KnowledgeNode = { id: 'parent', title: 'P', depth: 0, status: 'todo', children: ['child'], cardIds: [] };
    expect(mergeKnowledgeLeaves([...nodes, parent], ['a'], 'parent', 'Merged').error).toContain('末端');
  });
});
