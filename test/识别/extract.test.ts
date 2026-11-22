/**
 * 图片识别结果解析测试（时间 / 地点 / 要求 / 邮箱）
 *
 * 输入模拟 OCR 的脏文本（全角标点、多余空格、通知体），验证抽取与备注组装。
 */

import { describe, it, expect } from 'vitest';
import { extractFromText, buildNotes, planExtraction, collectApplied, parseExistingNotes, mergeExtractions } from '../../src/utils/extract';

const TODAY = new Date('2026-10-25T09:00:00');

const NOTICE = [
  '关于召开年级大会的通知',
  '时间：2026年11月2日 下午2:30',
  '地点：三教302',
  '要求：',
  '- 携带学生证',
  '- 提前10分钟签到',
  '- 提交纸质报告一份',
  '联系邮箱：teacher@school.edu.cn',
].join('\n');

describe('时间识别', () => {
  it('年月日 + 下午时间 → 24 小时制', () => {
    const r = extractFromText(NOTICE, TODAY);
    expect(r.date).toBe('2026-11-02');
    expect(r.time).toBe('14:30');
  });

  it('全角冒号与全角数字也能认', () => {
    const r = extractFromText('时间：２０２６年１１月２日　１４：０５', TODAY);
    expect(r.date).toBe('2026-11-02');
    expect(r.time).toBe('14:05');
  });

  it('只写月日 → 按今年补全', () => {
    expect(extractFromText('11月8日 09:00 交表', TODAY).date).toBe('2026-11-08');
  });

  it('今天/明天/后天', () => {
    expect(extractFromText('明天 08:00 开会', TODAY).date).toBe('2026-10-26');
    expect(extractFromText('后天交', TODAY).date).toBe('2026-10-27');
  });

  it('X点Y分 / X点 也能认', () => {
    expect(extractFromText('下午3点20分开始', TODAY).time).toBe('15:20');
    expect(extractFromText('上午9点', TODAY).time).toBe('09:00');
  });

  it('非法时间不硬塞', () => {
    expect(extractFromText('25:99 集合', TODAY).time).toBe('');
  });
});

describe('地点识别', () => {
  it('带「地点：」标签的行', () => {
    expect(extractFromText(NOTICE, TODAY).location).toBe('三教302');
  });

  it('无标签但像教室的短行', () => {
    expect(extractFromText('年级大会\n一教 101\n要求携带证件', TODAY).location).toBe('一教 101');
  });

  it('提示类行不会被误当地点', () => {
    expect(extractFromText('提交纸质材料到辅导员处', TODAY).location).toBe('');
  });
});

describe('要求与邮箱', () => {
  it('抓出要求条目并去掉项目符号', () => {
    const r = extractFromText(NOTICE, TODAY);
    expect(r.requirements).toContain('携带学生证');
    expect(r.requirements).toContain('提前10分钟签到');
    expect(r.requirements).toContain('提交纸质报告一份');
  });

  it('抓邮箱（去重）', () => {
    const r = extractFromText('联系 a@b.com 或 a@b.com，备用 c.d@e.cn', TODAY);
    expect(r.emails).toEqual(['a@b.com', 'c.d@e.cn']);
  });

  it('备注按「要求 / 邮箱」两段组装', () => {
    const r = extractFromText(NOTICE, TODAY);
    expect(r.notes).toContain('**要求**');
    expect(r.notes).toContain('- 携带学生证');
    expect(r.notes).toContain('**邮箱**');
    expect(r.notes).toContain('- teacher@school.edu.cn');
  });

  it('没有要求也没有邮箱时备注为空', () => {
    expect(buildNotes([], [])).toBe('');
    expect(extractFromText('随便一段话', TODAY).notes).toBe('');
  });
});

describe('名称与整体', () => {
  it('优先取「关于…」这类标题行', () => {
    expect(extractFromText(NOTICE, TODAY).title).toContain('年级大会');
  });

  it('空文本不抛错、全部为空', () => {
    const r = extractFromText('', TODAY);
    expect(r).toEqual({
      title: '', date: '', time: '', location: '', emails: [], requirements: [], notes: '',
    });
  });

  it('邮箱不会被当成要求条目', () => {
    const r = extractFromText('联系邮箱：teacher@school.edu.cn', TODAY);
    expect(r.requirements).toEqual([]);
  });
});

