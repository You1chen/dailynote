import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Memory } from '../utils/wanderDeck';
import { age } from '../utils/wanderDeck';
import { Headphones, Image as Picture, Shuffle } from 'lucide-react';

const mod = (n: number, length: number) => (n % length + length) % length;
function Preview({ item }: {item: Memory}) {
  if (item.kind === '灵感') return <p>{item.text}</p>;
  return <>{item.blocks.slice(0, 4).map(b => b.kind === 'text' ? <p key={b.id}>{b.text}</p> : b.kind === 'image' ? <img key={b.id} alt="卡片图片" src={b.data} draggable={false}/> : <p key={b.id}><Headphones size={18}/> {b.fileName || '录音'}</p>)}{!item.blocks.length && <Picture aria-label="暂无正文" size={20}/>}</>;
}
/** The unbounded slot index is the DOM key: moving to the foreground never remounts a side card. */
export default function WalkMotion({ items, open, reshuffle, paused }: {items: Memory[]; open: (item:Memory)=>void; reshuffle:()=>void; paused:boolean}) {
  const [anchor,setAnchor] = useState(0);
  const stage = useRef<HTMLDivElement>(null), pos = useRef(0), frame = useRef(0), target = useRef(0), moving = useRef(false);
  const drag = useRef<{id:number; x:number; y:number; base:number; t:number; moved:boolean}|null>(null);
  const blockClick = useRef(false), count = items.length;
  const pitch = () => Math.max(150,Math.min(stage.current?.clientWidth || 390, 580)*.66);
  const paint = useCallback((v:number) => {
    pos.current=v;
    stage.current?.querySelectorAll<HTMLElement>('[data-slot]').forEach(el => {
      const d = Number(el.dataset.slot)-v, a=Math.abs(d), bias=Math.sign(d);
      const x = bias*(Math.min(a,1)*(d<0?17:98) + Math.max(0,a-1)*(d<0?10:78));
      el.style.transform=`translate(-50%,-50%) translate3d(${x}%,${Math.min(a,2)*2}%,0) scale(${1-Math.min(a,2)*.105})`;
      el.style.opacity=String(a > 1.55 ? Math.max(0,1-(a-1.55)*1.5) : 1);
      el.style.filter=`brightness(${1-Math.min(a,1)*.52})`;
      el.style.zIndex=String(100-Math.round(a*20));
    });
  },[]);
  const settle = useCallback((to:number) => {
    cancelAnimationFrame(frame.current); target.current=to; moving.current=true;
    const start=pos.current, t0=performance.now(), duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 390;
    const tick=(t:number) => { const p=duration ? Math.min(1,(t-t0)/duration) : 1;
      paint(start+(to-start)*(1-Math.pow(1-p,3)));
      if(p<1) frame.current=requestAnimationFrame(tick); else { moving.current=false; setAnchor(to); }
    }; frame.current=requestAnimationFrame(tick);
  },[paint]);
  useLayoutEffect(()=>{paint(pos.current);},[anchor,paint]);
  useEffect(()=>()=>cancelAnimationFrame(frame.current),[]);
  const step=useCallback((dir:number)=>{ if(count>1 && !moving.current && !drag.current) settle(target.current+dir); },[count,settle]);
  useEffect(()=>{ const key=(e:KeyboardEvent)=>{if(paused || e.altKey) return; if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();step(e.key==='ArrowLeft'?-1:1);} }; window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key); },[paused,step]);
  function down(e:ReactPointerEvent<HTMLDivElement>) {if(!e.isPrimary || e.button!==0 || paused || moving.current) return; blockClick.current=false; drag.current={id:e.pointerId,x:e.clientX,y:e.clientY,base:pos.current,t:performance.now(),moved:false};}
  function move(e:ReactPointerEvent<HTMLDivElement>) {const g=drag.current;if(!g || g.id!==e.pointerId || count<2) return;const dx=e.clientX-g.x;
    if(!g.moved && Math.abs(dx)<7) return;
    if(!g.moved && Math.abs(dx)<Math.abs(e.clientY-g.y)){drag.current=null;return;}
    if(!g.moved){g.moved=true; blockClick.current=true; e.currentTarget.setPointerCapture(e.pointerId);}
    paint(g.base-Math.max(-1,Math.min(1,dx/pitch())));
  }
  function end(e:ReactPointerEvent<HTMLDivElement>,cancel=false){const g=drag.current;if(!g||g.id!==e.pointerId)return;drag.current=null;if(!g.moved)return;
    const dx=e.clientX-g.x, commit=!cancel && (Math.abs(dx)>pitch()*.22 || (Math.abs(dx)>20 && Math.abs(dx)/(performance.now()-g.t+1)>.38)); settle(Math.round(g.base)+(commit?(dx<0?1:-1):0));}
  const cur=items[mod(anchor,count)];
  return <><div className="walk-age" aria-live="polite">{age(cur.day)}</div><div className="walk-stage" ref={stage} onPointerDown={down} onPointerMove={move} onPointerUp={e=>end(e)} onPointerCancel={e=>end(e,true)} onPointerLeave={()=>{if(!drag.current?.moved)drag.current=null;}}>
    {(count===1?[0]:[-2,-1,0,1,2]).map(off=>{const slot=anchor+off,item=items[mod(slot,count)];return <div className="walk-slot" key={slot} data-slot={slot}><div className="walk-float"><button className="walk-paper" type="button" tabIndex={off===0?0:-1} aria-label={off===0?`阅读：${item.title}`:off<0?'翻到上一张':'翻到下一张'} onClick={e=>{if((e.detail!==0 && blockClick.current)||moving.current)return;if(!off)open(item);else step(Math.sign(off));}}>
    <strong>{item.title}</strong><div className="walk-excerpt"><Preview item={item}/></div><time>{item.day.split('-').join('/')}</time></button></div></div>;})}</div>
    <footer className="walk-foot"><button className="walk-random" aria-label="随机回顾时光，重新排列" onClick={reshuffle}><Shuffle size={16}/>随机回顾时光</button></footer></>;
}
