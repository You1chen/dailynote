import { describe, expect, it } from 'vitest';
import { layoutMindmap, hitMindmap, mindmapBounds } from '../../src/utils/mindmap';
import type { GoalNode } from '../../src/types';
const leaf = (id: string): GoalNode => ({ id, title: id, completed: false, children: [] });
describe('mindmap layout', () => {
  it('places branches on both wings and keeps every node', () => {
    const map = layoutMindmap('目标', [{ ...leaf('a'), children: [leaf('aa'), leaf('ab')] }, leaf('b'), leaf('c')]);
    expect(map).toHaveLength(4);
    expect(map.filter(n => n.x < 0)).toHaveLength(1);
    expect(map.filter(n => n.x > 0)).toHaveLength(2);
    for (const n of map) expect(hitMindmap(map, n.x, n.y)?.id).toBe(n.id);
  });
  it('keeps cards from overlapping and bounds covering every card', () => {
    const map = layoutMindmap('目标', Array.from({ length: 24 }, (_, i) => leaf(String(i))));
    const bounds = mindmapBounds(map);
    for (const a of map) {
      expect(a.x - a.width / 2).toBeGreaterThanOrEqual(bounds.left);
      expect(a.y - a.height / 2).toBeGreaterThanOrEqual(bounds.top);
      expect(a.y + a.height / 2).toBeLessThanOrEqual(bounds.bottom);
      for (const b of map) {
        if (a.id === b.id) continue;
        const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2;
        const overlapY = Math.abs(a.y - b.y) < (a.height + b.height) / 2;
        expect(overlapX && overlapY).toBe(false);
      }
    }
  });
  it('shows an empty tree without crashing', () => {
    const map = layoutMindmap('尚未拆解', []);
    expect(map).toHaveLength(1);
    expect(map[0].progress).toBe(null);
    expect(map[0].steps).toBe(0);
    expect(hitMindmap(map, 900, 900)).toBeUndefined();
  });
});
