import { useState } from 'react';
import { FolderOpen, HardDrive, ArrowRight, Shield, FolderSearch } from 'lucide-react';
import { isCapacitor, normalizePath, listStorageSubdirs } from '../services/storage';
import './SetupPage.css';

interface Props {
  onComplete: (storagePath: string) => void;
}

export default function SetupPage({ onComplete }: Props) {
  const [customPath, setCustomPath] = useState('');
  const [pathError, setPathError] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [subdirs, setSubdirs] = useState<string[]>([]);
  const isNative = isCapacitor();
  const defaultPath = 'Documents/DailyNote';

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
    setCustomPath(name);
    setPathError('');
    setBrowsing(false);
  };

  const handleUseDefault = () => {
    onComplete(defaultPath);
  };

  const handleUseCustom = () => {
    const input = customPath.trim();
    if (!input) {
      onComplete(defaultPath);
      return;
    }
    try {
      const path = normalizePath(input);
      setPathError('');
      onComplete(path);
    } catch (e) {
      setPathError(e instanceof Error ? e.message : '路径无效');
    }
  };

  return (
    <div className="setup-page">
      <div className="setup-card">
        <div className="setup-icon">
          <Shield size={48} strokeWidth={1.5} />
        </div>
        <h1 className="setup-title">欢迎使用 DailyNote</h1>
        <p className="setup-desc">
          Android 数据保存在设备公共存储。网页版数据保存在当前浏览器，清除站点数据后无法恢复，请定期导出备份。
        </p>

        {/* 默认路径 */}
        <div className="setup-option" onClick={handleUseDefault}>
          <div className="setup-option-icon">
            <HardDrive size={24} />
          </div>
          <div className="setup-option-body">
            <strong>使用默认位置</strong>
            <span className="setup-option-path">{defaultPath}/</span>
            <span className="setup-option-hint">
              {isNative ? '系统 Documents 文件夹，卸载后仍保留' : '保存在当前浏览器；清除站点数据后无法恢复'}
            </span>
          </div>
          <ArrowRight size={20} className="setup-option-arrow" />
        </div>

        {/* 自定义路径 */}
        <div className="setup-option setup-option--custom">
          <div className="setup-option-icon">
            <FolderOpen size={24} />
          </div>
          <div className="setup-option-body">
            <strong>自定义子目录</strong>
            <span className="setup-option-hint">
              {isNative ? '可指定公共 Documents 子目录，重装后选同一目录恢复' : '网页版保存在浏览器；更换浏览器或清除站点数据后无法恢复'}
            </span>
            <input
              className="input input-sm"
              value={customPath}
              onChange={e => { setCustomPath(e.target.value); setPathError(''); }}
              onClick={e => e.stopPropagation()}
              placeholder="子文件夹名称"
              style={{ marginTop: 8 }}
              onKeyDown={e => {
                if (e.key === 'Enter') handleUseCustom();
              }}
            />
            {pathError && (
              <span style={{ display: 'block', marginTop: 6, fontSize: '0.8rem', color: 'var(--color-danger)' }}>
                {pathError}
              </span>
            )}
            <button className="btn btn-outline btn-sm" onClick={handleBrowse} style={{ marginTop: 8 }}>
              <FolderSearch size={14} /> {browsing ? '收起目录' : '浏览已有目录'}
            </button>
            {browsing && (
              <div className="card" style={{ marginTop: 8, padding: 10 }}>
                {subdirs.length === 0 ? (
                  <p className="setup-option-hint" style={{ margin: 0, fontSize: '0.8rem' }}>
                    网页版数据在浏览器内置存储，无真实文件夹；手机版列出 Documents/ 下已有目录。
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ justifyContent: 'flex-start' }}
                      onClick={() => pickDir('DailyNote')}
                    >
                      <FolderOpen size={14} /> Documents/DailyNote/
                    </button>
                    {subdirs.map(name => (
                      <button
                        key={name}
                        className="btn btn-ghost btn-sm"
                        style={{ justifyContent: 'flex-start' }}
                        onClick={() => pickDir(name)}
                      >
                        <FolderOpen size={14} /> {name}/
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <button className="btn btn-primary setup-btn" onClick={handleUseCustom}>
          确认并开始使用
        </button>
        <button className="btn btn-ghost setup-btn" onClick={handleUseDefault} style={{ marginTop: 0 }}>
          跳过，使用默认位置
        </button>

        <p className="setup-footer">
          以后可在"备份与恢复"页面更改存储位置
        </p>
      </div>
    </div>
  );
}
