import { useEffect, useState } from 'react';
import {
  Search, ChevronLeft, ChevronRight, CalendarClock, CalendarDays, CalendarRange,
  Target, Archive, Trash2, Database, Settings, Star, type LucideIcon,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import SearchOverlay from './SearchOverlay';
import './SideNav.css';

interface Props {
  /** 遗留问题气泡数字（沉了一周以上的阻塞项） */
  badge?: number;
  /** DDL 气泡数字（剩余不足一周） */
  ddlBadge?: number;
  /** 重要的事气泡数字（剩余不足三天） */
  importantBadge?: number;
}

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  count?: number;
}

/** 展开的左侧导航：图标 + 文字，按使用频率分组（细分割线），设置固定底部 */
export default function SideNav({ badge = 0, ddlBadge = 0, importantBadge = 0 }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('dailynote_nav_collapsed') === '1');
  useEffect(() => {
    document.documentElement.style.setProperty('--nav-w', collapsed ? '52px' : '76px');
    localStorage.setItem('dailynote_nav_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  const groups: NavItem[][] = [
    [
      { to: '/ddl', icon: CalendarClock, label: 'DDL', count: ddlBadge },
      { to: '/important', icon: Star, label: '重要', count: importantBadge },
      { to: '/courses', icon: CalendarDays, label: '课程表' },
      { to: '/week', icon: CalendarRange, label: '周视图' },
    ],
    [
      { to: '/goals', icon: Target, label: '目标' },
      { to: '/backlog', icon: Archive, label: '遗留', count: badge },
    ],
    [
      { to: '/trash', icon: Trash2, label: '回收站' },
      { to: '/backup', icon: Database, label: '备份' },
    ],
  ];

  const renderItem = (item: NavItem) => {
    const active = location.pathname === item.to;
    return (
      <button
        key={item.to}
        className={`side-nav-item ${active ? 'side-nav-item--active' : ''}`}
        onClick={() => navigate(item.to)}
        title={item.label}
        aria-label={item.label}
      >
        <item.icon size={19} strokeWidth={active ? 2.4 : 2} />
        <span className="side-nav-label">{item.label}</span>
        {item.count ? (
          <span className="side-nav-badge">{item.count > 9 ? '9+' : item.count}</span>
        ) : null}
      </button>
    );
  };

  return (
    <>
      <nav className={`side-nav ${collapsed ? 'side-nav--collapsed' : ''}`}>
        <button className="side-nav-toggle" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? '展开导航' : '收起导航'} title={collapsed ? '展开导航' : '收起导航'}>{collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}</button>
        <div className="side-nav-search">
          <button
            className="side-nav-item side-nav-item--search"
            onClick={() => setSearchOpen(true)}
            title="搜索"
            aria-label="搜索"
          >
            <Search size={19} strokeWidth={2} />
            <span className="side-nav-label">搜索</span>
          </button>
        </div>

        <div className="side-nav-items">
          {groups.map((group, i) => (
            <div key={i} className="side-nav-group">
              {group.map(renderItem)}
              {i < groups.length - 1 && <div className="side-nav-divider" />}
            </div>
          ))}
        </div>

        <div className="side-nav-bottom">
          {renderItem({ to: '/settings', icon: Settings, label: '设置' })}
        </div>
      </nav>

      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
}
