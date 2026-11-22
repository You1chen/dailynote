import { Suspense, lazy as ReactLazy, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate, type Location } from 'react-router-dom';
import TaskBall from './components/TaskBall';
import SideNav, { type NavGroup } from './components/SideNav';
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
import HelpDialog from './components/HelpDialog';
import AvatarPreview from './components/AvatarPreview';
import UpdateApkDialog from './components/UpdateApkDialog';
import { apkUpdateSupported, findAutoUpdate } from './services/apkUpdate';
import type { ApkFileInfo } from './utils/apkUpdate';
import { BackButtonProvider, useRegisterBackHandler } from './contexts/BackButtonContext';
import { usePreferences, type ThemeMode } from './hooks/usePreferences';
import { useBacklogBadge } from './hooks/useBacklog';
import { useDdlBadge } from './hooks/useDdlBadge';
import { useImportantBadge } from './hooks/useImportantBadge';
import { watchServiceWorkerUpdate } from './services/swUpdate';
import { routeSwipeSurface, useAppSwipe, type SwipePreview } from './hooks/useAppSwipe';
import KnowledgeCardCollector from './components/KnowledgeCardCollector';
import type { QuickCardBackDetail } from './components/KnowledgeCardEditor';
import HomeAlarm from './components/HomeAlarm';
import { useRouteBack } from './hooks/useRouteBack';
import './App.css';

const AUTO_UPDATE_SKIP_KEY = 'dailynote_update_skip';

/** 同一个 APK（路径、大小、修改时间）只自动提示一次。 */
function autoUpdateKey(file: ApkFileInfo): string {
  return `${file.path}|${file.size}|${file.modified}`;
}

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
const SWIPE_SETTLE_MS = 240;
type SwipeMotion = { action: SwipePreview['action']; phase: 'drag' | 'saving' | 'cancel' | 'commit' };

