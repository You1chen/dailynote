import { useState, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Camera, Palette, CalendarClock, GraduationCap, Database, Download, RotateCcw, ListTodo } from 'lucide-react';
import { Capacitor } from '@capacitor/core';
import { usePreferences, type ThemeMode } from '../hooks/usePreferences';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { useRouteBack } from '../hooks/useRouteBack';
import AvatarCropper from '../components/AvatarCropper';
import CourseTimeSettings from '../components/CourseTimeSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import './SettingsPage.css';

const AVATARS = ['👤','😊','🎯','💪','🧠','🌟','🔥','💡','📚','✏️','🎨','🎵','🏃','🌱','☕','🐱','🐶','🦊','🌙','⭐','🚀','💎','🎉','🌈'];
const THEMES: {value: ThemeMode; label: string; icon: string}[] = [{value:'light',label:'浅色',icon:'☀️'},{value:'dark',label:'深色',icon:'🌙'},{value:'system',label:'跟随系统',icon:'◐'}];
const SECTIONS = [
  {id:'appearance',title:'个人与外观',description:'头像、名字与明暗主题',icon:Palette},
  {id:'schedule',title:'日程与时间',description:'睡眠折叠、默认时长与网格显示',icon:CalendarClock},
  {id:'courses',title:'课程与时间组合',description:'常用上下课时间、学期与特殊日期',icon:GraduationCap},
  {id:'todo',title:'TODO',description:'计时与移入遗留的确认',icon:ListTodo},
  {id:'data',title:'数据与备份',description:'导入导出、存储目录与偏好恢复',icon:Database},
];
export default function SettingsPage() {
  const navigate = useNavigate();
  const backFromSettings = useRouteBack();
  const [params, setParams] = useSearchParams();
  const section = SECTIONS.find(s => s.id === params.get('section'));
  const { prefs, updatePrefs, resetPrefs } = usePreferences();
  const [avatarPicker, setAvatarPicker] = useState(false);
  const [cropperFile, setCropperFile] = useState<File | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetNotice, setResetNotice] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const back = () => { if (cropperFile) setCropperFile(null); else if (confirmReset) setConfirmReset(false); else if (section) setParams({}, { replace: true }); else backFromSettings(); };
  useRegisterBackHandler(() => { back(); return true; }, [section?.id, cropperFile, confirmReset, backFromSettings]);
  const toggle = (label: string, hint: string, checked: boolean, onChange: (value: boolean) => void) => <div className="settings-field settings-toggle-row"><div><span>{label}</span><p className="settings-field-hint">{hint}</p></div><label className="settings-switch"><input aria-label={label} type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span className="settings-switch-slider"/></label></div>;
  return <div className="app-container settings-page">
    <header className="page-header"><button className="btn btn-ghost btn-icon" aria-label={section ? '返回设置首页' : '返回'} onClick={back}><ArrowLeft size={22}/></button><h1 className="page-title">{section?.title ?? '设置'}</h1><span className="settings-autosave">自动保存</span></header>
    {!section && <>
      <section className="settings-welcome"><span className="settings-eyebrow">YOUR EVERYDAY SPACE</span><h2>让日常，更合你的习惯。</h2><p>从时间的安排，到留给自己的空间。</p><div className="settings-overview"><span>{THEMES.find(t=>t.value===prefs.theme)?.label}</span><span>默认 {prefs.defaultDuration} 分钟</span><span>{prefs.courseTimeCombinations.length} 组课程时间</span></div></section>
      <nav className="settings-menu" aria-label="设置分类">{SECTIONS.map((s,index)=><button key={s.id} className="settings-menu-item" onClick={()=>setParams({section:s.id}, { replace: true })}><span className={`settings-menu-icon settings-menu-icon--${index}`}><s.icon size={22}/></span><span className="settings-menu-copy"><strong>{s.title}</strong><small>{s.description}</small></span><ChevronRight size={18}/></button>)}</nav>
      <p className="settings-home-note">调整立即生效。数据导入与偏好恢复会另行确认。</p>
    </>}
    {section?.id==='appearance' && <>
      <p className="settings-intro">给这个每天见面的地方，留一点自己的样子。</p>
      <section className="settings-section"><h2 className="settings-section-title">个人名片</h2><div className="card"><div className="settings-profile"><button className="settings-avatar-btn" aria-label="更换头像" onClick={()=>setAvatarPicker(!avatarPicker)}>{prefs.avatar.startsWith('data:image') ? <img className="settings-avatar-img" src={prefs.avatar} alt="头像"/> : <span className="settings-avatar-emoji">{prefs.avatar}</span>}</button><div className="settings-username"><label className="label" htmlFor="settings-name">怎么称呼你</label><input id="settings-name" className="input" value={prefs.username} maxLength={20} placeholder="你的名字" onChange={e=>updatePrefs({username:e.target.value})}/></div></div>{avatarPicker && <div className="settings-avatar-picker"><button className="settings-avatar-import-btn" onClick={()=>fileInput.current?.click()}><Camera size={16}/>从图片导入</button>{AVATARS.map(emoji=><button key={emoji} className={`settings-avatar-option ${prefs.avatar===emoji?'settings-avatar-option--active':''}`} onClick={()=>{updatePrefs({avatar:emoji});setAvatarPicker(false);}}>{emoji}</button>)}</div>}</div></section>
      <section className="settings-section"><h2 className="settings-section-title">明暗主题</h2><div className="card settings-theme-row">{THEMES.map(t=><button key={t.value} className={`settings-theme-chip ${prefs.theme===t.value?'settings-theme-chip--active':''}`} aria-label={t.label} aria-pressed={prefs.theme===t.value} onClick={()=>updatePrefs({theme:t.value})}><span className="settings-theme-icon">{t.icon}</span>{t.label}</button>)}</div></section>
    </>}
    {section?.id==='schedule' && <>
      <p className="settings-intro">这些偏好会用于日计划与周视图，让时间轴贴近你的作息。</p>
      <section className="settings-section"><h2 className="settings-section-title">作息与可见时间</h2><div className="card"><div className="settings-field"><label className="label">睡眠时间段</label><div className="settings-time-row"><input aria-label="睡眠开始时间" className="input" type="time" value={prefs.sleepStart} onChange={e=>{if(e.target.value)updatePrefs({sleepStart:e.target.value});}}/><span>→</span><input aria-label="睡眠结束时间" className="input" type="time" value={prefs.sleepEnd} onChange={e=>{if(e.target.value)updatePrefs({sleepEnd:e.target.value});}}/></div></div>{toggle('折叠睡眠时段','把睡眠时间收成一条细带，为白天腾出空间。',prefs.hideSleepHours,v=>updatePrefs({hideSleepHours:v}))}{toggle('只看未来','日计划中折叠今天已经过去的小时，其他日期正常显示。',prefs.futureOnly,v=>updatePrefs({futureOnly:v}))}</div></section>
      <section className="settings-section"><h2 className="settings-section-title">创建与浏览</h2><div className="card"><div className="settings-field"><label className="label">新计划默认时长</label><p className="settings-field-hint">点击时间轴空白处时采用，创建后仍可调整。</p><div className="settings-chip-row">{[15,30,45,60,90,120].map(n=><button key={n} className={`settings-chip ${prefs.defaultDuration===n?'settings-chip--active':''}`} aria-pressed={prefs.defaultDuration===n} onClick={()=>updatePrefs({defaultDuration:n})}>{n} 分钟</button>)}</div></div><div className="settings-field"><label className="label">时间轴疏密</label><p className="settings-field-hint">控制每小时占用的高度。</p><div className="settings-chip-row">{[{n:48,label:'紧凑'},{n:64,label:'标准'},{n:80,label:'宽松'}].map(d=><button key={d.n} className={`settings-chip ${prefs.hourHeight===d.n?'settings-chip--active':''}`} aria-pressed={prefs.hourHeight===d.n} onClick={()=>updatePrefs({hourHeight:d.n})}>{d.label}</button>)}</div></div></div></section>
    </>}
    {section?.id==='courses' && <>
      <p className="settings-intro">常用时间在这里统一维护；具体课程与校历在课程表管理。</p>
      <CourseTimeSettings combinations={prefs.courseTimeCombinations} onChange={courseTimeCombinations=>updatePrefs({courseTimeCombinations})}/>
      <button className="settings-link-card" onClick={()=>navigate('/courses')}><GraduationCap size={20}/><span><strong>学期与课程</strong><small>开学日期、放假补课、课程内容</small></span><ChevronRight size={18}/></button>
    </>}
    {section?.id === 'todo' && <section className="settings-section">
      <h2 className="settings-section-title">操作确认</h2>
      <div className="card">
        {toggle('开始计时前确认', '关闭后，单击任务直接开始计时。', prefs.todoConfirmations.startTimer,
          startTimer => updatePrefs({ todoConfirmations: { ...prefs.todoConfirmations, startTimer } }))}
        {toggle('结束计时前确认', '关闭后，单击正在计时的任务直接结束计时。', prefs.todoConfirmations.stopTimer,
          stopTimer => updatePrefs({ todoConfirmations: { ...prefs.todoConfirmations, stopTimer } }))}
        {toggle('移入遗留前确认', '关闭后，拖到清单下方并松手即可移入遗留。', prefs.todoConfirmations.moveToBacklog,
          moveToBacklog => updatePrefs({ todoConfirmations: { ...prefs.todoConfirmations, moveToBacklog } }))}
      </div>
    </section>}
    {section?.id==='data' && <>
      <p className="settings-intro">数据保存在你选择的设备目录。定期导出，给日常留一份副本。</p>
      <button className="settings-link-card" onClick={()=>navigate('/backup')}><Database size={20}/><span><strong>备份、导入与存储位置</strong><small>导出副本、恢复数据、查看或更换目录</small></span><ChevronRight size={18}/></button>
      {Capacitor.getPlatform() === 'android' && <button className="settings-link-card" onClick={()=>window.dispatchEvent(new Event('dailynote-open-update'))}><Download size={20}/><span><strong>安装更新包</strong><small>扫描存储目录中的 APK，签名一致时覆盖安装</small></span><ChevronRight size={18}/></button>}
      <section className="settings-section settings-reset-area"><h2 className="settings-section-title">偏好恢复</h2><div className="card"><p className="settings-field-hint">恢复头像、名字、主题、日程偏好与课程时间组合。不会删除已有内容。</p><button className="btn btn-ghost settings-reset-btn" onClick={()=>setConfirmReset(true)}><RotateCcw size={16}/>恢复默认偏好</button>{resetNotice && <p role="status" className="settings-field-hint">已恢复默认偏好。</p>}</div></section>
    </>}
    <input ref={fileInput} type="file" accept="image/*" style={{display:'none'}} onChange={e=>{const file=e.target.files?.[0];e.target.value='';if(file){setCropperFile(file);setAvatarPicker(false);}}}/>
    {cropperFile && <AvatarCropper file={cropperFile} onCancel={()=>setCropperFile(null)} onConfirm={avatar=>{updatePrefs({avatar});setCropperFile(null);}}/>}
    <ConfirmDialog open={confirmReset} message="恢复默认偏好？头像、名字、主题、日程偏好和课程时间组合会重置，已有内容不受影响。" confirmText="恢复默认" onCancel={()=>setConfirmReset(false)} onConfirm={()=>{resetPrefs();setConfirmReset(false);setResetNotice(true);}}/>
  </div>;
}
