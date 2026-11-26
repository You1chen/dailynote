import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CalendarDays, Camera, CircleHelp, Layers, ListTodo, Settings2 } from 'lucide-react';
import { BackButtonProvider, useRegisterBackHandler } from '../contexts/BackButtonContext';
import { usePreferences } from '../hooks/usePreferences';
import { useTaskBadge } from '../hooks/useTaskBoard';
import { dismissOnboarding } from '../services/startup';
import { watchServiceWorkerUpdate } from '../services/swUpdate';
import type { KnowledgeCard } from '../types/knowledge';
import { DataProvider } from './state/DataProvider';
import { UiContext, type ConfirmOptions, type ScheduleDraft, type ToastOptions, type UiApi } from './state/ui';
import TodayPage from './pages/TodayPage';
import CardsPage from './pages/CardsPage';
import CameraSheet from './components/CameraSheet';
import TodoSheet from './components/TodoSheet';
import HelpSheet from './components/HelpSheet';
import SettingsSheet from './components/SettingsSheet';
import WelcomeSheet from './components/WelcomeSheet';
import ScheduleSheet from './components/ScheduleSheet';
import CardEditorSheet from './components/CardEditorSheet';
import CardDetailSheet from './components/CardDetailSheet';
import ConfirmSheet from './components/ConfirmSheet';
import './v2.css';

