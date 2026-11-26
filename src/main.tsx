import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import AppRoot from './App';
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
  background: 'var(--color-bg)',
  color: 'var(--color-text-secondary)',
  fontSize: '0.875rem',
  gap: 12,
};

function Boot() {
  const [phase, setPhase] = useState<'loading' | 'storagePermission' | 'ready' | 'error'>('loading');
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
          border: '3px solid var(--color-border)',
          borderTopColor: 'var(--color-primary)',
          borderRadius: '50%',
          animation: 'boot-spin 0.8s linear infinite',
        }} />
        <span>正在读取数据…</span>
        {appVersion && <small>记 v{appVersion}</small>}
        <style>{`@keyframes boot-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div style={bootCenter}>
        <p role="alert">无法读取 记 数据。</p>
        <button type="button" className="btn btn-primary" onClick={() => { setPhase('loading'); void tryLoad(); }}>重试</button>
      </div>
    );
  }

  if (phase === 'storagePermission') {
    return (
      <main style={{ ...bootCenter, padding: 24, textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.25rem', color: 'var(--color-text)' }}>需要存储权限</h1>
        <p style={{ maxWidth: 400 }}>记 将数据保存在本机公共 Documents 目录，需要「所有文件访问」权限。</p>
        <p style={{ maxWidth: 400 }}>请在系统设置中打开「允许管理所有文件」，返回后会自动重新检测。</p>
        <button type="button" className="btn btn-primary" onClick={async () => {
          if (await requestAllFilesAccess()) void tryLoad();
        }}>打开系统设置</button>
        <button type="button" className="btn btn-outline" onClick={() => void tryLoad()}>重新检测权限</button>
        {appVersion && <small>记 v{appVersion}</small>}
      </main>
    );
  }

  return (
    <React.StrictMode>
      <AppRoot />
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Boot />);
