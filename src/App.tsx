import { useState, useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import TabBar from './components/TabBar';
import TaskBall from './components/TaskBall';
import SideNav from './components/SideNav';
import DailyPlanPage from './pages/DailyPlan';
import LongTermGoalsPage from './pages/LongTermGoals';
import ReflectionPage from './pages/Reflection';
import HarvestPage from './pages/Harvest';
import TrashPage from './pages/Trash';
import BackupRestorePage from './pages/BackupRestore';
import SettingsPage from './pages/SettingsPage';
import CoursesPage from './pages/CoursesPage';
import WeekViewPage from './pages/WeekViewPage';
import DdlPage from './pages/DdlPage';
import ImportantPage from './pages/ImportantPage';
import BacklogPage from './pages/BacklogPage';
import { BackButtonProvider } from './contexts/BackButtonContext';
import { usePreferences, type ThemeMode } from './hooks/usePreferences';
import { useBacklogBadge } from './hooks/useBacklog';
import { useDdlBadge } from './hooks/useDdlBadge';
import { useImportantBadge } from './hooks/useImportantBadge';
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
  const { prefs } = usePreferences();
  const backlogBadge = useBacklogBadge();
  const ddlBadge = useDdlBadge();
  const importantBadge = useImportantBadge();

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

  return (
    <>
      <SideNav badge={backlogBadge} ddlBadge={ddlBadge} importantBadge={importantBadge} />

      <div className="app-main">
        <Routes>
          <Route path="/" element={<DailyPlanPage />} />
          <Route path="/goals" element={<LongTermGoalsPage />} />
          <Route path="/backlog" element={<BacklogPage />} />
          <Route path="/reflection" element={<ReflectionPage />} />
          <Route path="/harvest" element={<HarvestPage />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/backup" element={<BackupRestorePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/week" element={<WeekViewPage />} />
          <Route path="/ddl" element={<DdlPage />} />
          <Route path="/important" element={<ImportantPage />} />
        </Routes>
      </div>
      <TabBar />
      <TaskBall />
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
