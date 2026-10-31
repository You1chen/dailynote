import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { hasGardenPassword, setGardenPassword, verifyGardenPassword, validGardenPin } from '../utils/gardenLock';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import './GardenGate.css';

export default function GardenGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [setup] = useState(() => !hasGardenPassword());
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useRegisterBackHandler(() => { if (!unlocked) { navigate('/goals', { replace: true }); return true; } return false; }, [unlocked, navigate]);
  async function enter() {
    if (busy) return;
    if (!validGardenPin(pin)) { setError('请输入 4–12 位数字密码'); return; }
    if (setup && pin !== repeat) { setError('两次密码不一致，再确认一下'); return; }
    setBusy(true); setError('');
    try {
      if (setup) await setGardenPassword(pin);
      else if (!await verifyGardenPassword(pin)) { setError('约定还没有对上，再想一想'); return; }
      setPin(''); setRepeat(''); setUnlocked(true);
    } catch { setError('暂时无法验证密码，请重试'); }
    finally { setBusy(false); }
  }
  if (unlocked) return <>{children}</>;
  return <div className="garden-gate" role="dialog" aria-modal="true" aria-labelledby="garden-gate-title">
    <form className="garden-gate-card" onSubmit={e => { e.preventDefault(); void enter(); }}>
      <span className="garden-gate-flower" aria-hidden="true">✿</span>
      <p className="garden-gate-kicker">秘密花园</p>
      <h1 id="garden-gate-title">{setup ? '为花园留一个约定' : '还记得我们的约定是？'}</h1>
      <p>{setup ? '设置 4–12 位数字密码，下次凭这个约定进来。请记住密码。' : '输入数字密码，推开花园的门。'}</p>
      <label htmlFor="garden-pin">{setup ? '设置密码' : '数字密码'}</label>
      <input id="garden-pin" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete={setup ? 'new-password' : 'current-password'} maxLength={12} autoFocus value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setError(''); }} />
      {setup && <><label htmlFor="garden-repeat">确认密码</label><input id="garden-repeat" type="password" inputMode="numeric" pattern="[0-9]*" autoComplete="new-password" maxLength={12} value={repeat} onChange={e => setRepeat(e.target.value.replace(/\D/g, ''))} /></>}
      {error && <p className="garden-gate-error" role="alert">{error}</p>}
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '请稍候…' : setup ? '记下约定，进入花园' : '进入秘密花园'}</button>
      <button className="btn btn-outline" type="button" onClick={() => navigate('/goals', { replace: true })}>返回目标</button>
    </form>
  </div>;
}
