/** Actual interactions, including those recoverable from reliable timestamps. */
export type ActivityCategory = 'todo' | 'ddl' | 'plan' | 'goal' | 'wish-milestone' | 'small-wish' | 'chore' | 'idea';
export type ActivityAction = 'create' | 'complete' | 'delete' | 'shelve' | 'progress';
export interface ActivityEvent {
  /** Legacy secret-garden event labels are migrated to authenticated ciphertext. */
  encrypted?: import('./garden').GardenCipher;
  id: string;
  date: string;
  occurredAt: number;
  category: ActivityCategory;
  action: ActivityAction;
  entityId: string;
  title: string;
  /** Progress and boolean transitions use 0..1; creation/deletion uses null. */
  from: number | null;
  to: number | null;
  parentId?: string;
  parentTitle?: string;
}
export interface SettlementProgress {
  entityId: string;
  title: string;
  from: number;
  to: number;
  delta: number;
  parentId?: string;
  parentTitle?: string;
}
export interface SettlementSummary {
  date: string;
  recordedSince: string | null;
  events: ActivityEvent[];
  todo: { created: number; completed: number; deleted: number; shelved: number };
  ddlCompleted: number;
  plans: SettlementProgress[];
  goals: SettlementProgress[];
  wishMilestones: SettlementProgress[];
  smallWishesCompleted: number;
  choresCompleted: number;
  ideasCreated: number;
}
export interface ActivityOptions {
  activityIntent?: 'complete-idea';
  skipActivity?: boolean;
}
