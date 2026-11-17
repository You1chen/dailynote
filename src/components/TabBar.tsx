import { NavLink, useLocation } from 'react-router-dom';
import { Calendar, BookOpen, Lightbulb, Sparkles } from 'lucide-react';
import './TabBar.css';

const tabs = [
  { to: '/', icon: Calendar, label: '计划' },
  { to: '/reflection', icon: BookOpen, label: '反思' },
  { to: '/harvest', icon: Lightbulb, label: '收获' },
  { to: '/wander', icon: Sparkles, label: '漫步' },
];

export default function TabBar() {
  const location = useLocation();

  return (
    <nav className="tab-bar">
      {tabs.map(tab => {
        const isActive = location.pathname === tab.to;
        return (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={`tab-item ${isActive ? 'tab-item--active' : ''}`}
          >
            <tab.icon size={22} strokeWidth={isActive ? 2.5 : 2} />
            <span className="tab-label">{tab.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
