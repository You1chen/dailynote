import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { useBacklog } from '../hooks/useBacklog';
import { BACKLOG_BLOCKER_HINTS, type BacklogItem, type BacklogStartMode, type BacklogStatus } from '../types';
import {
  ageFromStartAt,
  backlogAgeText,
  localDateStr,
  sortBacklog,
  startAtFromAge,
} from '../utils/backlog';
import ConfirmDialog from '../components/ConfirmDialog';
import './BacklogPage.css';
import { useSheetDrag } from '../hooks/useSheetDrag';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';

type Filter = 'all' | 'blocked' | 'resolved';

function num(v: string): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function BacklogPage() {
  const { items, loading, addItem, updateItem, changeStatus, removeItem } = useBacklog();

  const [filter, setFilter] = useState<Filter>('all');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<BacklogItem | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [showDropped, setShowDropped] = useState(false);

  // ---- 表单 ----
  const [title, setTitle] = useState('');
  const [startMode, setStartMode] = useState<BacklogStartMode>('age');
  const [ageY, setAgeY] = useState('');
  const [ageM, setAgeM] = useState('');
  const [ageD, setAgeD] = useState('');
  const [dateVal, setDateVal] = useState(localDateStr(new Date()));
  const [startText, setStartText] = useState('');
  const [blocker, setBlocker] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [askDelete, setAskDelete] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const sheetDrag = useSheetDrag(() => { if (!busy) setSheetOpen(false); }, sheetOpen && !busy);
  useRegisterBackHandler(() => {
    if (askDelete) { setAskDelete(false); return true; }
    if (sheetOpen) { if (!busy) setSheetOpen(false); return true; }
    return false;
  }, [askDelete, sheetOpen, busy]);

  const blocked = useMemo(
    () => sortBacklog(items.filter(i => i.status === 'blocked')),
    [items],
  );
  const ready = useMemo(() => sortBacklog(items.filter(i => i.status === 'ready')), [items]);
  const resolved = useMemo(() => sortBacklog(items.filter(i => i.status === 'resolved')), [items]);
  const dropped = useMemo(() => sortBacklog(items.filter(i => i.status === 'dropped')), [items]);

  function openNew() {
    setEditing(null);
    setTitle('');
    setStartMode('age');
    setAgeY(''); setAgeM(''); setAgeD('');
    setDateVal(localDateStr(new Date()));
    setStartText('');
    setBlocker('');
    setDetail('');
    setSheetOpen(true);
  }

  function openEdit(item: BacklogItem) {
    setEditing(item);
    setTitle(item.title);
    setStartMode(item.startMode);
    if (item.startMode === 'age' && item.startAt != null) {
      const { years, months, days } = ageFromStartAt(item.startAt);
      setAgeY(years ? String(years) : '');
      setAgeM(months ? String(months) : '');
      setAgeD(days ? String(days) : '');
      setDateVal(localDateStr(new Date()));
    } else if (item.startMode === 'date' && item.startAt != null) {
      setDateVal(localDateStr(new Date(item.startAt)));
      setAgeY(''); setAgeM(''); setAgeD('');
    } else {
      setAgeY(''); setAgeM(''); setAgeD('');
      setDateVal(localDateStr(new Date()));
    }
    setStartText(item.startText || '');
    setBlocker(item.blocker || '');
    setDetail(item.detail || '');
    setSheetOpen(true);
  }

  function appendBlocker(word: string) {
    setBlocker(prev => (prev.trim() ? `${prev.replace(/\s+$/, '')} ${word}` : word));
  }

  async function handleSave() {
    const t = title.trim();
    if (!t) { setNotice('请填写事项'); return; }

    let startAt: number | null = null;
    let text = '';
    if (startMode === 'age') {
      startAt = startAtFromAge(num(ageY), num(ageM), num(ageD));
    } else if (startMode === 'date') {
      const dt = new Date(`${dateVal}T00:00:00`);
      startAt = Number.isNaN(dt.getTime()) ? Date.now() : dt.getTime();
    } else {
      text = startText.trim() || '未填';
      startAt = null;
    }

    setBusy(true);
    try {
      if (editing) {
        await updateItem({
          ...editing,
          title: t,
          startMode,
          startAt,
          startText: text,
          blocker: blocker.trim(),
          detail: detail.trim(),
        });
      } else {
        await addItem({
          title: t,
          startMode,
          startAt,
          startText: text,
          blocker: blocker.trim(),
          detail: detail.trim(),
          status: 'blocked',
        });
      }
      setSheetOpen(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!editing?.id) return;
    const id = editing.id;
    setAskDelete(false);
    await removeItem(id);
    setSheetOpen(false);
  }

  const cardActions = (item: BacklogItem) => {
    const id = item.id!;
    if (item.status === 'blocked') {
      return (
        <>
          <button className="bk-act" onClick={() => changeStatus(id, 'blocked')}>仍阻塞</button>
          <button className="bk-act bk-act--ok" onClick={() => changeStatus(id, 'ready')}>可推进</button>
          <button className="bk-act" onClick={() => changeStatus(id, 'dropped')}>终止</button>
        </>
      );
    }
    if (item.status === 'ready') {
      return (
        <>
          <button className="bk-act" onClick={() => changeStatus(id, 'blocked')}>退回阻塞</button>
          <button className="bk-act bk-act--ok" onClick={() => changeStatus(id, 'resolved')}>已解决</button>
          <button className="bk-act" onClick={() => changeStatus(id, 'dropped')}>终止</button>
        </>
      );
    }
    return (
      <>
        <button className="bk-act" onClick={() => changeStatus(id, 'blocked')}>恢复</button>
        <button className="bk-act" onClick={() => changeStatus(id, 'dropped')}>终止</button>
      </>
    );
  };

  const renderCard = (item: BacklogItem) => (
    <div
      key={item.id}
      className={`bk-card ${item.status === 'blocked' ? 'bk-card--blocked' : ''}`}
      onClick={() => openEdit(item)}
    >
      <div className="bk-row1">
        <span className="bk-title">{item.title}</span>
        <span className="bk-age">{backlogAgeText(item)}</span>
      </div>
      {item.blocker && <div className="bk-meta">{item.blocker}</div>}
      <div className="bk-actions" onClick={e => e.stopPropagation()}>{cardActions(item)}</div>
    </div>
  );

  const showBlocked = filter !== 'resolved';
  const showReady = filter === 'all';
  const showResolvedFold = filter !== 'blocked';
  const resolvedOpen = showResolved || filter === 'resolved';

  return (
    <div className="app-container">
      <div className="page-header">
        <h1 className="page-title">遗留问题</h1>
        <button className="btn btn-primary btn-sm" onClick={openNew}>
          <Plus size={14} /> 记一条
        </button>
      </div>

      <div className="bk-chips">
        <button className={`bk-chip ${filter === 'all' ? 'bk-chip--on' : ''}`} onClick={() => setFilter('all')}>全部</button>
        <button className={`bk-chip ${filter === 'blocked' ? 'bk-chip--on' : ''}`} onClick={() => setFilter('blocked')}>阻塞中</button>
        <button className={`bk-chip ${filter === 'resolved' ? 'bk-chip--on' : ''}`} onClick={() => setFilter('resolved')}>已解决</button>
      </div>

      {loading ? (
        <div className="empty-state"><p>加载中...</p></div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <p>还没有遗留问题。真正难的事通常当天解决不了——先记下来。</p>
        </div>
      ) : (
        <>
          {showBlocked && blocked.length > 0 && (
            <div className="bk-group">
              <div className="bk-g-title">阻塞中 <span className="bk-g-count">{blocked.length}</span></div>
              {blocked.map(renderCard)}
            </div>
          )}

          {showReady && ready.length > 0 && (
            <div className="bk-group">
              <div className="bk-g-title bk-g-title--ok">可推进 <span className="bk-g-count">{ready.length}</span></div>
              {ready.map(renderCard)}
            </div>
          )}

          {showResolvedFold && resolved.length > 0 && (
            <div className="bk-group">
              <button className="bk-fold" onClick={() => setShowResolved(v => !v)}>
                已解决 <span className="bk-g-count">{resolved.length} 条 · {resolvedOpen ? '收起' : '展开'}</span>
              </button>
              {resolvedOpen && resolved.map(renderCard)}
            </div>
          )}

          {showResolvedFold && dropped.length > 0 && (
            <div className="bk-group">
              <button className="bk-fold" onClick={() => setShowDropped(v => !v)}>
                已终止 <span className="bk-g-count">{dropped.length} 条 · {showDropped ? '收起' : '展开'}</span>
              </button>
              {showDropped && dropped.map(renderCard)}
            </div>
          )}
        </>
      )}

      {sheetOpen && (
        <div className="bk-overlay" onClick={() => setSheetOpen(false)}>
          <div className="bk-sheet" style={sheetDrag.style} onClick={e => e.stopPropagation()}>
            <div className="bk-grip" {...sheetDrag.handlers} />

            <div className="bk-field">
              <label className="bk-label">事项</label>
              <input
                className="input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="未启动的学习项"
              />
            </div>

            <div className="bk-field">
              <div className="bk-label-row">
                <label className="bk-label">起始</label>
                <span className="bk-modes">
                  {(['age', 'date', 'text'] as BacklogStartMode[]).map(m => (
                    <button
                      key={m}
                      className={`bk-mode ${startMode === m ? 'bk-mode--on' : ''}`}
                      onClick={() => setStartMode(m)}
                    >
                      {m === 'age' ? '距今' : m === 'date' ? '日期' : '文字'}
                    </button>
                  ))}
                </span>
              </div>

              {startMode === 'age' && (
                <div className="bk-age-row">
                  <input className="input bk-num" inputMode="numeric" value={ageY}
                    onChange={e => setAgeY(e.target.value.replace(/\D/g, ''))} placeholder="0" />
                  <span className="bk-unit">年</span>
                  <input className="input bk-num" inputMode="numeric" value={ageM}
                    onChange={e => setAgeM(e.target.value.replace(/\D/g, ''))} placeholder="0" />
                  <span className="bk-unit">月</span>
                  <input className="input bk-num" inputMode="numeric" value={ageD}
                    onChange={e => setAgeD(e.target.value.replace(/\D/g, ''))} placeholder="0" />
                  <span className="bk-unit">日</span>
                </div>
              )}

              {startMode === 'date' && (
                <input className="input" type="date" value={dateVal} onChange={e => setDateVal(e.target.value)} />
              )}

              {startMode === 'text' && (
                <input
                  className="input"
                  value={startText}
                  onChange={e => setStartText(e.target.value)}
                  placeholder="某个用非数字描述的时间点"
                />
              )}
            </div>

            <div className="bk-field">
              <label className="bk-label">困难</label>
              <input
                className="input"
                value={blocker}
                onChange={e => setBlocker(e.target.value)}
                placeholder="为什么做不到？"
              />
              <div className="bk-reco">
                <span className="bk-reco-lbl">推荐</span>
                {BACKLOG_BLOCKER_HINTS.map(h => (
                  <button key={h} className="bk-tag" onClick={() => appendBlocker(h)}>{h}</button>
                ))}
              </div>
            </div>

            <div className="bk-field">
              <label className="bk-label">详情</label>
              <textarea
                className="input bk-detail"
                value={detail}
                onChange={e => setDetail(e.target.value)}
                placeholder="补充说明"
              />
            </div>

            <div className="bk-sheet-acts">
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={busy}>
                {busy ? '保存中...' : '保存'}
              </button>
              {editing ? (
                <button className="btn btn-outline btn-danger" onClick={() => setAskDelete(true)}>删除</button>
              ) : (
                <button className="btn btn-ghost" onClick={() => setSheetOpen(false)}>
                  <X size={16} /> 取消
                </button>
              )}
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={askDelete}
        message="删除后可在回收站还原，确定删除？"
        onCancel={() => setAskDelete(false)}
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={notice !== null}
        message={notice ?? ''}
        onCancel={() => setNotice(null)}
      />    </div>
  );
}
