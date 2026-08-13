import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@capacitor/app';
import AppRoot from './App';
import SetupPage from './pages/SetupPage';
import {
  loadFromFile,
  setStoragePath,
  getDisplayPath,
  flush,
  isCapacitor,
  storageAccessBlocked,
  requestAllFilesAccess,
  INIT_STORAGE_BLOCKED,
} from './services/storage';

const bootCenter: React.CSSProperties = {
  minHeight: '100dvh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#f5f5f7',
  color: '#6b7280',
  fontSize: '0.875rem',
  gap: 12,
};

const permBtn: React.CSSProperties = {
  marginTop: 8,
  padding: '12px 28px',
  borderRadius: 10,
  border: 'none',
  background: '#4f46e5',
  color: '#fff',
  fontSize: '0.95rem',
  cursor: 'pointer',
};

const permBtnGhost: React.CSSProperties = {
  ...permBtn,
  background: 'transparent',
  color: '#4f46e5',
  border: '1px solid #4f46e5',
  marginTop: 0,
};

function Boot() {
  const [phase, setPhase] = useState<'loading' | 'setup' | 'storagePermission' | 'ready'>('loading');
  const [statusMsg, setStatusMsg] = useState('正在初始化...');
  const busyRef = useRef(false);

  /** 权限就绪后加载数据：被阻塞 → 授权页；成功 → 进入应用 */
  const tryLoad = useCallback(async (): Promise<void> => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (await storageAccessBlocked()) {
        setPhase('storagePermission');
        return;
      }

      setStatusMsg('正在读取数据...');
      const count = await loadFromFile();

      if (count === INIT_STORAGE_BLOCKED) {
        setPhase('storagePermission');
        return;
      }
      if (count > 0) {
        setStatusMsg(`已从 ${getDisplayPath()} 恢复 ${count} 条记录`);
      } else if (count === -1) {
        setStatusMsg('首次使用，数据将在保存时创建');
      }

      // 短暂显示状态信息后进入应用
      await new Promise(r => setTimeout(r, count > 0 ? 800 : 200));
      setPhase('ready');
    } finally {
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    (async () => {
      const storagePath = localStorage.getItem('dailynote_storage_path');

      if (!storagePath) {
        // 首次使用，需要用户选择存储位置
        setPhase('setup');
        return;
      }

      // 已有存储路径：从文件加载数据到内存（file-authoritative）
      setStatusMsg('正在读取数据...');
      await tryLoad();
    })();
  }, [tryLoad]);

  // 生命周期兜底：切后台/退到桌面时冲刷未完成写入
  useEffect(() => {
    const onHide = () => { flush(); };
    document.addEventListener('visibilitychange', onHide);
    let appListener: { remove: () => void } | null = null;
    if (isCapacitor()) {
      App.addListener('pause', onHide).then(l => { appListener = l; });
    }
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      appListener?.remove();
    };
  }, []);

  // 授权页：用户去系统设置开启「所有文件访问」返回后，自动重新检测并加载
  useEffect(() => {
    if (phase !== 'storagePermission') return;
    let cancelled = false;
    const check = () => { if (!cancelled) tryLoad(); };
    const onVisibility = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisibility);
    let appListener: { remove: () => void } | null = null;
    if (isCapacitor()) {
      App.addListener('appStateChange', state => { if (state.isActive) check(); }).then(l => { appListener = l; });
    }
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      appListener?.remove();
    };
  }, [phase, tryLoad]);

  const handleSetupComplete = async (path: string) => {
    setStoragePath(path);

    // 检查该路径是否已有数据文件（例如之前用过）；权限被阻塞则先引导授权
    setStatusMsg('正在检查已有数据...');
    await tryLoad();
  };

  const handleGrantAccess = async () => {
    await requestAllFilesAccess();
  };

  if (phase === 'loading') {
    return (
      <div style={bootCenter}>
        <div style={{
          width: 32, height: 32,
          border: '3px solid #e5e7eb',
          borderTopColor: '#4f46e5',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <span>{statusMsg}</span>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (phase === 'setup') {
    return <SetupPage onComplete={handleSetupComplete} />;
  }

  if (phase === 'storagePermission') {
    return (
      <div style={{ ...bootCenter, padding: 24, textAlign: 'center', color: '#374151', fontSize: '0.9rem' }}>
        <span style={{ fontSize: 44 }}>🔓</span>
        <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#111827' }}>需要存储权限</h2>
        <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.7 }}>
          你的数据文件保存在公共 Documents 目录。Android 11+ 系统限制应用直接读写该目录，
          需要授予「所有文件访问」权限，应用才能读取和保存这些数据（数据只在手机本地，不会上传）。
        </p>
        <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.7, color: '#6b7280', fontSize: '0.8rem' }}>
          点击下方按钮打开系统设置，开启「允许管理所有文件」开关后返回本应用，将自动重新检测并恢复数据。
        </p>
        <button style={permBtn} onClick={handleGrantAccess}>去开启权限</button>
        <button style={permBtnGhost} onClick={() => tryLoad()}>已开启，重新检测</button>
      </div>
    );
  }

  return (
    <React.StrictMode>
      <AppRoot />
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Boot />);
