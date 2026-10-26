import { useEffect, useState } from 'react';
import { X, Plus, Trash2, Check } from 'lucide-react';
import { useLinkGroups } from '../hooks/useLinkGroups';
import { getAllCourses, getSemester } from '../db';
import { effectiveCourses, currentWeekOf } from '../utils/courseSchedule';
import { courseLink, groupLink, hasLink, toggleLink, courseWeeksText } from '../utils/ddlLinks';
import type { Course, DdlLink, LinkGroup, SemesterRecord } from '../types';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import ConfirmDialog from './ConfirmDialog';
import './LinkPicker.css';

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 本地今天（不能用 todayStr：UTC 语义，凌晨会差一天） */
function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface Props {
  open: boolean;
  links: DdlLink[];
  onChange: (links: DdlLink[]) => void;
  onClose: () => void;
}

/**
 * 关联内容选择器：
 * - 「课程」是内置组，直接读课程表，只列本学期仍在周期内的有效课程，永远与课程表同步
 * - 其余分组由用户自建，条目可增可删
 */
export default function LinkPicker({ open, links, onChange, onClose }: Props) {
  const { groups, addGroup, removeGroup, addItem, removeItem } = useLinkGroups();
  const [courses, setCourses] = useState<Course[]>([]);
  const [semester, setSemester] = useState<SemesterRecord | undefined>(undefined);
  const [creating, setCreating] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [addingIn, setAddingIn] = useState<number | null>(null);
  const [itemDraft, setItemDraft] = useState('');
  const [pendingDelete, setPendingDelete] = useState<LinkGroup | null>(null);

  // 每次打开都重新读课程表：课程表刚改过也能立刻反映
  useEffect(() => {
    if (!open) return;
    Promise.all([getAllCourses(), getSemester()])
      .then(([cs, sem]) => { setCourses(cs); setSemester(sem); })
      .catch(() => { setCourses([]); setSemester(undefined); });
    setCreating(false);
    setNewGroupName('');
    setAddingIn(null);
    setItemDraft('');
  }, [open]);

  // 返回键先关选择器，不要直接把整个表单关掉。
  // 依赖 open：打开时重新注册，保证自己的处理器排在父组件（表单）之后被调用。
  useRegisterBackHandler(() => {
    if (!open) return false;
    if (pendingDelete) { setPendingDelete(null); return true; }
    onClose();
    return true;
  }, [open]);

  if (!open) return null;

  const today = localToday();
  const week = currentWeekOf(semester, today);
  const validCourses = effectiveCourses(courses, semester, today);

  const confirmAddItem = async (groupId: number) => {
    const name = itemDraft.trim();
    if (!name) return;
    await addItem(groupId, name);
    setItemDraft('');
    setAddingIn(null);
  };

  const confirmCreateGroup = async () => {
    const name = newGroupName.trim();
    if (!name) return;
    await addGroup(name);
    setNewGroupName('');
    setCreating(false);
  };

  return (
    <div className="lp-mask" onClick={onClose}>
      <div className="lp-sheet" onClick={e => e.stopPropagation()}>
        <div className="lp-head">
          <div>
            <div className="lp-title">关联内容</div>
            <div className="lp-sub">课程组随课程表自动同步，分组可自己加</div>
          </div>
          <button className="lp-close" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>

        <div className="lp-body">
          {/* ===== 内置：课程 ===== */}
          <div className="lp-sec">
            <div className="lp-sec-head">
              <span className="lp-sec-name">📚 课程</span>
              <span className="lp-sec-meta">
                {week > 0 ? `第 ${week} 周 · 有效 ${validCourses.length} 门` : '未设置开学时间'}
              </span>
            </div>

            {!semester?.startDate ? (
              <p className="lp-empty">在「课程表」设置开学时间后，这里会自动列出正在上的课</p>
            ) : week < 1 ? (
              <p className="lp-empty">还没开学，暂时没有可关联的课程</p>
            ) : validCourses.length === 0 ? (
              <p className="lp-empty">本学期没有正在上的课（未开讲、已结课、单双周不在本周的都算无效）</p>
            ) : (
              validCourses.map(c => {
                const on = hasLink(links, courseLink(c));
                return (
                  <button
                    key={c.id}
                    className={`lp-item ${on ? 'lp-item--on' : ''}`}
                    onClick={() => onChange(toggleLink(links, courseLink(c)))}
                  >
                    <span className="lp-item-main">
                      <span className="lp-item-name">{c.name}</span>
                      <span className="lp-item-meta">
                        {courseWeeksText(c)} · {c.dayOfWeek.map(d => WEEKDAY_LABELS[d]).join('、')} {c.startTime}-{c.endTime}
                      </span>
                    </span>
                    <span className={`lp-check ${on ? 'lp-check--on' : ''}`}>{on && <Check size={13} />}</span>
                  </button>
                );
              })
            )}
          </div>

          {/* ===== 自定义分组 ===== */}
          {groups.map(g => (
            <div className="lp-sec" key={g.id}>
              <div className="lp-sec-head">
                <span className="lp-sec-name">🗂 {g.name}</span>
                <button className="lp-del-group" onClick={() => setPendingDelete(g)} title="删除分组">
                  <Trash2 size={13} />
                </button>
              </div>

              {g.items.length === 0 && <p className="lp-empty">还没有条目</p>}
              {g.items.map(item => {
                const on = hasLink(links, groupLink(g, item));
                return (
                  <div className={`lp-item ${on ? 'lp-item--on' : ''}`} key={item.id}>
                    <button
                      className="lp-item-hit"
                      onClick={() => onChange(toggleLink(links, groupLink(g, item)))}
                    >
                      <span className="lp-item-main">
                        <span className="lp-item-name">{item.name}</span>
                      </span>
                      <span className={`lp-check ${on ? 'lp-check--on' : ''}`}>{on && <Check size={13} />}</span>
                    </button>
                    <button
                      className="lp-item-del"
                      title={`删除「${item.name}」`}
                      onClick={() => removeItem(g.id!, item.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                );
              })}

              {addingIn === g.id ? (
                <div className="lp-add-row">
                  <input
                    className="lp-add-input"
                    autoFocus
                    value={itemDraft}
                    maxLength={20}
                    placeholder="条目名称"
                    onChange={e => setItemDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); confirmAddItem(g.id!); }
                      if (e.key === 'Escape') { setAddingIn(null); setItemDraft(''); }
                    }}
                  />
                  <button className="lp-add-btn" onClick={() => confirmAddItem(g.id!)}>添加</button>
                  <button className="lp-add-cancel" onClick={() => { setAddingIn(null); setItemDraft(''); }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button className="lp-add-line" onClick={() => { setAddingIn(g.id!); setItemDraft(''); }}>
                  <Plus size={13} /> 添加条目
                </button>
              )}
            </div>
          ))}

          {/* ===== 新建分组 ===== */}
          {creating ? (
            <div className="lp-add-row lp-new-group">
              <input
                className="lp-add-input"
                autoFocus
                value={newGroupName}
                maxLength={12}
                placeholder="分组名称"
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); confirmCreateGroup(); }
                  if (e.key === 'Escape') { setCreating(false); setNewGroupName(''); }
                }}
              />
              <button className="lp-add-btn" onClick={confirmCreateGroup}>确定</button>
              <button className="lp-add-cancel" onClick={() => { setCreating(false); setNewGroupName(''); }}>
                <X size={14} />
              </button>
            </div>
          ) : (
            <button className="lp-new-group-btn" onClick={() => { setCreating(true); setNewGroupName(''); }}>
              <Plus size={14} /> 新建分组
            </button>
          )}
        </div>

        <div className="lp-foot">
          <span className="lp-count">已选 {links.length} 项</span>
          <button className="lp-done" onClick={onClose}>完成</button>
        </div>

        <ConfirmDialog
          open={pendingDelete !== null}
          message={pendingDelete ? `删除分组「${pendingDelete.name}」？组内条目一起删除，已关联的 DDL 保留名字。` : ''}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => { if (pendingDelete?.id != null) removeGroup(pendingDelete.id); setPendingDelete(null); }}
        />
      </div>
    </div>
  );
}
