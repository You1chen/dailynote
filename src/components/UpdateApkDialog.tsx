import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import ConfirmDialog from './ConfirmDialog';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import {
  apkUpdateSupported,
  canRequestInstall,
  errorMessage,
  getInstalledAppInfo,
  installUpdatePackage,
  openInstallPermissionSettings,
  scanUpdatePackages,
} from '../services/apkUpdate';
import { getStoragePath } from '../services/store';
import {
  apkKind,
  describeApk,
  formatSize,
  isCoverInstallable,
  kindLabel,
  pickBestApk,
  versionText,
  type ApkFileInfo,
  type InstalledAppInfo,
} from '../utils/apkUpdate';
import './UpdateApkDialog.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * 应用内更新：扫描存储目录里的 APK，确认包名与签名后调起系统安装器覆盖安装。
 * 系统安装器仍会再确认一次；覆盖安装保留应用数据。
 */
export default function UpdateApkDialog({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [files, setFiles] = useState<ApkFileInfo[]>([]);
  const [installed, setInstalled] = useState<InstalledAppInfo | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!apkUpdateSupported()) {
      setError('仅 Android 安装版支持应用内更新。');
      setFiles([]);
      setInstalled(null);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [info, list, permission] = await Promise.all([
        getInstalledAppInfo(),
        scanUpdatePackages(),
        canRequestInstall(),
      ]);
      setInstalled(info);
      setFiles(list);
      setAllowed(permission);
      setSelectedPath(previous => {
        if (previous && list.some(file => file.path === previous)) return previous;
        return info ? pickBestApk(list, info)?.path ?? null : null;
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // 从系统「安装未知应用」设置返回后自动刷新权限状态。
  useEffect(() => {
    if (!open) return;
    const recheck = () => {
      void canRequestInstall().then(setAllowed).catch(() => {});
    };
    const onVisible = () => { if (document.visibilityState === 'visible') recheck(); };
    window.addEventListener('focus', recheck);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', recheck);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open]);

  // Android 返回键与桌面 Esc 先关对话框，不回到设置页。
  useRegisterBackHandler(() => {
    if (!open) return false;
    onClose();
    return true;
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const selected = files.find(file => file.path === selectedPath) ?? null;
  const usable = !!selected && isCoverInstallable(selected) && allowed;
  const kind = selected && installed ? apkKind(selected, installed) : 'foreign';
  const storageHint = getStoragePath();

  const startInstall = async () => {
    if (!selected) return;
    setConfirming(false);
    setInstalling(true);
    setError('');
    try {
      await installUpdatePackage(selected);
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="ua-mask" onClick={onClose}>
      <section
        className="ua-box"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ua-title"
        onClick={event => event.stopPropagation()}
      >
        <header className="ua-head">
          <div>
            <p className="ua-eyebrow">应用内更新</p>
            <h2 id="ua-title">安装更新包</h2>
          </div>
          <div className="ua-head-actions">
            <button
              type="button"
              className="ua-icon-btn"
              aria-label="重新扫描"
              onClick={() => void refresh()}
              disabled={loading || installing}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </button>
            <button type="button" className="ua-icon-btn" aria-label="关闭" onClick={onClose}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        <p className="ua-hint">
          把新的 APK 放进 <code>{storageHint}</code>、<code>Documents</code> 或 <code>Download</code>，
          再点刷新。只有同包名、同签名的安装包才能覆盖安装，数据会保留。
        </p>

        {installed && (
          <p className="ua-current">
            当前版本 {versionText(installed.versionName, installed.versionCode)}
          </p>
        )}
        {!loading && !error && !installed && (
          <p className="ua-note">无法读取当前版本，应用内更新暂不可用。</p>
        )}

        {loading && <p className="ua-note">正在扫描安装包…</p>}
        {!loading && !error && files.length === 0 && (
          <p className="ua-note">没有找到 DailyNote 的 APK。复制安装包到上面的目录后点右上角刷新。</p>
        )}

        {!loading && files.length > 0 && (
          <ul className="ua-list">
            {files.map(file => {
              const itemKind = installed ? apkKind(file, installed) : 'foreign';
              const active = file.path === selectedPath;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    className={`ua-item${active ? ' ua-item--on' : ''}`}
                    onClick={() => setSelectedPath(file.path)}
                    aria-pressed={active}
                  >
                    <span className="ua-item-main">
                      <strong>{file.name}</strong>
                      <small>{formatSize(file.size)} · {versionText(file.versionName, file.versionCode)}</small>
                    </span>
                    <span className={`ua-badge ua-badge--${itemKind}`}>{kindLabel(itemKind)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected && installed && (
          <div className={`ua-detail${isCoverInstallable(selected) ? '' : ' ua-detail--warn'}`}>
            <p>{describeApk(selected, installed)}</p>
            {!isCoverInstallable(selected) && (
              <p className="ua-warn">
                不同签名无法覆盖安装，需要先卸载旧版再装新包；卸载不会删除 Documents 里的数据。
              </p>
            )}
          </div>
        )}

        {!allowed && (
          <div className="ua-perm">
            <p>系统还没有允许 DailyNote 安装应用。</p>
            <div className="ua-perm-acts">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { void openInstallPermissionSettings().catch(e => setError(errorMessage(e))); }}
              >
                去系统设置允许
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => { void canRequestInstall().then(setAllowed).catch(() => {}); }}
              >
                重新检测
              </button>
            </div>
          </div>
        )}

        {error && <p className="ua-error" role="alert">{error}</p>}

        <footer className="ua-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>关闭</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!usable || installing}
            onClick={() => setConfirming(true)}
          >
            {installing ? '正在准备…' : '覆盖安装'}
          </button>
        </footer>
      </section>

      <ConfirmDialog
        open={confirming}
        message={selected
          ? `覆盖安装 DailyNote ${selected.versionName || `#${selected.versionCode}`}？应用会被替换，本机数据保留。`
          : ''}
        confirmText="覆盖安装"
        onCancel={() => setConfirming(false)}
        onConfirm={() => { void startInstall(); }}
      />
    </div>
  );
}
