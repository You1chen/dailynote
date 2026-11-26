import { useEffect, useRef, useState } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  ArrowLeft,
  Camera,
  Check,
  FileCode2,
  Globe2,
  Loader2,
  Plus,
  ScanText,
  Trash2,
} from 'lucide-react';
import Sheet from './Sheet';
import { deleteCourse, saveCourse, saveSemester } from '../../db';
import type { Course, SemesterRecord } from '../../types';
import { useData } from '../state/DataProvider';
import { useUi } from '../state/ui';
import { genId } from '../../types';
import { fileToCompressedDataURL } from '../../utils/avatarCrop';
import { recognizeText, type OcrProgress } from '../services/ocr';
import {
  parseTimetableHtml,
  parseTimetableText,
  type ParsedCourseRow,
} from '../utils/timetableHtml';
import { mondayThisWeek, WEEKDAY_CN } from '../utils/dates';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Source = 'url' | 'html' | 'text' | 'ocr';
type Step = 'source' | 'preview';
type WeekType = 'all' | 'odd' | 'even';

interface DraftRow {
  key: string;
  name: string;
  teacher: string;
  location: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  startWeek: number;
  weekCount: number;
  weekType: WeekType;
}

interface CourseGrabPlugin {
  grab(options: { url: string }): Promise<{ html: string; url?: string }>;
}

const CourseGrab = registerPlugin<CourseGrabPlugin>('CourseGrab');
const native = Capacitor.isNativePlatform();

const TABS: { id: Source; label: string; icon: typeof Globe2 }[] = [
  { id: 'url', label: '网址', icon: Globe2 },
  { id: 'html', label: '源码', icon: FileCode2 },
  { id: 'text', label: '文字', icon: ScanText },
  { id: 'ocr', label: '截图', icon: Camera },
];

function toDraft(row: ParsedCourseRow): DraftRow {
  return {
    key: genId(),
    name: row.name.trim(),
    teacher: row.teacher?.trim() ?? '',
    location: row.location?.trim() ?? '',
    dayOfWeek: row.dayOfWeek[0] ?? 1,
    startTime: row.startTime,
    endTime: row.endTime,
    startWeek: row.startWeek ?? 1,
    weekCount: row.weekCount ?? 18,
    weekType: row.weekType ?? 'all',
  };
}

function currentWeek(startDate: string | null | undefined): number | null {
  if (!startDate) return null;
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const diff = Math.floor((Date.now() - start) / (7 * 86400000));
  return diff >= 0 ? diff + 1 : null;
}

