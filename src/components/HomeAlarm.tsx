import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { navigationBadges, sumBadges, type NavigationBadgeCounts } from '../utils/navigationBadges';
import { usePreferences } from '../hooks/usePreferences';
import { alarmFlashState, alarmPauseDeadline, DEFAULT_ALARM_PAUSE_MINUTES, type HomeAlarmPreference } from '../utils/homeAlarm';
import './HomeAlarm.css';

// Browsers clamp timeouts to a signed 32-bit integer.
const MAX_TIMEOUT_MS = 2_147_483_647;
const deadlineFormat = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' });

export default function HomeAlarm(counts: NavigationBadgeCounts) {
  const badges = navigationBadges(counts);
  const total = sumBadges(badges);
  const [open, setOpen] = useState(false);
  const { prefs: { homeAlarm: preference }, updatePrefs } = usePreferences();
  const [minutes, setMinutes] = useState(String(DEFAULT_ALARM_PAUSE_MINUTES));
  const [custom, setCustom] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [, setClock] = useState(Date.now);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const flashState = alarmFlashState(preference, Date.now());

  useEffect(() => {
    if (preference.flashDisabled || !preference.pausedUntil) return;
    let timer: number | undefined;
    function refresh() {
      window.clearTimeout(timer);
      const now = Date.now();
      setClock(now);
      const remaining = preference.pausedUntil - now;
      if (remaining > 0) timer = window.setTimeout(refresh, Math.min(remaining, MAX_TIMEOUT_MS));
    }
    refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [preference]);

  function close(restoreFocus = false) {
    setOpen(false);
    setCustom(false);
    setInvalid(false);
    if (restoreFocus) trigger.current?.focus();
  }

  useEffect(() => {
    if (!total) close();
  }, [total]);

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !container.current?.contains(event.target)) close();
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  useRegisterBackHandler(() => {
    if (!open) return false;
    close(true);
    return true;
  }, [open], 'overlay');

  function updatePreference(next: HomeAlarmPreference) {
    void updatePrefs({ homeAlarm: next });
    setCustom(false);
    setInvalid(false);
  }

  function pause(value: string) {
    const pausedUntil = alarmPauseDeadline(value, Date.now());
    if (pausedUntil === undefined) {
      setInvalid(true);
      return;
    }
    updatePreference({ flashDisabled: false, pausedUntil });
  }

  function submitCustomPause(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    pause(minutes);
  }

  if (!total) return null;
  return (
    <div className="home-alarm" ref={container} onKeyDown={event => {
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    }}>
      <button
        ref={trigger}
        type="button"
        className={`home-alarm-trigger${flashState === 'active' ? ' home-alarm-trigger--flashing' : ''}`}
        aria-label={`警报，${total} 项提醒`}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => open ? close() : setOpen(true)}
      >
        <span className="home-alarm-mark" aria-hidden="true">!</span>
        <span className="home-alarm-count" aria-hidden="true">{total > 99 ? '99+' : total}</span>
      </button>
      {open && (
        <section className="home-alarm-panel" id={panelId} aria-labelledby={`${panelId}-title`} data-app-swipe="off">
          <header className="home-alarm-header">
            <h2 id={`${panelId}-title`}>警报 <small>{total} 项提醒</small></h2>
            <button type="button" className="home-alarm-close" aria-label="关闭警报" onClick={() => close(true)}><X size={18} aria-hidden="true" /></button>
          </header>
          <ul className="home-alarm-links">
            {badges.map(({ to, label, count }) => (
              <li key={to}>
                <Link to={to} onClick={() => close()}>
                  {label}
                  <span aria-label={`${count} 项提醒`}>{count}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
          <div className="home-alarm-settings">
            {flashState === 'paused' && <p role="status">闪烁已暂停至 {deadlineFormat.format(preference.pausedUntil)}</p>}
            {flashState === 'disabled' && <p role="status">闪烁已关闭</p>}
            <div className="home-alarm-actions">
              {flashState === 'active' && <button type="button" onClick={() => pause(String(DEFAULT_ALARM_PAUSE_MINUTES))}>暂停 1 小时</button>}
              {flashState !== 'disabled' && (
                <button type="button" aria-expanded={custom} aria-controls={custom ? `${panelId}-custom` : undefined} onClick={() => {
                  setCustom(!custom);
                  setInvalid(false);
                }}>自定义暂停</button>
              )}
              {flashState !== 'active' && <button type="button" onClick={() => updatePreference({ flashDisabled: false, pausedUntil: 0 })}>恢复闪烁</button>}
              {flashState !== 'disabled' && <button type="button" onClick={() => updatePreference({ flashDisabled: true, pausedUntil: 0 })}>永久关闭闪烁</button>}
            </div>
            {custom && flashState !== 'disabled' && (
              <form className="home-alarm-form" id={`${panelId}-custom`} onSubmit={submitCustomPause} noValidate>
                <label htmlFor={`${panelId}-minutes`}>暂停分钟数</label>
                <input id={`${panelId}-minutes`} type="number" inputMode="numeric" min={1} step={1} value={minutes}
                  aria-invalid={invalid || undefined} aria-describedby={invalid ? `${panelId}-error` : undefined}
                  onChange={event => { setMinutes(event.target.value); setInvalid(false); }} />
                <button type="submit">确认暂停</button>
                {invalid && <p role="alert" id={`${panelId}-error`}>请输入有效的正整数分钟数</p>}
              </form>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
