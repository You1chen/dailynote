import { Trash2, RotateCcw, AlertTriangle } from 'lucide-react';
import { useTrash } from '../hooks/useTrash';
import './Trash.css';

const TABLE_LABELS: Record<string, string> = {
  longTermGoals: '长期目标',
  reflections: '反思',
  harvests: '收获',
  fixedRoutines: '作息模板',
  taskTemplates: '任务清单模板',
  timeBlocks: '时间块',
};

export default function TrashPage() {
  const { items, loading, restore, permDelete, clearAll } = useTrash();

  if (loading) {
    return (
      <div className="app-container">
        <div className="page-header"><h1 className="page-title">回收站</h1></div>
        <div className="empty-state"><p>加载中...</p></div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="page-header">
        <h1 className="page-title">回收站</h1>
        {items.length > 0 && (
          <button className="btn btn-danger btn-sm" onClick={() => {
            if (confirm('确定要清空回收站吗？此操作不可撤销。')) clearAll();
          }}>
            <AlertTriangle size={14} /> 清空回收站
          </button>
        )}
      </div>

      <p className="trash-hint">
        已删除的内容会保留 30 天，之后自动清理。
      </p>

      {items.length === 0 ? (
        <div className="empty-state">
          <Trash2 size={48} className="icon" />
          <p>回收站为空</p>
        </div>
      ) : (
        <div className="trash-list">
          {items.map(item => {
            const gid = item.id!;
            const label = TABLE_LABELS[item.originalTable] || item.originalTable;
            const daysLeft = Math.max(
              0,
              30 - Math.floor((Date.now() - item.deletedAt) / (1000 * 60 * 60 * 24))
            );

            return (
              <div key={gid} className="trash-item animate-in">
                <div className="trash-item-info">
                  <span className="trash-item-type">{label}</span>
                  <span className="trash-item-title">{item.title}</span>
                  <span className="trash-item-meta">
                    删除于 {new Date(item.deletedAt).toLocaleDateString('zh-CN')}
                    {' · '}
                    {daysLeft > 0 ? `剩余 ${daysLeft} 天` : '即将清理'}
                  </span>
                </div>
                <div className="trash-item-actions">
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={async () => {
                      const ok = await restore(gid);
                      if (!ok) alert('还原失败，可能原始数据已不存在。');
                    }}
                  >
                    <RotateCcw size={14} /> 还原
                  </button>
                  <button
                    className="btn btn-ghost btn-sm btn-danger"
                    onClick={() => permDelete(gid)}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
