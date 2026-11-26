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
  /** 自定义标签；共享标签在关系网中形成确认连线 */
  tags?: string[];
  /** 手动设置的关键词；共享关键词形成确认连线，也可从节点长按菜单设置 */
  keywords?: string[];
  /** 直接关联的课程 id（不再依赖知识树） */
  courseIds?: number[];
  /** 已确认关联的卡片 id（手动挑选或接受系统建议），关系网中的实线边 */
  links?: string[];
  /** 被拒绝的关联建议（负反馈），避免同一条建议反复出现 */
  ignoredLinks?: string[];
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
