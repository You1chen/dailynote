/**
 * Deterministic force-directed layout for the knowledge-card graph.
 *
 * No external dependency and no randomness at render time: the same nodes,
 * edges and options always produce exactly the same coordinates, so the
 * network does not "jump" between React renders. Nodes are seeded on a
 * phyllotaxis spiral (high degree first, near the center) and relaxed with a
 * simple repulsion / spring / gravity / collision simulation.
 */

export interface LayoutInputNode {
  id: string;
  degree: number;
  radius?: number; // UI may pass a base radius
  group?: string; // e.g. card type, for slight clustering
  createdAt?: number;
}

export interface LayoutInputEdge {
  source: string;
  target: string;
  weight?: number;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface GraphLayoutOptions {
  width?: number; // default 1000
  height?: number; // default 700
  iterations?: number; // default 420
  padding?: number; // default 56
  /** Extra safe area on the right for floating controls; defaults to `padding`. */
  paddingRight?: number;
  seed?: number; // default 7
}

const DEFAULT_WIDTH = 1000;
const DEFAULT_HEIGHT = 700;
const DEFAULT_ITERATIONS = 420;
const DEFAULT_PADDING = 56;
const DEFAULT_SEED = 7;

/** Above this node count O(N^2) repulsion is still fine but iterations are reduced. */
const MAX_FULL_REPULSION_NODES = 250;
/** Golden angle used by the phyllotaxis seed placement. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const REPULSION_STRENGTH = 26000;
const REPULSION_FORCE_CAP = 30;
const SPRING_BASE_LENGTH = 54;
const SPRING_STRENGTH = 0.034;
const GRAVITY_BASE = 0.0017;
const GRAVITY_DEGREE = 0.0015;
const GROUP_PULL = 0.0008;
const BOUNDARY_MARGIN_RATIO = 0.2;
const MAX_BOUNDARY_MARGIN = 120;
const BOUNDARY_STRENGTH = 0.03;
const COLLISION_GAP = 6;
const COLLISION_STRENGTH = 0.5;
const DAMPING = 0.82;
const MAX_VELOCITY = 14;
const MIN_FORCE_SCALE = 0.18;

const clamp = (value: number, min: number, max: number): number => (value < min ? min : value > max ? max : value);

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Small, dependency-free PRNG used for stable jitter. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable pseudo-random value in [0, 1) for a seed + key pair. */
function stableRandom(seed: number, key: string): number {
  return mulberry32((seed ^ hashString(key)) >>> 0)();
}

const safeDegree = (node: LayoutInputNode): number => (Number.isFinite(node.degree) ? Math.max(0, node.degree) : 0);
const safeCreatedAt = (node: LayoutInputNode): number => (node.createdAt !== undefined && Number.isFinite(node.createdAt) ? node.createdAt : 0);

function nodeRadius(node: LayoutInputNode, width: number, height: number): number {
  const requested = node.radius !== undefined && Number.isFinite(node.radius) ? node.radius : undefined;
  const base = requested !== undefined ? requested : 9 + Math.min(10, safeDegree(node) * 1.1);
  return Math.max(2, Math.min(base, Math.min(width, height) / 6));
}

interface Body {
  node: LayoutInputNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

/**
 * Lay out `nodes` inside a width x height box.
 * Returns a point for every unique input id (duplicate ids collapse to one).
 */
export function layoutCardGraph(
  nodes: LayoutInputNode[],
  edges: LayoutInputEdge[],
  options: GraphLayoutOptions = {},
): Record<string, LayoutPoint> {
  if (!nodes.length) return {};

  const requestedWidth = options.width ?? DEFAULT_WIDTH;
  const requestedHeight = options.height ?? DEFAULT_HEIGHT;
  const width = Number.isFinite(requestedWidth) ? Math.max(1, requestedWidth) : DEFAULT_WIDTH;
  const height = Number.isFinite(requestedHeight) ? Math.max(1, requestedHeight) : DEFAULT_HEIGHT;
  const requestedPadding = options.padding ?? DEFAULT_PADDING;
  const maxPadding = Math.max(0, Math.min(width, height) / 2 - 1);
  const padding = Math.max(0, Math.min(Number.isFinite(requestedPadding) ? requestedPadding : DEFAULT_PADDING, maxPadding));
  const requestedPaddingRight = options.paddingRight ?? padding;
  const paddingRight = Math.max(0, Math.min(Number.isFinite(requestedPaddingRight) ? requestedPaddingRight : padding, maxPadding));
  const requestedSeed = options.seed ?? DEFAULT_SEED;
  const seed = Number.isFinite(requestedSeed) ? requestedSeed : DEFAULT_SEED;
  const centerX = (padding + width - paddingRight) / 2;
  const centerY = height / 2;
  const minBoundX = padding;
  const maxBoundX = width - paddingRight;
  const minBoundY = padding;
  const maxBoundY = height - padding;

  // De-duplicate ids so every output key maps to exactly one body.
  const uniqueNodes: LayoutInputNode[] = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const id = String(node.id);
    if (seen.has(id)) continue;
    seen.add(id);
    uniqueNodes.push(node);
  }
  if (uniqueNodes.length === 1) {
    return { [uniqueNodes[0].id]: { x: centerX, y: centerY } };
  }

