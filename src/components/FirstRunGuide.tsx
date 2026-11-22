import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { ONBOARDING_STEPS, onboardingPrimaryLabel, type OnboardingStep } from '../content/onboardingSteps';
import './FirstRunGuide.css';

const EDGE = 16;
const GAP = 14;
const SPOT_PADDING = 8;
const CARD_WIDTH = 340;
const CARD_FALLBACK_HEIGHT = 220;
const CARD_RETRY_MS = 180;
const CARD_RETRY_LIMIT = 24;

const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Viewport {
  width: number;
  height: number;
}

interface CardPosition {
  left: number;
  top: number;
  /** 卡片在高亮框的哪一侧；自由摆放时没有箭头。 */
  side: 'above' | 'below' | 'none';
  /** 小三角相对卡片左边的位置。 */
  caret: number;
}

function viewportSize(): Viewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

/** 把真实元素换算成视口内的框；元素尺寸为 0 或完全在视口外时返回 null。 */
function elementBox(step: OnboardingStep, viewport: Viewport): Box | null {
  const target = step.target;
  if (!target || !('selector' in target)) return null;
  const element = document.querySelector<HTMLElement>(target.selector);
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8) return null;
  // 大区域（时间轴）只框住进入视口的那一段，避免整块被裁到只剩几像素。
  const bandTop = Math.max(SPOT_PADDING, rect.top);
  const cap = target.maxHeight;
  const left = Math.max(SPOT_PADDING, Math.min(rect.left, viewport.width - SPOT_PADDING));
  const right = Math.min(viewport.width - SPOT_PADDING, rect.right);
  const bottom = Math.min(
    viewport.height - SPOT_PADDING,
    cap ? bandTop + cap : rect.bottom,
  );
  if (right - left < 8 || bottom - bandTop < 8) return null;
  return { left, top: bandTop, width: right - left, height: bottom - bandTop };
}

/** 手势步骤没有可圈的真实控件，改用视口比例定义一块区域。 */
function zoneBox(step: OnboardingStep, viewport: Viewport): Box | null {
  const target = step.target;
  if (!target || !('zone' in target)) return null;
  const { left, top, right, bottom } = target.zone;
  return {
    left: left * viewport.width,
    top: top * viewport.height,
    width: (right - left) * viewport.width,
    height: (bottom - top) * viewport.height,
  };
}

function resolveBox(step: OnboardingStep, viewport: Viewport): Box | null {
  if (!step.target) return null;
  return 'selector' in step.target ? elementBox(step, viewport) : zoneBox(step, viewport);
}

