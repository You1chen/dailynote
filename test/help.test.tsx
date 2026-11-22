import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import HelpDialog, { helpPrimaryLabel } from '../src/components/HelpDialog';
import FirstRunGuide from '../src/components/FirstRunGuide';
import SideNav from '../src/components/SideNav';
import { CORE_FEATURES } from '../src/content/coreFeatures';

vi.mock('../src/components/SearchOverlay', () => ({ default: () => null }));

function navHtml() {
  return renderToStaticMarkup(
    <StaticRouter location="/">
      <SideNav open onGroup={vi.fn()} searchOpen={false} avatar="" username=""
        onClose={vi.fn()} onHelp={vi.fn()} onShowSearch={vi.fn()} onCloseSearch={vi.fn()} onSelect={vi.fn()} />
    </StaticRouter>,
  );
}

describe('help and onboarding dialog', () => {
  it('is opened from the navigation instead of a page link', () => {
    const html = navHtml();
    expect(html).toContain('帮助');
    expect(html).not.toContain('href="/help"');
    expect(html).toMatch(/<button[^>]*class="side-nav-item"[^>]*>/);
  });

  it('pages through one swipe page and one page per core feature', () => {
    const html = renderToStaticMarkup(<HelpDialog open onClose={vi.fn()} />);
    expect(html).toContain('<dialog');
    expect(html).toContain('先记住四个滑动');
    for (const { label, summary, steps, gesture } of CORE_FEATURES) {
      expect(html).toContain(label);
      expect(html).toContain(summary);
      for (const step of steps) expect(html).toContain(step);
      expect(html).toContain(gesture);
    }
    expect(html.match(/class="help-page-panel"/g)).toHaveLength(6);
    expect(html.match(/class="help-dot[ "]/g)).toHaveLength(6);
    expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it('mentions both swipe directions before the features', () => {
    const html = renderToStaticMarkup(<HelpDialog open onClose={vi.fn()} />);
    expect(html.indexOf('从左向右滑')).toBeGreaterThan(-1);
    expect(html.indexOf('先记住四个滑动')).toBeLessThan(html.indexOf('TODO'));
    expect(html).toContain('从右向左滑');
    expect(html).toContain('反向滑动');
    expect(html).toContain('上下滑动');
  });

  it('starts the first run as a spotlight tour instead of the help dialog', () => {
    const html = renderToStaticMarkup(<FirstRunGuide onDismiss={vi.fn()} />);
    expect(html).toContain('新手引导');
    expect(html).toContain('跳过');
    expect(html).toContain('下一步');
    expect(html).not.toContain('欢迎使用 DailyNote');
  });

  it('labels the help dialog footer for both variants', () => {
    expect(helpPrimaryLabel(5, 'welcome')).toBe('开始使用');
    expect(helpPrimaryLabel(5, 'help')).toBe('完成');
    expect(helpPrimaryLabel(0, 'welcome')).toBe('下一页');
  });
});
