import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getAllCourses, getKnowledgeMap, getSemester } from '../../db';
import { getCards } from '../../db/knowledgeCards';
import type { Course, SemesterRecord } from '../../types';
import type { KnowledgeCard, KnowledgeMap } from '../../types/knowledge';

interface DataContextValue {
  cards: KnowledgeCard[];
  courses: Course[];
  semester?: SemesterRecord;
  knowledgeMaps: KnowledgeMap[];
  loadingCards: boolean;
  loadingCourses: boolean;
  reloadCards: () => Promise<void>;
  reloadCourses: () => Promise<void>;
  courseName: (id: number) => string;
  /** Course ids inherited from the legacy course knowledge tree, per card. */
  legacyCardCourses: Record<string, number[]>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [semester, setSemester] = useState<SemesterRecord | undefined>(undefined);
  const [knowledgeMaps, setKnowledgeMaps] = useState<KnowledgeMap[]>([]);
  const [loadingCards, setLoadingCards] = useState(true);
  const [loadingCourses, setLoadingCourses] = useState(true);

  const reloadCards = useCallback(async () => {
    try {
      const next = await getCards();
      setCards(next);
    } catch (error) {
      console.error('加载卡片失败:', error);
    } finally {
      setLoadingCards(false);
    }
  }, []);

  const reloadCourses = useCallback(async () => {
    try {
      const [nextCourses, nextSemester] = await Promise.all([getAllCourses(), getSemester()]);
      setCourses(nextCourses);
      setSemester(nextSemester);
      const maps = await Promise.all(
        nextCourses
          .filter(course => course.id)
          .map(course => getKnowledgeMap(course.id!).catch(() => undefined)),
      );
      setKnowledgeMaps(maps.filter((map): map is KnowledgeMap => !!map));
    } catch (error) {
      console.error('加载课程失败:', error);
    } finally {
      setLoadingCourses(false);
    }
  }, []);

  useEffect(() => {
    void reloadCards();
    void reloadCourses();
  }, [reloadCards, reloadCourses]);

  useEffect(() => {
    const onCards = () => { void reloadCards(); };
    const onCourses = () => { void reloadCourses(); };
    window.addEventListener('dailynote-cards-changed', onCards);
    window.addEventListener('dailynote-courses-changed', onCourses);
    return () => {
      window.removeEventListener('dailynote-cards-changed', onCards);
      window.removeEventListener('dailynote-courses-changed', onCourses);
    };
  }, [reloadCards, reloadCourses]);

  const courseNameMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const course of courses) if (course.id != null) map.set(course.id, course.name);
    return map;
  }, [courses]);

  const legacyCardCourses = useMemo(() => {
    const map: Record<string, Set<number>> = {};
    for (const knowledgeMap of knowledgeMaps) {
      for (const node of knowledgeMap.nodes) {
        for (const cardId of node.cardIds ?? []) {
          (map[cardId] ??= new Set()).add(knowledgeMap.courseId);
        }
      }
    }
    const out: Record<string, number[]> = {};
    for (const [cardId, ids] of Object.entries(map)) out[cardId] = [...ids];
    return out;
  }, [knowledgeMaps]);

  const courseName = useCallback((id: number) => courseNameMap.get(id) ?? '课程', [courseNameMap]);

  const value = useMemo<DataContextValue>(() => ({
    cards,
    courses,
    semester,
    knowledgeMaps,
    loadingCards,
    loadingCourses,
    reloadCards,
    reloadCourses,
    courseName,
    legacyCardCourses,
  }), [cards, courses, semester, knowledgeMaps, loadingCards, loadingCourses, reloadCards, reloadCourses, courseName, legacyCardCourses]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const value = useContext(DataContext);
  if (!value) throw new Error('useData must be used inside DataProvider');
  return value;
}

/** Merge explicit course ids with ids inherited from the old knowledge tree. */
export function effectiveCourseIds(card: KnowledgeCard, legacy: Record<string, number[]>): number[] {
  return [...new Set([...(card.courseIds ?? []), ...(legacy[card.id] ?? [])])];
}