  const bodies: Body[] = uniqueNodes.map(node => ({
    node,
    x: centerX,
    y: centerY,
    vx: 0,
    vy: 0,
    radius: nodeRadius(node, width, height),
  }));
  const count = bodies.length;

  // Seed on a phyllotaxis spiral; high-degree nodes get the inner turns.
  const seeded = [...bodies].sort((left, right) => {
    const degreeDelta = safeDegree(right.node) - safeDegree(left.node);
    if (degreeDelta) return degreeDelta;
    const createdDelta = safeCreatedAt(left.node) - safeCreatedAt(right.node);
    if (createdDelta) return createdDelta;
    return left.node.id < right.node.id ? -1 : left.node.id > right.node.id ? 1 : 0;
  });
  const spreadX = Math.max(1, (maxBoundX - minBoundX) / 2 - 24);
  const spreadY = Math.max(1, height / 2 - padding - 24);
  seeded.forEach((body, rank) => {
    const progress = Math.sqrt((rank + 0.5) / count);
    const angle = rank * GOLDEN_ANGLE + (stableRandom(seed, `${body.node.id}:angle`) - 0.5) * 0.6;
    body.x = centerX + Math.cos(angle) * spreadX * progress + (stableRandom(seed, `${body.node.id}:x`) - 0.5) * 6;
    body.y = centerY + Math.sin(angle) * spreadY * progress + (stableRandom(seed, `${body.node.id}:y`) - 0.5) * 6;
    body.x = clamp(body.x, minBoundX, maxBoundX);
    body.y = clamp(body.y, minBoundY, maxBoundY);
  });

  // Resolve edges once: ignore unknown endpoints / self loops, de-duplicate.
  const bodyByIndex = new Map<string, number>();
  uniqueNodes.forEach((node, index) => bodyByIndex.set(String(node.id), index));
  const springByPair = new Map<string, { left: number; right: number; weight: number }>();
  for (const edge of edges) {
    const left = bodyByIndex.get(String(edge.source));
    const right = bodyByIndex.get(String(edge.target));
    if (left === undefined || right === undefined || left === right) continue;
    const key = left < right ? `${left}:${right}` : `${right}:${left}`;
    if (springByPair.has(key)) continue;
    const weight = edge.weight !== undefined && Number.isFinite(edge.weight) ? Math.max(0.25, edge.weight) : 1;
    springByPair.set(key, { left: Math.min(left, right), right: Math.max(left, right), weight });
  }
  const springs = [...springByPair.values()];

  // Mild group clustering: each group gets its own directional target.
  const groupNames = [...new Set(bodies.map(body => body.node.group).filter((group): group is string => typeof group === 'string' && group.length > 0))].sort();
  const groupTargets = new Map<string, LayoutPoint>();
  const groupDistance = Math.min(width, height) * 0.28;
  groupNames.forEach((group, index) => {
    const angle = (index / groupNames.length) * Math.PI * 2 + 0.31;
    groupTargets.set(group, { x: centerX + Math.cos(angle) * groupDistance, y: centerY + Math.sin(angle) * groupDistance });
  });
  const clusterGroups = groupNames.length > 1;
  const boundaryMargin = Math.min(MAX_BOUNDARY_MARGIN, Math.min(width, height) * BOUNDARY_MARGIN_RATIO);

  const requestedIterations = options.iterations ?? DEFAULT_ITERATIONS;
  const baseIterations = Math.max(0, Math.floor(Number.isFinite(requestedIterations) ? requestedIterations : DEFAULT_ITERATIONS));
  // Large graphs still get a usable layout without a quadratic explosion.
  const scaledIterations = Math.round(baseIterations * (MAX_FULL_REPULSION_NODES / count));
  const iterations = count > MAX_FULL_REPULSION_NODES && baseIterations > 0
    ? Math.max(1, Math.min(baseIterations, scaledIterations))
    : baseIterations;
  const maxDegree = Math.max(1, ...bodies.map(body => safeDegree(body.node)));
  const forceX = new Float64Array(count);
  const forceY = new Float64Array(count);

