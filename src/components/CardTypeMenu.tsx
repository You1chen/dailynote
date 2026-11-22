import { useEffect, useState } from 'react';
import { X, Trash2 } from 'lucide-react';
import { DEFAULT_CARD_TYPES, getCustomCardTypes, addCustomCardType, removeCustomCardType } from '../db/knowledgeCards';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import ConfirmDialog from './ConfirmDialog';
import './CardTypeMenu.css';

export default function CardTypeMenu({ value, onSelect, onClose }: {value: string; onSelect: (type: string)=>void; onClose: ()=>void}) {
  const [types,setTypes]=useState<string[]>([]), [input,setInput]=useState(''), [error,setError]=useState(''), [busy,setBusy]=useState(false);
  const [remove,setRemove]=useState<string|null>(null);
  useEffect(()=>{void getCustomCardTypes().then(setTypes).catch(()=>setError('无法读取类型'));},[]);
  useRegisterBackHandler(()=>{if(remove)setRemove(null);else if(!busy)onClose();return true;},[remove,busy,onClose]);
  async function add(){if(busy)return;setBusy(true);setError('');try{await addCustomCardType(input);setTypes(await getCustomCardTypes());onSelect(input.trim());onClose();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}}
  async function erase(){if(!remove||busy)return;setBusy(true);try{await removeCustomCardType(remove);setTypes(await getCustomCardTypes());setRemove(null);}catch{setError('删除失败');}finally{setBusy(false);}}
  return <div className="card-type-backdrop"><section className="card-type-menu" role="dialog" aria-modal="true" aria-label="卡片类型"><header><h3>类型</h3><button aria-label="关闭类型设置" disabled={busy} onClick={onClose}><X size={19}/></button></header>
    <div className="card-type-options">{[...DEFAULT_CARD_TYPES,...types].map(type=><div key={type}><button aria-pressed={value===type} disabled={busy} onClick={()=>{onSelect(type);onClose();}}>{type}{value===type?' ✓':''}</button>{types.includes(type)&&<button aria-label={`删除类型：${type}`} disabled={busy} onClick={()=>setRemove(type)}><Trash2 size={16}/></button>}</div>)}</div>
    <form onSubmit={e=>{e.preventDefault();void add();}}><label htmlFor="custom-card-type">自定义</label><div><input id="custom-card-type" value={input} maxLength={24} disabled={busy} onChange={e=>setInput(e.target.value)} placeholder="类型名称"/><button disabled={busy||!input.trim()}>添加</button></div></form>{error&&<p role="alert">{error}</p>}
  </section><ConfirmDialog open={!!remove} message={`删除类型“${remove ?? ''}”？已有卡片保留原类型。`} confirmText="删除" onCancel={()=>setRemove(null)} onConfirm={()=>void erase()}/></div>;
}
