import { useState, useEffect, useRef, type ReactNode } from 'react';
import { getLockedWishCount, lockGarden } from '../services/gardenSecurity';
import { useNavigate } from 'react-router-dom';
import { hasGardenPassword, verifyGardenPassword } from '../utils/gardenLock';
import { hasGardenVault, hasLegacyGardenContent, setupGarden, unlockGarden, migrateLegacyWishes } from '../services/gardenSecurity';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import './GardenGate.css';

export default function GardenGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate(); const [unlocked, setUnlocked] = useState(false); const [passphrase, setPassphrase] = useState(''); const [repeat, setRepeat] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => { const onHide = () => { if (document.visibilityState === 'hidden') { generation.current++; lockGarden(); setUnlocked(false); setPassphrase(''); setRepeat(''); } }; document.addEventListener('visibilitychange', onHide); return () => { generation.current++; document.removeEventListener('visibilitychange', onHide); lockGarden(); }; }, []);
  useRegisterBackHandler(() => { if (!unlocked) { navigate('/goals', { replace: true }); return true; } return false; }, [unlocked, navigate]);
  async function enter() {
    if (busy) return; const attempt = generation.current; setBusy(true); setError('');
    try {
      if (hasGardenVault()) { await unlockGarden(passphrase); if (hasLegacyGardenContent()) await migrateLegacyWishes(); }
      else {
        if (hasGardenPassword() && !(await verifyGardenPassword(passphrase))) throw new Error('口令不正确');
        if (passphrase.length < 4) throw new Error('口令至少需要 4 个字符');
        if (passphrase !== repeat) throw new Error('两次口令不一致');
        await setupGarden(passphrase); await migrateLegacyWishes();
        localStorage.removeItem('dailynote_garden_lock');
      }
      if (attempt !== generation.current || document.visibilityState === 'hidden') { lockGarden(); return; }
      setPassphrase(''); setRepeat(''); setUnlocked(true);
    } catch (e) { setError(e instanceof Error ? e.message : '暂时无法解锁，请重试'); } finally { setBusy(false); }
  }
  if (unlocked) return <>{getLockedWishCount() > 0 && <p role="status">另有 {getLockedWishCount()} 条愿望需要导入备份原来的口令。<button className="btn btn-outline" onClick={() => { lockGarden(); setUnlocked(false); }}>换一个口令解锁</button></p>}{children}</>;
  const setup = !hasGardenVault();
  return <div className="garden-gate" role="dialog" aria-modal="true" aria-labelledby="garden-gate-title"><form className="garden-gate-card" onSubmit={e => { e.preventDefault(); void enter(); }}><span className="garden-gate-flower" aria-hidden="true">✿</span><p className="garden-gate-kicker">秘密花园</p><h1 id="garden-gate-title">{setup ? '为花园留一个约定' : '还记得我们的约定是？'}</h1><p>{setup ? hasGardenPassword() ? '输入原来的数字密码，完成加密迁移。之后可在设置中改为更强的文字口令。' : '设置至少 4 个字符的口令。建议使用较长的文字口令。' : '输入口令，解开花园内容。'}</p><label htmlFor="garden-passphrase">{setup ? '口令' : '花园口令'}</label><input id="garden-passphrase" type="password" autoComplete={setup ? 'new-password' : 'current-password'} autoFocus value={passphrase} onChange={e => { setPassphrase(e.target.value); setError(''); }} />{setup && <><label htmlFor="garden-repeat">确认口令</label><input id="garden-repeat" type="password" autoComplete="new-password" value={repeat} onChange={e => setRepeat(e.target.value)} /></>}{error && <p className="garden-gate-error" role="alert">{error}</p>}<button className="btn btn-primary" type="submit" disabled={busy}>{busy ? '请稍候…' : setup ? '启用加密并进入' : '进入秘密花园'}</button><button className="btn btn-outline" type="button" onClick={() => navigate('/goals', { replace: true })}>返回目标</button></form></div>;
}
