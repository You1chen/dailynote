import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Check, Clock3, Trash2 } from 'lucide-react';
import Sheet from './Sheet';
import { getPlanByDate, moveTimeBlockToTrash, savePlan } from '../../db';
import { usePreferences } from '../../hooks/usePreferences';
import { genId } from '../../types';
import type { DailyPlan, TimeBlock } from '../../types';
import { useUi, type ScheduleDraft } from '../state/ui';
import { durationLabel, minutesToTime, monthDay, timeToMinutes, weekdayName } from '../utils/dates';

interface Props {
  open: boolean;
  draft: ScheduleDraft | null;
  onClose: () => void;
}

const DURATIONS = [30, 60, 90, 120];

function defaultStart(date: string): string {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  if (date !== today) return '09:00';
  const minutes = now.getHours() * 60 + now.getMinutes();
  return minutesToTime(Math.min(22 * 60, Math.max(6 * 60, Math.round(minutes / 30) * 30)));
}

function emptyBlock(startTime: string, duration: number, title = '', content = ''): TimeBlock {
  const end = minutesToTime(Math.min(1439, timeToMinutes(startTime) + duration));
  return {
    id: '',
    startTime,
    endTime: end,
    taskTitle: title,
    plannedContent: content,
    checklist: [],
    actualExecution: '',
    focusScore: 0,
    efficiencyScore: 0,
    completed: false,
    notes: '',
  };
}

