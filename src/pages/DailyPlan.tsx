import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Plus, X, Save, Trash2, CheckCircle2, Settings, Maximize2, ClipboardList, CalendarDays, SkipForward } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import DayNavigator from '../components/DayNavigator';
import FullscreenSchedule from '../components/FullscreenSchedule';
import PreferencePanel from '../components/PreferencePanel';
import ConfirmDialog from '../components/ConfirmDialog';
import { useDailyPlan } from '../hooks/useDailyPlan';
import { usePreferences } from '../hooks/usePreferences';
import { getAllRoutines, getAllTaskTemplates, savePlan, getAllCourses, getSemester, getAllPlans } from '../db';
import { todayStr, genId, appendTemplateItems } from '../types';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { timeToMinutes, minutesToTime, isInSleepPeriod, sleepLabel, gridClickY, blockRenderRect, futureFoldStart, futureWindow } from '../utils/time';
import type { FutureWindowGeometry } from '../utils/time';
import { computeDayCourses, weekIndex } from '../utils/courseSchedule';
import type { TimeBlock, TaskTemplate, Course, SemesterRecord } from '../types';
import './DailyPlan.css';

/** 星期几 → 中文（0=周日，与课程表约定一致） */
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WEEK_TYPE_LABELS: Record<Course['weekType'], string> = {
  all: '每周',
  odd: '单周',
  even: '双周',
};

/** 清单型即时任务的占位时长（分钟）：不知道何时结束前先占位，保证时间表可见 */
const CHECKLIST_PLACEHOLDER_MIN = 10;

/** 是否为清单型即时任务（有子任务清单 = 轻量任务：不验收、不评分） */
function isChecklistTask(b: TimeBlock): boolean {
  return Array.isArray(b.checklist) && b.checklist.length > 0;
}

/** 清单子任务是否全部勾选完毕 */
function allChecklistDone(b: TimeBlock): boolean {
  return isChecklistTask(b) && b.checklist!.every(i => i.done);
}

