import './ConfirmDialog.css';

interface Props {
  open: boolean;
  message: string;
  confirmText?: string;
  /** 只提示、不确认时省略 onConfirm（只显示「知道了」） */
  onConfirm?: () => void;
  onCancel: () => void;
}

/**
 * 应用内确认/提示框。
 * 不用 window.confirm / alert —— 安卓 WebView 没有原生 JS 对话框时，
 * 它们会静默失效（confirm 返回 false、alert 什么都不显示），看起来就是「点了没反应」。
 */
export default function ConfirmDialog({ open, message, confirmText = '删除', onConfirm, onCancel }: Props) {
  if (!open) return null;
  const infoOnly = !onConfirm;

  return (
    <div className="cd-mask" onClick={onCancel}>
      <div className="cd-box" onClick={e => e.stopPropagation()}>
        <p className="cd-msg">{message}</p>
        <div className="cd-acts">
          {infoOnly ? (
            <button className="cd-btn" onClick={onCancel}>知道了</button>
          ) : (
            <>
              <button className="cd-btn" onClick={onCancel}>取消</button>
              <button className="cd-btn cd-btn--danger" onClick={onConfirm}>{confirmText}</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