describe('与现有内容的去重与冲突', () => {
  const empty = { name: '', deadlineDate: '', deadlineTime: '', location: '', notes: '' };
  const info = extractFromText(NOTICE, TODAY);

  it('表单为空 → 全部 fill', () => {
    const rows = planExtraction(info, empty);
    expect(rows.filter(r => r.action === 'fill').length).toBe(rows.length);
  });

  it('值完全相同 → skip（不重复填）', () => {
    const rows = planExtraction(info, {
      ...empty,
      name: info.title,
      deadlineDate: info.date,
      deadlineTime: info.time,
      location: info.location,
    });
    expect(rows.filter(r => r.kind === 'scalar').every(r => r.action === 'skip')).toBe(true);
  });

  it('值不同 → conflict', () => {
    const rows = planExtraction(info, { ...empty, location: '二教201' });
    const loc = rows.find(r => r.id === 'location')!;
    expect(loc.action).toBe('conflict');
    expect(loc.current).toBe('二教201');
  });

  it('备注里已有同一邮箱 → 该行 skip', () => {
    const rows = planExtraction(info, { ...empty, notes: '联系 teacher@school.edu.cn' });
    const mail = rows.find(r => r.kind === 'email')!;
    expect(mail.action).toBe('skip');
  });

  it('备注里已有不同邮箱 → conflict，并给出原值', () => {
    const rows = planExtraction(info, { ...empty, notes: '旧邮箱 old@school.edu.cn' });
    const mail = rows.find(r => r.kind === 'email')!;
    expect(mail.action).toBe('conflict');
    expect(mail.current).toContain('old@school.edu.cn');
  });

  it('要求条目已存在 → skip（仅去重，不报冲突）', () => {
    const rows = planExtraction(info, { ...empty, notes: '- 携带学生证' });
    const hit = rows.find(r => r.value === '携带学生证')!;
    expect(hit.action).toBe('skip');
    expect(rows.find(r => r.value === '提前10分钟签到')!.action).toBe('fill');
  });

  it('parseExistingNotes 剥掉项目符号与加粗标题', () => {
    const parsed = parseExistingNotes('**要求**\n- 携带学生证\n1. 交报告\n\n联系 a@b.com');
    expect(parsed.lines).toContain('携带学生证');
    expect(parsed.lines).toContain('交报告');
    expect(parsed.lines.some(l => l.includes('要求'))).toBe(false);
    expect(parsed.emails).toEqual(['a@b.com']);
  });
});
describe('多张图片之间的冲突', () => {
  const a = extractFromText('会议\n时间：2026年11月2日 下午2:30\n地点：三教302\n要求：携带学生证', TODAY);
  const b = extractFromText('会议\n时间：2026年11月2日 下午3:30\n地点：三教302\n要求：携带学生证\n联系 a@b.com', TODAY);

  it('时间不同 → 时间进候选，其余仍取单值', () => {
    const merged = mergeExtractions([a, b]);
    expect(merged.candidates.time).toEqual(['14:30', '15:30']);
    expect(merged.candidates.location).toBeUndefined();
    expect(merged.info.date).toBe('2026-11-02');
  });

  it('值相同则不产生候选', () => {
    const merged = mergeExtractions([a, a]);
    expect(merged.candidates).toEqual({});
  });

  it('要求与邮箱取并集并去重', () => {
    const merged = mergeExtractions([a, b]);
    expect(merged.info.requirements).toEqual(['携带学生证']);
    expect(merged.info.emails).toEqual(['a@b.com']);
  });

  it('planExtraction 把候选挂到对应行上（图与图冲突可见）', () => {
    const merged = mergeExtractions([a, b]);
    const rows = planExtraction(merged.info, {
      name: '', deadlineDate: '', deadlineTime: '', location: '', notes: '',
    }, merged.candidates);
    const timeRow = rows.find(r => r.id === 'deadlineTime')!;
    expect(timeRow.candidates).toEqual(['14:30', '15:30']);
    expect(rows.find(r => r.id === 'location')!.candidates).toBeUndefined();
  });

  it('图与图冲突 与 表单冲突 可同时存在（行上两个标记）', () => {
    const merged = mergeExtractions([a, b]);
    const rows = planExtraction(merged.info, {
      name: '', deadlineDate: '', deadlineTime: '09:00', location: '', notes: '',
    }, merged.candidates);
    const timeRow = rows.find(r => r.id === 'deadlineTime')!;
    expect(timeRow.action).toBe('conflict');   // 与表单不同
    expect(timeRow.candidates).toHaveLength(2); // 且图与图不同
  });
});
describe('回归：状态栏时钟 / 截止行 / 界面噪声', () => {
  // 用户实测第一张：作业截图（顶部有状态栏时间 20:02）
  const shot1 = [
    '20:02',
    '传感技术第3章作业',
    '陈科',
    '传感技术第3章作业',
    '截止时间：2026-11-02 23:59',
    '开始答题',
  ].join('\n');

  // 用户实测第二张：DDL 页自身的截图（全是界面文案）
  const shot2 = [
    '20:33',
    'DDL',
    '搜索',
    '共4个截止事项',
    '+ 添加 DDL',
    '传感技术第三章作业',
    '编辑',
    '事件名称',
    '传感技术第三章作业',
    '截止时间',
    '地点',
  ].join('\n');

  it('状态栏 20:02 不会被当成截止时间，取 23:59', () => {
    const r = extractFromText(shot1, TODAY);
    expect(r.time).toBe('23:59');
    expect(r.date).toBe('2026-11-02');
  });

  it('「截止时间：…」不会被写成要求', () => {
    const r = extractFromText(shot1, TODAY);
    expect(r.requirements.join()).not.toContain('截止时间');
    expect(r.notes).toBe('');
  });

  it('名称取业务行，不取状态栏时间', () => {
    const r = extractFromText(shot1, TODAY);
    expect(r.title).toContain('传感技术');
    expect(r.title).not.toBe('20:02');
  });

  it('界面截图不产生时间/地点/要求', () => {
    const r = extractFromText(shot2, TODAY);
    expect(r.time).toBe('');
    expect(r.date).toBe('');
    expect(r.location).toBe('');
    expect(r.requirements).toEqual([]);
  });

  it('只有界面文案时整体为空（不硬凑）', () => {
    const r = extractFromText('DDL\n搜索\n添加\n事件名称\n截止时间\n地点\n名称', TODAY);
    expect(r).toEqual({
      title: '', date: '', time: '', location: '', emails: [], requirements: [], notes: '',
    });
  });

  it('两张图合并：时间只有 23:59，名称出现两个候选', () => {
    const merged = mergeExtractions([
      extractFromText(shot1, TODAY),
      extractFromText(shot2, TODAY),
    ]);
    expect(merged.info.time).toBe('23:59');
    expect(merged.info.date).toBe('2026-11-02');
    expect(merged.candidates.time).toBeUndefined();
    expect(merged.candidates.title).toHaveLength(2);
  });

  it('同一行的日期与时间都能取到', () => {
    const r = extractFromText('作业\n提交：2026-11-05 18:30', TODAY);
    expect(r.date).toBe('2026-11-05');
    expect(r.time).toBe('18:30');
  });

  it('孤立的 HH:MM 一律不当时间', () => {
    expect(extractFromText('20:02', TODAY).time).toBe('');
    expect(extractFromText('9:05\n随便一段话', TODAY).time).toBe('');
  });
});
describe('回归：识别结果要落到对应字段（不能全进备注）', () => {
  const empty = { name: '', deadlineDate: '', deadlineTime: '', location: '', notes: '' };

  // 用户实测截图：作业通知 + 状态栏时钟
  const shot = [
    '20:02',
    '传感技术第3章作业',
    '截止时间：2026-11-02 23:59',
    '要求：携带学生证',
    '联系 teacher@school.edu.cn',
  ].join('\n');

  it('标量行带 field，时间行是 deadlineTime', () => {
    const rows = planExtraction(extractFromText(shot, TODAY), empty);
    const byLabel = (l: string) => rows.find(r => r.label === l)!;
    expect(byLabel('名称').field).toBe('name');
    expect(byLabel('日期').field).toBe('deadlineDate');
    expect(byLabel('时间').field).toBe('deadlineTime');
  });

  it('collectApplied：时间进时间字段，不进邮箱、不进备注', () => {
    const rows = planExtraction(extractFromText(shot, TODAY), empty);
    const { fields, requirements, emails } = collectApplied(rows);
    expect(fields.deadlineTime).toBe('23:59');
    expect(fields.deadlineDate).toBe('2026-11-02');
    expect(fields.name).toContain('传感技术');
    expect(emails).toEqual(['teacher@school.edu.cn']);
    expect(requirements).toEqual(['携带学生证']);
    expect(Object.values(fields)).not.toContain('teacher@school.edu.cn');
  });

  it('冲突且保留原值 → 不采用识别值', () => {
    const rows = planExtraction(extractFromText(shot, TODAY), { ...empty, deadlineTime: '09:00' });
    const timeRow = rows.find(r => r.field === 'deadlineTime')!;
    expect(timeRow.action).toBe('conflict');
    expect(collectApplied(rows).fields.deadlineTime).toBeUndefined();

    const applied = collectApplied([{ ...timeRow, useValue: true }]);
    expect(applied.fields.deadlineTime).toBe('23:59');
  });

  it('已存在（skip）的行不会被写入', () => {
    const rows = planExtraction(extractFromText(shot, TODAY), { ...empty, notes: '- 携带学生证' });
    const { requirements } = collectApplied(rows);
    expect(requirements).toEqual([]);
  });

  it('空行与空值被忽略', () => {
    const rows = planExtraction(extractFromText('随便一段话', TODAY), empty);
    const applied = collectApplied(rows);
    expect(applied.requirements).toEqual([]);
    expect(applied.emails).toEqual([]);
  });
});