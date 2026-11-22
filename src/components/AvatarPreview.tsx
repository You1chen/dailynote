import { useLayoutEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { isAvatarImage } from '../utils/avatar';
import './AvatarPreview.css';

export default function AvatarPreview({ avatar, onClose }: { avatar: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const trigger = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus({ preventScroll: true });
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="avatar-preview"
      aria-label="头像预览"
      aria-modal="true"
      data-app-swipe="off"
      onCancel={event => { event.preventDefault(); onClose(); }}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}
    >
      <button className="avatar-preview-close" type="button" onClick={onClose} aria-label="关闭头像预览">
        <X size={24} aria-hidden="true" />
      </button>
      {isAvatarImage(avatar)
        ? <img className="avatar-preview-image" src={avatar} alt="头像" />
        : <span className="avatar-preview-emoji" role="img" aria-label={`头像 ${avatar}`}>{avatar}</span>}
    </dialog>
  );
}
