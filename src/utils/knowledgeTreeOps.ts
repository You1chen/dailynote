import type { KnowledgeMap, KnowledgeNode } from '../types/knowledge';

export interface KnowledgeTreeResult {
  nodes: KnowledgeNode[];
  error?: string;
}

export function renameKnowledgeNode(nodes: KnowledgeNode[], id: string, title: string): KnowledgeTreeResult {
  const normalized = title.trim();
  if (!normalized) return { nodes, error: '名称不能为空' };
  return { nodes: nodes.map(node => node.id === id ? { ...node, title: normalized } : node) };
}

export function deleteKnowledgeNodes(nodes: KnowledgeNode[], ids: string[]): KnowledgeTreeResult {
  const removed = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (node.parentId && removed.has(node.parentId) && !removed.has(node.id)) { removed.add(node.id); changed = true; }
  }
  return { nodes: nodes.filter(node => !removed.has(node.id)).map(node => ({ ...node, children: node.children.filter(id => !removed.has(id)) })) };
}

export function duplicateKnowledgeLeaf(nodes: KnowledgeNode[], id: string, newTitle: string): KnowledgeTreeResult {
  const source = nodes.find(node => node.id === id);
  const title = newTitle.trim();
  if (!source || source.children.length) return { nodes, error: '只能复制末端节点' };
  if (!title) return { nodes, error: '名称不能为空' };
  const copy: KnowledgeNode = {
    ...source,
    id: `node-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title,
    children: [],
    status: 'todo',
    cardIds: [...(source.cardIds ?? [])],
  };
  const result = [...nodes];
  const parentIndex = source.parentId ? result.findIndex(node => node.id === source.parentId) : -1;
  if (parentIndex >= 0) {
    const children = [...result[parentIndex].children];
    const sourceChildIndex = children.indexOf(source.id);
    children.splice(sourceChildIndex + 1, 0, copy.id);
    result[parentIndex] = { ...result[parentIndex], children };
  }
  const sourceIndex = result.findIndex(node => node.id === source.id);
  const insertAt = sourceIndex + 1;
  const nextSibling = source.parentId
    ? result.findIndex((node, index) => index > sourceIndex && node.parentId === source.parentId && node.depth === source.depth)
    : result.findIndex((node, index) => index > sourceIndex && !node.parentId && node.depth === source.depth);
  result.splice(nextSibling >= 0 ? nextSibling : insertAt, 0, copy);
  return { nodes: result };
}

export function mergeKnowledgeLeaves(nodes: KnowledgeNode[], sourceIds: string[], targetId: string, newTitle: string): KnowledgeTreeResult {
  const ids = [...new Set(sourceIds)].filter(id => id !== targetId);
  const target = nodes.find(node => node.id === targetId);
  const sources = ids.map(id => nodes.find(node => node.id === id)).filter((node): node is KnowledgeNode => !!node);
  const title = newTitle.trim();
  if (!target || target.children.length) return { nodes, error: '合并目标必须是没有子节点的末端节点' };
  if (!title) return { nodes, error: '合并后的名称不能为空' };
  if (sources.some(node => node.children.length)) return { nodes, error: '只能合并末端节点' };
  if (sources.some(node => node.parentId !== target.parentId)) return { nodes, error: '只能合并同一层级的末端节点' };
  const selectedIds = new Set([...ids, targetId]);
  const orderedSources = nodes.filter(node => selectedIds.has(node.id));
  const cardIds = [...new Set(orderedSources.flatMap(node => node.cardIds ?? []))];
  const withMerged = nodes.map(node => node.id === targetId ? { ...node, title, cardIds } : node);
  return { nodes: deleteKnowledgeNodes(withMerged, ids).nodes };
}

export function moveKnowledgeLeaves(nodes: KnowledgeNode[], sourceIds: string[], targetId: string): KnowledgeTreeResult {
  const ids = [...new Set(sourceIds)].filter(id => id !== targetId);
  const target = nodes.find(node => node.id === targetId);
  const sources = ids.map(id => nodes.find(node => node.id === id)).filter((node): node is KnowledgeNode => !!node);
  if (!target) return { nodes, error: '请选择有效的目标节点' };
  if ((target.cardIds?.length ?? 0) > 0) return { nodes, error: '移动目标必须没有关联卡片' };
  if (sources.some(node => node.children.length)) return { nodes, error: '只能移动末端节点' };
  const sourceSet = new Set(ids);
  const moved = nodes.filter(node => sourceSet.has(node.id));
  let result = nodes.map(node => ({ ...node, children: node.children.filter(id => !sourceSet.has(id)) }));
  const movedNodes = moved.map(node => ({ ...node, parentId: targetId, depth: target.depth + 1 }));
  result = result.map(node => node.id === targetId ? { ...node, children: [...node.children, ...movedNodes.map(item => item.id)] } : node);
  let insertionIndex = result.findIndex(item => item.id === targetId) + 1;
  for (const node of movedNodes) {
    const oldIndex = result.findIndex(item => item.id === node.id);
    if (oldIndex >= 0) result.splice(oldIndex, 1);
    const targetIndex = result.findIndex(item => item.id === targetId);
    insertionIndex = Math.max(targetIndex + 1, Math.min(insertionIndex, result.length));
    result.splice(insertionIndex, 0, node);
    insertionIndex++;
  }
  return { nodes: result };
}

export function applyKnowledgeNodes(map: KnowledgeMap, nodes: KnowledgeNode[]): KnowledgeMap {
  return { ...map, nodes, updatedAt: Date.now() };
}
