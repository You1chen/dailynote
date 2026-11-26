import { Suspense, lazy as ReactLazy, useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate, type Location } from 'react-router-dom';
import TaskBall from './components/TaskBall';
import SideNav, { type NavGroup } from './components/SideNav';
import DailyPlanPage from './pages/DailyPlan';
import LongTermGoalsPage from './pages/LongTermGoals';
import ReflectionPage from './pages/Reflection';
import TrashPage from './pages/Trash';
import SettingsPage from './pages/SettingsPage';
import CoursesPage from './pages/CoursesPage';
import WeekViewPage from './pages/WeekViewPage';
import DdlPage from './pages/DdlPage';
import ImportantPage from './pages/ImportantPage';
import { BackButtonProvider, useRegisterBackHandler } from './contexts/BackButtonContext';
import { useDdlBadge } from './hooks/useDdlBadge';
import { useImportantBadge } from './hooks/useImportantBadge';
import { watchServiceWorkerUpdate } from './services/swUpdate';
import { routeSwipeSurface, useAppSwipe, type SwipePreview } from './hooks/useAppSwipe';
import KnowledgeCardCollector from './components/KnowledgeCardCollector';
import type { QuickCardBackDetail } from './components/KnowledgeCardEditor';
import HomeAlarm from './components/HomeAlarm';
import { useRouteBack } from './hooks/useRouteBack';
import './App.css';

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
        if (event.key !== 'Escape') return;
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
  }, [navOpen, searchOpen, closeNav, closeSearch]);

  useRegisterBackHandler(() => {
    if (!navOpen) return false;
    if (searchOpen) closeSearch();
    else closeNav();
    return true;
  }, [navOpen, searchOpen, closeSearch, closeNav], 'overlay');
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

  const swipeSurface = searchOpen ? undefined : routeSwipeSurface(location.pathname, navOpen, quickNote);
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
  const ddlBadge = useDdlBadge();
  const importantBadge = useImportantBadge();
  // 有新版本接管（PWA）：提示刷新，避免一直看在旧缓存上
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => { watchServiceWorkerUpdate(() => setUpdateReady(true)); }, []);

  return (
    <div ref={swipeShell} className="app-gesture-shell" data-swipe={motion?.action} data-swipe-phase={motion?.phase}>
      {home && <SideNav open={navOpen} group={marker?.group} onGroup={group => showNav(underlying, group)} searchOpen={searchOpen}
        ddlBadge={ddlBadge} importantBadge={importantBadge}
        onClose={closeNav} onShowSearch={openSearch} onCloseSearch={closeSearch} onSelect={selectRoute} />}

      <div ref={page} className="app-page" aria-hidden={navOpen || quickNote || undefined}>
        {home && <button type="button" ref={opener} className="app-nav-toggle" onClick={openNav}
          aria-haspopup="dialog" aria-expanded={navOpen} aria-controls="app-navigation">打开导航</button>}
        <div className="app-main">
        <Routes location={underlying}>
          <Route path="/wander" element={<Suspense fallback={null}><Walk /></Suspense>} />
          <Route path="/" element={<DailyPlanPage alarm={<HomeAlarm ddlBadge={ddlBadge} importantBadge={importantBadge} />} />} />
          <Route path="/goals" element={<LongTermGoalsPage />} />
          <Route path="/reflection" element={<ReflectionPage />} />
          <Route path="/harvest" element={<Navigate to={`/reflection${location.search}`} replace />} />
          <Route path="/trash" element={<TrashPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/courses" element={<CoursesPage />} />
          <Route path="/week" element={<WeekViewPage />} />
          <Route path="/ddl" element={<DdlPage />} />
          <Route path="/important" element={<ImportantPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
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

export default function App() {
  return (
    <BackButtonProvider>
      <HashRouter>
        <AppShell />
      </HashRouter>
    </BackButtonProvider>
  );
}
