import { useState, useEffect } from 'react';
import { changeGardenPassphrase, hasGardenVault, lockGarden } from '../services/gardenSecurity';

export default function GardenSecuritySettings() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') { setCurrent(''); setNext(''); setConfirm(''); } };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); };
  }, []);
  async function change() {
    if (busy) return;
    if (next !== confirm) { setMessage('两次新口令不一致'); return; }
    setBusy(true); setMessage('');
    let changed = false;
    try {
      await changeGardenPassphrase(current, next);
      changed = true;
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) { setMessage(e instanceof Error ? e.message : '操作失败'); }
    finally {
      if (changed) { lockGarden(); window.dispatchEvent(new CustomEvent('dailynote-garden-locked', { detail: { changed: true } })); }
      setBusy(false);
    }
  }
  return <section className="settings-section" aria-labelledby="garden-security-title">
    <h2 className="settings-section-title" id="garden-security-title">秘密花园加密</h2>
    <div className="card">
      <p className="settings-security-badge">{hasGardenVault() ? '已启用 · RSA-3072 + AES-256-GCM' : '等待首次加密设置'}</p>
      <p className="settings-field-hint">{hasGardenVault() ? '内容使用 AES-GCM 加密，RSA-OAEP 保护内容密钥。私钥由密码短语加密后随备份保存，解锁密钥仅留在内存。离开或切到后台将重新上锁。' : '进入秘密花园后，使用原来的数字密码完成加密迁移。以后仍可使用原密码，也可以在这里换成更强的文字短语。'}</p>
      <p className="settings-field-hint">建议使用较长、独特的密码短语。忘记密码无法恢复；此前导出的旧备份仍需单独妥善保管。</p>
      {hasGardenVault() && <form onSubmit={e=>{e.preventDefault();void change();}}>
        <div className="settings-field"><label className="label" htmlFor="garden-current-phrase">当前口令</label><input id="garden-current-phrase" className="input" type="password" required disabled={busy} value={current} onChange={e=>setCurrent(e.target.value)} autoComplete="current-password"/></div>
        <div className="settings-field"><label className="label" htmlFor="garden-new-phrase">新口令</label><input id="garden-new-phrase" className="input" type="password" required minLength={4} disabled={busy} value={next} onChange={e=>setNext(e.target.value)} autoComplete="new-password"/></div>
        <div className="settings-field"><label className="label" htmlFor="garden-confirm-phrase">确认新口令</label><input id="garden-confirm-phrase" className="input" type="password" required minLength={4} disabled={busy} value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password"/></div>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy?'正在保护密钥…':'更改口令'}</button>
      </form>}
      {message && <p className="settings-field-hint" role="status">{message}</p>}
    </div>
  </section>;
}
export { GardenSecuritySettings };