  for (let step = 0; step < iterations; step++) {
    const progress = step / Math.max(1, iterations);
    const forceScale = MIN_FORCE_SCALE + (1 - MIN_FORCE_SCALE) * (1 - progress);
    forceX.fill(0);
    forceY.fill(0);

    // Pairwise inverse-square repulsion with a cap, plus mild collision resolve.
    for (let leftIndex = 0; leftIndex < count; leftIndex++) {
      const left = bodies[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < count; rightIndex++) {
        const right = bodies[rightIndex];
        let dx = right.x - left.x;
        let dy = right.y - left.y;
        let squaredDistance = dx * dx + dy * dy;
        if (squaredDistance < 1e-6) {
          const angle = stableRandom(seed, `${left.node.id}|${right.node.id}`) * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          squaredDistance = 1;
        }
        const distance = Math.sqrt(squaredDistance);
        const normalX = dx / distance;
        const normalY = dy / distance;
        let push = Math.min(REPULSION_FORCE_CAP, REPULSION_STRENGTH / squaredDistance);
        const collisionDistance = left.radius + right.radius + COLLISION_GAP;
        if (distance < collisionDistance) push += (collisionDistance - distance) * COLLISION_STRENGTH;
        forceX[leftIndex] -= normalX * push;
        forceY[leftIndex] -= normalY * push;
        forceX[rightIndex] += normalX * push;
        forceY[rightIndex] += normalY * push;
      }
    }

    // Edge springs; stronger edges are slightly shorter / stiffer.
    for (const spring of springs) {
      const left = bodies[spring.left];
      const right = bodies[spring.right];
      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < 1e-6) {
        const angle = stableRandom(seed, `${left.node.id}|${right.node.id}:spring`) * Math.PI * 2;
        dx = Math.cos(angle);
        dy = Math.sin(angle);
        distance = 1;
      }
      const normalX = dx / distance;
      const normalY = dy / distance;
      const restLength = left.radius + right.radius + SPRING_BASE_LENGTH * (1 - Math.min(0.3, (spring.weight - 1) * 0.06));
      const pull = (distance - restLength) * SPRING_STRENGTH;
      forceX[spring.left] += normalX * pull;
      forceY[spring.left] += normalY * pull;
      forceX[spring.right] -= normalX * pull;
      forceY[spring.right] -= normalY * pull;
    }

    // Gravity (stronger for hubs) and optional group clustering.
    for (let index = 0; index < count; index++) {
      const body = bodies[index];
      const degreeRatio = safeDegree(body.node) / maxDegree;
      const gravity = GRAVITY_BASE + GRAVITY_DEGREE * degreeRatio;
      forceX[index] += (centerX - body.x) * gravity;
      forceY[index] += (centerY - body.y) * gravity;
      const group = body.node.group;
      if (clusterGroups && group) {
        const target = groupTargets.get(group);
        if (target) {
          forceX[index] += (target.x - body.x) * GROUP_PULL;
          forceY[index] += (target.y - body.y) * GROUP_PULL;
        }
      }
      // Soft wall: keep the layout away from the hard padding so clamping stays
      // a last-resort safety net instead of pinning many nodes to the border.
      const leftRoom = body.x - minBoundX;
      const rightRoom = maxBoundX - body.x;
      const topRoom = body.y - minBoundY;
      const bottomRoom = maxBoundY - body.y;
      if (leftRoom < boundaryMargin) forceX[index] += (boundaryMargin - leftRoom) * BOUNDARY_STRENGTH;
      if (rightRoom < boundaryMargin) forceX[index] -= (boundaryMargin - rightRoom) * BOUNDARY_STRENGTH;
      if (topRoom < boundaryMargin) forceY[index] += (boundaryMargin - topRoom) * BOUNDARY_STRENGTH;
      if (bottomRoom < boundaryMargin) forceY[index] -= (boundaryMargin - bottomRoom) * BOUNDARY_STRENGTH;
    }

    // Velocity integration with damping, cooling and hard boundary clamping.
    for (let index = 0; index < count; index++) {
      const body = bodies[index];
      body.vx = (body.vx + forceX[index] * forceScale) * DAMPING;
      body.vy = (body.vy + forceY[index] * forceScale) * DAMPING;
      body.vx = clamp(body.vx, -MAX_VELOCITY, MAX_VELOCITY);
      body.vy = clamp(body.vy, -MAX_VELOCITY, MAX_VELOCITY);
      body.x += body.vx;
      body.y += body.vy;
      const clampedX = clamp(body.x, minBoundX, maxBoundX);
      const clampedY = clamp(body.y, minBoundY, maxBoundY);
      if (clampedX !== body.x) body.vx *= -0.2;
      if (clampedY !== body.y) body.vy *= -0.2;
      body.x = clampedX;
      body.y = clampedY;
    }
  }

  const round = (value: number, min: number, max: number): number => clamp(Math.round(value * 100) / 100, min, max);
  const points: Record<string, LayoutPoint> = {};
  for (const body of bodies) {
    points[body.node.id] = { x: round(body.x, minBoundX, maxBoundX), y: round(body.y, minBoundY, maxBoundY) };
  }
  return points;
}