export default function ScheduleSheet({ open, draft, onClose }: Props) {
  const { prefs } = usePreferences();
  const ui = useUi();
  const [block, setBlock] = useState<TimeBlock | null>(null);
  const [plan, setPlan] = useState<DailyPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleteArmed, setDeleteArmed] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !draft) return;
    setError('');
    setDeleteArmed(false);
    const base = draft.block
      ? { ...draft.block, checklist: draft.block.checklist ?? [] }
      : emptyBlock(
          draft.startTime ?? defaultStart(draft.date),
          prefs.defaultDuration,
          draft.title ?? '',
          draft.content ?? '',
        );
    if (draft.block && draft.title !== undefined) base.taskTitle = draft.title;
    if (draft.block && draft.content !== undefined) base.plannedContent = draft.content;
    if (!draft.block && draft.startTime && draft.endTime) base.endTime = draft.endTime;
    setBlock(base);
    setPlan(null);
    void getPlanByDate(draft.date)
      .then(next => setPlan(next ?? { date: draft.date, timeBlocks: [], createdAt: Date.now(), updatedAt: Date.now() }))
      .catch(() => setPlan({ date: draft.date, timeBlocks: [], createdAt: Date.now(), updatedAt: Date.now() }));
  }, [open, draft, prefs.defaultDuration]);

  const isEditing = !!draft?.block;
  const date = draft?.date ?? '';
  const dateLabel = useMemo(() => date ? `${monthDay(date)} · ${weekdayName(date)}` : '', [date]);

  if (!draft) return null;

  function patch(changes: Partial<TimeBlock>) {
    setBlock(current => current ? { ...current, ...changes } : current);
  }

  function applyStart(start: string) {
    if (!block) return;
    const duration = Math.max(5, timeToMinutes(block.endTime) - timeToMinutes(block.startTime));
    patch({ startTime: start, endTime: minutesToTime(Math.min(1439, timeToMinutes(start) + duration)) });
  }

  function applyDuration(minutes: number) {
    if (!block) return;
    patch({ endTime: minutesToTime(Math.min(1439, timeToMinutes(block.startTime) + minutes)) });
  }

  async function save() {
    if (!block || busy) return;
    const start = timeToMinutes(block.startTime);
    const end = timeToMinutes(block.endTime);
    if (end <= start) {
      setError('结束时间需要晚于开始时间。');
      return;
    }
    if (!block.taskTitle.trim() && !block.plannedContent.trim()) {
      setError('写一个名称或内容，再保存。');
      titleRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const nextPlan: DailyPlan = plan ?? { date, timeBlocks: [], createdAt: Date.now(), updatedAt: Date.now() };
      const nextBlock: TimeBlock = {
        ...block,
        id: block.id || genId(),
        taskTitle: block.taskTitle.trim() || block.plannedContent.trim().slice(0, 24),
        checklist: block.checklist ?? [],
      };
      const exists = nextPlan.timeBlocks.some(item => item.id === nextBlock.id);
      const timeBlocks = exists
        ? nextPlan.timeBlocks.map(item => item.id === nextBlock.id ? nextBlock : item)
        : [...nextPlan.timeBlocks, nextBlock];
      await savePlan({ ...nextPlan, timeBlocks, updatedAt: Date.now() });
      window.dispatchEvent(new CustomEvent('dailynote-plan-changed', { detail: { date } }));
      ui.toast(isEditing ? '日程已更新' : '日程已添加');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!block?.id || !plan || busy) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      window.setTimeout(() => setDeleteArmed(false), 2600);
      return;
    }
    setBusy(true);
    try {
      await moveTimeBlockToTrash(date, block, `日程 · ${block.taskTitle || block.startTime}`);
      await savePlan({
        ...plan,
        timeBlocks: plan.timeBlocks.filter(item => item.id !== block.id),
        updatedAt: Date.now(),
      });
      window.dispatchEvent(new CustomEvent('dailynote-plan-changed', { detail: { date } }));
      ui.toast('日程已删除');
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  if (!block) return null;

  const activeMinutes = Math.max(0, timeToMinutes(block.endTime) - timeToMinutes(block.startTime));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      busy={busy}
      title={isEditing ? '编辑日程' : '新建日程'}
      subtitle={dateLabel}
      footer={(
        <>
          {isEditing && (
            <button type="button" className={`v-btn ${deleteArmed ? 'v-btn--danger' : 'v-btn--ghost'}`} onClick={() => void remove()} disabled={busy}>
              <Trash2 size={15} />
              {deleteArmed ? '确认删除' : '删除'}
            </button>
          )}
          <span className="v-grow" />
          <button type="button" className="v-btn v-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" className="v-btn v-btn--primary" onClick={() => void save()} disabled={busy}>
            {busy ? '保存中…' : '保存'}
          </button>
        </>
      )}
    >
      <div className="v-form-group" style={{ marginTop: 4 }}>
        <input
          ref={titleRef}
          className="v-field"
          style={{ height: 54, fontSize: 19, fontWeight: 650, letterSpacing: '-0.02em' }}
          value={block.taskTitle}
          onChange={event => patch({ taskTitle: event.target.value })}
          placeholder="要做什么？"
          maxLength={80}
        />
      </div>

      <div className="v-form-group">
        <span className="v-label">时间</span>
        <div className="v-row" style={{ gap: 8 }}>
          <input
            className="v-field"
            type="time"
            aria-label="开始时间"
            value={block.startTime}
            onChange={event => applyStart(event.target.value)}
            style={{ flex: 1 }}
          />
          <span className="v-tiny">至</span>
          <input
            className="v-field"
            type="time"
            aria-label="结束时间"
            value={block.endTime}
            onChange={event => patch({ endTime: event.target.value })}
            style={{ flex: 1 }}
          />
        </div>
        <div className="v-row v-row--wrap" style={{ marginTop: 9, gap: 6 }}>
          <span className="v-tiny" style={{ marginRight: 2 }}>
            <Clock3 size={12} style={{ verticalAlign: '-2px', marginRight: 3 }} />
            {durationLabel(block.startTime, block.endTime)}
          </span>
          {DURATIONS.map(minutes => (
            <button
              key={minutes}
              type="button"
              className={`v-pill ${activeMinutes === minutes ? 'v-pill--on' : ''}`}
              style={{ height: 27, fontSize: 11.5 }}
              onClick={() => applyDuration(minutes)}
            >
              {minutes < 60 ? `${minutes} 分` : `${minutes / 60} 小时`}
            </button>
          ))}
        </div>
      </div>

      <div className="v-form-group">
        <span className="v-label">内容</span>
        <textarea
          className="v-textarea"
          value={block.plannedContent}
          onChange={event => patch({ plannedContent: event.target.value })}
          placeholder="补充一点细节，可留空"
          rows={4}
        />
      </div>

      <button
        type="button"
        className="v-settings-row"
        style={{ width: '100%', background: 'transparent', border: 0, borderTop: '1px solid var(--v-separator)', textAlign: 'left', padding: '14px 0' }}
        onClick={() => patch({ completed: !block.completed })}
        aria-pressed={block.completed}
      >
        <span className="v-settings-row-label">
          <strong>标记完成</strong>
          <span>完成后在时间轴上会淡化显示</span>
        </span>
        <span className={`v-checkbox ${block.completed ? 'v-checkbox--on' : ''}`} aria-hidden="true">
          {block.completed && <Check size={13} />}
        </span>
      </button>

      {error && <p role="alert" style={{ margin: '10px 0 0', color: 'var(--v-red)', fontSize: 12.5 }}>{error}</p>}

      <div className="v-tiny" style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14 }}>
        <CalendarDays size={13} />
        {monthDay(date)} {weekdayName(date)} · 保存后会自动写进当天时间轴
      </div>
    </Sheet>
  );
}
