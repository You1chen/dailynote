import { useEffect, useRef } from 'react';
import { X, Save } from 'lucide-react';
import './FullscreenEditor.css';

export interface FullscreenEditorProps {
  visible: boolean;
  editorTitle: string;         // 编辑器标题，如"编辑收获"
  titleValue: string;           // 内容标题
  bodyValue: string;            // 正文内容
  onTitleChange: (v: string) => void;
  onBodyChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  titlePlaceholder?: string;
  bodyPlaceholder?: string;
  /** 正文下方可插入额外内容（如标签提示、评分等） */
  extra?: React.ReactNode;
}

export default function FullscreenEditor({
  visible, editorTitle,
  titleValue, bodyValue,
  onTitleChange, onBodyChange,
  onSave, onCancel,
  titlePlaceholder = '标题（可选）',
  bodyPlaceholder = '写下内容...',
  extra,
}: FullscreenEditorProps) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (visible && bodyRef.current) {
      setTimeout(() => bodyRef.current?.focus(), 200);
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fs-overlay" onClick={onCancel}>
      <div className="fs-editor" onClick={e => e.stopPropagation()}>
        {/* 顶栏 */}
        <div className="fs-header">
          <button className="btn btn-ghost btn-icon" onClick={onCancel}>
            <X size={22} />
          </button>
          <span className="fs-header-title">{editorTitle}</span>
          <button className="btn btn-primary btn-sm" onClick={onSave}>
            <Save size={16} /> 保存
          </button>
        </div>

        {/* 标题 */}
        <input
          className="fs-title-input"
          value={titleValue}
          onChange={e => onTitleChange(e.target.value)}
          placeholder={titlePlaceholder}
        />

        {/* 正文 */}
        <textarea
          ref={bodyRef}
          className="fs-body-input"
          value={bodyValue}
          onChange={e => onBodyChange(e.target.value)}
          placeholder={bodyPlaceholder}
        />

        {/* 额外内容 */}
        {extra && <div className="fs-extra">{extra}</div>}
      </div>
    </div>
  );
}