function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const routeBack = useRouteBack();
  const home = location.pathname === '/';
  const quickNote = location.pathname === '/reflection' && !!location.state?.fromHomeQuickNote;
  const marker = location.state?.fullscreenNavigation as { base: Location; group?: NavGroup } | undefined;
  const homeNavigation = home && marker?.base?.pathname === '/' ? marker : undefined;
  const navOpen = !!homeNavigation;
  const quickBase = location.state?.quickCardBase as Location | undefined;
  const underlying = homeNavigation?.base ?? (quickNote ? quickBase ?? { ...location, pathname: '/', hash: '', search: '', state: null } : location);
  const [searchKey, setSearchKey] = useState<string>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [avatarPreviewKey, setAvatarPreviewKey] = useState<string>();
  const avatarPreviewOpen = avatarPreviewKey === location.key;
  const openAvatarPreview = () => setAvatarPreviewKey(location.key);
  const closeAvatarPreview = () => setAvatarPreviewKey(undefined);
  const searchOpen = navOpen && searchKey === location.key;
  const showNav = useCallback((base: Location, group?: NavGroup) => {
    navigate(`${base.pathname}${base.search}${base.hash}`, {
      state: { fullscreenNavigation: { base, group } },
      preventScrollReset: true,
    });
  }, [navigate]);
  const openNav = useCallback(() => {
    if (home && !navOpen) showNav(underlying);
  }, [home, navOpen, showNav, underlying]);
  const closeNav = useCallback(() => navigate(-1), [navigate]);
  const openSearch = useCallback(() => setSearchKey(location.key), [location.key]);
  const closeSearch = useCallback(() => setSearchKey(undefined), []);
  const opener = useRef<HTMLButtonElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const previouslyOpen = useRef(false);

  const selectRoute = (to: string) => {
    if (to === `${location.pathname}${location.search}${location.hash}` || to === location.pathname) closeNav();
    else navigate(to);
  };

  useLayoutEffect(() => {
    page.current?.toggleAttribute('inert', navOpen || quickNote);
  }, [navOpen, quickNote]);

  useEffect(() => {
    if (!navOpen && !quickNote) return;
    const overflow = document.body.style.overflowY;
    document.body.style.overflowY = 'hidden';
    return () => { document.body.style.overflowY = overflow; };
  }, [navOpen, quickNote]);

  useEffect(() => {
    if (navOpen) {
      const onKey = (event: KeyboardEvent) => {
        if (event.key !== 'Escape' || helpOpen || avatarPreviewOpen || updateOpen) return;
        event.preventDefault();
        event.stopPropagation();
        if (searchOpen) closeSearch();
        else closeNav();
      };
      document.addEventListener('keydown', onKey, true);
      previouslyOpen.current = true;
      return () => {
        document.removeEventListener('keydown', onKey, true);
      };
    }
    if (previouslyOpen.current) opener.current?.focus({ preventScroll: true });
    previouslyOpen.current = false;
  }, [navOpen, searchOpen, helpOpen, avatarPreviewOpen, updateOpen, closeNav, closeSearch]);

  useRegisterBackHandler(() => {
    if (avatarPreviewOpen) { closeAvatarPreview(); return true; }
    if (!navOpen || (updateOpen && !helpOpen)) return false;
    if (helpOpen) { setHelpOpen(false); return true; }
    if (searchOpen) closeSearch();
    else closeNav();
    return true;
  }, [navOpen, searchOpen, helpOpen, avatarPreviewOpen, updateOpen, closeSearch, closeNav], 'overlay');
  useRegisterBackHandler(() => {
    if (home) return false;
    routeBack();
    return true;
  }, [home, routeBack], true);

  const swipeShell = useRef<HTMLDivElement>(null);
  const quickPanel = useRef<HTMLDivElement>(null);
  const [motion, setMotion] = useState<SwipeMotion>();
  const motionRef = useRef<SwipeMotion>();
  const timer = useRef<number>();

  const updateMotion = useCallback((next?: SwipeMotion) => {
    motionRef.current = next;
    setMotion(next);
  }, []);
  useLayoutEffect(() => {
    // Navigation, browser Back, and modal changes invalidate the gesture and its timers.
    return () => {
      window.clearTimeout(timer.current);
      updateMotion();
    };
  }, [location.key, searchOpen, updateMotion]);

  function draw({ action, distance }: SwipePreview) {
    // A group is a drill-down within navigation. Its back gesture returns to the directory.
    if (marker?.group && action === 'close-navigation') return;
    const shell = swipeShell.current;
    if (!shell) return;
    const offset = Math.min(distance, document.documentElement.clientWidth || window.innerWidth);
    shell.style.setProperty('--swipe-distance', `${offset}px`);
    if (motionRef.current?.action !== action) updateMotion({ action, phase: 'drag' });
  }

  function settle(preview: SwipePreview, commit: boolean, complete?: () => void) {
    const shell = swipeShell.current;
    if (!shell) return;
    draw(preview);
    // Flush the final drag position before changing the CSS target for the transition.
    void shell.offsetWidth;
    updateMotion({ action: preview.action, phase: commit ? 'commit' : 'cancel' });
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    timer.current = window.setTimeout(() => {
      if (complete) complete();
      else updateMotion();
    }, reduced ? 0 : SWIPE_SETTLE_MS);
  }

  function release(preview: SwipePreview, commit: boolean) {
    if (marker?.group && preview.action === 'close-navigation') {
      if (commit) closeNav();
      return;
    }
    if (!commit) { settle(preview, false); return; }
    switch (preview.action) {
      case 'open-navigation':
        settle(preview, true, openNav);
        break;
      case 'close-navigation':
        settle(preview, true, closeNav);
        break;
      case 'open-quick-note':
        // The mounted preview becomes the real editor without replacing the home route or draft.
        settle(preview, true, () => navigate('/reflection?cards=new', { state: { fromHomeQuickNote: true, quickCardBase: underlying }, preventScrollReset: true }));
        break;
      case 'close-quick-note': {
        draw(preview);
        const waiting: SwipeMotion = { action: preview.action, phase: 'saving' };
        updateMotion(waiting);
        const detail: QuickCardBackDetail = {
          handled: false,
          complete: saved => {
            if (motionRef.current !== waiting) return;
            settle(preview, saved, saved ? routeBack : undefined);
          },
        };
        window.dispatchEvent(new CustomEvent('dailynote-quick-card-back', { detail }));
        if (!detail.handled) settle(preview, false);
        break;
      }
    }
  }

  const swipeSurface = searchOpen || helpOpen || avatarPreviewOpen || updateOpen
    ? undefined
    : routeSwipeSurface(location.pathname, navOpen, quickNote);
  useAppSwipe({
    context: `${location.key}:${swipeSurface}`,
    // Let a started gesture own its direction, but block new gestures during a settling animation.
    surface: motion && motion.phase !== 'drag' ? undefined : swipeSurface,
    onPreview: draw,
    onRelease: release,
  });
  const openingQuick = motion?.action === 'open-quick-note';
  const renderQuick = quickNote || openingQuick;
  useLayoutEffect(() => { quickPanel.current?.toggleAttribute('inert', !quickNote); }, [quickNote, renderQuick]);
  const { prefs } = usePreferences();
  const backlogBadge = useBacklogBadge();
  const ddlBadge = useDdlBadge();
  const importantBadge = useImportantBadge();
  // 有新版本接管（PWA）：提示刷新，避免一直看在旧缓存上
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => { watchServiceWorkerUpdate(() => setUpdateReady(true)); }, []);

  // 首次引导最后一步直接指向说明书：打开应用内「帮助」。
  useEffect(() => {
    const openHelp = () => setHelpOpen(true);
    window.addEventListener('dailynote-open-help', openHelp);
    return () => window.removeEventListener('dailynote-open-help', openHelp);
  }, []);

  // 应用内更新：设置页入口与启动时自动检测更高版本的安装包。
  // 自动提示被关掉后，同一个 APK 不再打扰；换成新文件会重新提示。
  const [pendingAutoUpdate, setPendingAutoUpdate] = useState<ApkFileInfo | null>(null);
  useEffect(() => {
    const openUpdate = () => {
      setPendingAutoUpdate(null);
      setUpdateOpen(true);
    };
    window.addEventListener('dailynote-open-update', openUpdate);
    return () => window.removeEventListener('dailynote-open-update', openUpdate);
  }, []);
  useEffect(() => {
    if (!apkUpdateSupported()) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void findAutoUpdate().then(file => {
        if (cancelled || !file) return;
        let skipped: string | null = null;
        try { skipped = localStorage.getItem(AUTO_UPDATE_SKIP_KEY); } catch { /* 隐私模式 */ }
        if (skipped === autoUpdateKey(file)) return;
        setPendingAutoUpdate(file);
        setUpdateOpen(true);
      });
    }, 1600);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, []);
  const closeUpdate = () => {
    if (pendingAutoUpdate) {
      try { localStorage.setItem(AUTO_UPDATE_SKIP_KEY, autoUpdateKey(pendingAutoUpdate)); } catch { /* 忽略 */ }
      setPendingAutoUpdate(null);
    }
    setUpdateOpen(false);
  };

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
    <div ref={swipeShell} className="app-gesture-shell" data-swipe={motion?.action} data-swipe-phase={motion?.phase}>
      {home && <SideNav open={navOpen} group={marker?.group} onGroup={group => showNav(underlying, group)} searchOpen={searchOpen} avatar={prefs.avatar} username={prefs.username}
        badge={backlogBadge} ddlBadge={ddlBadge} importantBadge={importantBadge}
        onClose={closeNav} onPreviewAvatar={openAvatarPreview} onHelp={() => setHelpOpen(true)} onShowSearch={openSearch} onCloseSearch={closeSearch} onSelect={selectRoute} />}
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      {avatarPreviewOpen && <AvatarPreview avatar={prefs.avatar} onClose={closeAvatarPreview} />}
      <UpdateApkDialog open={updateOpen && !avatarPreviewOpen && !helpOpen} onClose={closeUpdate} />

      <div ref={page} className="app-page" aria-hidden={navOpen || quickNote || undefined}>
        {home && <button type="button" ref={opener} className="app-nav-toggle" onClick={openNav}
          aria-haspopup="dialog" aria-expanded={navOpen} aria-controls="app-navigation">打开导航</button>}
        <div className="app-main">
        <Routes location={underlying}>
          <Route path="/wander" element={<Suspense fallback={null}><Walk /></Suspense>} />
          <Route path="/" element={<DailyPlanPage alarm={<HomeAlarm backlogBadge={backlogBadge} ddlBadge={ddlBadge} importantBadge={importantBadge} />} />} />
          <Route path="/goals" element={<LongTermGoalsPage />} />
          <Route path="/garden/*" element={<GardenGate><GardenPage /></GardenGate>} />
          <Route path="/backlog" element={<BacklogPage />} />
          <Route path="/reflection" element={<ReflectionPage />} />
          <Route path="/harvest" element={<Navigate to={`/reflection${location.search}`} replace />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/backup" element={<BackupRestorePage />} />
          <Route path="/settings" element={<SettingsPage onPreviewAvatar={openAvatarPreview} />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/week" element={<WeekViewPage />} />
          <Route path="/ddl" element={<DdlPage />} />
          <Route path="/important" element={<ImportantPage />} />
          <Route path="/settlement" element={<SettlementPage />} />
        </Routes>
        </div>
        {home && <TaskBall />}

        {updateReady && (
          <div className="app-update-bar" role="status">
            <span>有新版本</span>
            <button onClick={() => window.location.reload()}>刷新</button>
          </div>
        )}
      </div>
      {renderQuick && <div ref={quickPanel} className="app-quick-panel" aria-hidden={!quickNote || undefined}>
        <KnowledgeCardCollector startWithNewCard quickComposer onClose={routeBack} />
      </div>}
    </div>
  );
}

export default function App({ children }: { children?: React.ReactNode }) {
  return (
    <BackButtonProvider>
      <HashRouter>
        <AppShell />
        {children}
      </HashRouter>
    </BackButtonProvider>
  );
}
