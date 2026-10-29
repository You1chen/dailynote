import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { todayStr } from '../src/types';
import SettlementPage from '../src/pages/Settlement';

vi.mock('../src/contexts/BackButtonContext', () => ({ useRegisterBackHandler: vi.fn() }));
vi.mock('../src/services/store', () => ({ getStore: () => ({ activityEvents: [
  { id: 'old', date: '2020-02-28', occurredAt: 1, category: 'idea', action: 'create', entityId: 'a', title: '旧灵感', from: null, to: null },
  { id: 'new', date: '2020-02-29', occurredAt: 2, category: 'todo', action: 'create', entityId: 'b', title: '另一天', from: null, to: null },
] }) }));

const render = (url: string) => renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><SettlementPage /></MemoryRouter>);

describe('settlement selected date', () => {
  it('uses the selected date and its events rather than system today', () => {
    const html = render('/settlement?date=2020-02-28');
    expect(html).toContain('value="2020-02-28"');
    expect(html).toContain('当日结算');
    expect(html).toContain('记录灵感');
    expect(html).toContain('2020年2月28日');
    expect(html).toContain('当日结算');
    expect(html).not.toContain('新建 TODO');
  });
  it('shows different events on another selected date', () => {
    const html = render('/settlement?date=2020-02-29');
    expect(html).toContain('新建 TODO');
    expect(html).not.toContain('记录灵感');
  });
  it.each(['/settlement', '/settlement?date=2020-02-30', '/settlement?date=bad'])('defaults absent or invalid date to local today: %s', url => {
    expect(render(url)).toContain(`value="${todayStr()}"`);
    expect(render(url)).toContain('今日结算');
  });
});