export default function CourseImportSheet({ open, onClose }: Props) {
  const { courses, semester, reloadCourses } = useData();
  const ui = useUi();
  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<Source>(native ? 'url' : 'html');
  const [url, setUrl] = useState('');
  const [html, setHtml] = useState('');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(mondayThisWeek());
  const [replace, setReplace] = useState(courses.length > 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ocrProgress, setOcrProgress] = useState<OcrProgress>({ status: '', progress: 0 });
  const ocrInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep('source');
    setSource(native ? 'url' : 'html');
    setUrl('');
    setHtml('');
    setText('');
    setRows([]);
    setWarnings([]);
    setError('');
    setBusy(false);
    setStartDate(semester?.startDate || mondayThisWeek());
    setReplace(courses.length > 0);
  }, [open, semester?.startDate, courses.length]);

  async function grabUrl() {
    const target = url.trim();
    if (!target) {
      setError('先填入课程表所在网页的地址。');
      return;
    }
    setBusy(true);
    setError('');
    try {
      if (native) {
        const result = await CourseGrab.grab({ url: target });
        if (!result?.html) throw new Error('没有从页面读到内容。');
        setHtml(result.html);
        parse(result.html, 'html');
        return;
      }
      const response = await fetch(target, { credentials: 'include' });
      if (!response.ok) throw new Error(`网页返回 ${response.status}`);
      const content = await response.text();
      setHtml(content);
      parse(content, 'html');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (/Failed to fetch|CORS|NetworkError/i.test(message)) {
        setError('浏览器不允许直接读取这个网页（跨域限制）。请用「源码」方式粘贴页面源码，或在 Android App 内使用站内抓取。');
      } else if (/plugin|not implemented|unavailable/i.test(message)) {
        setError('当前安装包还没有站内抓取能力。可以先粘贴网页源码或课表文字。');
      } else {
        setError(`读取失败：${message}`);
      }
      if (native) setSource('html');
    } finally {
      setBusy(false);
    }
  }

  async function recognizeScreenshot(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const data = await fileToCompressedDataURL(file, 2200, 0.92);
      const result = await recognizeText(data, update => setOcrProgress(update));
      setText(result.text);
      setSource('text');
      ui.toast('识别完成，可以继续解析');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '截图识别失败。');
    } finally {
      setBusy(false);
      setOcrProgress({ status: '', progress: 0 });
    }
  }

  function parse(inputHtml?: string, kind: Source = source) {
    setError('');
    const result = kind === 'html' || kind === 'url'
      ? parseTimetableHtml(inputHtml ?? html)
      : parseTimetableText(text);
    setWarnings(result.warnings);
    if (!result.rows.length) {
      setError(result.warnings[0] || '没有解析出课程。可以换一种来源，或手动添加一门课。');
      return;
    }
    const drafts = result.rows.map(toDraft);
    // Drop exact duplicate rows that some table layouts produce.
    const seen = new Set<string>();
    const unique = drafts.filter(row => {
      const key = `${row.name}|${row.dayOfWeek}|${row.startTime}|${row.endTime}|${row.location}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    setRows(unique);
    setWarnings(result.warnings);
    setStep('preview');
  }

  function manualParse() {
    if (source === 'html' || source === 'url') parse();
    else if (text.trim()) parse(undefined, 'text');
    else setError('还没有可解析的内容。');
  }

  function patchRow(key: string, changes: Partial<DraftRow>) {
    setRows(current => current.map(row => row.key === key ? { ...row, ...changes } : row));
  }

  async function importCourses() {
    if (busy) return;
    if (!rows.length) {
      setError('至少保留一门课。');
      return;
    }
    const invalid = rows.find(row => !row.name.trim() || row.endTime <= row.startTime || row.startWeek < 1);
    if (invalid) {
      setError(`请检查「${invalid.name || '未命名课程'}」的名称、时间和起始周。`);
      return;
    }
    if (replace && courses.length) {
      const ok = await ui.confirm({
        title: '替换现有课程？',
        message: `将删除当前 ${courses.length} 门课程，再写入预览里的 ${rows.length} 门课。已经写进日程的时间块不会受影响。`,
        confirmLabel: '替换导入',
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setError('');
    try {
      const now = Date.now();
      if (replace) {
        for (const course of courses) if (course.id != null) await deleteCourse(course.id);
      }
      const semesterRecord: SemesterRecord = {
        id: 1,
        startDate: startDate || null,
        specialDates: semester?.specialDates ?? [],
        updatedAt: now,
      };
      await saveSemester(semesterRecord);
      for (const row of rows) {
        const course: Course = {
          name: row.name.trim(),
          teacher: row.teacher.trim(),
          location: row.location.trim(),
          dayOfWeek: [row.dayOfWeek],
          startTime: row.startTime,
          endTime: row.endTime,
          weekType: row.weekType,
          startWeek: row.startWeek,
          weekCount: row.weekCount,
          semesterStartDate: startDate || undefined,
          createdAt: now,
          updatedAt: now,
        };
        await saveCourse(course);
      }
      await reloadCourses();
      window.dispatchEvent(new Event('dailynote-courses-changed'));
      ui.toast(`已导入 ${rows.length} 门课`);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '导入失败，请重试。');
    } finally {
      setBusy(false);
    }
  }

  const week = currentWeek(startDate);
  const footer = step === 'source' ? (
    <>
      <span className="v-tiny v-grow">
        {native ? 'Android App 内可打开课程网站并抓取当前页' : '网页版建议粘贴网页源码或课表文字'}
      </span>
      <button type="button" className="v-btn v-btn--ghost" onClick={onClose} disabled={busy}>取消</button>
      <button type="button" className="v-btn v-btn--primary" onClick={manualParse} disabled={busy}>
        解析课表
      </button>
    </>
  ) : (
    <>
      <button type="button" className="v-btn v-btn--ghost" onClick={() => setStep('source')} disabled={busy}>
        <ArrowLeft size={15} /> 返回
      </button>
      <span className="v-tiny v-grow">{rows.length} 门课</span>
      <button type="button" className="v-btn v-btn--primary" onClick={() => void importCourses()} disabled={busy}>
        {busy ? '导入中…' : `导入 ${rows.length} 门课`}
      </button>
    </>
  );

  return (
    <Sheet
      open={open}
      onClose={onClose}
      busy={busy}
      title={step === 'source' ? '导入课程表' : '预览课程'}
      subtitle={step === 'source'
        ? '从课程网站、网页源码、文字或截图里读出课表'
        : '导入前可以逐行修正，开学日期用于计算当前周次'}
      size="full"
      footer={footer}
    >
      {step === 'source' ? (
        <>
          <div className="v-import-tabs">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-pressed={source === id}
                onClick={() => { setSource(id); setError(''); }}
              >
                <Icon size={17} />
                {label}
              </button>
            ))}
          </div>

          {source === 'url' && (
            <>
              <div className="v-import-note">
                <Globe2 size={16} />
                <span>
                  {native
                    ? '填入课程表页面地址，登录后在站内页面里点「读取本页」；课表会直接回到这里。'
                    : '浏览器受跨域限制，多数教务系统无法直接读取。可先打开网页复制源码，切到「源码」粘贴。'}
                </span>
              </div>
              <label className="v-label">课程表网址</label>
              <div className="v-row" style={{ gap: 8 }}>
                <input
                  className="v-field v-grow"
                  value={url}
                  onChange={event => setUrl(event.target.value)}
                  placeholder="https://…"
                  inputMode="url"
                />
                <button type="button" className="v-btn v-btn--primary" onClick={() => void grabUrl()} disabled={busy}>
                  {busy ? <Loader2 size={15} className="v-spin" /> : <Globe2 size={15} />}
                  {native ? '打开抓取' : '尝试读取'}
                </button>
              </div>
              <p className="v-tiny" style={{ margin: '8px 2px 0', lineHeight: 1.6 }}>
                读取的是你已登录的浏览器/App 页面，不会上传账号密码。抓取失败时请用源码或文字方式。
              </p>
            </>
          )}

          {source === 'html' && (
            <>
              <div className="v-import-note">
                <FileCode2 size={16} />
                <span>在课程网页上按 F12 或「查看网页源代码」，复制整页 HTML 粘到这里。包含 &lt;table&gt; 的页面解析效果最好。</span>
              </div>
              <textarea
                className="v-textarea"
                style={{ minHeight: 260, fontFamily: 'var(--v-mono)', fontSize: 12 }}
                value={html}
                onChange={event => setHtml(event.target.value)}
                placeholder="<table>…</table>"
              />
            </>
          )}

          {source === 'text' && (
            <>
              <div className="v-import-note">
                <ScanText size={16} />
                <span>一行一门课，例如：周一 08:00-09:40 高等数学 @教1-101 1-16周。也支持「第1-2节」写法。</span>
              </div>
              <textarea
                className="v-textarea"
                style={{ minHeight: 240 }}
                value={text}
                onChange={event => setText(event.target.value)}
                placeholder={'周一 08:00-09:40 高等数学 @教1-101\n周三 第3-4节 大学英语 1-16周 教2-202'}
              />
            </>
          )}

          {source === 'ocr' && (
            <>
              <div className="v-import-note">
                <Camera size={16} />
                <span>拍下或选择课程表截图，先识别成文字，再解析成课程。识别在本机完成。</span>
              </div>
              <button
                type="button"
                className="v-btn v-btn--primary v-btn--lg"
                style={{ width: '100%' }}
                onClick={() => ocrInput.current?.click()}
                disabled={busy}
              >
                {busy ? <Loader2 size={18} className="v-spin" /> : <Camera size={18} />}
                {busy ? '处理中…' : '选择截图并识别'}
              </button>
              <input
                ref={ocrInput}
                type="file"
                accept="image/*"
                hidden
                onChange={event => {
                  void recognizeScreenshot(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
              {busy && ocrProgress.status && (
                <div className="v-camera-status" style={{ marginTop: 14 }}>
                  <div className="v-camera-status-row">
                    <Loader2 size={15} className="v-spin" />
                    <span>{ocrProgress.status}</span>
                    <span style={{ marginLeft: 'auto' }}>{Math.round((ocrProgress.progress || 0) * 100)}%</span>
                  </div>
                  <div className="v-progress"><span style={{ width: `${Math.max(4, ocrProgress.progress * 100)}%` }} /></div>
                </div>
              )}
              {!!text && (
                <div style={{ marginTop: 14 }}>
                  <span className="v-label">识别结果</span>
                  <textarea className="v-textarea" value={text} onChange={event => setText(event.target.value)} rows={6} />
                </div>
              )}
            </>
          )}

          {error && <p role="alert" style={{ color: 'var(--v-red)', fontSize: 12.5, margin: '12px 2px 0' }}>{error}</p>}
        </>
      ) : (
        <>
          <div className="v-import-weekstart">
            <label>
              <span className="v-label">本学期开学日期</span>
              <input className="v-field" type="date" value={startDate} onChange={event => setStartDate(event.target.value)} />
            </label>
            <span className="v-tiny" style={{ paddingBottom: 12 }}>{week ? `当前第 ${week} 周` : '用于计算当前周次'}</span>
          </div>

          {!!courses.length && (
            <label className="v-import-toggle">
              <button
                type="button"
                className="v-switch"
                aria-checked={replace}
                aria-label="替换现有课程"
                onClick={() => setReplace(value => !value)}
              />
              <span>替换现有 {courses.length} 门课程（关掉则是追加）</span>
              {replace && <Check size={15} style={{ color: 'var(--v-green)', marginLeft: 'auto' }} />}
            </label>
          )}

          {!!warnings.length && (
            <div className="v-import-warning">
              {warnings.slice(0, 4).map(warning => <div key={warning}>· {warning}</div>)}
            </div>
          )}

          {rows.map(row => (
            <div className="v-import-row" key={row.key}>
              <div className="v-import-row-head">
                <input
                  className="v-field v-grow"
                  value={row.name}
                  onChange={event => patchRow(row.key, { name: event.target.value })}
                  placeholder="课程名称"
                  aria-label="课程名称"
                />
                <button type="button" className="v-iconbtn" aria-label="删除这门课" onClick={() => setRows(current => current.filter(item => item.key !== row.key))}>
                  <Trash2 size={15} />
                </button>
              </div>
              <div className="v-import-grid">
                <select className="v-select" value={row.dayOfWeek} onChange={event => patchRow(row.key, { dayOfWeek: Number(event.target.value) })} aria-label="星期">
                  {WEEKDAY_CN.map((name, index) => <option key={name} value={index}>周{name}</option>)}
                </select>
                <input className="v-field" type="time" value={row.startTime} onChange={event => patchRow(row.key, { startTime: event.target.value })} aria-label="开始时间" />
                <input className="v-field" type="time" value={row.endTime} onChange={event => patchRow(row.key, { endTime: event.target.value })} aria-label="结束时间" />
              </div>
              <div className="v-import-row-sub">
                <input className="v-field" value={row.location} onChange={event => patchRow(row.key, { location: event.target.value })} placeholder="地点" aria-label="地点" />
                <input className="v-field" value={row.teacher} onChange={event => patchRow(row.key, { teacher: event.target.value })} placeholder="教师" aria-label="教师" />
                <select className="v-select" value={row.weekType} onChange={event => patchRow(row.key, { weekType: event.target.value as WeekType })} aria-label="单双周">
                  <option value="all">每周</option>
                  <option value="odd">单周</option>
                  <option value="even">双周</option>
                </select>
              </div>
              <div className="v-import-row-sub" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <label className="v-tiny" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  起始周
                  <input className="v-field" type="number" min={1} max={30} value={row.startWeek} onChange={event => patchRow(row.key, { startWeek: Number(event.target.value) })} />
                </label>
                <label className="v-tiny" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  持续周
                  <input className="v-field" type="number" min={1} max={30} value={row.weekCount} onChange={event => patchRow(row.key, { weekCount: Number(event.target.value) })} />
                </label>
              </div>
            </div>
          ))}

          <button
            type="button"
            className="v-btn v-btn--soft"
            style={{ width: '100%', marginTop: 4 }}
            onClick={() => setRows(current => [...current, {
              key: genId(), name: '', teacher: '', location: '', dayOfWeek: 1,
              startTime: '08:00', endTime: '09:40', startWeek: 1, weekCount: 18, weekType: 'all',
            }])}
          >
            <Plus size={15} /> 手动添加一门课
          </button>

          {error && <p role="alert" style={{ color: 'var(--v-red)', fontSize: 12.5, margin: '10px 2px 0' }}>{error}</p>}
        </>
      )}
    </Sheet>
  );
}
