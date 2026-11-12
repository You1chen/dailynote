import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, BookOpen } from 'lucide-react';
import KnowledgeMapPanel from '../components/KnowledgeMapPanel';
import { getAllCourses, deleteCourse, getSemester, saveSemester } from '../db';
import type { Course, SemesterRecord } from '../types';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { usePreferences } from '../hooks/usePreferences';
import { blockRenderRect, foldedGrid } from '../utils/time';
import { isCourseInSemester } from '../utils/courseSchedule';
import CourseEditModal, { DAY_LABELS, WEEK_TYPE_LABELS } from '../components/CourseEditModal';
// settings-section / settings-field / settings-chip 等通用表单样式复用设置页
import './SettingsPage.css';
import ConfirmDialog from '../components/ConfirmDialog';
import './CoursesPage.css';

const SPECIAL_KINDS: { value: 'holiday' | 'makeup'; label: string }[] = [
  { value: 'holiday', label: '放假' },
  { value: 'makeup', label: '补课' },
];

/** 课程覆盖的周范围文本，如「第1-18周」 */
function weekRangeText(c: Course): string {
  return `第${c.startWeek}-${c.startWeek + c.weekCount - 1}周`;
}

// 课程表视图网格几何（与周视图/日视图同一套几何：全 0-24h、无睡眠折叠）
const TIME_COL_W = 44;
const COL_W = 52;
const GRID_HEADER_H = 34;

// 不重要时段折叠（课程表视图专属，整点对齐；展开时走 blockRenderRect 全 0-24h 路径）
const UNIMPORTANT_FOLDS = [
  { start: '00:00', end: '07:00', label: '凌晨' },
  { start: '12:00', end: '13:00', label: '午休' },
  { start: '22:00', end: '24:00', label: '深夜' },
];
const FOLD_BAR_H = 24;

