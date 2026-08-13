import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { getAllCourses, deleteCourse, getSemester, saveSemester } from '../db';
import type { Course, SemesterRecord } from '../types';
import { useRegisterBackHandler } from '../contexts/BackButtonContext';
import { usePreferences } from '../hooks/usePreferences';
import { blockRenderRect } from '../utils/time';
import CourseEditModal, { DAY_LABELS, WEEK_TYPE_LABELS } from '../components/CourseEditModal';
// settings-section / settings-field / settings-chip 等通用表单样式复用设置页
import './SettingsPage.css';
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

export default function CoursesPage() {
  const navigate = useNavigate();
  const { prefs } = usePreferences();
  const [courses, setCourses] = useState<Course[]>([]);
  const [semester, setSemester] = useState<SemesterRecord | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  // 视图：列表（课程管理）/ 课表（二维模板网格）
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');

  // 编辑弹窗：undefined=关闭，null=新建，Course=编辑
  const [editingCourse, setEditingCourse] = useState<Course | null | undefined>(undefined);

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

  const handleRemoveSpecialDate = async (id: number) => {
    if (!window.confirm('删除这条特殊日期？')) return;
    await saveSemester({
      id: 1,
      startDate: semester?.startDate ?? null,
      specialDates: (semester?.specialDates ?? []).filter(s => s.id !== id),
      updatedAt: Date.now(),
    });
    setSemester(await getSemester());
  };

  // ============ 课程 ============

  const handleDeleteCourse = async (c: Course) => {
    if (!window.confirm(`确定删除课程「${c.name}」？删除后可在回收站恢复。`)) return;
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

  // 课程表视图：模板语义，显示全部课程（不按周过滤），按开始时间排序
  const gridCourses = [...courses].sort(
    (a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime),
  );
  const hourHeight = prefs.hourHeight;
  const gridHeight = 24 * hourHeight;
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
                开学时间所在周（周一对齐）为第 1 周
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
                法定节假日已内置（2026 精确，2027 部分推定），这里手动补充：放假日期不显示课程；
                补课日期即使撞上节假日也照常显示当天课程
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
                          onClick={() => handleRemoveSpecialDate(s.id)}
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
          courses.length === 0 ? (
            <div className="empty-state">
              <p>还没有课程，点击「添加课程」开始创建</p>
            </div>
          ) : (
            /* === 课程表视图：星期 × 时间的二维模板网格，显示全部课程 === */
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
                {/* 小时行 */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="ct-hour-row"
                    style={{ top: GRID_HEADER_H + h * hourHeight, height: hourHeight }}
                  >
                    <span className="ct-hour-label">{String(h).padStart(2, '0')}:00</span>
                    <div className="ct-hour-line" />
                  </div>
                ))}
                {/* 课程块：模板语义，周次/单双周以角标与 tooltip 呈现 */}
                {gridCourses.map(c =>
                  c.dayOfWeek.map(dw => {
                    const rect = blockRenderRect(c.startTime, c.endTime, gridGeo);
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
                        </div>
                        <button
                          className="btn btn-ghost btn-icon"
                          title="删除课程"
                          onClick={e => {
                            e.stopPropagation();
                            handleDeleteCourse(c);
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
    </div>
  );
}
