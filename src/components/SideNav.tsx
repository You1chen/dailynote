import { Menu, Settings } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import './SideNav.css';

interface Props {
  onMenuClick: () => void;
  onSettingsClick: () => void;
}

export default function SideNav({ onMenuClick, onSettingsClick }: Props) {
  const location = useLocation();
  const isSettingsActive = location.pathname === '/settings';

  return (
    <nav className="side-nav">
      <button
        className="side-nav-item"
        onClick={onMenuClick}
        title="菜单"
        aria-label="打开菜单"
      >
        <Menu size={22} />
      </button>
      <button
        className={`side-nav-item ${isSettingsActive ? 'side-nav-item--active' : ''}`}
        onClick={onSettingsClick}
        title="设置"
        aria-label="设置"
      >
        <Settings size={22} />
      </button>
    </nav>
  );
}
