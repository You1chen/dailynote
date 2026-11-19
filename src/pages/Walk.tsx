import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, History, Filter, Pencil, X } from 'lucide-react';
import { getCards } from '../db/knowledgeCards';
import { getAllIdeas } from '../db';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { collectMemories, deal, matchesDay, type Memory } from '../utils/wanderDeck';
import WalkMotion from './WalkMotion';
import WalkEdit from '../components/WalkEdit';
import './Walk.css';

export default function Walk() {
  const navigate=useNavigate(); const [all,setAll]=useState<Memory[]|null>(null),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  const [range,setRange]=useState(['','']),[draft,setDraft]=useState(['','']),[hist,setHist]=useState(false),[version,setVersion]=useState(0);
  const [sheet,setSheet]=useState(false),[detail,setDetail]=useState<Memory|null>(null),[editing,setEditing]=useState<Memory|null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const backgroundEntry = useRef('');
  useEffect(()=>{let live=true;setError(false); Promise.all([getCards(),getAllIdeas()]).then(([cards,ideas])=>{if(live)setAll(deal(collectMemories(cards,ideas)));}).catch(()=>{if(live)setError(true);});return()=>{live=false;};},[retry]);
  const entries=useMemo(()=>all?.filter(i=>matchesDay(i.day,range[0],range[1],hist))??[],[all,range,hist]);
  const close=useCallback(()=>{setSheet(false);setDetail(null);},[]);
  const beginEdit=useCallback(()=>{if(!detail)return;setEditing(detail);setDetail(null);},[detail]);
  const back=useCallback(()=>{if(editing){setEditing(null);return true;}if(sheet||detail)close();else navigate('/',{replace:true});return true;},[editing,sheet,detail,close,navigate]);
  useRegisterBackHandler(back,[back]);
  useEffect(()=>{if(sheet||detail)dialog.current?.showModal();else dialog.current?.close();},[sheet,detail]);
  return <main className="walk-room"><header className="walk-head"><button onClick={back} aria-label="返回"><ArrowLeft/></button><h1>漫步</h1><button title="历史上的今天" aria-label="历史上的今天" aria-pressed={hist} onClick={()=>setHist(!hist)}><History/></button><button title="时间区间筛选" aria-label="时间区间筛选" aria-pressed={!!(range[0]||range[1])} onClick={()=>{setDraft([...range]);setSheet(true);}}><Filter/></button></header>
  {entries.length ? <div className="walk-deal" key={`${version}:${range.join(':')}:${hist}`}><WalkMotion items={entries} open={setDetail} paused={sheet||!!detail||!!editing} reshuffle={()=>{setAll(prev=>prev?deal(prev):prev);setVersion(v=>v+1);}}/></div> : <div className="walk-empty"><p>{error?'未能读取漫步内容':!all?'正在铺开卡片…':hist?'往年的今天还没有记录':all.length?'这段时间没有记录':'还没有卡片或灵感'}</p>{error?<button onClick={()=>setRetry(r=>r+1)}>重试</button>:all?.length?<button onClick={()=>{setHist(false);setRange(['','']);}}>查看全部时间</button>:all?<button onClick={()=>navigate('/reflection')}>去收集卡片</button>:null}</div>}
  <dialog ref={dialog} className="walk-dialog" aria-label={sheet?'时间区间筛选':'阅读原文'} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target===e.currentTarget)close();}}><section><header><span>{sheet?'时间区间':detail?.kind}</span><div className="walk-dialog-actions">{detail&&<button aria-label="编辑" onClick={beginEdit}><Pencil size={17}/></button>}<button aria-label="关闭" onClick={close}><X/></button></div></header>
  {sheet?<form onSubmit={e=>{e.preventDefault();setRange([...draft]);close();}}><label>从<input type="date" value={draft[0]} max={draft[1]||undefined} onChange={e=>setDraft([e.target.value,draft[1]])}/></label><label>至<input type="date" value={draft[1]} min={draft[0]||undefined} onChange={e=>setDraft([draft[0],e.target.value])}/></label><footer><button type="button" onClick={()=>{setRange(['','']);close();}}>全部时间</button><button>应用</button></footer></form>:detail&&<article className="walk-detail-card" onClick={e=>{if(!(e.target as HTMLElement).closest('audio,img,button'))beginEdit();}}><time>{detail.day} · {new Date(detail.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</time><h2>{detail.title}</h2>{detail.kind==='灵感'?<p>{detail.text}</p>:detail.blocks.map(b=><div key={b.id}>{b.kind==='text'?<p>{b.text}</p>:b.kind==='image'?<img src={b.data} alt="卡片图片"/>:<audio controls preload="none" src={b.data}/>}</div>)}</article>}</section></dialog>{editing&&<WalkEdit memory={editing} onClose={()=>setEditing(null)} onSaved={next=>setAll(prev=>prev?prev.map(item=>item.id===next.id?next:item):prev)}/>}</main>;
}
