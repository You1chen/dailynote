import { useRef, useState } from 'react';
import { Download, FolderOpen, HardDriveDownload, Monitor, Moon, RotateCcw, Sun, Upload } from 'lucide-react';
import Sheet from './Sheet';
import { usePreferences, type ThemeMode } from '../../hooks/usePreferences';
import {
  getDisplayPath,
  importFromJSON,
  isCapacitor,
  saveBackupFile,
  saveNow,
} from '../../services/storage';
import { rescanFromDisk } from '../../services/store';
import { useUi } from '../state/ui';

interface Props {
  open: boolean;
  onClose: () => void;
}

const THEMES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
  { value: 'system', label: '自动', icon: Monitor },
];

const DURATIONS = [30, 45, 60, 90];

export default function SettingsSheet({ open, onClose }: Props) {
  const { prefs, updatePrefs } = usePreferences();
  const ui = useUi();
  const [status, setStatus] = useState('');
  const [statusError, setStatusError] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const native = isCapacitor();
  const path = getDisplayPath();

  function show(message: string, error = false) {
    setStatus(message);
    setStatusError(error);
  }

  async function save() {
    setBusy(true);
    try {
      const ok = await saveNow();
      show(ok ? '已保存到本机' : '保存失败，请重试', !ok);
    } catch (cause) {
      show(cause instanceof Error ? cause.message : '保存失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function exportBackup() {
    setBusy(true);
    try {
      const result = await saveBackupFile();
      show(`备份已导出：${result}`);
    } catch (cause) {
      show(cause instanceof Error ? cause.message : '导出失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function importBackup(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const text = await file.text();
      const count = await importFromJSON(text);
      show(`已导入 ${count} 条记录，正在重新载入…`);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (cause) {
      show(cause instanceof Error ? cause.message : '导入失败', true);
      setBusy(false);
    }
  }

  async function rescan() {
    setBusy(true);
    try {
      const count = await rescanFromDisk();
      if (count === -2) show('存储权限被拒绝，无法读取', true);
      else if (count < 0) show('目录里没有发现数据');
      else show(`已按磁盘重新读取，${count} 条记录`);
    } catch {
      show('重新扫描失败', true);
    } finally {
      setBusy(false);
    }
  }

  async function openFolder() {
    if (native) {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        await Filesystem.getUri({ directory: Directory.Documents, path: 'DailyNote' });
        show(`数据目录：${path}`);
      } catch {
        show(`数据目录：${path}`);
      }
      return;
    }
    show(`网页版数据在浏览器 IndexedDB 中，不生成文件夹`);
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="设置"
      subtitle="外观、日程偏好与本机数据"
      footer={(
        <>
          <span className="v-tiny v-grow">{status || '所有修改会立即生效'}</span>
          <button type="button" className="v-btn v-btn--primary" onClick={onClose}>完成</button>
        </>
      )}
    >
      <div className="v-settings-group">
        <h3>外观</h3>
        <div className="v-settings-row">
          <div className="v-settings-row-label">
            <strong>主题</strong>
            <span>跟随系统时会随设备的深浅色切换</span>
          </div>
        </div>
        <div className="v-seg v-seg--block" style={{ margin: '0 0 12px' }}>
          {THEMES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              aria-pressed={prefs.theme === value}
              onClick={() => updatePrefs({ theme: value })}
            >
              <Icon size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="v-settings-group">
        <h3>日程</h3>
        <div className="v-settings-row">
          <div className="v-settings-row-label">
            <strong>新建日程的默认时长</strong>
            <span>框选时会以实际拖动的时间为准</span>
          </div>
        </div>
        <div className="v-seg v-seg--block" style={{ margin: '0 0 4px' }}>
          {DURATIONS.map(minutes => (
            <button
              key={minutes}
              type="button"
              aria-pressed={prefs.defaultDuration === minutes}
              onClick={() => updatePrefs({ defaultDuration: minutes })}
            >
              {minutes} 分
            </button>
          ))}
        </div>
      </div>

      <div className="v-settings-group">
        <h3>数据与备份</h3>
        <div className="v-settings-row">
          <div className="v-settings-row-label">
            <strong>保存位置</strong>
            <span>{native ? path : '浏览器 IndexedDB（网页版）'}</span>
          </div>
          <button type="button" className="v-iconbtn v-iconbtn--filled" aria-label="查看位置" onClick={() => void openFolder()}>
            <FolderOpen size={17} />
          </button>
        </div>
        <div className="v-settings-row">
          <div className="v-settings-row-label">
            <strong>立即保存</strong>
            <span>写入当前存储位置</span>
          </div>
          <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={() => void save()} disabled={busy}>
            <HardDriveDownload size={14} /> 保存
          </button>
        </div>
        <div className="v-settings-row">
          <div className="v-settings-row-label">
            <strong>导出备份</strong>
            <span>生成一个包含全部数据的 JSON 文件</span>
          </div>
          <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={() => void exportBackup()} disabled={busy}>
            <Download size={14} /> 导出
          </button>
        </div>
        <div className="v-settings-row">
          <div className="v-settings-row-label">
            <strong>导入备份</strong>
            <span>合并已有记录，导入后自动重新载入</span>
          </div>
          <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            <Upload size={14} /> 导入
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={event => {
              void importBackup(event.currentTarget.files?.[0]);
              event.currentTarget.value = '';
            }}
          />
        </div>
        <div className="v-settings-row">
          <div className="v-settings-row-label">
            <strong>重新扫描</strong>
            <span>外部改过数据文件后，按磁盘重新读一遍</span>
          </div>
          <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={() => void rescan()} disabled={busy}>
            <RotateCcw size={14} /> 扫描
          </button>
        </div>
        {status && (
          <p style={{ margin: '8px 2px 0', fontSize: 12, lineHeight: 1.5, color: statusError ? 'var(--v-red)' : 'var(--v-green)' }} role="status">
            {status}
          </p>
        )}
      </div>

      <div className="v-settings-group">
        <h3>关于</h3>
        <div className="v-settings-row">
          <div className="v-settings-row-label">
            <strong>使用说明</strong>
            <span>两页应用的全部操作方式</span>
          </div>
          <button type="button" className="v-btn v-btn--ghost v-btn--sm" onClick={() => { onClose(); ui.openHelp(); }}>
            打开
          </button>
        </div>
        <div className="v-about">
          <strong>DailyNote</strong>
          本地优先 · 无账号 · 无云同步<br />
          Android 与网页共用同一份数据格式
        </div>
      </div>
    </Sheet>
  );
}