interface ToastItem {
  id: number;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface EditorState {
  card: KnowledgeCard;
  isNew: boolean;
}

export default function AppV2({ showOnboarding = false }: { showOnboarding?: boolean }) {
  return (
    <BackButtonProvider>
      <DataProvider>
        <HashRouter>
          <Shell showOnboarding={showOnboarding} />
        </HashRouter>
      </DataProvider>
    </BackButtonProvider>
  );
}

function Shell({ showOnboarding }: { showOnboarding: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { prefs } = usePreferences();
  const undone = useTaskBadge();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(showOnboarding);
  const [schedule, setSchedule] = useState<ScheduleDraft | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [confirmOptions, setConfirmOptions] = useState<ConfirmOptions | null>(null);
  const confirmResolver = useRef<((value: boolean) => void) | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastSeq = useRef(0);

  const showToast = useCallback((message: string, options?: ToastOptions) => {
    const id = ++toastSeq.current;
    setToasts(list => [...list, { id, message, actionLabel: options?.actionLabel, onAction: options?.onAction }]);
    window.setTimeout(() => {
      setToasts(list => list.filter(item => item.id !== id));
    }, options?.duration ?? 2800);
  }, []);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => (
    new Promise(resolve => {
      confirmResolver.current = resolve;
      setConfirmOptions(options);
    })
  ), []);

  const resolveConfirm = useCallback((value: boolean) => {
    confirmResolver.current?.(value);
    confirmResolver.current = null;
    setConfirmOptions(null);
  }, []);

  const openCardEditor = useCallback((card: KnowledgeCard, isNew = false) => {
    setDetailId(null);
    setEditor({ card, isNew });
  }, []);

  const openSchedule = useCallback((draft: ScheduleDraft) => setSchedule(draft), []);

  const closeWelcome = useCallback(() => {
    dismissOnboarding();
    setWelcomeOpen(false);
  }, []);

  const ui = useMemo<UiApi>(() => ({
    openCamera: () => setCameraOpen(true),
    openTodo: () => setTodoOpen(true),
    openHelp: () => setHelpOpen(true),
    openSettings: () => setSettingsOpen(true),
    openSchedule,
    openCardEditor,
    openCardDetail: (cardId: string) => setDetailId(cardId),
    toast: showToast,
    confirm,
  }), [openSchedule, openCardEditor, showToast, confirm]);

  // Keep the native chrome and browser theme colour in sync with preferences.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = prefs.theme === 'system' ? (media.matches ? 'dark' : 'light') : prefs.theme;
      document.documentElement.dataset.theme = resolved;
      document.documentElement.style.colorScheme = resolved;
      const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
      if (meta) meta.content = resolved === 'dark' ? '#0a0a0c' : '#f5f5f7';
    };
    apply();
    if (prefs.theme !== 'system') return;
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [prefs.theme]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [location.pathname]);

  useEffect(() => watchServiceWorkerUpdate(() => {
    showToast('有新版本，刷新后生效', {
      actionLabel: '刷新',
      onAction: () => window.location.reload(),
      duration: 12_000,
    });
  }), [showToast]);

  const closeTopSheet = useCallback(() => {
    if (confirmOptions) { resolveConfirm(false); return true; }
    if (editor) { setEditor(null); return true; }
    if (detailId) { setDetailId(null); return true; }
    if (schedule) { setSchedule(null); return true; }
    if (cameraOpen) { setCameraOpen(false); return true; }
    if (helpOpen) { setHelpOpen(false); return true; }
    if (settingsOpen) { setSettingsOpen(false); return true; }
    if (welcomeOpen) { closeWelcome(); return true; }
    return false;
  }, [confirmOptions, editor, detailId, schedule, cameraOpen, helpOpen, settingsOpen, welcomeOpen, resolveConfirm, closeWelcome]);

  useRegisterBackHandler(closeTopSheet, [closeTopSheet], 'overlay');
  useRegisterBackHandler(() => {
    if (location.pathname !== '/') {
      navigate('/');
      return true;
    }
    return false;
  }, [location.pathname, navigate]);

  const activeTab = location.pathname === '/cards' ? 'cards' : 'today';

  return (
    <UiContext.Provider value={ui}>
      <div className="v-app">
        <header className="v-topbar">
          <div className="v-topbar-inner">
            <button type="button" className="v-brand" onClick={() => navigate('/')} aria-label="回到今日">
              <span className="v-brand-mark" aria-hidden="true" />
              <span className="v-brand-name">DailyNote</span>
              <span className="v-brand-sub">今日 · 卡片</span>
            </button>
            <div className="v-top-actions">
              <button
                type="button"
                className="v-iconbtn"
                aria-label={`打开待办${undone ? `，${undone} 项未完成` : ''}`}
                onClick={() => setTodoOpen(true)}
                style={{ position: 'relative' }}
              >
                <ListTodo size={18} />
                {undone > 0 && <span className="v-top-badge">{undone > 99 ? '99+' : undone}</span>}
              </button>
              <button type="button" className="v-iconbtn" aria-label="使用说明" onClick={() => setHelpOpen(true)}>
                <CircleHelp size={18} />
              </button>
              <button type="button" className="v-iconbtn" aria-label="设置" onClick={() => setSettingsOpen(true)}>
                <Settings2 size={18} />
              </button>
            </div>
          </div>
        </header>

        <div className="v-shell">
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/cards" element={<CardsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>

        <nav className="v-tabbar" aria-label="主导航">
          <button
            type="button"
            className="v-tab"
            aria-current={activeTab === 'today' ? 'page' : undefined}
            onClick={() => navigate('/')}
          >
            <CalendarDays size={18} />
            今日
          </button>
          <button
            type="button"
            className="v-tab"
            aria-current={activeTab === 'cards' ? 'page' : undefined}
            onClick={() => navigate('/cards')}
          >
            <Layers size={18} />
            卡片
          </button>
        </nav>

        <button
          type="button"
          className="v-camera-ball"
          aria-label="拍照"
          title="拍照"
          onClick={() => setCameraOpen(true)}
        >
          <Camera size={24} />
        </button>

        <ScheduleSheet open={!!schedule} draft={schedule} onClose={() => setSchedule(null)} />
        <CardEditorSheet
          open={!!editor}
          card={editor?.card ?? null}
          isNew={editor?.isNew ?? false}
          onClose={() => setEditor(null)}
        />
        <CardDetailSheet open={!!detailId} cardId={detailId} onClose={() => setDetailId(null)} />
        <CameraSheet open={cameraOpen} onClose={() => setCameraOpen(false)} />
        <TodoSheet open={todoOpen} onClose={() => setTodoOpen(false)} />
        <HelpSheet open={helpOpen} onClose={() => setHelpOpen(false)} />
        <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <WelcomeSheet open={welcomeOpen} onClose={closeWelcome} />
        <ConfirmSheet
          open={!!confirmOptions}
          options={confirmOptions}
          onResolve={value => resolveConfirm(value)}
        />

        <div className="v-toast-wrap" role="status" aria-live="polite">
          {toasts.map(toast => (
            <div className="v-toast" key={toast.id}>
              <span>{toast.message}</span>
              {toast.actionLabel && (
                <button
                  type="button"
                  onClick={() => {
                    toast.onAction?.();
                    setToasts(list => list.filter(item => item.id !== toast.id));
                  }}
                >
                  {toast.actionLabel}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </UiContext.Provider>
  );
}
