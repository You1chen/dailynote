import { useEffect, useRef } from 'react';
import {
  Archive, ArrowLeft, BookOpen, CalendarClock, CalendarDays, CalendarRange, ChevronRight,
  CircleHelp, Database, Footprints, List, Search, Settings, Star, Target, Trash2, type LucideIcon,
} from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import SearchOverlay from './SearchOverlay';
import { navigationBadges, sumBadges } from '../utils/navigationBadges';
import './SideNav.css';

export type NavGroup = 'items' | 'planning' | 'data';

interface Props {
  open: boolean;
  group?: NavGroup;
  onGroup: (group: NavGroup) => void;
  searchOpen: boolean;
  avatar: string;
  username: string;
  badge?: number;
  ddlBadge?: number;
  importantBadge?: number;
  onClose: () => void;
  onHelp: () => void;
  onShowSearch: () => void;
  onCloseSearch: () => void;
  onSelect: (to: string) => void;
}

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  count?: number;
}

const notesLinks: NavItem[] = [
  { to: '/reflection', icon: BookOpen, label: '记事' },
  { to: '/wander', icon: Footprints, label: '回忆' },
];

function NavBadge({ count = 0 }: { count?: number }) {
  if (count <= 0) return null;
  return <span className="side-nav-badge" role="img" aria-label={`${count} 项提醒`}>{count}</span>;
}

export default function SideNav({ open, group, onGroup, searchOpen, avatar, username, badge, ddlBadge, importantBadge, onClose, onHelp, onShowSearch, onCloseSearch, onSelect }: Props) {
  const { pathname } = useLocation();
  const navContent = useRef<HTMLDivElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const groupBack = useRef<HTMLButtonElement>(null);
  const [ddl, important, backlog] = navigationBadges({ backlogBadge: badge, ddlBadge, importantBadge });
  const groups: { id: NavGroup; title: string; icon: LucideIcon; items: NavItem[] }[] = [
    { id: 'items', title: '事项信息', icon: List, items: [
      { ...ddl, icon: CalendarClock },
      { ...important, icon: Star },
      { to: '/courses', icon: CalendarDays, label: '课程表' },
      { to: '/week', icon: CalendarRange, label: '周视图' },
    ] },
    { id: 'planning', title: '规划', icon: Target, items: [
      { to: '/goals', icon: Target, label: '目标' },
      { ...backlog, icon: Archive },
    ] },
    { id: 'data', title: '数据', icon: Database, items: [
      { to: '/trash', icon: Trash2, label: '回收站' },
      { to: '/backup', icon: Database, label: '备份' },
    ] },
  ];

  useEffect(() => {
    navContent.current?.toggleAttribute('inert', !open || searchOpen);
    if (open && !searchOpen) {
      const control = group ? groupBack : searchButton;
      control.current?.focus({ preventScroll: true });
    }
    if (navContent.current) navContent.current.scrollTop = 0;
  }, [open, searchOpen, group]);

  function selectLink(event: React.MouseEvent<HTMLAnchorElement>, to: string) {
    if (event.button !== 0 || event.metaKey || event.altKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    onSelect(to);
  }

  function renderItem({ to, icon: Icon, label, count }: NavItem) {
    const active = pathname === to;
    return (
      <Link key={to} to={to} className="side-nav-item" aria-current={active ? 'page' : undefined} onClick={event => selectLink(event, to)}>
        <Icon size={20} aria-hidden="true" />
        <span>{label}</span>
        <NavBadge count={count} />
      </Link>
    );
  }

  const appearance = '/settings?section=appearance';
  const currentGroup = groups.find(item => item.id === group);
  return (
    <section id="app-navigation" className={`side-nav${open ? ' side-nav--open' : ''}`} role="dialog" aria-label="导航" aria-modal={open || undefined} aria-hidden={!open}>
      <div className="side-nav-scroll" ref={navContent} aria-hidden={searchOpen || undefined}>
        <nav className="side-nav-inner" aria-label="页面链接">
          {currentGroup ? (
            <section className="side-nav-group" aria-labelledby="side-nav-group-title">
              <div className="side-nav-group-header">
                <button ref={groupBack} className="side-nav-group-back" onClick={onClose} type="button" aria-label="返回导航">
                  <ArrowLeft size={20} aria-hidden="true" />
                </button>
                <h2 id="side-nav-group-title">{currentGroup.title}</h2>
              </div>
              <ul className="side-nav-group-list side-nav-links">
                {currentGroup.items.map(item => <li key={item.to}>{renderItem(item)}</li>)}
              </ul>
            </section>
          ) : (
            <>
              <button className="app-nav-toggle" onClick={onClose} type="button">关闭导航</button>
              <div className="side-nav-top">
                <button ref={searchButton} className="side-nav-search" onClick={onShowSearch} type="button"><Search size={20} aria-hidden="true" />搜索</button>
              </div>
              <Link className="side-nav-profile" to={appearance} onClick={event => selectLink(event, appearance)}>
                <span className="side-nav-avatar" aria-hidden="true">{avatar?.startsWith('data:image/') ? <img src={avatar} alt="" /> : avatar || '👤'}</span>
                <span className="side-nav-identity"><small>ID</small><strong>{username?.trim() || '未设置'}</strong></span>
                <ChevronRight size={18} className="side-nav-profile-arrow" aria-hidden="true" />
              </Link>
              <div className="side-nav-links side-nav-links--featured">{notesLinks.map(renderItem)}</div>
              <div className="side-nav-directory">
                {groups.map(({ id, title, icon: Icon, items }) => (
                  <button key={id} className="side-nav-item" onClick={() => onGroup(id)} type="button">
                    <Icon size={20} aria-hidden="true" />
                    <span>{title}</span>
                    <NavBadge count={sumBadges(items)} />
                    <ChevronRight className="side-nav-profile-arrow" size={18} aria-hidden="true" />
                  </button>
                ))}
              </div>
              <div className="side-nav-settings side-nav-settings--split">
                <button type="button" className="side-nav-item" onClick={onHelp}>
                  <CircleHelp size={20} aria-hidden="true" />
                  <span>帮助</span>
                </button>
                {renderItem({ to: '/settings', icon: Settings, label: '设置' })}
              </div>
            </>
          )}
        </nav>
      </div>
      <SearchOverlay open={open && searchOpen} onClose={onCloseSearch} onNavigate={onSelect} />
    </section>
  );
}
