import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, CalendarClock, GraduationCap, Database, RotateCcw, ListTodo } from 'lucide-react';
import { usePreferences } from '../hooks/usePreferences';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { useRouteBack } from '../hooks/useRouteBack';
import CourseTimeSettings from '../components/CourseTimeSettings';
import ConfirmDialog from '../components/ConfirmDialog';
import './SettingsPage.css';

const SECTIONS = [
  {id:'schedule',title:'日程与时间',icon:CalendarClock},
  {id:'courses',title:'课程与时间组合',icon:GraduationCap},
  {id:'todo',title:'TODO',icon:ListTodo},
  {id:'data',title:'数据',icon:Database},
];
export default function SettingsPage() {
  const navigate = useNavigate();
  const backFromSettings = useRouteBack();
  const [params, setParams] = useSearchParams();
  const section = SECTIONS.find(s => s.id === params.get('section'));
  const { prefs, updatePrefs, resetPrefs } = usePreferences();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetNotice, setResetNotice] = useState(false);
  const back = () => {
    if (confirmReset) setConfirmReset(false);
    else if (section) setParams({}, { replace: true });
    else backFromSettings();
  };
  useRegisterBackHandler(() => { back(); return true; }, [section?.id, confirmReset, backFromSettings]);
  const toggle = (label: string, checked: boolean, onChange: (value: boolean) => void) => <div className="settings-field settings-toggle-row"><span>{label}</span><label className="settings-switch"><input aria-label={label} type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/><span className="settings-switch-slider"/></label></div>;
  return <div className="app-container settings-page">
    <header className="page-header"><button className="btn btn-ghost btn-icon" aria-label={section ? '返回设置首页' : '返回'} onClick={back}><ArrowLeft size={22}/></button><h1 className="page-title">{section?.title ?? '设置'}</h1></header>
    {!section && <>
      <nav className="settings-menu" aria-label="设置分类">{SECTIONS.map((s,index)=><button key={s.id} className="settings-menu-item" onClick={()=>setParams({section:s.id}, { replace: true })}><span className={`settings-menu-icon settings-menu-icon--${index}`}><s.icon size={22}/></span><span className="settings-menu-copy"><strong>{s.title}</strong></span><ChevronRight size={18}/></button>)}</nav>
    </>}
    {section?.id==='schedule' && <>
      <section className="settings-section"><h2 className="settings-section-title">作息与可见时间</h2><div className="card"><div className="settings-field"><label className="label">睡眠时间段</label><div className="settings-time-row"><input aria-label="睡眠开始时间" className="input" type="time" value={prefs.sleepStart} onChange={e=>{if(e.target.value)updatePrefs({sleepStart:e.target.value});}}/><span>→</span><input aria-label="睡眠结束时间" className="input" type="time" value={prefs.sleepEnd} onChange={e=>{if(e.target.value)updatePrefs({sleepEnd:e.target.value});}}/></div></div>{toggle('折叠睡眠时段',prefs.hideSleepHours,v=>updatePrefs({hideSleepHours:v}))}{toggle('只看未来',prefs.futureOnly,v=>updatePrefs({futureOnly:v}))}</div></section>
      <section className="settings-section"><h2 className="settings-section-title">创建与浏览</h2><div className="card"><div className="settings-field"><label className="label">新计划默认时长</label><div className="settings-chip-row">{[15,30,45,60,90,120].map(n=><button key={n} className={`settings-chip ${prefs.defaultDuration===n?'settings-chip--active':''}`} aria-pressed={prefs.defaultDuration===n} onClick={()=>updatePrefs({defaultDuration:n})}>{n} 分钟</button>)}</div></div><div className="settings-field"><label className="label">时间轴疏密</label><div className="settings-chip-row">{[{n:48,label:'紧凑'},{n:64,label:'标准'},{n:80,label:'宽松'}].map(d=><button key={d.n} className={`settings-chip ${prefs.hourHeight===d.n?'settings-chip--active':''}`} aria-pressed={prefs.hourHeight===d.n} onClick={()=>updatePrefs({hourHeight:d.n})}>{d.label}</button>)}</div></div></div></section>
    </>}
    {section?.id==='courses' && <>
      <CourseTimeSettings combinations={prefs.courseTimeCombinations} onChange={courseTimeCombinations=>updatePrefs({courseTimeCombinations})}/>
      <button className="settings-link-card" onClick={()=>navigate('/courses')}><GraduationCap size={20}/><span><strong>学期与课程</strong></span><ChevronRight size={18}/></button>
    </>}
    {section?.id === 'todo' && <section className="settings-section">
      <h2 className="settings-section-title">操作确认</h2>
      <div className="card">
        {toggle('开始计时前确认', prefs.todoConfirmations.startTimer,
          startTimer => updatePrefs({ todoConfirmations: { ...prefs.todoConfirmations, startTimer } }))}
        {toggle('结束计时前确认', prefs.todoConfirmations.stopTimer,
          stopTimer => updatePrefs({ todoConfirmations: { ...prefs.todoConfirmations, stopTimer } }))}
        {toggle('移入遗留前确认', prefs.todoConfirmations.moveToBacklog,
          moveToBacklog => updatePrefs({ todoConfirmations: { ...prefs.todoConfirmations, moveToBacklog } }))}
      </div>
    </section>}
    {section?.id==='data' && <section className="settings-section settings-reset-area"><h2 className="settings-section-title">偏好恢复</h2><div className="card"><button className="btn btn-ghost settings-reset-btn" onClick={()=>setConfirmReset(true)}><RotateCcw size={16}/>恢复默认偏好</button>{resetNotice && <p role="status" className="settings-field-hint">已恢复默认偏好。</p>}</div></section>}
    <ConfirmDialog open={confirmReset} message="恢复默认偏好？日程偏好、课程时间组合和确认设置会重置，已有内容不受影响。" confirmText="恢复默认" onCancel={()=>setConfirmReset(false)} onConfirm={()=>{resetPrefs();setConfirmReset(false);setResetNotice(true);}}/>
  </div>;
}
