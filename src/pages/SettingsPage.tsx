import { useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Camera } from 'lucide-react';
import { usePreferences, type ThemeMode } from '../hooks/usePreferences';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import AvatarCropper from '../components/AvatarCropper';
import './SettingsPage.css';

const AVATAR_OPTIONS = [
  '👤', '😊', '🎯', '💪', '🧠', '🌟', '🔥', '💡',
  '📚', '✏️', '🎨', '🎵', '🏃', '🌱', '☕', '🐱',
  '🐶', '🦊', '🌙', '⭐', '🚀', '💎', '🎉', '🌈',
];

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: string }[] = [
  { value: 'light', label: '浅色', icon: '☀️' },
  { value: 'dark', label: '深色', icon: '🌙' },
  { value: 'system', label: '跟随系统', icon: '💻' },
];

const DENSITY_OPTIONS = [
  { label: '紧凑', value: 48 },
  { label: '标准', value: 64 },
  { label: '宽松', value: 80 },
];

const DURATION_OPTIONS = [15, 30, 45, 60, 90, 120];

export default function SettingsPage() {
  const navigate = useNavigate();
  const { prefs, updatePrefs, resetPrefs } = usePreferences();
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [cropperFile, setCropperFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Android 返回键处理
  useRegisterBackHandler(() => {
    navigate(-1);
    return true;
  }, []);

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  return (
    <div className="app-container">
      {/* 页面标题 */}
      <div className="page-header">
        <button className="btn btn-ghost btn-icon" onClick={handleBack}>
          <ArrowLeft size={22} />
        </button>
        <h1 className="page-title">设置</h1>
        <div style={{ width: 36 }} />
      </div>

      {/* === 个人信息 === */}
      <section className="settings-section">
        <h2 className="settings-section-title">👤 个人信息</h2>
        <div className="card">
          <div className="settings-profile">
            <button
              className="settings-avatar-btn"
              onClick={() => setShowAvatarPicker(!showAvatarPicker)}
              title="更换头像"
            >
              {prefs.avatar.startsWith('data:image') ? (
                <img className="settings-avatar-img" src={prefs.avatar} alt="头像" />
              ) : (
                <>
                  <span className="settings-avatar-emoji">{prefs.avatar}</span>
                  <span className="settings-avatar-hint">点击更换</span>
                </>
              )}
            </button>
            <div className="settings-username">
              <label className="label">用户名</label>
              <input
                className="input"
                value={prefs.username}
                onChange={e => updatePrefs({ username: e.target.value })}
                placeholder="你的名字"
                maxLength={20}
              />
            </div>
          </div>

          {/* 头像选择器 */}
          {showAvatarPicker && (
            <div className="settings-avatar-picker">
              <button
                className="settings-avatar-import-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera size={16} /> 从图片导入
              </button>
              {AVATAR_OPTIONS.map(emoji => (
                <button
                  key={emoji}
                  className={`settings-avatar-option ${prefs.avatar === emoji ? 'settings-avatar-option--active' : ''}`}
                  onClick={() => {
                    updatePrefs({ avatar: emoji });
                    setShowAvatarPicker(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* === 外观 === */}
      <section className="settings-section">
        <h2 className="settings-section-title">🎨 外观</h2>
        <div className="card">
          <div className="settings-theme-row">
            {THEME_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`settings-theme-chip ${prefs.theme === opt.value ? 'settings-theme-chip--active' : ''}`}
                onClick={() => updatePrefs({ theme: opt.value })}
              >
                <span className="settings-theme-icon">{opt.icon}</span>
                <span>{opt.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* === 默认偏好 === */}
      <section className="settings-section">
        <h2 className="settings-section-title">📐 默认偏好</h2>
        <div className="card">
          {/* 睡眠时间 */}
          <div className="settings-field">
            <div className="settings-field-header">
              <span>😴 睡眠时间段</span>
              <span className="settings-field-hint">在时间网格中折叠隐藏</span>
            </div>
            <div className="settings-time-row">
              <input
                className="input input-sm"
                type="time"
                value={prefs.sleepStart}
                onChange={e => updatePrefs({ sleepStart: e.target.value })}
              />
              <span className="settings-time-sep">—</span>
              <input
                className="input input-sm"
                type="time"
                value={prefs.sleepEnd}
                onChange={e => updatePrefs({ sleepEnd: e.target.value })}
              />
            </div>
          </div>

          {/* 隐藏睡眠开关 */}
          <div className="settings-field">
            <div className="settings-toggle-row">
              <div>
                <span>隐藏睡眠时段</span>
                <p className="settings-field-hint">开启后在网格中折叠睡眠时间</p>
              </div>
              <label className="settings-switch">
                <input
                  type="checkbox"
                  checked={prefs.hideSleepHours}
                  onChange={e => updatePrefs({ hideSleepHours: e.target.checked })}
                />
                <span className="settings-switch-slider" />
              </label>
            </div>
          </div>

          {/* 默认任务时长 */}
          <div className="settings-field">
            <label className="label">⏱ 默认任务时长</label>
            <p className="settings-field-hint" style={{ marginBottom: 8 }}>点击空白处创建任务时的默认时长</p>
            <div className="settings-chip-row">
              {DURATION_OPTIONS.map(d => (
                <button
                  key={d}
                  className={`settings-chip ${prefs.defaultDuration === d ? 'settings-chip--active' : ''}`}
                  onClick={() => updatePrefs({ defaultDuration: d })}
                >
                  {d >= 60 ? `${d / 60}h` : `${d}min`}
                </button>
              ))}
            </div>
          </div>

          {/* 网格密度 */}
          <div className="settings-field">
            <label className="label">📏 网格密度</label>
            <p className="settings-field-hint" style={{ marginBottom: 8 }}>调整每小时的高度</p>
            <div className="settings-chip-row">
              {DENSITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`settings-chip ${prefs.hourHeight === opt.value ? 'settings-chip--active' : ''}`}
                  onClick={() => updatePrefs({ hourHeight: opt.value })}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* === 恢复默认 === */}
      <section className="settings-section">
        <button
          className="btn btn-ghost settings-reset-btn"
          onClick={resetPrefs}
        >
          <RotateCcw size={16} /> 恢复默认设置
        </button>
      </section>

      {/* 图片导入（隐藏 input；选中后打开裁剪弹窗） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // 允许重复选择同一文件
          if (file) {
            setCropperFile(file);
            setShowAvatarPicker(false);
          }
        }}
      />
      {cropperFile && (
        <AvatarCropper
          file={cropperFile}
          onCancel={() => setCropperFile(null)}
          onConfirm={dataURL => {
            updatePrefs({ avatar: dataURL });
            setCropperFile(null);
          }}
        />
      )}
    </div>
  );
}
