import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Check, X, ListTodo, ChevronDown, ChevronUp, ClipboardList, Trash2 } from 'lucide-react';
import DayNavigator from '../components/DayNavigator';
import { useTaskList } from '../hooks/useTaskList';
import { useTaskTemplates } from '../hooks/useTaskTemplates';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { todayStr, genId } from '../types';
import type { TaskTemplate } from '../types';
import './TaskListPage.css';

export default function TaskListPage() {
  const navigate = useNavigate();
  const [date, setDate] = useState(todayStr());
  const { items, loading, addItem, toggleItem, removeItem } = useTaskList(date);
  const [newTitle, setNewTitle] = useState('');
  const [expanded, setExpanded] = useState(true);

  // ---- 任务清单模板管理 ----
  const { templates, addTemplate, updateTemplate, removeTemplate, reload } = useTaskTemplates();
  const [showTemplates, setShowTemplates] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  // 未提交的编辑草稿（避免每次按键都触发文件写）：模板名 / 条目文本
  const [nameDrafts, setNameDrafts] = useState<Record<number, string>>({});
  const [itemDrafts, setItemDrafts] = useState<Record<number, Record<string, string>>>({});

  useRegisterBackHandler(() => {
    if (showTemplates) { setShowTemplates(false); return true; }
    navigate(-1);
    return true;
  }, [showTemplates]);

  const handleAdd = useCallback(() => {
    if (newTitle.trim()) {
      addItem(newTitle);
      setNewTitle('');
    }
  }, [newTitle, addItem]);

  // ---- 模板面板操作 ----
  const handleOpenTemplates = () => {
    reload();
    setShowTemplates(true);
  };

  const handleCreateTemplate = async () => {
    const name = newTemplateName.trim();
    if (!name) return;
    const id = await addTemplate(name);
    setNewTemplateName('');
    setExpandedId(id); // 创建后自动展开编辑
  };

  const handleDeleteTemplate = (id: number) => {
    const t = templates.find(x => x.id === id);
    if (!confirm(`确定删除模板「${t?.name || ''}」吗？`)) return;
    removeTemplate(id);
    if (expandedId === id) setExpandedId(null);
  };

  const handleCommitName = (id: number) => {
    const t = templates.find(x => x.id === id);
    const draft = nameDrafts[id];
    if (draft !== undefined && t) {
      const trimmed = draft.trim();
      if (trimmed && trimmed !== t.name) updateTemplate(id, { name: trimmed });
    }
    setNameDrafts(prev => { const c = { ...prev }; delete c[id]; return c; });
  };

  const handleAddItem = (id: number) => {
    const t = templates.find(x => x.id === id);
    if (!t) return;
    const newItem = { id: genId(), text: '', done: false };
    updateTemplate(id, { items: [...t.items, newItem] });
  };

  const handleToggleItem = (id: number, itemId: string) => {
    const t = templates.find(x => x.id === id);
    if (!t) return;
    const items = t.items.map(it => it.id === itemId ? { ...it, done: !it.done } : it);
    updateTemplate(id, { items });
  };

  const handleRemoveItem = (id: number, itemId: string) => {
    const t = templates.find(x => x.id === id);
    if (!t) return;
    updateTemplate(id, { items: t.items.filter(it => it.id !== itemId) });
  };

  const handleCommitItemText = (id: number, itemId: string) => {
    const t = templates.find(x => x.id === id);
    const draft = itemDrafts[id]?.[itemId];
    if (draft !== undefined && t) {
      updateTemplate(id, { items: t.items.map(it => it.id === itemId ? { ...it, text: draft.trim() } : it) });
    }
    setItemDrafts(prev => {
      const m = { ...(prev[id] || {}) };
      delete m[itemId];
      return { ...prev, [id]: m };
    });
  };

  const pending = items.filter(t => !t.completed);
  const done = items.filter(t => t.completed);

  return (
    <div className="app-container">
      <div className="page-header">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate(-1)}>
          <ArrowLeft size={22} />
        </button>
        <h1 className="page-title">任务清单</h1>
        <button className="btn btn-ghost btn-icon" title="任务清单模板" onClick={handleOpenTemplates}>
          <ClipboardList size={20} />
        </button>
      </div>

      <DayNavigator date={date} onDateChange={setDate} />

      {/* 添加区域 */}
      <div className="taskpage-add-row">
        <input
          className="input"
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && newTitle.trim()) {
              handleAdd();
            }
          }}
          placeholder="添加新任务..."
        />
        <button
          className="btn btn-primary"
          onClick={handleAdd}
          disabled={!newTitle.trim()}
        >
          <Plus size={18} /> 添加
        </button>
      </div>

      {loading ? (
        <div className="empty-state"><p>加载中...</p></div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <ListTodo size={36} className="icon" />
          <p>暂无任务</p>
          <span style={{ fontSize: 'var(--font-xs)', color: 'var(--color-text-muted)' }}>
            在上方输入框添加今天的待办事项
          </span>
        </div>
      ) : (
        <>
          {/* 待完成 */}
          {pending.length > 0 && (
            <div className="taskpage-group">
              <div className="taskpage-group-header">
                <span className="taskpage-group-title">待完成</span>
                <span className="taskpage-group-count">{pending.length}</span>
              </div>
              <div className="taskpage-items">
                {pending.map(item => (
                  <div key={item.id} className="taskpage-item">
                    <button
                      className="taskpage-check"
                      onClick={() => toggleItem(item.id)}
                      title="标记完成"
                    />
                    <span className="taskpage-item-text">{item.title}</span>
                    <button
                      className="taskpage-delete"
                      onClick={() => removeItem(item.id)}
                      title="删除"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 已完成 */}
          {done.length > 0 && (
            <div className="taskpage-group">
              <div
                className="taskpage-group-header taskpage-group-header--done"
                onClick={() => setExpanded(!expanded)}
              >
                <span className="taskpage-group-title">已完成</span>
                <span className="taskpage-group-count">{done.length}</span>
                <span style={{ marginLeft: 'auto' }}>
                  {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </span>
              </div>
              {expanded && (
                <div className="taskpage-items">
                  {done.map(item => (
                    <div key={item.id} className="taskpage-item taskpage-item--done">
                      <button
                        className="taskpage-check taskpage-check--done"
                        onClick={() => toggleItem(item.id)}
                        title="标记未完成"
                      >
                        <Check size={13} strokeWidth={3} />
                      </button>
                      <span className="taskpage-item-text taskpage-item-text--done">
                        {item.title}
                      </span>
                      <button
                        className="taskpage-delete"
                        onClick={() => removeItem(item.id)}
                        title="删除"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* 任务清单模板管理面板 */}
      {showTemplates && (
        <div className="modal-overlay" onClick={() => setShowTemplates(false)}>
          <div className="modal tpl-modal" onClick={e => e.stopPropagation()}>
            <div className="tpl-header">
              <h3 className="tpl-title">🧩 任务清单模板</h3>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowTemplates(false)}>
                <X size={18} />
              </button>
            </div>
            <p className="tpl-hint">模板是一份可勾选的清单，编辑即时任务时可一键套用</p>

            {/* 新建 */}
            <div className="tpl-create">
              <input
                className="input"
                value={newTemplateName}
                onChange={e => setNewTemplateName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleCreateTemplate(); }}
                placeholder="新模板名称，例如：早起清单"
              />
              <button
                className="btn btn-primary btn-sm"
                onClick={handleCreateTemplate}
                disabled={!newTemplateName.trim()}
              >
                <Plus size={14} /> 创建
              </button>
            </div>

            {/* 模板列表 */}
            {templates.length === 0 ? (
              <div className="tpl-empty">还没有模板，先创建一个吧</div>
            ) : (
              templates.map(t => {
                const id = t.id!;
                const isExpanded = expandedId === id;
                const shownName = nameDrafts[id] ?? t.name;
                return (
                  <div key={id} className="tpl-card">
                    <div className="tpl-card-header">
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => setExpandedId(isExpanded ? null : id)}
                        title={isExpanded ? '收起' : '展开'}
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                      <input
                        className="input input-sm tpl-name-input"
                        value={shownName}
                        onChange={e => setNameDrafts(prev => ({ ...prev, [id]: e.target.value }))}
                        onBlur={() => handleCommitName(id)}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        placeholder="模板名称"
                      />
                      <span className="tpl-count">{t.items.length} 项</span>
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => handleDeleteTemplate(id)}
                        title="删除模板"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>

                    {isExpanded && (
                      <div className="tpl-items">
                        {t.items.map(item => (
                          <div key={item.id} className="tpl-item">
                            <button
                              className={`tpl-item-check ${item.done ? 'tpl-item-check--done' : ''}`}
                              onClick={() => handleToggleItem(id, item.id)}
                              title={item.done ? '标记未完成' : '标记完成'}
                            >
                              {item.done && <Check size={12} strokeWidth={3} />}
                            </button>
                            <input
                              className="input input-sm"
                              value={itemDrafts[id]?.[item.id] ?? item.text}
                              onChange={e => setItemDrafts(prev => ({
                                ...prev,
                                [id]: { ...(prev[id] || {}), [item.id]: e.target.value },
                              }))}
                              onBlur={() => handleCommitItemText(id, item.id)}
                              onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                              placeholder="子任务内容..."
                            />
                            <button
                              className="btn btn-ghost btn-icon btn-sm"
                              onClick={() => handleRemoveItem(id, item.id)}
                              title="删除此项"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        ))}
                        <button className="tpl-item-add" onClick={() => handleAddItem(id)}>
                          <Plus size={14} /> 添加子任务
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
