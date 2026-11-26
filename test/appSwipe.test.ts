import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appSwipeAction, attachAppSwipe, blockAppSwipeForCurrentTouch, isAppSwipeClaimed, type SwipeSurface } from '../src/hooks/useAppSwipe';

describe('fullscreen navigation swipe direction', () => {
  it.each([
    ['home', 100, 'open-navigation'], ['home', -100, 'open-quick-note'],
    ['page', 100, 'open-navigation'], ['page', -100, undefined],
    ['navigation', -100, 'close-navigation'], ['navigation', 100, undefined],
    ['quick-note', 100, 'close-quick-note'], ['quick-note', -100, undefined],
  ] as const)('routes a %s swipe of %s px to %s', (surface, dx, action) => {
    expect(appSwipeAction(surface, dx, 15)).toBe(action);
  });

  it.each(['home', 'page', 'navigation', 'quick-note'] satisfies SwipeSurface[])('ignores short, vertical, and diagonal movement on %s', surface => {
    expect(appSwipeAction(surface, -30, 0)).toBeUndefined();
    expect(appSwipeAction(surface, 30, 0)).toBeUndefined();
    expect(appSwipeAction(surface, 0, 160)).toBeUndefined();
    expect(appSwipeAction(surface, -90, 80)).toBeUndefined();
    expect(appSwipeAction(surface, 90, 80)).toBeUndefined();
  });
});

describe('app swipe ownership', () => {
  class Target extends EventTarget {
    closest() { return null; }
  }
  let target: Target;
  let surface: SwipeSurface;
  let cleanup: () => void;
  const onPreview = vi.fn();
  const onRelease = vi.fn();

  function touch(type: string, x: number, y = 0, count = type === 'touchend' || type === 'touchcancel' ? 0 : 1) {
    const point = { identifier: 1, clientX: x, clientY: y };
    const event = Object.assign(new Event(type, { cancelable: true }), {
      touches: Array.from({ length: count }, (_, index) => ({ ...point, identifier: index + 1 })),
      changedTouches: [point],
    });
    target.dispatchEvent(event);
    return event;
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Element', Target);
    surface = 'home';
    target = new Target();
    cleanup = attachAppSwipe(target as unknown as Document, () => ({ surface, context: surface, onPreview, onRelease }));
    onPreview.mockReset();
    onRelease.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('follows each move and clamps a reversal to the original edge', () => {
    touch('touchstart', 200);
    expect(touch('touchmove', 170).defaultPrevented).toBe(true);
    expect(isAppSwipeClaimed()).toBe(true);
    touch('touchmove', 100);
    touch('touchmove', 210);
    expect(onPreview.mock.calls.flat()).toEqual([30, 100, 0].map(distance => ({ action: 'open-quick-note', distance })));
    touch('touchend', 210);
    expect(onRelease).toHaveBeenCalledWith({ action: 'open-quick-note', distance: 0 }, false);
    expect(isAppSwipeClaimed()).toBe(true);
    vi.advanceTimersByTime(351);
    expect(isAppSwipeClaimed()).toBe(false);
  });

  it('uses the release position and suppresses a ghost click through a surface change', () => {
    touch('touchstart', 110);
    touch('touchmove', 132);
    touch('touchend', 215);
    expect(onRelease).toHaveBeenCalledWith({ action: 'open-navigation', distance: 105 }, true);
    surface = 'navigation';
    const click = Object.assign(new Event('click', { cancelable: true }), { detail: 1 });
    target.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    touch('touchstart', 140);
    expect(isAppSwipeClaimed()).toBe(false);
  });

  it('respects a vertical scroll or child gesture throughout the same touch', () => {
    touch('touchstart', 100);
    expect(touch('touchmove', 102, 22).defaultPrevented).toBe(false);
    touch('touchmove', 220, 25);
    touch('touchend', 220);
    touch('touchstart', 100);
    blockAppSwipeForCurrentTouch();
    expect(touch('touchmove', 220).defaultPrevented).toBe(false);
    touch('touchend', 220);
    expect(onPreview).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
    expect(isAppSwipeClaimed()).toBe(false);
  });

  it('cancels a claim when a second finger arrives or the touch is canceled', () => {
    touch('touchstart', 100);
    touch('touchmove', 200);
    touch('touchstart', 200, 0, 2);
    touch('touchend', 200);
    expect(onRelease).toHaveBeenCalledExactlyOnceWith({ action: 'open-navigation', distance: 100 }, false);
    touch('touchstart', 100);
    touch('touchmove', 210);
    touch('touchcancel', 210);
    expect(onRelease).toHaveBeenLastCalledWith({ action: 'open-navigation', distance: 110 }, false);
  });
});
