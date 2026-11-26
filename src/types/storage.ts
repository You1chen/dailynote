import type { KnowledgeCardLibrary } from './knowledge';
import type { PreferencesPatch } from './preferences';
import type {
  DailyPlan, LongTermGoal, Reflection, Harvest, FixedRoutine, TaskItem,
  TaskTemplate, TrashItem, Course, SemesterRecord, DdlItem, ImportantItem,
  TaskBoard, LinkGroup,
} from './index';

/** 持久化领域数据；不依赖存储实现，供搜索、迁移和存储共同使用。 */
export interface StoreShape {
  dailyPlans: DailyPlan[];
  longTermGoals: LongTermGoal[];
  reflections: Reflection[];
  harvests: Harvest[];
  fixedRoutines: FixedRoutine[];
  taskItems: TaskItem[];
  taskTemplates: TaskTemplate[];
  trashItems: TrashItem[];
  courses: Course[];
  semester: SemesterRecord[];
  ddls: DdlItem[];
  important: ImportantItem[];
  taskBoard: TaskBoard[];
  linkGroups: LinkGroup[];
  knowledgeCards: KnowledgeCardLibrary[];
}

export interface StorageData extends StoreShape {
  version: 1;
  savedAt: number;
  /** Optional preferences embedded in legacy single-file saves. */
  preferences?: PreferencesPatch;
}

export type AnyStoreTable = keyof StoreShape;
