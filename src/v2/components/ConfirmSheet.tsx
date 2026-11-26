import Sheet from './Sheet';
import type { ConfirmOptions } from '../state/ui';

interface Props {
  open: boolean;
  options: ConfirmOptions | null;
  onResolve: (value: boolean) => void;
}

export default function ConfirmSheet({ open, options, onResolve }: Props) {
  return (
    <Sheet
      open={open}
      onClose={() => onResolve(false)}
      size="center"
      footer={(
        <>
          <button type="button" className="v-btn v-btn--ghost v-grow" onClick={() => onResolve(false)}>
            {options?.cancelLabel ?? '取消'}
          </button>
          <button
            type="button"
            className={`v-btn ${options?.danger ? 'v-btn--danger' : 'v-btn--primary'}`}
            onClick={() => onResolve(true)}
          >
            {options?.confirmLabel ?? '确定'}
          </button>
        </>
      )}
    >
      <div style={{ padding: '18px 6px 8px', textAlign: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 19, letterSpacing: '-0.02em' }}>{options?.title}</h2>
        {options?.message && (
          <p style={{ margin: '8px auto 0', maxWidth: 320, fontSize: 13, lineHeight: 1.6, color: 'var(--v-text-2)' }}>
            {options.message}
          </p>
        )}
      </div>
    </Sheet>
  );
}
