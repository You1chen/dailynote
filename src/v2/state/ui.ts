import { createContext, useContext } from 'react';
import type { KnowledgeCard } from '../../types/knowledge';
import type { TimeBlock } from '../../types';

export interface ScheduleDraft {
  date: string;
  block?: TimeBlock;
  startTime?: string;
  endTime?: string;
  title?: string;
  content?: string;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  duration?: number;
}

export interface UiApi {
  openCamera: () => void;
  openTodo: () => void;
  openHelp: () => void;
  openSettings: () => void;
  openSchedule: (draft: ScheduleDraft) => void;
  openCardEditor: (card: KnowledgeCard, isNew?: boolean) => void;
  openCardDetail: (cardId: string) => void;
  toast: (message: string, options?: ToastOptions) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

export const UiContext = createContext<UiApi | null>(null);

export function useUi(): UiApi {
  const value = useContext(UiContext);
  if (!value) throw new Error('useUi must be used inside the v2 shell');
  return value;
}
