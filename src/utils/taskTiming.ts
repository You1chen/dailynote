export interface TaskTiming {
  elapsedMs: number;
  startedAt?: number;
}

export function elapsedTaskMs(timing: TaskTiming | undefined, now = Date.now()): number {
  return (timing?.elapsedMs ?? 0) + (timing?.startedAt === undefined ? 0 : Math.max(0, now - timing.startedAt));
}

export function formatTaskElapsed(ms: number): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':');
}