export default function CoursesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { prefs } = usePreferences();
  const [courses, setCourses] = useState<Course[]>([]);
  const [semester, setSemester] = useState<SemesterRecord | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // 视图：列表（课程管理）/ 课表（二维模板网格）
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // 课表视图：是否折叠不重要时段（默认折叠，仅组件状态不持久化）
  const [foldUnimportant, setFoldUnimportant] = useState(true);

  // 编辑弹窗：undefined=关闭，null=新建，Course=编辑
  const [editingCourse, setEditingCourse] = useState<Course | null | undefined>(undefined);
  const [askDeleteCourse, setAskDeleteCourse] = useState<Course | null>(null);
  const [askDeleteSpecial, setAskDeleteSpecial] = useState<number | null>(null);
  const [knowledgeCourse, setKnowledgeCourse] = useState<Course | null>(null);
  const [knowledgeNodeId, setKnowledgeNodeId] = useState<string | null>(null);

  // 特殊日期表单
  const [specialDate, setSpecialDate] = useState('');
  const [specialKind, setSpecialKind] = useState<'holiday' | 'makeup'>('holiday');

  // Android 返回键处理
  useRegisterBackHandler(() => {
    navigate(-1);
    return true;
  }, []);

  const load = useCallback(async () => {
    const [cs, sem] = await Promise.all([getAllCourses(), getSemester()]);
    setCourses(cs);
    setSemester(sem);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const courseId = Number(searchParams.get('knowledgeCourse'));
    if (!Number.isSafeInteger(courseId) || courseId <= 0) return;
    const course = courses.find(item => item.id === courseId);
    if (!course) return;
    setKnowledgeCourse(course);
    setKnowledgeNodeId(searchParams.get('knowledgeNode'));
    setSearchParams({}, { replace: true });
  }, [courses, searchParams, setSearchParams]);

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  // ============ 学期设置 ============

  const handleStartDateChange = async (startDate: string) => {
    await saveSemester({
      id: 1,
      startDate: startDate || null,
      specialDates: semester?.specialDates ?? [],
      updatedAt: Date.now(),
    });
    setSemester(await getSemester());
  };

  const handleAddSpecialDate = async () => {
    if (!specialDate) return;
    const specialDates = [...(semester?.specialDates ?? [])];
    const existing = specialDates.find(s => s.date === specialDate);
    if (existing) existing.kind = specialKind; // 同一天重复添加 → 替换类型
    else specialDates.push({ id: Date.now(), date: specialDate, kind: specialKind });
    await saveSemester({
      id: 1,
      startDate: semester?.startDate ?? null,
      specialDates,
      updatedAt: Date.now(),
    });
    setSemester(await getSemester());
    setSpecialDate('');
  };

  const removeSpecialDate = async (id: number) => {
    setAskDeleteSpecial(null);
    await saveSemester({
      id: 1,
      startDate: semester?.startDate ?? null,
      specialDates: (semester?.specialDates ?? []).filter(s => s.id !== id),
      updatedAt: Date.now(),
    });
    setSemester(await getSemester());
  };

  // ============ 课程 ============

  const removeCourse = async (c: Course) => {
    setAskDeleteCourse(null);
    await deleteCourse(c.id!);
    setCourses(await getAllCourses());
  };

  const handleCourseSaved = async () => {
    setEditingCourse(undefined);
    setCourses(await getAllCourses());
  };

  // 按周日→周六分组（多星期课程在每个所选星期分组中都出现）
  const grouped = DAY_LABELS.map((label, dw) => ({
    label,
    dayOfWeek: dw,
    list: courses.filter(c => c.dayOfWeek.includes(dw)),
  }));

  // 课表只展示当前学期的模板（不按周过滤）；列表保留历史课程供管理。
  const gridCourses = courses.filter(c => isCourseInSemester(c, semester)).sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime),
  );
  const hourHeight = prefs.hourHeight;
  // 折叠态：多段折叠几何；展开态：全 0-24h（现有 blockRenderRect 路径不变）
  const fg =
    viewMode === 'grid' && foldUnimportant
      ? foldedGrid(UNIMPORTANT_FOLDS, hourHeight, FOLD_BAR_H)
      : null;
  const gridHeight = fg ? fg.gridHeight : 24 * hourHeight;
  const gridGeo = { hideSleep: false, sleepStart: '', sleepEnd: '', hourHeight, barHeight: 0, gridHeight };

  if (loading) {
    return (
      <div className="app-container">
        <div className="empty-state"><p>加载中...</p></div>
      </div>
    );
  }

  return (
    <div className={`app-container${viewMode === 'grid' ? ' app-container--week' : ''}`}>
      {/* 页面标题 */}
      <div className="page-header">
        <button className="btn btn-ghost btn-icon" onClick={handleBack}>
          <ArrowLeft size={22} />
        </button>
        <h1 className="page-title">课程表</h1>
        <div style={{ width: 36 }} />
      </div>

      {/* === 学期设置（列表视图专属：课表视图只显示课程） === */}
      {viewMode === 'list' && (
        <section className="settings-section">
          <h2 className="settings-section-title">📅 学期设置</h2>
          <div className="card">
            <div className="settings-field">
              <label className="label">🎒 开学时间</label>
              <p className="settings-field-hint" style={{ marginBottom: 8 }}>
                开学时间所在周（周一对齐）为第 1 周。切换学期不会把已有课程转入新学期。
              </p>
              <input
                className="input"
                type="date"
                value={semester?.startDate ?? ''}
                onChange={e => handleStartDateChange(e.target.value)}
              />
              {!semester?.startDate && (
                <p className="courses-warn" style={{ marginTop: 8 }}>
                  ⚠️ 未设置开学时间，课程不会显示在日程表中
                </p>
              )}
            </div>

            <div className="settings-field">
              <label className="label">🎌 特殊日期（放假 / 补课）</label>
              <p className="settings-field-hint" style={{ marginBottom: 8 }}>
                法定节假日已内置（2026 精确，2027 部分推定）。手动补充：放假不显示课程，补课照常显示。
              </p>
              <div className="courses-special-add">
                <input
                  className="input input-sm"
                  type="date"
                  value={specialDate}
                  onChange={e => setSpecialDate(e.target.value)}
                />
                <div className="courses-kind-row">
                  {SPECIAL_KINDS.map(k => (
                    <button
                      key={k.value}
                      className={`settings-chip ${specialKind === k.value ? 'settings-chip--active' : ''}`}
                      onClick={() => setSpecialKind(k.value)}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleAddSpecialDate}
                  disabled={!specialDate}
                >
                  添加
                </button>
              </div>
              {(semester?.specialDates?.length ?? 0) > 0 && (
                <div className="courses-special-list">
                  {semester!.specialDates
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map(s => (
                      <div key={s.id} className="courses-special-item">
                        <span className="courses-special-date">{s.date}</span>
                        <span
                          className={`courses-special-tag ${s.kind === 'holiday' ? 'courses-special-tag--holiday' : 'courses-special-tag--makeup'}`}
                        >
                          {s.kind === 'holiday' ? '放假' : '补课'}
                        </span>
                        <button
                          className="btn btn-ghost btn-icon courses-special-del"
                          title="删除"
                          onClick={() => setAskDeleteSpecial(s.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* === 课程（列表 / 课表双视图） === */}
      <section className="settings-section">
        <div className="courses-list-header">
          <h2 className="settings-section-title" style={{ marginBottom: 0 }}>📚 课程</h2>
          <div className="courses-header-right">
            <div className="courses-view-toggle">
              <button
                className={`settings-chip ${viewMode === 'list' ? 'settings-chip--active' : ''}`}
                onClick={() => setViewMode('list')}
              >
                列表
              </button>
              <button
                className={`settings-chip ${viewMode === 'grid' ? 'settings-chip--active' : ''}`}
                onClick={() => setViewMode('grid')}
              >
                课表
              </button>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => setEditingCourse(null)}>
              <Plus size={16} /> 添加课程
            </button>
          </div>
        </div>

        {viewMode === 'grid' ? (
          gridCourses.length === 0 ? (
            <div className="empty-state">
              <p>本学期还没有课程，点击「添加课程」开始创建</p>
              {courses.length > 0 && <p>其他学期的课程可在列表中管理</p>}
            </div>
          ) : (
            /* === 课程表视图：星期 × 时间的二维模板网格，显示当前学期课程 === */
            <>
              <div className="ct-fold-toggle-row">
                <button
                  className={`settings-chip${foldUnimportant ? ' settings-chip--active' : ''}`}
                  onClick={() => setFoldUnimportant(v => !v)}
                >
                  折叠不重要时段
                </button>
              </div>
              <div className="ct-scroll">
              <div className="ct-inner" style={{ height: GRID_HEADER_H + gridHeight }}>
                {/* 表头（星期，模板不绑定具体日期） */}
                <div className="ct-head" style={{ height: GRID_HEADER_H }}>
                  {DAY_LABELS.map((label, dw) => (
                    <div
                      key={dw}
                      className="ct-head-cell"
                      style={{ left: TIME_COL_W + dw * COL_W, width: COL_W }}
                    >
                      {label}
                    </div>
                  ))}
                </div>
                {/* 小时行：折叠态跳过整点落入折叠段的小时（折叠段整点对齐） */}
                {Array.from({ length: 24 }, (_, h) => {
                  const rowTop = fg ? fg.mapMinute(h * 60) : h * hourHeight;
                  if (fg && rowTop < 0) return null;
                  return (
                    <div
                      key={h}
                      className="ct-hour-row"
                      style={{ top: GRID_HEADER_H + rowTop, height: hourHeight }}
                    >
                      <span className="ct-hour-label">{String(h).padStart(2, '0')}:00</span>
                      <div className="ct-hour-line" />
                    </div>
                  );
                })}
                {/* 折叠条（仅展示，不点击；z=4 高于课程块、低于 sticky 表头） */}
                {fg &&
                  UNIMPORTANT_FOLDS.map((fold, i) => (
                    <div
                      key={fold.start}
                      className="ct-fold-bar"
                      style={{ top: GRID_HEADER_H + fg.barTops[i], height: FOLD_BAR_H }}
                    >
                      <span className="ct-fold-bar-text">
                        {fold.label} {fold.start}–{fold.end}
                      </span>
                    </div>
                  ))}
                {/* 课程块：模板语义，周次/单双周以角标与 tooltip 呈现 */}
                {gridCourses.map(c =>
                  c.dayOfWeek.map(dw => {
                    const rect = fg
                      ? fg.rect(c.startTime, c.endTime)
                      : blockRenderRect(c.startTime, c.endTime, gridGeo);
                    if (!rect) return null;
                    return (
                      <div
                        key={`${c.id}-${dw}`}
                        className="ct-course-block"
                        style={{
                          left: TIME_COL_W + dw * COL_W + 2,
                          width: COL_W - 6,
                          top: GRID_HEADER_H + rect.top,
                          height: rect.height,
                        }}
                        title={`${c.name} · ${weekRangeText(c)} · ${WEEK_TYPE_LABELS[c.weekType]}${c.location ? ` · ${c.location}` : ''}`}
                        onClick={e => {
                          e.stopPropagation();
                          setEditingCourse(c);
                        }}
                      >
                        <div className="ct-block-inner">
                          <span className="ct-block-time">{c.startTime}-{c.endTime}</span>
                          <span className="ct-block-name">{c.name}</span>
                          {c.location && <span className="ct-block-loc">{c.location}</span>}
                        </div>
                        {c.weekType !== 'all' && (
                          <span className="ct-block-badge">{c.weekType === 'odd' ? '单' : '双'}</span>
                        )}
                      </div>
                    );
                  }),
                )}
              </div>
              </div>
            </>
          )
        ) : (
          <>
            {courses.length === 0 ? (
              <div className="empty-state">
                <p>还没有课程，点击「添加课程」开始创建</p>
              </div>
            ) : (
              grouped.map(g => (
                <div key={g.dayOfWeek} className="courses-day-group">
                  <div className="courses-day-label">{g.label}</div>
                  {g.list.length === 0 ? (
                    <div className="courses-day-empty">无课</div>
                  ) : (
                    g.list.map(c => (
                      <div key={c.id} className="card courses-card" onClick={() => setEditingCourse(c)}>
                        <div className="courses-card-info">
                          <span className="courses-card-time">
                            {c.startTime}-{c.endTime}
                          </span>
                          <span className="courses-card-name">{c.name}</span>
                          <span className="courses-card-meta">
                            {c.location || '未填地点'} · {weekRangeText(c)} · {WEEK_TYPE_LABELS[c.weekType]}
                          </span>
                          <span className="courses-card-meta">
                            {c.semesterStartDate
                              ? `所属学期：${c.semesterStartDate} 开学${isCourseInSemester(c, semester) ? '（当前）' : '（非当前）'}`
                              : '所属学期：待设置开学时间'}
                          </span>
                          <button className="courses-map-link" onClick={e => { e.stopPropagation(); setKnowledgeCourse(c); }}><BookOpen size={14} /> 知识地图</button>
                        </div>
                        <button
                          className="btn btn-ghost btn-icon"
                          title="删除课程"
                          onClick={e => {
                            e.stopPropagation();
                            setAskDeleteCourse(c);
                          }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ))
            )}
          </>
        )}
      </section>

      {/* === 新建/编辑弹窗（共享组件） === */}
      {editingCourse !== undefined && (
        <CourseEditModal
          course={editingCourse}
          onClose={() => setEditingCourse(undefined)}
          onSaved={handleCourseSaved}
        />
      )}
      {knowledgeCourse && <KnowledgeMapPanel course={knowledgeCourse} initialNodeId={knowledgeNodeId} onClose={() => { setKnowledgeCourse(null); setKnowledgeNodeId(null); }} />}
      <ConfirmDialog
        open={askDeleteCourse !== null}
        message={askDeleteCourse ? `确定删除课程「${askDeleteCourse.name}」？删除后可在回收站恢复。` : ''}
        onCancel={() => setAskDeleteCourse(null)}
        onConfirm={() => askDeleteCourse && removeCourse(askDeleteCourse)}
      />
      <ConfirmDialog
        open={askDeleteSpecial !== null}
        message="删除这条特殊日期？"
        onCancel={() => setAskDeleteSpecial(null)}
        onConfirm={() => askDeleteSpecial !== null && removeSpecialDate(askDeleteSpecial)}
      />    </div>
  );
}
