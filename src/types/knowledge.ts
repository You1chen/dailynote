export type KnowledgeStatus = 'todo' | 'debt' | 'learned';

export interface KnowledgeNoteBlock {
  id: string;
  text: string;
  checklist: boolean;
  checked?: boolean;
}

export interface KnowledgeNote {
  blocks: KnowledgeNoteBlock[];
  updatedAt: number;
}

export interface KnowledgeNode {
  id: string;
  parentId?: string;
  title: string;
  page?: string;
  depth: number;
  status: KnowledgeStatus;
  children: string[];
  note?: KnowledgeNote;
}

export interface KnowledgeMap {
  id?: number;
  courseId: number;
  courseName: string;
  sourceMarkdown: string;
  nodes: KnowledgeNode[];
  createdAt: number;
  updatedAt: number;
}
