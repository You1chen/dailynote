import { useEffect } from 'react';
import { CalendarDays, Camera, Layers, ListTodo, Sparkles } from 'lucide-react';
import { useUi } from '../state/ui';

interface Props {
  open: boolean;
  onClose: () => void;
}

const POINTS = [
  { icon: CalendarDays, text: '长按时间轴再拖动，框出起止时间就建成一段日程。' },
  { icon: ListTodo, text: '待办收在顶部抽屉里，点一下完成，四秒内可撤销。' },
  { icon: Layers, text: '卡片页记录想法；关系网会先给出关联建议，你确认后才连线。' },
  { icon: Camera, text: '右下角相机球：拍照后存成日程或卡片；卡片可以只留图片。' },
];

export default function WelcomeSheet({ open, onClose }: Props) {
  const ui = useUi();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="v-welcome" role="dialog" aria-modal="true" aria-label="欢迎使用">
      <div className="v-welcome-card">
        <div className="v-welcome-mark"><Sparkles size={24} /></div>
        <h1>欢迎使用<br />DailyNote</h1>
        <p>两页就好：一页安排今天，一页收藏想法。试一次框选，剩下的自然会用。</p>
        <div className="v-welcome-points">
          {POINTS.map(({ icon: Icon, text }) => (
            <div className="v-welcome-point" key={text}>
              <span className="v-welcome-point-icon"><Icon size={16} /></span>
              <span>{text}</span>
            </div>
          ))}
        </div>
        <div className="v-welcome-actions">
          <button type="button" className="v-btn v-btn--primary v-btn--lg" onClick={onClose}>开始使用</button>
          <button
            type="button"
            className="v-btn v-btn--ghost"
            onClick={() => { onClose(); window.setTimeout(() => ui.openHelp(), 180); }}
          >
            使用说明
          </button>
        </div>
      </div>
    </div>
  );
}
