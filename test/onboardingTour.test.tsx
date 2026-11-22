import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import FirstRunGuide from '../src/components/FirstRunGuide';
import { ONBOARDING_STEPS, onboardingPrimaryLabel } from '../src/content/onboardingSteps';

/** SSR 会在相邻文本节点之间插入注释，比较文案前先去掉。 */
function textOf(html: string): string {
  return html.replace(/<!-- -->/g, '');
}

describe('first-run spotlight tour', () => {
  it('covers the four entry points and finishes at the manual', () => {
    expect(ONBOARDING_STEPS.map(step => step.id)).toEqual(['todo', 'card', 'nav', 'schedule', 'manual']);
    const manual = ONBOARDING_STEPS[ONBOARDING_STEPS.length - 1];
    expect(manual.action).toBe('help');
    expect(manual.title).toContain('帮助');
  });

  it('anchors each step to the real interface or a gesture zone', () => {
    expect(ONBOARDING_STEPS[0].target).toEqual({ selector: '[data-tour="todo-ball"]' });
    expect(ONBOARDING_STEPS[1].target).toHaveProperty('zone');
    expect(ONBOARDING_STEPS[2].target).toHaveProperty('zone');
    expect(ONBOARDING_STEPS[3].target).toEqual({ selector: '[data-tour="time-grid"]', maxHeight: 300 });
    expect(ONBOARDING_STEPS[4].target).toBeUndefined();
  });

  it('renders the floating card with skip and next on the first step', () => {
    const html = textOf(renderToStaticMarkup(<FirstRunGuide onDismiss={vi.fn()} />));
    expect(html).toContain('role="dialog"');
    expect(html).toContain('新手引导 · 1/5');
    expect(html).toContain('TODO');
    expect(html).toContain('跳过');
    expect(html).toContain('下一步');
    expect(html).toContain('关闭引导');
  });

  it('does not tour features outside the four highlights', () => {
    const html = renderToStaticMarkup(<FirstRunGuide onDismiss={vi.fn()} />);
    for (const word of ['课程表', 'DDL', '目标', '回忆']) expect(html).not.toContain(word);
  });

  it('labels the last step as the start action', () => {
    expect(onboardingPrimaryLabel(0)).toBe('下一步');
    expect(onboardingPrimaryLabel(ONBOARDING_STEPS.length - 1)).toBe('开始使用');
  });
});
