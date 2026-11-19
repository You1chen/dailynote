import { Suspense, lazy as ReactLazy, useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import TabBar from './components/TabBar';
import TaskBall from './components/TaskBall';
import SideNav from './components/SideNav';
import DailyPlanPage from './pages/DailyPlan';
import LongTermGoalsPage from './pages/LongTermGoals';
import GardenGate from './components/GardenGate';
import GardenPage from './pages/GardenPage';
import ReflectionPage from './pages/Reflection';
import TrashPage from './pages/Trash';
import BackupRestorePage from './pages/BackupRestore';
import SettingsPage from './pages/SettingsPage';
import CoursesPage from './pages/CoursesPage';
import WeekViewPage from './pages/WeekViewPage';
import DdlPage from './pages/DdlPage';
import ImportantPage from './pages/ImportantPage';
import BacklogPage from './pages/BacklogPage';
import SettlementPage from './pages/Settlement';
import { BackButtonProvider, useRegisterBackHandler } from './contexts/BackButtonContext';
import { usePreferences, type ThemeMode } from './hooks/usePreferences';
import { useBacklogBadge } from './hooks/useBacklog';
import { useDdlBadge } from './hooks/useDdlBadge';
import { useImportantBadge } from './hooks/useImportantBadge';
import { watchServiceWorkerUpdate } from './services/swUpdate';
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

const Walk = ReactLazy(() => import('./pages/Walk'));
function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const inGarden = location.pathname === '/garden' || location.pathname.startsWith('/garden/');
  const immersive = inGarden || location.pathname === '/wander';
  useRegisterBackHandler(() => {
    if (location.pathname === '/') return false;
    navigate('/', { replace: true });
    return true;
  }, [location.pathname, navigate], true);
  const { prefs } = usePreferences();
  const backlogBadge = useBacklogBadge();
  const ddlBadge = useDdlBadge();
  const importantBadge = useImportantBadge();
  // 有新版本接管（PWA）：提示刷新，避免一直看在旧缓存上
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => { watchServiceWorkerUpdate(() => setUpdateReady(true)); }, []);

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
      {!immersive && <SideNav badge={backlogBadge} ddlBadge={ddlBadge} importantBadge={importantBadge} />}

      <div className={inGarden ? "app-main app-main--garden" : "app-main"}>
        <Routes>
          <Route path="/wander" element={<Suspense fallback={null}><Walk /></Suspense>} />
          <Route path="/" element={<DailyPlanPage />} />
          <Route path="/goals" element={<LongTermGoalsPage />} />
          <Route path="/garden/*" element={<GardenGate><GardenPage /></GardenGate>} />
          <Route path="/backlog" element={<BacklogPage />} />
          <Route path="/reflection" element={<ReflectionPage />} />
          <Route path="/harvest" element={<Navigate to={`/reflection${location.search}`} replace />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/backup" element={<BackupRestorePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/week" element={<WeekViewPage />} />
          <Route path="/ddl" element={<DdlPage />} />
          <Route path="/important" element={<ImportantPage />} />
          <Route path="/settlement" element={<SettlementPage />} />
        </Routes>
      </div>
      {!immersive && <><TabBar /><TaskBall /></>}

      {updateReady && (
        <div className="app-update-bar" role="status">
          <span>有新版本</span>
          <button onClick={() => window.location.reload()}>刷新</button>
        </div>
      )}
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
