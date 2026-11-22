export type KnowledgeStatus = 'todo' | 'debt' | 'learned';

export interface KnowledgeComment {
  id: string;
  text: string;
  images: string[];
  createdAt: number;
  updatedAt: number;
}

export type KnowledgeCardContent =
  | { id: string; kind: 'text'; text: string; comments?: KnowledgeComment[]; createdAt: number; updatedAt: number }
  | { id: string; kind: 'image'; data: string; comments?: KnowledgeComment[]; createdAt: number; updatedAt: number }
  | { id: string; kind: 'audio'; data: string; mimeType: string; durationMs: number; fileName: string; comments?: KnowledgeComment[]; createdAt: number; updatedAt: number };

export interface KnowledgeCard {
  id: string;
  title: string;
  type?: string;
  status?: KnowledgeStatus;
  contents: KnowledgeCardContent[];
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeCardRecord {
  id: string;
  card: KnowledgeCard;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeCardLibrary {
  id: number;
  records: KnowledgeCardRecord[];
  audioExportPath: string;
  customTypes?: string[];
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
  cardIds: string[];
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
