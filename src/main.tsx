import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from '@capacitor/app';
import AppRoot from './App';
import SetupPage from './pages/SetupPage';
import { loadFromFile, fileExists, setStoragePath, getDisplayPath, flush, isCapacitor } from './services/storage';

function Boot() {
  const [phase, setPhase] = useState<'loading' | 'setup' | 'ready'>('loading');
  const [statusMsg, setStatusMsg] = useState('正在初始化...');

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
      const count = await loadFromFile();

      if (count > 0) {
        setStatusMsg(`已从 ${getDisplayPath()} 恢复 ${count} 条记录`);
      } else if (count === -1) {
        setStatusMsg('首次使用，数据将在保存时创建');
      }

      // 短暂显示状态信息后进入应用
      await new Promise(r => setTimeout(r, count > 0 ? 800 : 200));
      setPhase('ready');
    })();
  }, []);

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

  const handleSetupComplete = async (path: string) => {
    setStoragePath(path);

    // 检查该路径是否已有数据文件（例如之前用过）
    setStatusMsg('正在检查已有数据...');
    const exists = await fileExists();

    if (exists) {
      const count = await loadFromFile();
      setStatusMsg(`发现已有数据，正在恢复 ${count} 条记录...`);
      await new Promise(r => setTimeout(r, 1000));
    }

    setPhase('ready');
  };

  if (phase === 'loading') {
    return (
      <div style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f5f5f7',
        color: '#6b7280',
        fontSize: '0.875rem',
        gap: 12,
      }}>
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

  return (
    <React.StrictMode>
      <AppRoot />
    </React.StrictMode>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Boot />);