/** Date → "HH:mm"（不取整，反映真实完成时刻） */
function formatHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "YYYY-MM-DD" → 本地 Date */
function dateObj(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`);
}

/** 日期平移 n 天，返回 "YYYY-MM-DD" */
function shiftDate(dateStr: string, n: number): string {
  const d = dateObj(dateStr);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 该日期所在周（周一→周日）7 个日期 */
function weekOf(dateStr: string): string[] {
  const dow = dateObj(dateStr).getDay(); // 0=周日
  const monday = shiftDate(dateStr, -((dow === 0 ? 7 : dow) - 1));
  return Array.from({ length: 7 }, (_, i) => shiftDate(monday, i));
}

/** 只看未来：只留折叠起点之后的小时标签 */
function futureHourLabels(g: FutureWindowGeometry): { hour: number; top: number }[] {
  const labels: { hour: number; top: number }[] = [];
  for (let h = 0; h < 24; h++) {
    const top = g.minuteToTop(h * 60);
    if (top >= 0) labels.push({ hour: h, top });
  }
  return labels;
}

export default function DailyPlanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [date, setDate] = useState(searchParams.get('date') || todayStr());

  // 从搜索跳进来时切到对应日期
  useEffect(() => {
    const d = searchParams.get('date');
    if (d) setDate(d);
  }, [searchParams]);
  const { plan, loading, addFullBlock, updateBlock, removeBlock, reload } = useDailyPlan(date);
  const { prefs, updatePrefs, resetPrefs } = usePreferences();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [nowMinutes, setNowMinutes] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  // UI 状态
  const [editingBlock, setEditingBlock] = useState<TimeBlock | null>(null);
  const [showPrefs, setShowPrefs] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [newStartTime, setNewStartTime] = useState('08:00');
  const [timeMode, setTimeMode] = useState<'range' | 'duration'>('range');
  const [durationMinutes, setDurationMinutes] = useState(prefs.defaultDuration);
  const [planningMode, setPlanningMode] = useState<'pre' | 'instant'>('pre');
  const [instantStyle, setInstantStyle] = useState<'block' | 'list'>('block');
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [templateList, setTemplateList] = useState<TaskTemplate[]>([]);
  const [acceptingBlock, setAcceptingBlock] = useState<TimeBlock | null>(null);
  // 课程表（只读展示：渲染时按日期实时计算，不写入当天计划）
  const [courses, setCourses] = useState<Course[]>([]);
  const [semester, setSemester] = useState<SemesterRecord | undefined>(undefined);
  const [viewingCourse, setViewingCourse] = useState<Course | null>(null);
  const checklistDoneAtRef = useRef(0);
  /** 即时任务开始时间是否被手动微调过（微调后冻结，不再随每30秒刷新） */
  const manualStartRef = useRef(false);

  // 获取当前时间（取整到5分钟；23:55 封顶，避免 23:58 进位成 00:00 跨日）
  function getNowRounded(): string {
    const d = new Date();
    const totalMin = d.getHours() * 60 + d.getMinutes();
    const rounded = Math.min(1435, Math.round(totalMin / 5) * 5);
    const hh = Math.floor(rounded / 60) % 24;
    const mm = rounded % 60;
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  // 即时模式下实时更新开始时间；清单模式同时保持 endTime = now + 占位时长
  useEffect(() => {
    if (planningMode === 'instant' && editingBlock) {
      const timer = setInterval(() => {
        setEditingBlock(prev => {
          if (!prev) return null;
          // 开始时间已手动微调：冻结，不再随时间更新
          if (manualStartRef.current) return prev;
          const now = getNowRounded();
          return {
            ...prev,
            startTime: now,
            endTime: instantStyle === 'list' && !allChecklistDone(prev)
              ? computeEndTime(now, CHECKLIST_PLACEHOLDER_MIN)
              : prev.endTime,
          };
        });
      }, 30000); // 每30秒更新
      return () => clearInterval(timer);
    }
  }, [planningMode, instantStyle, editingBlock?.id]);

  // 清单型即时任务占位：未全部勾选时强制 endTime = startTime + 10min，保证时间表可见
  useEffect(() => {
    if (editingBlock && planningMode === 'instant' && instantStyle === 'list' && !allChecklistDone(editingBlock)) {
      setEditingBlock(prev => prev ? { ...prev, endTime: computeEndTime(prev.startTime, CHECKLIST_PLACEHOLDER_MIN) } : null);
    }
  }, [planningMode, instantStyle, editingBlock?.id]);

  // 每次打开新的时间块时清空上次的完成时刻记录与手动微调标记
  useEffect(() => { checklistDoneAtRef.current = 0; manualStartRef.current = false; }, [editingBlock?.id]);

  // 加载课程表与学期设置（每次进入本页重新加载，课程表页修改后返回自动生效）
  useEffect(() => {
    Promise.all([getAllCourses(), getSemester()]).then(([cs, sem]) => {
      setCourses(cs);
      setSemester(sem);
    });
  }, []);

  // 动态偏好值
  const HOUR_HEIGHT = prefs.hourHeight;
  const hideSleep = prefs.hideSleepHours;
  const sleepMinStart = timeToMinutes(prefs.sleepStart);
  const sleepMinEnd = timeToMinutes(prefs.sleepEnd);
  const sleepCrosses = sleepMinEnd < sleepMinStart;
  const sleepDurationMin = sleepCrosses
    ? (1440 - sleepMinStart) + sleepMinEnd
    : sleepMinEnd - sleepMinStart;
  const visibleHours = hideSleep ? 24 - Math.round(sleepDurationMin / 60) : 24;
  const SLEEP_BAR_H = hideSleep ? 28 : 0;
  const GRID_HEIGHT = visibleHours * HOUR_HEIGHT + SLEEP_BAR_H;

  // ---- 只看未来（仅今天）：折叠当前小时之前的时段 ----
  const isToday = date === todayStr();
  const FUTURE_BAR_H = 24;
  const futureStart = isToday && prefs.futureOnly ? futureFoldStart(nowMinutes) : 0;
  const futureGeo = futureStart > 0 ? futureWindow(futureStart, HOUR_HEIGHT, FUTURE_BAR_H) : null;
  const gridHeight = futureGeo ? futureGeo.gridHeight : GRID_HEIGHT;

  // 根据时长模式计算 endTime
  const computeEndTime = (start: string, dur: number): string => {
    const mins = timeToMinutes(start) + dur;
    const hh = Math.floor(mins / 60) % 24;
    const mm = Math.floor(mins % 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  };

  // 返回键处理
  useRegisterBackHandler(() => {
    if (fullscreen) { setFullscreen(false); return true; }
    if (showPrefs) { setShowPrefs(false); return true; }
    if (acceptingBlock) { setAcceptingBlock(null); return true; }
    if (editingBlock) { setEditingBlock(null); return true; }
    if (viewingCourse) { setViewingCourse(null); return true; }
    return false;
  }, [editingBlock, acceptingBlock, fullscreen, showPrefs, viewingCourse]);

  // 当前时间每分钟更新
  useEffect(() => {
    const timer = setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 60000);
    return () => clearInterval(timer);
  }, []);

  // 自动滚动到当前时间（整页滚动，不是内层容器）；只看未来时回到页面顶部，让折叠条露出来
  useEffect(() => {
    const el = scrollRef.current;
    if (loading || !el || fullscreen) return;
    if (futureGeo) {
      window.scrollTo({ top: 0, behavior: 'auto' });
      return;
    }
    const offset = Math.max(0, minutesToTop(nowMinutes) - 200);
    const top = el.getBoundingClientRect().top + window.scrollY + offset;
    window.scrollTo({ top, behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, date, prefs.futureOnly]);

  // --- 将实际分钟映射到网格 top 位置 ---
  function minutesToTop(minutes: number): number {
    if (!hideSleep) return (minutes / 60) * HOUR_HEIGHT;

    const s = timeToMinutes(prefs.sleepStart);
    const e = timeToMinutes(prefs.sleepEnd);

    if (sleepCrosses) {
      if (minutes >= e && minutes < s) {
        return ((minutes - e) / 60) * HOUR_HEIGHT + SLEEP_BAR_H;
      }
      return -1;
    } else {
      if (minutes < s) return (minutes / 60) * HOUR_HEIGHT + SLEEP_BAR_H;
      if (minutes >= e) return ((minutes - (e - s)) / 60) * HOUR_HEIGHT + SLEEP_BAR_H;
      return -1;
    }
  }

  // --- 生成可见小时标签 ---
  function getVisibleHourLabels(): { hour: number; top: number }[] {
    const labels: { hour: number; top: number }[] = [];
    if (!hideSleep) {
      for (let h = 0; h < 24; h++) labels.push({ hour: h, top: h * HOUR_HEIGHT });
    } else if (sleepCrosses) {
      let h = Math.floor(sleepMinEnd / 60);
      let v = 0;
      while (h !== Math.floor(sleepMinStart / 60) || v === 0) {
        labels.push({ hour: h, top: SLEEP_BAR_H + v * HOUR_HEIGHT });
        h = (h + 1) % 24;
        v++;
      }
    } else {
      for (let h = 0; h < 24; h++) {
        if (h >= sleepMinStart / 60 && h < sleepMinEnd / 60) continue;
        const adjustedH = h >= sleepMinEnd / 60 ? h - Math.round(sleepDurationMin / 60) : h;
        labels.push({ hour: h, top: SLEEP_BAR_H + adjustedH * HOUR_HEIGHT });
      }
    }
    return labels;
  }

  // --- 在指定分钟处新建任务块（点空白 / FAB / 只看未来 共用） ---
  const startNewBlockAt = useCallback((minutes: number) => {
    const actualMinutes = Math.max(0, Math.min(1430, Math.round(minutes / 5) * 5));
    const startTime = minutesToTime(actualMinutes);
    const endTime = minutesToTime(Math.min(1440, actualMinutes + prefs.defaultDuration) % 1440);

    setNewStartTime(startTime);
    manualStartRef.current = false;
    setEditingBlock({
      id: '',
      startTime,
      endTime,
      taskTitle: '',
      plannedContent: '',
      checklist: [],
      actualExecution: '',
      focusScore: 0,
      efficiencyScore: 0,
      completed: false,
      notes: '',
    });
    setShowNewMenu(false);
  }, [prefs.defaultDuration]);

  // --- 网格点击处理 ---
  const handleGridClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.time-block')) return;
    if ((e.target as HTMLElement).closest('.course-block')) return;
    if ((e.target as HTMLElement).closest('.sleep-bar')) return;
    if ((e.target as HTMLElement).closest('.future-bar')) return;

    // 滚动容器（.time-grid-container）的 rect.top 不随内部滚动变化；
    // 若取 e.currentTarget（.time-grid）的 rect.top，会随滚动偏移，再加 scrollTop 会双重补偿
    const rect = scrollRef.current?.getBoundingClientRect();
    if (!rect) return;
    const y = gridClickY(e.clientY, rect.top, scrollRef.current?.scrollTop ?? 0);

    // 只看未来：折叠条以上无效，其余按折叠窗口直接反映射
    if (futureGeo) {
      if (y < FUTURE_BAR_H) return;
      startNewBlockAt(futureGeo.topToMinutes(y));
      return;
    }

    // 精确逆映射：minutesToTop 的反函数
    let actualMinutes: number;
    if (hideSleep && sleepCrosses) {
      const adjustedY = y - SLEEP_BAR_H;
      if (adjustedY < 0) return;
      actualMinutes = (adjustedY * 60) / HOUR_HEIGHT + sleepMinEnd;
      if (actualMinutes >= 1440) actualMinutes -= 1440;
      if (actualMinutes >= sleepMinStart) actualMinutes = sleepMinStart - 5;
    } else if (hideSleep) {
      // 不跨夜但隐藏睡眠（罕见情况）
      const adjustedY = y - SLEEP_BAR_H;
      if (adjustedY < 0) return;
      actualMinutes = (adjustedY * 60) / HOUR_HEIGHT;
      // 压缩空间中 >= sleepMinStart 意味着已越过睡眠间隙，需补回 sleepDurationMin
      if (actualMinutes >= sleepMinStart) actualMinutes += sleepDurationMin;
    } else {
      actualMinutes = (y * 60) / HOUR_HEIGHT;
    }
    startNewBlockAt(actualMinutes);
  }, [hideSleep, HOUR_HEIGHT, SLEEP_BAR_H, sleepCrosses, sleepMinEnd, sleepMinStart, sleepDurationMin, futureGeo, startNewBlockAt]);

  // --- 全屏模式下的网格点击回调（不再退出全屏） ---
  const handleFullscreenGridClick = useCallback((startTime: string) => {
    const endMin = Math.min(1440, timeToMinutes(startTime) + prefs.defaultDuration);
    const hh = Math.floor(endMin / 60) % 24;
    const mm = endMin % 60;
    const endTime = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

    manualStartRef.current = false;
    setEditingBlock({
      id: '',
      startTime,
      endTime,
      taskTitle: '',
      plannedContent: '',
      checklist: [],
      actualExecution: '',
      focusScore: 0,
      efficiencyScore: 0,
      completed: false,
      notes: '',
    });
    // 保持全屏打开，不退出
  }, [prefs.defaultDuration]);

  // --- 新建/编辑保存（保存前钳制数值范围） ---
  const handleSaveBlock = async () => {
    if (!editingBlock) return;
    const safe = {
      ...editingBlock,
      focusScore: Math.min(10, Math.max(0, editingBlock.focusScore ?? 0)),
      efficiencyScore: Math.min(10, Math.max(0, editingBlock.efficiencyScore ?? 0)),
    };
    // 清单型即时任务：全部子任务勾完 = 完成（结束时间 = 最后勾选时刻）；未勾完 = 占位 10 分钟、不算完成
    if (isChecklistTask(safe)) {
      if (allChecklistDone(safe)) {
        safe.completed = true;
        if (checklistDoneAtRef.current > 0) {
          safe.endTime = formatHM(new Date(checklistDoneAtRef.current));
        } else if (!safe.completed) {
          // 兜底：已是全部勾选但本次编辑无完成记录（少见），用当前时刻
          safe.endTime = formatHM(new Date());
        }
      } else {
        safe.completed = false;
        safe.endTime = computeEndTime(safe.startTime, CHECKLIST_PLACEHOLDER_MIN);
      }
    }
    if (safe.id) {
      await updateBlock(safe.id, safe);
    } else {
      const newBlock: TimeBlock = { ...safe, id: genId() };
      await addFullBlock(newBlock);
    }
    setEditingBlock(null);
  };

  const handleDeleteBlock = async () => {
    if (!editingBlock || !editingBlock.id) return;
    await removeBlock(editingBlock.id);
    setEditingBlock(null);
  };

  // --- 验收：独立弹窗，仅对已存在的时间块开放；保存后视为任务完成 ---
  const openAcceptance = () => {
    if (!editingBlock || !editingBlock.id) return;
    setAcceptingBlock({ ...editingBlock, checklist: editingBlock.checklist || [] });
  };

  const handleAcceptBlock = async () => {
    if (!acceptingBlock || !acceptingBlock.id) return;
    const safe = {
      ...acceptingBlock,
      focusScore: Math.min(10, Math.max(0, acceptingBlock.focusScore ?? 0)),
      efficiencyScore: Math.min(10, Math.max(0, acceptingBlock.efficiencyScore ?? 0)),
      completed: true,
    };
    await updateBlock(safe.id, safe);
    setAcceptingBlock(null);
    setEditingBlock(null);
  };

  const handleUnacceptBlock = async () => {
    if (!acceptingBlock || !acceptingBlock.id) return;
    await updateBlock(acceptingBlock.id, { completed: false });
    setAcceptingBlock(null);
    setEditingBlock(null);
  };

  // 从模板导入
  const handleImportRoutine = async () => {
    const routines = await getAllRoutines();
    if (routines.length === 0) {
      setNotice('请先在「目标」页创建作息模板');
      return;
    }
    if (!plan) return;
    const importedBlocks: TimeBlock[] = routines[0].timeBlocks.map(rb => ({
      id: genId(),
      startTime: rb.startTime,
      endTime: rb.endTime,
      taskTitle: rb.taskTitle,
      plannedContent: rb.plannedContent,
      actualExecution: '',
      focusScore: 0,
      efficiencyScore: 0,
      completed: false,
      notes: '',
    }));
    const allBlocks = [...plan.timeBlocks, ...importedBlocks];
    await savePlan({ ...plan, timeBlocks: allBlocks, updatedAt: Date.now() });
    reload();
  };

  // 套用任务清单模板（追加到当前清单）
  const handleOpenTemplatePicker = async () => {
    const list = await getAllTaskTemplates();
    if (list.length === 0) {
      setNotice('任务清单模板请在任务悬浮球里创建');
      return;
    }
    setTemplateList(list);
    setShowTemplatePicker(true);
  };

  const handleApplyTemplate = (t: TaskTemplate) => {
    setEditingBlock(prev => prev
      ? { ...prev, checklist: appendTemplateItems(prev.checklist || [], t.items) }
      : prev);
    setShowTemplatePicker(false);
  };

  const blocks = plan?.timeBlocks ?? [];
  // 当天课程（按课表+学期实时计算：星期/周次/单双周/节假日全部过滤完毕，按开始时间排序）
  const courseBlocks = useMemo(
    () => computeDayCourses(courses, semester, date),
    [courses, semester, date],
  );
  // 月历面板（默认收起，点顶部日期展开）
  const [calOpen, setCalOpen] = useState(false);
  // 哪些日期有计划（周条上的小圆点）
  const [planDates, setPlanDates] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    getAllPlans()
      .then(plans => {
        if (!alive) return;
        setPlanDates(new Set(plans.filter(p => p.timeBlocks.length > 0).map(p => p.date)));
      })
      .catch(() => { /* 圆点失败不影响主流程 */ });
    return () => { alive = false; };
  }, [plan]);

  const weekDates = weekOf(date);
  // 从周视图跳过来：用同一套面板新建/编辑（参数用掉后清掉，避免刷新重复弹）
  useEffect(() => {
    if (loading) return;
    const newAt = searchParams.get('new');
    const blockId = searchParams.get('block');
    if (!newAt && !blockId) return;

    if (blockId) {
      const b = plan?.timeBlocks.find(x => x.id === blockId);
      if (b) setEditingBlock({ ...b });
    } else if (newAt && /^\d{2}:\d{2}$/.test(newAt)) {
      setNewStartTime(newAt);
      manualStartRef.current = true;
      setEditingBlock({
        id: '',
        startTime: newAt,
        endTime: computeEndTime(newAt, prefs.defaultDuration),
        taskTitle: '',
        plannedContent: '',
        checklist: [],
        actualExecution: '',
        focusScore: 0,
        efficiencyScore: 0,
        completed: false,
        notes: '',
      });
    }
    navigate(`/?date=${date}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, plan, searchParams]);
  /** 新建时间块（FAB / 空档点击共用） */
  const openNewBlock = useCallback(() => {
    const isInstant = planningMode === 'instant';
    const start = isInstant ? getNowRounded() : '08:00';
    const end = isInstant ? computeEndTime(start, prefs.defaultDuration) : '09:00';
    setNewStartTime(start);
    manualStartRef.current = false;
    setEditingBlock({
      id: '',
      startTime: start,
      endTime: end,
      taskTitle: '',
      plannedContent: '',
      checklist: [],
      actualExecution: '',
      focusScore: 0,
      efficiencyScore: 0,
      completed: false,
      notes: '',
    });
  }, [planningMode, prefs.defaultDuration]);

  /** 顶部概览：块数 / 已验收 / 专注均值（只算已评分的块） */
  const summary = useMemo(() => {
    const blocks = plan?.timeBlocks ?? [];
    const done = blocks.filter(b => b.completed).length;
    const scored = blocks.filter(b => b.focusScore > 0);
    const avg = scored.length
      ? Math.round((scored.reduce((s, b) => s + b.focusScore, 0) / scored.length) * 10) / 10
      : 0;
    return { total: blocks.length, done, avg };
  }, [plan]);
  const showNowLine = isToday && (futureGeo !== null || !(hideSleep && isInSleepPeriod(nowMinutes, prefs.sleepStart, prefs.sleepEnd)));
  const hourLabels = futureGeo ? futureHourLabels(futureGeo) : getVisibleHourLabels();

  /** 时间块渲染矩形：只看未来走折叠窗口，否则走睡眠折叠 */
  const blockRect = (start: string, end: string) => futureGeo
    ? futureGeo.rect(start, end)
    : blockRenderRect(start, end, {
        hideSleep,
        sleepStart: prefs.sleepStart,
        sleepEnd: prefs.sleepEnd,
        hourHeight: HOUR_HEIGHT,
        barHeight: SLEEP_BAR_H,
        gridHeight: GRID_HEIGHT,
      });

  if (loading) {
    return (
      <div className="app-container app-container--day">
        <div className="empty-state"><p>加载中...</p></div>
      </div>
    );
  }

  return (
    <div className="dp-page">
      <div className="dp-head">
      {/* 顶部：日期 + 前后一天 */}
      <div className="dp-top">
        <button className="dp-date" onClick={() => setCalOpen(v => !v)}>
          <span className="dp-date-main">
            {dateObj(date).getMonth() + 1}月{dateObj(date).getDate()}日
          </span>
          <span className="dp-date-sub">{WEEKDAY_LABELS[dateObj(date).getDay()]}</span>
        </button>
        <div className="dp-top-actions">
          <button className="dp-arrow" onClick={() => setDate(shiftDate(date, -1))} aria-label="前一天">‹</button>
          <button className="dp-arrow" onClick={() => setDate(shiftDate(date, 1))} aria-label="后一天">›</button>
          {date !== todayStr() && (
            <button className="dp-today" onClick={() => setDate(todayStr())}>今天</button>
          )}
        </div>
      </div>

      {/* 月历：点日期展开，选完自动收起 */}
      {calOpen && (
        <div className="dp-cal">
          <DayNavigator
            date={date}
            onDateChange={d => { setDate(d); setCalOpen(false); }}
          />
        </div>
      )}

      {/* 一周条：点一下切日，圆点=那天有计划 */}
      <div className="dp-week">
        {weekDates.map(d => {
          const on = d === date;
          const todayCell = d === todayStr();
          return (
            <button key={d} className={`dp-wd ${on ? 'dp-wd--on' : ''}`} onClick={() => setDate(d)}>
              <span className="dp-wd-w">{WEEKDAY_LABELS[dateObj(d).getDay()].replace('周', '')}</span>
              <span className={`dp-wd-n ${todayCell && !on ? 'dp-wd-n--today' : ''}`}>
                {dateObj(d).getDate()}
              </span>
              <span className={`dp-wd-dot ${planDates.has(d) ? 'dp-wd-dot--on' : ''}`} />
            </button>
          );
        })}
      </div>

      {/* 一行统计 + 工具 */}
      <div className="dp-stats">
        <span><b>{summary.total}</b> 块</span>
        <span className="dp-sep">·</span>
        <span><b>{summary.done}</b> 已验收</span>
        <span className="dp-sep">·</span>
        <span>专注 <b>{summary.avg || '—'}</b></span>
        <div className="dp-tools">
          {isToday && (
            <button
              className={`dp-tool ${prefs.futureOnly ? 'dp-tool--on' : ''}`}
              title={prefs.futureOnly ? '显示全部时段' : '只看未来（折叠当前小时之前）'}
              aria-pressed={prefs.futureOnly}
              onClick={() => updatePrefs({ futureOnly: !prefs.futureOnly })}
            >
              <SkipForward size={16} />
            </button>
          )}
          <button className="dp-tool" title="偏好设置" onClick={() => setShowPrefs(true)}>
            <Settings size={16} />
          </button>
          <button className="dp-tool" title="课程表" onClick={() => navigate('/courses')}>
            <CalendarDays size={16} />
          </button>
          <button className="dp-tool" title="全屏视图" onClick={() => setFullscreen(true)}>
            <Maximize2 size={16} />
          </button>
          <button className="dp-tool" title="从模板导入" onClick={handleImportRoutine}>
            <ClipboardList size={16} />
          </button>
        </div>
      </div>
      </div>

      {/* 时间网格 */}
      <div className="time-grid-container" ref={scrollRef}>
        <div className="time-grid" style={{ height: gridHeight }} onClick={handleGridClick}>
          {/* 只看未来的折叠条（当前小时之前全部收起） */}
          {futureGeo && (
            <div
              className="future-bar"
              style={{ top: 0, height: FUTURE_BAR_H }}
              onClick={() => updatePrefs({ futureOnly: false })}
            >
              <span className="future-bar-text">
                ⏩ 只看未来 · 00:00–{minutesToTime(futureGeo.startMin)} 已折叠 · 点此展开
              </span>
            </div>
          )}

          {/* 睡眠折叠条（只看未来时由折叠条接管顶部） */}
          {hideSleep && !futureGeo && (
            <div
              className="sleep-bar"
              style={{ top: 0, height: 24 }}
              onClick={() => setShowPrefs(true)}
            >
              <span className="sleep-bar-text">
                😴 睡眠时间 · {sleepLabel(prefs.sleepStart, prefs.sleepEnd)} · 点击设置
              </span>
            </div>
          )}

          {/* 小时标签 + 网格线 */}
          {hourLabels.map(({ hour, top }) => (
            <div key={hour} className="time-row" style={{ top, height: HOUR_HEIGHT }}>
              <span className="time-label">
                {String(hour).padStart(2, '0')}:00
              </span>
              <div className="time-row-line" />
              {[10, 20, 30, 40, 50].map(m => (
                <div
                  key={m}
                  className="time-subline"
                  style={{ top: (m / 60) * HOUR_HEIGHT }}
                />
              ))}
            </div>
          ))}

          {/* 课程块（只读展示，z-index 低于任务块，重叠时任务块在上） */}
          {courseBlocks.map(course => {
            const rect = blockRect(course.startTime, course.endTime);
            if (!rect) return null;
            const { top, height } = rect;
            return (
              <div
                key={`course-${course.id}`}
                className="course-block"
                style={{ top, height, left: 48, right: 10 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setViewingCourse(course);
                }}
              >
                <div className="course-block-inner">
                  <span className="course-block-time">
                    {course.startTime}-{course.endTime}
                  </span>
                  <span className="course-block-name">{course.name}</span>
                  {course.location && (
                    <span className="course-block-loc">📍 {course.location}</span>
                  )}
                </div>
              </div>
            );
          })}

          {/* 时间块 */}
          {blocks.map(block => {
            const rect = blockRect(block.startTime, block.endTime);
            if (!rect) return null;
            const { top, height } = rect;
            const isDone = block.completed;

            return (
              <div
                key={block.id}
                className={`time-block ${isDone ? 'time-block--done' : ''} ${!block.taskTitle ? 'time-block--empty' : ''}`}
                style={{ top, height, left: 48, right: 10 }}
                onClick={(e) => {
                  e.stopPropagation();
                  manualStartRef.current = false;
                  setEditingBlock({ ...block, checklist: block.checklist || [] });
                }}
              >
                <div className="time-block-inner">
                  <span className="time-block-time">
                    {block.startTime}-{block.endTime}
                  </span>
                  <span className="time-block-title">
                    {block.taskTitle || '点击编辑...'}
                  </span>
                  {(block.checklist?.length ?? 0) > 0 && (
                    <span className="time-block-checklist">
                      <span className="time-block-checklist-bar">
                        <span
                          className="time-block-checklist-bar-inner"
                          style={{
                            width: `${((block.checklist?.filter(c => c.done).length ?? 0) / (block.checklist?.length || 1)) * 100}%`,
                          }}
                        />
                      </span>
                      {block.checklist?.filter(c => c.done).length ?? 0}/{block.checklist?.length ?? 0}
                    </span>
                  )}
                  {!isChecklistTask(block) && (
                    <span className="time-block-scores">
                      {block.focusScore > 0 || block.efficiencyScore > 0
                        ? `专${block.focusScore} 效${block.efficiencyScore}`
                        : '未验收'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* 当前时间指示器 */}
          {showNowLine && (() => {
            const top = futureGeo ? futureGeo.minuteToTop(nowMinutes) : minutesToTop(nowMinutes);
            if (top < 0) return null;
            return (
              <div className="now-line" style={{ top }}>
                <div className="now-dot" />
                <div className="now-bar" />
              </div>
            );
          })()}
        </div>
      </div>

      {/* 全屏日程视图 */}
      <FullscreenSchedule
        visible={fullscreen}
        date={date}
        blocks={blocks}
        prefs={prefs}
        onDateChange={setDate}
        onBlockClick={(block) => {
          manualStartRef.current = false;
          setEditingBlock({ ...block });
          // 保持全屏打开，不退出
        }}
        onGridClick={handleFullscreenGridClick}
        onPrefsClick={() => { /* 直接打开偏好，不关闭全屏 */ setShowPrefs(true); }}
        onClose={() => setFullscreen(false)}
        courses={courseBlocks}
        onCourseClick={setViewingCourse}
      />

      {/* 偏好设置面板 */}
      <PreferencePanel
        visible={showPrefs}
        prefs={prefs}
        onUpdate={updatePrefs}
        onReset={resetPrefs}
        onClose={() => setShowPrefs(false)}
      />

      {/* 底部编辑面板 (Bottom Sheet) */}
      {editingBlock && (
        <div className="bs-overlay" onClick={() => setEditingBlock(null)}>
          <div className="bs-sheet" onClick={e => e.stopPropagation()}>
            <div className="bs-handle" />
            <h3 className="bs-title">
              {editingBlock.id ? '编辑任务' : '新建任务'}
            </h3>

            <div className="bs-body">
                            {/* 即时任务已下线：只保留预规划 */}

{/* 预规划模式 或 即时整块模式：显示时间设置 */}
              {(planningMode === 'pre' || instantStyle === 'block') && (<>
                <div className="form-group">
                  <label className="label">时间设置</label>
                  <div className="bs-time-mode">
                    <button
                      className={`bs-mode-btn ${timeMode === 'range' ? 'bs-mode-btn--active' : ''}`}
                      onClick={() => setTimeMode('range')}
                    >起止时间</button>
                    <button
                      className={`bs-mode-btn ${timeMode === 'duration' ? 'bs-mode-btn--active' : ''}`}
                      onClick={() => setTimeMode('duration')}
                    >起止+时长</button>
                  </div>
                </div>

                {/* 时间输入 */}
                {planningMode === 'pre' && (
                  <div className="form-group">
                    <label className="label">开始时间</label>
                    <input
                      className="input"
                      type="time"
                      value={editingBlock.startTime}
                      onChange={e => {
                        const start = e.target.value;
                        const updates: Partial<TimeBlock> = { startTime: start };
                        if (timeMode === 'duration') {
                          updates.endTime = computeEndTime(start, durationMinutes);
                        }
                        setEditingBlock({ ...editingBlock, ...updates });
                      }}
                    />
                  </div>
                )}
                {planningMode === 'instant' && instantStyle === 'block' && (
                  <div className="form-group">
                    <label className="label">
                      开始时间
                      <span className="bs-instant-badge">⚡ 现在</span>
                    </label>
                    <input
                      className="input"
                      type="time"
                      value={editingBlock.startTime}
                      readOnly
                      style={{ color: 'var(--color-text-muted)', background: 'var(--color-bg)' }}
                    />
                    <p className="bs-instant-hint">
                      {manualStartRef.current
                        ? '已手动微调，不再随时间更新'
                        : '开始时间已锁定为当前时刻'}
                    </p>
                  </div>
                )}

                {timeMode === 'range' ? (
                  <div className="form-group">
                    <label className="label">结束时间</label>
                    <input
                      className="input"
                      type="time"
                      value={editingBlock.endTime}
                      onChange={e => setEditingBlock({ ...editingBlock, endTime: e.target.value })}
                    />
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="label">预计时长（分钟）</label>
                    <input
                      className="input"
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={durationMinutes || ''}
                      onChange={e => {
                        const raw = e.target.value;
                        if (raw === '') { setDurationMinutes(0); return; }
                        const n = parseInt(raw, 10);
                        if (!isNaN(n)) {
                          setDurationMinutes(n);
                          setEditingBlock({
                            ...editingBlock,
                            endTime: computeEndTime(editingBlock.startTime, n),
                          });
                        }
                      }}
                      onBlur={() => {
                        const clamped = Math.min(480, Math.max(5, durationMinutes || 30));
                        if (clamped !== durationMinutes) {
                          setDurationMinutes(clamped);
                          setEditingBlock({
                            ...editingBlock,
                            endTime: computeEndTime(editingBlock.startTime, clamped),
                          });
                        }
                      }}
                    />
                  </div>
                )}
              </>)}

              {/* 即时清单模式：开始时间可见、可微调 */}
              {planningMode === 'instant' && instantStyle === 'list' && (
                <div className="form-group">
                  <label className="label">
                    开始时间
                    <span className="bs-instant-badge">⚡ 即时</span>
                  </label>
                  <input
                    className="input"
                    type="time"
                    value={editingBlock.startTime}
                    onChange={e => {
                      const start = e.target.value;
                      if (!start) return; // 清空时不落状态，避免非法时间
                      manualStartRef.current = true;
                      setEditingBlock({
                        ...editingBlock,
                        startTime: start,
                        // 未勾完时占位 endTime 跟随开始时间；已全部勾完保持完成时刻不变
                        endTime: allChecklistDone(editingBlock)
                          ? editingBlock.endTime
                          : computeEndTime(start, CHECKLIST_PLACEHOLDER_MIN),
                      });
                    }}
                  />
                  <p className="bs-instant-hint">
                    {manualStartRef.current
                      ? '已手动微调，不再随时间更新'
                      : '默认随当前时刻更新，可手动微调'}
                  </p>
                </div>
              )}

              {/* 任务名称 */}
              <div className="form-group">
                <label className="label">任务名称</label>
                <input
                  className="input"
                  value={editingBlock.taskTitle}
                  onChange={e => setEditingBlock({ ...editingBlock, taskTitle: e.target.value })}
                  placeholder="任务名称"
                />
              </div>

              {/* 计划内容：清单模式 vs 整块模式 */}
              {planningMode === 'instant' && instantStyle === 'list' ? (
                <div className="form-group">
                  <label className="label">📋 任务清单</label>
                  <div className="bs-checklist">
                    {editingBlock.checklist?.map((item, idx) => (
                      <div key={item.id} className="bs-checklist-row">
                        <button
                          type="button"
                          className={`bs-checklist-check ${item.done ? 'bs-checklist-check--done' : ''}`}
                          onClick={() => {
                            const updated = [...(editingBlock.checklist || [])];
                            updated[idx] = { ...updated[idx], done: !updated[idx].done };
                            // 记录「全部勾选完成」的时刻，作为结束时间
                            const wasAllDone = allChecklistDone(editingBlock);
                            const nowAllDone = updated.length > 0 && updated.every(i => i.done);
                            if (!wasAllDone && nowAllDone) checklistDoneAtRef.current = Date.now();
                            setEditingBlock({ ...editingBlock, checklist: updated });
                          }}
                          title={item.done ? '标记未完成' : '标记完成'}
                        >
                          {item.done && <CheckCircle2 size={14} />}
                        </button>
                        <input
                          className="input input-sm"
                          value={item.text}
                          onChange={e => {
                            const updated = [...(editingBlock.checklist || [])];
                            updated[idx] = { ...updated[idx], text: e.target.value };
                            setEditingBlock({ ...editingBlock, checklist: updated });
                          }}
                          placeholder="子任务内容"
                        />
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            const updated = (editingBlock.checklist || []).filter((_, i) => i !== idx);
                            setEditingBlock({ ...editingBlock, checklist: updated });
                          }}
                          title="删除此项"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ))}
                    <div className="bs-checklist-tools">
                      <button
                        type="button"
                        className="bs-checklist-add"
                        onClick={() => {
                          const updated = [...(editingBlock.checklist || []), { id: genId(), text: '', done: false }];
                          setEditingBlock({ ...editingBlock, checklist: updated });
                        }}
                      >
                        <Plus size={14} /> 添加子任务
                      </button>
                      <button
                        type="button"
                        className="bs-checklist-add"
                        onClick={handleOpenTemplatePicker}
                      >
                        <ClipboardList size={14} /> 套用模板
                      </button>
                    </div>

                    {/* 套用模板选择器（内联在 bs-sheet 内，层级高于 310） */}
                    {showTemplatePicker && (
                      <div className="bs-template-picker">
                        <div className="bs-template-picker-title">选择模板（追加到当前清单）</div>
                        {templateList.map(t => (
                          <button
                            key={t.id}
                            type="button"
                            className="bs-template-item"
                            onClick={() => handleApplyTemplate(t)}
                          >
                            <span className="bs-template-item-name">{t.name}</span>
                            <span className="bs-template-item-count">{t.items.length} 项</span>
                          </button>
                        ))}
                        <button
                          type="button"
                          className="bs-template-cancel"
                          onClick={() => setShowTemplatePicker(false)}
                        >
                          取消
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="form-group">
                  <label className="label">计划内容</label>
                  <textarea
                    className="input textarea"
                    value={editingBlock.plannedContent}
                    onChange={e => setEditingBlock({ ...editingBlock, plannedContent: e.target.value })}
                    placeholder="要做什么？"
                    rows={2}
                  />
                </div>
              )}

            </div>

            {/* 固定底部操作栏 */}
            <div className="bs-footer">
              {editingBlock.id && !isChecklistTask(editingBlock) && (
                <button className="btn btn-sm btn-outline" onClick={openAcceptance} title="验收并完成">
                  <CheckCircle2 size={16} /> 验收
                </button>
              )}
              <button className="btn btn-primary" onClick={handleSaveBlock}>
                <Save size={16} /> 保存
              </button>
              {editingBlock.id && (
                <button className="btn btn-danger" onClick={handleDeleteBlock}>
                  <Trash2 size={16} /> 删除
                </button>
              )}
              <button className="btn btn-ghost" onClick={() => setEditingBlock(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 验收弹窗（独立于编辑面板，保存后视为任务完成） */}
      {acceptingBlock && (
        <div className="accept-overlay" onClick={() => setAcceptingBlock(null)}>
          <div className="accept-modal" onClick={e => e.stopPropagation()}>
            <h3 className="accept-title">✅ 任务验收</h3>
            {acceptingBlock.taskTitle && (
              <div className="accept-task-title">{acceptingBlock.taskTitle}</div>
            )}

            <div className="form-group">
              <label className="label">实际执行情况</label>
              <textarea
                className="input textarea"
                value={acceptingBlock.actualExecution}
                onChange={e => setAcceptingBlock({ ...acceptingBlock, actualExecution: e.target.value })}
                placeholder="实际完成情况"
                rows={3}
              />
            </div>

            <div className="bs-scores">
              <div className="form-group">
                <label className="label">专注度 (0-10)</label>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={acceptingBlock.focusScore || ''}
                  placeholder="0=未评分"
                  onChange={e => {
                    const raw = e.target.value;
                    if (raw === '') { setAcceptingBlock({ ...acceptingBlock, focusScore: 0 }); return; }
                    const n = parseInt(raw, 10);
                    if (!isNaN(n)) setAcceptingBlock({ ...acceptingBlock, focusScore: n });
                  }}
                  onBlur={() => {
                    const clamped = Math.min(10, Math.max(0, acceptingBlock.focusScore || 0));
                    if (clamped !== acceptingBlock.focusScore) {
                      setAcceptingBlock({ ...acceptingBlock, focusScore: clamped });
                    }
                  }}
                />
              </div>
              <div className="form-group">
                <label className="label">效率 (0-10)</label>
                <input
                  className="input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={acceptingBlock.efficiencyScore || ''}
                  placeholder="0=未评分"
                  onChange={e => {
                    const raw = e.target.value;
                    if (raw === '') { setAcceptingBlock({ ...acceptingBlock, efficiencyScore: 0 }); return; }
                    const n = parseInt(raw, 10);
                    if (!isNaN(n)) setAcceptingBlock({ ...acceptingBlock, efficiencyScore: n });
                  }}
                  onBlur={() => {
                    const clamped = Math.min(10, Math.max(0, acceptingBlock.efficiencyScore || 0));
                    if (clamped !== acceptingBlock.efficiencyScore) {
                      setAcceptingBlock({ ...acceptingBlock, efficiencyScore: clamped });
                    }
                  }}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="label">备注</label>
              <input
                className="input"
                value={acceptingBlock.notes}
                onChange={e => setAcceptingBlock({ ...acceptingBlock, notes: e.target.value })}
                placeholder="备注"
              />
            </div>

            <div className="accept-actions">
              {acceptingBlock.completed && (
                <button className="btn btn-sm btn-ghost" onClick={handleUnacceptBlock} title="撤销验收">
                  撤销验收
                </button>
              )}
              <button className="btn btn-primary" onClick={handleAcceptBlock}>
                <CheckCircle2 size={16} /> 验收完成
              </button>
              <button className="btn btn-ghost" onClick={() => setAcceptingBlock(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 新建时间块（FAB） */}
      <button className="dp-fab" onClick={openNewBlock} title="新建时间块" aria-label="新建时间块">
        <Plus size={24} />
      </button>

      <ConfirmDialog
        open={notice !== null}
        message={notice ?? ''}
        onCancel={() => setNotice(null)}
      />

      {/* 课程详情弹窗（只读，修改请到课程表页） */}
      {viewingCourse && (() => {
        const week = semester?.startDate ? weekIndex(date, semester.startDate) : 0;
        const lastWeek = viewingCourse.startWeek + viewingCourse.weekCount - 1;
        return (
          <div className="course-modal-overlay" onClick={() => setViewingCourse(null)}>
            <div className="course-modal" onClick={e => e.stopPropagation()}>
              <h3 className="course-modal-title">📚 课程详情</h3>
              <div className="course-modal-name">{viewingCourse.name}</div>
              <div className="course-modal-row">
                <span className="course-modal-label">时间</span>
                <span>
                  {viewingCourse.dayOfWeek.map(d => WEEKDAY_LABELS[d]).join('、')} {viewingCourse.startTime}-{viewingCourse.endTime}
                </span>
              </div>
              <div className="course-modal-row">
                <span className="course-modal-label">教师</span>
                <span>{viewingCourse.teacher || '未填'}</span>
              </div>
              <div className="course-modal-row">
                <span className="course-modal-label">地点</span>
                <span>{viewingCourse.location || '未填'}</span>
              </div>
              <div className="course-modal-row">
                <span className="course-modal-label">周次</span>
                <span>
                  第{viewingCourse.startWeek}-{lastWeek}周 · {WEEK_TYPE_LABELS[viewingCourse.weekType]}
                </span>
              </div>
              <div className="course-modal-row">
                <span className="course-modal-label">当前</span>
                <span>{week > 0 ? `第 ${week} 周` : '未开学或未设置开学时间'}</span>
              </div>
              <p className="course-modal-hint">课程为只读展示，如需修改请到「课程表」页</p>
              <div className="course-modal-actions">
                <button className="btn btn-ghost" onClick={() => setViewingCourse(null)}>关闭</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
