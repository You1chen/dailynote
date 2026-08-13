import { useNavigate, useLocation } from 'react-router-dom';
import { Target, BarChart3, Trash2, Database, ListTodo, X } from 'lucide-react';
import { useEffect } from 'react';
import './SideMenu.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

const menuItems = [
  { to: '/goals', icon: Target, label: '长期目标' },
  { to: '/tasks', icon: ListTodo, label: '任务清单' },
  { to: '/dashboard', icon: BarChart3, label: '宏观视图' },
  { to: '/trash', icon: Trash2, label: '回收站' },
  { to: '/backup', icon: Database, label: '备份与恢复' },
];

export default function SideMenu({ open, onClose }: Props) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  if (!open) return null;

  const handleNavigate = (to: string) => {
    navigate(to);
    onClose();
  };

  return (
    <div className="sidemenu-overlay" onClick={onClose}>
      <div className="sidemenu-panel" onClick={e => e.stopPropagation()}>
        <div className="sidemenu-header">
          <span className="sidemenu-header-title">DailyNote</span>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <nav className="sidemenu-nav">
          {menuItems.map(item => {
            const isActive = location.pathname === item.to;
            return (
              <button
                key={item.to}
                className={`sidemenu-item ${isActive ? 'sidemenu-item--active' : ''}`}
                onClick={() => handleNavigate(item.to)}
              >
                <item.icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
