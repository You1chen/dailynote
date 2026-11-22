import type { GoalNode } from '../types';
import { nodeProgress, treeProgress } from './goalTree';

export interface MapNode {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  progress: number | null;
  leaf: boolean;
  completed: boolean;
  steps: number;
  parent: string | null;
}

const colors = ['#d9704b', '#3f9c86', '#6f74c4', '#bf8f2f', '#4b93b8', '#b96f96'];
const ROOT = { width: 196, height: 96 };
const CHILD = { width: 162, height: 84 };
const GAP_X = 54;
const GAP_Y = 62;
const ROW_GAP = 18;
const columnHeight = CHILD.height + ROW_GAP;

/**
 * 手机优先的双翼脑图：中心是当前节点，一级分支左右交替向下排。
 * 坐标系是世界坐标（与画布像素无关），由渲染端做适配缩放。
 */
export function layoutMindmap(title: string, nodes: GoalNode[]): MapNode[] {
  const children: MapNode[] = nodes.map((node, index) => {
    const side = index % 2 === 0 ? 1 : -1;
    const row = Math.floor(index / 2);
    return {
      id: node.id,
      title: node.title,
      x: side * (ROOT.width / 2 + GAP_X + CHILD.width / 2),
      y: row * columnHeight,
      width: CHILD.width,
      height: CHILD.height,
      color: colors[index % colors.length],
      progress: nodeProgress(node),
      leaf: node.children.length === 0,
      completed: node.completed,
      steps: node.children.length,
      parent: '__root__',
    };
  });
  const rootY = children.length ? Math.floor((children.length - 1) / 2) * (columnHeight / 2) : 0;
  return [{
    id: '__root__',
    title,
    x: 0,
    y: rootY,
    width: ROOT.width,
    height: ROOT.height,
    color: '#237a67',
    progress: treeProgress(nodes),
    leaf: false,
    completed: false,
    steps: nodes.length,
    parent: null,
  }, ...children];
}

export function mindmapBounds(nodes: MapNode[]) {
  return {
    left: Math.min(...nodes.map(n => n.x - n.width / 2)) - 28,
    right: Math.max(...nodes.map(n => n.x + n.width / 2)) + 28,
    top: Math.min(...nodes.map(n => n.y - n.height / 2)) - 22,
    bottom: Math.max(...nodes.map(n => n.y + n.height / 2)) + 30,
  };
}

export function hitMindmap(nodes: MapNode[], x: number, y: number): MapNode | undefined {
  return nodes.find(n => Math.abs(x - n.x) <= n.width / 2 && Math.abs(y - n.y) <= n.height / 2);
}