function sameBox(a: Box | null, b: Box | null): boolean {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/**
 * 元素锚点可能已被启动时的「跳到当前时间」滚出屏幕（时间轴尤其常见）。
 * 把它的上沿带到日期栏下方；固定定位的悬浮球不受影响。
 */
function revealTarget(step: OnboardingStep): void {
  if (!step.target || !('selector' in step.target)) return;
  const element = document.querySelector<HTMLElement>(step.target.selector);
  if (!element) return;
  const rect = element.getBoundingClientRect();
  const topLimit = 140;
  if (rect.top >= topLimit && rect.top < window.innerHeight - 120) return;
  const top = Math.max(0, window.scrollY + rect.top - topLimit);
  window.scrollTo({ top, behavior: 'auto' });
}

/**
 * 说明卡片优先贴着高亮框的上/下边；放不下就换另一侧，
 * 两侧都放不下时退回屏幕底部的悬浮位置。
 */
function placeCard(
  box: Box | null,
  placement: 'above' | 'below',
  viewport: Viewport,
  cardWidth: number,
  cardHeight: number,
): CardPosition {
  const maxLeft = Math.max(EDGE, viewport.width - EDGE - cardWidth);
  const center = box ? box.left + box.width / 2 : viewport.width / 2;
  const left = Math.round(Math.min(Math.max(EDGE, center - cardWidth / 2), maxLeft));

  if (!box) {
    return {
      left,
      top: Math.max(EDGE, viewport.height - EDGE - cardHeight),
      side: 'none',
      caret: 0,
    };
  }

  const caret = Math.round(Math.min(Math.max(28, center - left), cardWidth - 28));
  const belowTop = box.top + box.height + GAP;
  const aboveTop = box.top - GAP - cardHeight;
  const fitsBelow = belowTop + cardHeight <= viewport.height - EDGE;
  const fitsAbove = aboveTop >= EDGE;

  const preferredFits = placement === 'above' ? fitsAbove : fitsBelow;
  if (preferredFits) {
    return {
      left,
      top: Math.round(placement === 'above' ? aboveTop : belowTop),
      side: placement,
      caret,
    };
  }

  const other = placement === 'above' ? 'below' : 'above';
  const otherFits = other === 'above' ? fitsAbove : fitsBelow;
  if (otherFits) {
    return {
      left,
      top: Math.round(other === 'above' ? aboveTop : belowTop),
      side: other,
      caret,
    };
  }

  return {
    left,
    top: Math.max(EDGE, Math.round(viewport.height - EDGE - cardHeight)),
    side: 'none',
    caret: 0,
  };
}

interface Props {
  onDismiss: () => void;
}

/**
 * 首次安装的分步引导：悬浮窗 + 框选标记。
 *
 * 只讲解四个入口（TODO、左滑卡片、右滑导航、框选时间），最后指向应用内说明书。
 * 关闭后仍沿用原有的 `dailynote_onboarding_dismissed` 标记，不再出现。
 */
export default function FirstRunGuide({ onDismiss }: Props) {
  const [index, setIndex] = useState(0);
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });
  const [box, setBox] = useState<Box | null>(null);
  const [cardHeight, setCardHeight] = useState(CARD_FALLBACK_HEIGHT);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = ONBOARDING_STEPS[index];
  const total = ONBOARDING_STEPS.length;

  // 视口尺寸只在客户端读取，服务端渲染时保持 0，卡片走默认位置。
  useEffect(() => {
    const update = () => setViewport(viewportSize());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // 圈选目标：首屏数据还没渲染出来时短暂重试，之后跟随滚动与缩放重新测量。
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    let timer = 0;
    const read = () => {
      if (cancelled) return true;
      const next = resolveBox(step, viewportSize());
      setBox(previous => (sameBox(previous, next) ? previous : next));
      return next !== null;
    };
    revealTarget(step);
    if (!read() && step.target) {
      const retry = () => {
        if (cancelled || attempts >= CARD_RETRY_LIMIT) return;
        attempts += 1;
        revealTarget(step);
        if (!read()) timer = window.setTimeout(retry, CARD_RETRY_MS);
      };
      timer = window.setTimeout(retry, CARD_RETRY_MS);
    }
    const onViewportChange = () => { read(); };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [step]);

  // 卡片高度随文案变化，量到真实高度后再决定放在框的上方还是下方。
  useBrowserLayoutEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const height = node.offsetHeight;
    if (height && Math.abs(height - cardHeight) > 1) setCardHeight(height);
  }, [index, viewport.width, viewport.height, cardHeight]);

  // 引导期间锁定背景滚动，避免高亮框和真实控件错位。
  useEffect(() => {
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => { body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true });
  }, [index]);

  useRegisterBackHandler(() => {
    if (index === 0) { onDismiss(); return true; }
    setIndex(index - 1);
    return true;
  }, [index, onDismiss]);

  const go = (next: number) => setIndex(Math.max(0, Math.min(total - 1, next)));
  const last = index === total - 1;
  const cardWidth = viewport.width ? Math.min(CARD_WIDTH, Math.max(0, viewport.width - EDGE * 2)) : 0;
  const position = viewport.width && cardWidth
    ? placeCard(box, step.placement ?? 'below', viewport, cardWidth, cardHeight)
    : null;

  const spotlightStyle: CSSProperties | undefined = box
    ? { left: box.left, top: box.top, width: box.width, height: box.height }
    : undefined;

  const openManual = () => {
    onDismiss();
    window.dispatchEvent(new Event('dailynote-open-help'));
  };

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (last) onDismiss();
      else go(index + 1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (index > 0) go(index - 1);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = cardRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
    if (!focusable?.length) return;
    const first = focusable[0];
    const end = focusable[focusable.length - 1];
    if (!event.shiftKey && document.activeElement === end) { event.preventDefault(); first.focus(); }
    else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); end.focus(); }
  }

  return (
    <div
      className="tour-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      onKeyDown={onKeyDown}
    >
      {!box && <div className="tour-dim" aria-hidden="true" />}

      {box && (
        <div className="tour-spot" style={spotlightStyle} aria-hidden="true">
          {step.arrow && <span className={`tour-arrow tour-arrow--${step.arrow}`}>{step.arrow === 'left' ? '←' : '→'}</span>}
        </div>
      )}

      <div
        ref={cardRef}
        className={`tour-card${position ? '' : ' tour-card--center'}`}
        data-side={position?.side ?? 'none'}
        style={position ? { left: position.left, top: position.top, width: cardWidth } : undefined}
        tabIndex={-1}
      >
        {position?.side !== 'none' && (
          <span className="tour-caret" style={{ left: position?.caret }} aria-hidden="true" />
        )}

        <header className="tour-head">
          <span className="tour-kicker">新手引导 · {index + 1}/{total}</span>
          <button type="button" className="tour-close" aria-label="关闭引导" onClick={onDismiss}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <p className="tour-tag">{step.kicker}</p>
        <h2 className="tour-title" id="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>

        <div className="tour-dots" role="group" aria-label="引导步骤">
          {ONBOARDING_STEPS.map((item, dotIndex) => (
            <button
              key={item.id}
              type="button"
              className="tour-dot"
              aria-label={`第 ${dotIndex + 1} 步：${item.kicker}`}
              aria-current={dotIndex === index ? 'true' : undefined}
              onClick={() => go(dotIndex)}
            />
          ))}
        </div>

        <footer className="tour-foot">
          {!last && (
            <button type="button" className="tour-skip" onClick={onDismiss}>跳过</button>
          )}
          <div className="tour-actions">
            {index > 0 && (
              <button type="button" className="btn btn-ghost btn-icon" aria-label="上一步" onClick={() => go(index - 1)}>
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
            )}
            {step.action === 'help' && (
              <button type="button" className="btn btn-ghost" onClick={openManual}>打开帮助</button>
            )}
            <button
              type="button"
              className="btn btn-primary tour-next"
              onClick={() => (last ? onDismiss() : go(index + 1))}
            >
              {onboardingPrimaryLabel(index)}
              {!last && <ArrowRight size={15} aria-hidden="true" />}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
