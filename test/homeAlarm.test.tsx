import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import HomeAlarm from '../src/components/HomeAlarm';
import SideNav, { type NavGroup } from '../src/components/SideNav';
import {
  alarmFlashState, alarmPauseDeadline, DEFAULT_ALARM_PAUSE_MINUTES,
} from '../src/utils/homeAlarm';
import { navigationBadges, sumBadges } from '../src/utils/navigationBadges';

vi.mock('../src/components/SearchOverlay', () => ({ default: () => null }));

function renderNav(group?: NavGroup) {
  return renderToStaticMarkup(
    <StaticRouter location="/ddl">
      <SideNav open group={group} onGroup={vi.fn()} searchOpen={false} avatar="" username=""
        badge={4} ddlBadge={8} importantBadge={5} onClose={vi.fn()}
        onHelp={vi.fn()} onShowSearch={vi.fn()} onCloseSearch={vi.fn()} onSelect={vi.fn()} />
    </StaticRouter>,
  );
}

describe('navigation badge routing', () => {
  it('shares all three badge sources and adds their exact counts', () => {
    const badges = navigationBadges({ ddlBadge: 8, importantBadge: 5, backlogBadge: 4 });
    expect(badges).toEqual([
      { to: '/ddl', label: 'DDL', count: 8 },
      { to: '/important', label: '重要', count: 5 },
      { to: '/backlog', label: '遗留', count: 4 },
    ]);
    expect(sumBadges(badges)).toBe(17);
    expect(sumBadges(navigationBadges({}))).toBe(0);
  });

  it('shows each group total without counting other groups or displaying zero badges', () => {
    const html = renderNav();
    expect(html).toMatch(/事项信息<\/span><span[^>]+aria-label="13 项提醒">13<\/span>/);
    expect(html).toMatch(/规划<\/span><span[^>]+aria-label="4 项提醒">4<\/span>/);
    expect(html.match(/class="side-nav-badge"/g)).toHaveLength(2);
  });

  it('keeps a nested group as an ordered layout of individual destination rows and shows leaf badges', () => {
    const html = renderNav('items');
    expect(html).toContain('aria-label="返回导航"');
    expect(html).toMatch(/<ul class="side-nav-group-list side-nav-links"><li><a[^>]+aria-current="page"[^>]+href="\/ddl"/);
    expect(html).toMatch(/DDL<\/span><span[^>]+aria-label="8 项提醒">8<\/span>/);
    expect(html).toMatch(/重要<\/span><span[^>]+aria-label="5 项提醒">5<\/span>/);
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).not.toContain('href="/backlog"');
  });

  it('renders the Home alarm trigger only when there are reminders', () => {
    const active = renderToStaticMarkup(<HomeAlarm ddlBadge={8} importantBadge={5} backlogBadge={4} />);
    expect(active).toContain('aria-label="警报，17 项提醒"');
    expect(active).toContain('home-alarm-trigger--flashing');
    expect(renderToStaticMarkup(<HomeAlarm />)).toBe('');
  });
});

describe('Home alarm flash preferences', () => {
  const now = 1_750_000_000_000;

  it('pauses for 60 minutes by default and checks expiry against the current time', () => {
    const pausedUntil = alarmPauseDeadline(String(DEFAULT_ALARM_PAUSE_MINUTES), now)!;
    const paused = { flashDisabled: false, pausedUntil };
    expect(pausedUntil).toBe(now + 3_600_000);
    expect(alarmFlashState(paused, pausedUntil - 1)).toBe('paused');
    expect(alarmFlashState(paused, pausedUntil)).toBe('active');
  });

  it('supports custom minute durations and rejects malformed or unsupported values', () => {
    expect(alarmPauseDeadline('90', now)).toBe(now + 5_400_000);
    for (const value of ['', '0', '-2', '1.5', 'abc', 'Infinity', '99999999999999999']) {
      expect(alarmPauseDeadline(value, now)).toBeUndefined();
    }
  });

  it('honors permanent disabling even after the pause deadline', () => {
    expect(alarmFlashState({ flashDisabled: true, pausedUntil: now - 1 }, now)).toBe('disabled');
  });
});
