import { useState } from 'react';
import { Download, Upload, Database, Shield, AlertCircle, FolderOpen, MapPin, FileDown, FolderSearch } from 'lucide-react';
import {
  saveNow,
  importFromJSON,
  saveBackupFile,
  getDisplayPath,
  normalizePath,
  switchStoragePath,
  getLastPersistError,
  listStorageSubdirs,
} from '../services/storage';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import './BackupRestore.css';

export default function BackupRestorePage() {
  const [status, setStatus] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<'success' | 'error'>('success');
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [pathError, setPathError] = useState('');
  const [changing, setChanging] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [subdirs, setSubdirs] = useState<string[]>([]);
  const [persistError, setPersistError] = useState(getLastPersistError());

  useRegisterBackHandler(() => false, []);

  const showStatus = (msg: string, type: 'success' | 'error' = 'success') => {
    setStatus(msg);
    setStatusType(type);
    setTimeout(() => setStatus(null), 4000);
  };

  const handleBrowse = async () => {
    if (browsing) { setBrowsing(false); return; }
    setBrowsing(true);
    try {
      setSubdirs(await listStorageSubdirs());
    } catch {
      setSubdirs([]);
    }
  };

  const pickDir = (name: string) => {
    setNewPath(name);
    setPathError('');
    setBrowsing(false);
  };

  const handleChangePath = async () => {
    let path: string;
    try {
      path = normalizePath(newPath);
    } catch (e) {
      setPathError(e instanceof Error ? e.message : '路径无效');
      return;
    }
    setPathError('');
    setChanging(true);
    try {
      const result = await switchStoragePath(path);
      setNewPath('');
      setPersistError(getLastPersistError());
      if (result.recovered) {
        showStatus(`✅ 已切换到 ${path}，恢复 ${result.count} 条记录（原位置数据保留）`);
      } else {
        showStatus(`✅ 已切换到 ${path}，当前数据已保存到新位置`);
      }
    } catch (e) {
      showStatus(`切换失败: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setChanging(false);
    }
  };

  const handleSave = async () => {
    try {
      const ok = await saveNow();
      if (ok) {
        showStatus(`✅ 数据已保存到 ${getDisplayPath()}`);
      } else {
        showStatus('保存失败，请重试', 'error');
      }
    } catch (e) {
      showStatus(`保存失败: ${e}`, 'error');
    }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const path = await saveBackupFile();
      showStatus(`✅ 备份已导出：${path}`);
    } catch (e) {
      showStatus(`导出失败: ${e instanceof Error ? e.message : e}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async (e: Event) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setImporting(true);
      try {
        const text = await file.text();
        const count = await importFromJSON(text);
        showStatus(`✅ 成功导入 ${count} 条记录，已写入存储文件`);
      } catch (e) {
        showStatus(`导入失败: ${e instanceof Error ? e.message : '文件格式错误'}`, 'error');
      } finally {
        setImporting(false);
      }
    };
    input.click();
  };

  return (
    <div className="app-container">
      <div className="page-header">
        <h1 className="page-title">备份与恢复</h1>
      </div>

      {/* 存储位置 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="backup-info">
          <FolderOpen size={20} color="var(--color-primary)" />
          <div>
            <strong>当前存储位置</strong>
            <p className="backup-desc" style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {getDisplayPath()}
            </p>
            <p className="backup-desc">
              数据按「日期文件夹 + 类型文件」分文件保存。卸载重装后选择相同路径即可恢复。
            </p>
          </div>
        </div>
      </div>

      {persistError && (
        <div className="backup-status backup-status--error" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} />
          <span>上次写入失败: {persistError}</span>
        </div>
      )}

      {/* 更改存储位置 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="backup-info">
          <MapPin size={20} color="var(--color-primary)" />
          <div>
            <strong>更改存储位置</strong>
            <p className="backup-desc">
              输入子目录名或完整路径。若该位置已有数据将恢复并继续编辑，原位置数据保留。
            </p>
            <input
              className="input input-sm"
              value={newPath}
              onChange={e => { setNewPath(e.target.value); setPathError(''); }}
              placeholder="存储目录（可选）"
              style={{ marginTop: 8 }}
              onKeyDown={e => { if (e.key === 'Enter') handleChangePath(); }}
            />
            {pathError && (
              <span style={{ display: 'block', marginTop: 6, fontSize: '0.8rem', color: 'var(--color-danger)' }}>
                {pathError}
              </span>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              <button className="btn btn-outline" onClick={handleBrowse} style={{ flex: 1 }}>
                <FolderSearch size={16} /> {browsing ? '收起目录' : '浏览已有目录'}
              </button>
              <button className="btn btn-primary" onClick={handleChangePath} disabled={changing} style={{ flex: 1 }}>
                {changing ? '切换中...' : '切换到此位置'}
              </button>
            </div>

            {browsing && (
              <div className="card" style={{ marginTop: 8, padding: 10 }}>
                {subdirs.length === 0 ? (
                  <p className="backup-desc" style={{ margin: 0, fontSize: '0.8rem' }}>
                    网页版数据在浏览器内置存储；手机版列出 Documents/ 下已有文件夹，点选切换，或输入名称新建。
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button
                      className="btn btn-ghost"
                      style={{ justifyContent: 'flex-start', fontSize: '0.85rem' }}
                      onClick={() => pickDir('DailyNote')}
                    >
                      <FolderOpen size={16} /> Documents/DailyNote/（默认）
                    </button>
                    {subdirs.map(name => (
                      <button
                        key={name}
                        className="btn btn-ghost"
                        style={{ justifyContent: 'flex-start', fontSize: '0.85rem' }}
                        onClick={() => pickDir(name)}
                      >
                        <FolderOpen size={16} /> {name}/
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 操作 */}
      <button className="btn btn-primary backup-btn" onClick={handleSave}>
        <Download size={18} /> 立即保存到文件
      </button>

      <button
        className="btn btn-outline backup-btn"
        onClick={handleExport}
        disabled={exporting}
      >
        <FileDown size={18} />
        {exporting ? '导出中...' : '导出备份文件'}
      </button>

      <button
        className="btn btn-outline backup-btn"
        onClick={handleImport}
        disabled={importing}
      >
        <Upload size={18} />
        {importing ? '导入中...' : '从文件导入数据'}
      </button>

      {status && (
        <div className={`backup-status ${statusType === 'error' ? 'backup-status--error' : ''}`}>
          {statusType === 'error' ? <AlertCircle size={16} /> : <Database size={16} />}
          <span>{status}</span>
        </div>
      )}

      <div className="card" style={{ marginTop: 24 }}>
        <h4 style={{ marginBottom: 8, fontSize: 'var(--font-base)', color: 'var(--color-text-secondary)' }}>
          工作原理
        </h4>
        <ul className="backup-guide">
          <li>数据存放在设备公共 Documents 目录，不在应用沙箱内</li>
          <li>按日期与类型分文件存储：days/&lt;日期&gt;/{'{plan,reflections,harvests,tasks}.json'}，加上 goals.json、routines.json、templates.json、courses.json、semester.json、ddls.json、trash.json</li>
          <li>每次修改只写被改到的文件，立即保存（无延迟）</li>
          <li>启动时从文件读取数据，确保卸载重装不丢失</li>
          <li>重装后指定相同目录即可恢复全部数据（含回收站）</li>
          <li>换手机时：旧手机导出 → 新手机导入</li>
        </ul>
      </div>
    </div>
  );
}
