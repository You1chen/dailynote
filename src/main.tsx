import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import AppRoot from './v2/AppV2';
import { flush, requestAllFilesAccess } from './services/storage';
import { initializeStartup } from './services/startup';

const isAndroid = Capacitor.getPlatform() === 'android';

// Android 15+ applies window insets to the native content root. Keep the CSS
// safe-area variables at zero there so the two layers do not double-pad.
if (isAndroid) {
  const root = document.documentElement;
  root.style.setProperty('--safe-top', '0px');
  root.style.setProperty('--safe-right', '0px');
  root.style.setProperty('--safe-bottom', '0px');
  root.style.setProperty('--safe-left', '0px');
}

const bootCenter: React.CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'var(--v-bg)',
  color: 'var(--v-text-2)',
  fontSize: '0.875rem',
  fontFamily: 'var(--v-font)',
  gap: 12,
};

const bootButton: React.CSSProperties = {
  height: 42,
  padding: '0 20px',
  border: 0,
  borderRadius: 999,
  background: 'var(--v-accent)',
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const bootButtonGhost: React.CSSProperties = {
  ...bootButton,
  background: 'transparent',
  color: 'var(--v-accent)',
};

function Boot() {
  const [phase, setPhase] = useState<'loading' | 'storagePermission' | 'ready' | 'error'>('loading');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [appVersion, setAppVersion] = useState('');
  const busyRef = useRef(false);

  useEffect(() => {
    if (isAndroid) App.getInfo().then(info => setAppVersion(info.version)).catch(() => {});
  }, []);

  const tryLoad = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const result = await initializeStartup();
      if (result.phase === 'storagePermission') {
        setPhase('storagePermission');
        return;
      }
      if (result.count > 0) {
        // Move legacy embedded cards to the independent collector before rendering.
        const { initializeKnowledgeCards } = await import('./db/knowledgeCards');
        await initializeKnowledgeCards();
      }
      setShowOnboarding(result.showOnboarding);
      setPhase('ready');
    } catch (error) {
      console.error('读取启动数据失败:', error);
      setPhase('error');
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => { void tryLoad(); }, [tryLoad]);

  // Don't write an empty startup snapshot while waiting for access to existing data.
  useEffect(() => {
    if (phase !== 'ready') return;
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onHide);
    const listener = isAndroid ? App.addListener('pause', () => { void flush(); }) : null;
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      void listener?.then(handle => handle.remove());
    };
  }, [phase]);

  // Check again after the user returns from Android's system settings.
  useEffect(() => {
    if (phase !== 'storagePermission') return;
    const onVisible = () => { if (document.visibilityState === 'visible') void tryLoad(); };
    document.addEventListener('visibilitychange', onVisible);
    const listener = isAndroid ? App.addListener('appStateChange', state => { if (state.isActive) void tryLoad(); }) : null;
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void listener?.then(handle => handle.remove());
    };
  }, [phase, tryLoad]);

  if (phase === 'loading') {
    return (
      <div style={bootCenter} role="status">
        <div style={{
          width: 32, height: 32,
          border: '3px solid var(--v-separator)',
          borderTopColor: 'var(--v-accent)',
          borderRadius: '50%',
          animation: 'boot-spin 0.8s linear infinite',
        }} />
        <span>正在读取数据…</span>
        {appVersion && <small>DailyNote v{appVersion}</small>}
        <style>{`@keyframes boot-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div style={bootCenter}>
        <p role="alert" style={{ color: 'var(--v-text)' }}>无法读取 DailyNote 数据。</p>
        <button type="button" style={bootButton} onClick={() => { setPhase('loading'); void tryLoad(); }}>重试</button>
      </div>
    );
  }

  if (phase === 'storagePermission') {
    return (
      <main style={{ ...bootCenter, padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.35rem', color: 'var(--v-text)', letterSpacing: '-0.02em' }}>需要存储权限</h1>
        <p style={{ maxWidth: 400 }}>DailyNote 将数据保存在本机公共 Documents 目录，需要「所有文件访问」权限。</p>
        <p style={{ maxWidth: 400 }}>请在系统设置中打开「允许管理所有文件」，返回后会自动重新检测。</p>
        <button type="button" style={bootButton} onClick={async () => {
          if (await requestAllFilesAccess()) void tryLoad();
        }}>打开系统设置</button>
        <button type="button" style={bootButtonGhost} onClick={() => void tryLoad()}>重新检测权限</button>
        {appVersion && <small>DailyNote v{appVersion}</small>}
      </main>
    );
  }

  return (
    <React.StrictMode>
      <AppRoot showOnboarding={showOnboarding} />
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Boot />);
