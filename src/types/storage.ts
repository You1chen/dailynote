import type { ActivityEvent } from './settlement';
import type { GardenKeyEnvelope } from './garden';
import type {
  DailyPlan, LongTermGoal, Reflection, Harvest, FixedRoutine, TaskItem,
  TaskTemplate, TrashItem, Course, SemesterRecord, DdlItem, ImportantItem,
  BacklogItem, Idea, TaskBoard, LinkGroup,
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
  backlog: BacklogItem[];
  ideas: Idea[];
  taskBoard: TaskBoard[];
  linkGroups: LinkGroup[];
  activityEvents: ActivityEvent[];
  gardenKeys: GardenKeyEnvelope[];
}

export interface StorageData extends StoreShape {
  version: 1;
  savedAt: number;
}

export type AnyStoreTable = keyof StoreShape;
