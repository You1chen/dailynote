import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, useNavigate } from 'react-router-dom';
import TabBar from './components/TabBar';
import SideNav from './components/SideNav';
import SideMenu from './components/SideMenu';
import DailyPlanPage from './pages/DailyPlan';
import LongTermGoalsPage from './pages/LongTermGoals';
import ReflectionPage from './pages/Reflection';
import HarvestPage from './pages/Harvest';
import DashboardPage from './pages/Dashboard';
import TrashPage from './pages/Trash';
import BackupRestorePage from './pages/BackupRestore';
import SettingsPage from './pages/SettingsPage';
import TaskListPage from './pages/TaskListPage';
import CoursesPage from './pages/CoursesPage';
import WeekViewPage from './pages/WeekViewPage';
import { BackButtonProvider, useRegisterBackHandler } from './contexts/BackButtonContext';
import { usePreferences, type ThemeMode } from './hooks/usePreferences';
import './App.css';

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = prefersDark ? 'dark' : 'light';
  } else {
    root.dataset.theme = theme;
  }
}

function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const { prefs } = usePreferences();

  // 应用主题
  useEffect(() => {
    applyTheme(prefs.theme);
    if (prefs.theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [prefs.theme]);

  useRegisterBackHandler(() => {
    if (menuOpen) {
      setMenuOpen(false);
      return true;
    }
    return false;
  }, [menuOpen]);

  return (
    <>
      <SideNav
        onMenuClick={() => setMenuOpen(true)}
        onSettingsClick={() => navigate('/settings')}
      />
      <SideMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

      <div className="app-main">
        <Routes>
          <Route path="/" element={<DailyPlanPage />} />
          <Route path="/goals" element={<LongTermGoalsPage />} />
          <Route path="/reflection" element={<ReflectionPage />} />
          <Route path="/harvest" element={<HarvestPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/backup" element={<BackupRestorePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/tasks" element={<TaskListPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/week" element={<WeekViewPage />} />
        </Routes>
      </div>
      <TabBar />
    </>
  );
}

export default function App() {
  return (
    <BackButtonProvider>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </BackButtonProvider>
  );
}
