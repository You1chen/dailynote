import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PERIOD_TIMES,
  parseTimetableHtml,
  parseTimetableText,
  type ParsedCourseRow,
} from '../src/v2/utils/timetableHtml';

const fullWeekHeader = '<tr><th>节次</th><th>周一</th><th>周二</th><th>周三</th><th>周四</th><th>周五</th></tr>';

describe('DEFAULT_PERIOD_TIMES', () => {
  it('provides at least twelve 45-minute periods', () => {
    expect(DEFAULT_PERIOD_TIMES.length).toBeGreaterThanOrEqual(12);
    for (const period of DEFAULT_PERIOD_TIMES) {
      expect(period.start).toMatch(/^\d{2}:\d{2}$/);
      expect(period.end).toMatch(/^\d{2}:\d{2}$/);
      const [startHour, startMinute] = period.start.split(':').map(Number);
      const [endHour, endMinute] = period.end.split(':').map(Number);
      expect(endHour * 60 + endMinute - (startHour * 60 + startMinute)).toBe(45);
    }
  });
});

describe('parseTimetableHtml', () => {
  it('expands rowspans and merges adjacent identical course cells', () => {
    const html = `
      <table class="course-table">
        <thead>
          ${fullWeekHeader}
        </thead>
        <tbody>
          <tr>
            <td>第1-2节</td>
            <td rowspan="2">高等数学A<br>张老师<br>1-16周<br>教1-101</td>
            <td>大学英语<br>李老师<br>1-16周<br>教2-202</td>
            <td></td><td></td><td></td>
          </tr>
          <tr>
            <td>第3-4节</td>
            <td>大学物理<br>王老师<br>2-8周<br>教3-303</td>
            <td></td><td></td><td></td>
          </tr>
        </tbody>
      </table>
    `;
    const result = parseTimetableHtml(html);
    expect(result.warnings).toEqual([]);
    expect(result.rows).toEqual<ParsedCourseRow[]>([
      {
        name: '高等数学A',
        teacher: '张老师',
        location: '教1-101',
        dayOfWeek: [1],
        startTime: '08:00',
        endTime: '11:40',
        startWeek: 1,
        weekCount: 16,
        weekType: 'all',
      },
      {
        name: '大学英语',
        teacher: '李老师',
        location: '教2-202',
        dayOfWeek: [2],
        startTime: '08:00',
        endTime: '09:40',
        startWeek: 1,
        weekCount: 16,
        weekType: 'all',
      },
      {
        name: '大学物理',
        teacher: '王老师',
        location: '教3-303',
        dayOfWeek: [2],
        startTime: '10:00',
        endTime: '11:40',
        startWeek: 2,
        weekCount: 7,
        weekType: 'all',
      },
    ]);
  });

  it('uses explicit clock times from the row label and from a course cell', () => {
    const html = `
      <table>
        <tr><th>时间</th><th>星期一</th><th>星期二</th><th>星期三</th></tr>
        <tr>
          <td>08:00-09:40</td>
          <td>高等数学<br>教1-101</td>
          <td></td><td></td>
        </tr>
        <tr>
          <td>10:00~11:40</td>
          <td></td>
          <td>大学英语<br>教2-202</td>
          <td></td>
        </tr>
        <tr>
          <td>第5-6节</td>
          <td></td><td></td>
          <td>物理实验<br>10:00-11:40<br>物理实验室</td>
        </tr>
      </table>
    `;
    const result = parseTimetableHtml(html);
    expect(result.warnings).toEqual([]);
    expect(result.rows).toEqual<ParsedCourseRow[]>([
      {
        name: '高等数学',
        teacher: '',
        location: '教1-101',
        dayOfWeek: [1],
        startTime: '08:00',
        endTime: '09:40',
      },
      {
        name: '大学英语',
        teacher: '',
        location: '教2-202',
        dayOfWeek: [2],
        startTime: '10:00',
        endTime: '11:40',
      },
      {
        name: '物理实验',
        teacher: '',
        location: '物理实验室',
        dayOfWeek: [3],
        startTime: '10:00',
        endTime: '11:40',
      },
    ]);
  });

  it('decodes entities and converts br tags while ignoring source formatting', () => {
    const html = `
      <TABLE>
        <TR><TH>节次</TH><TH>周一</TH><TH>周二</TH><TH>周三</TH></TR>
        <TR>
          <TD>第1-2节</TD>
          <TD>高等数学A&amp;B<br/>
              张&nbsp;老师<br/>1-16周<br/>教1-101</TD>
          <TD>C&lt;C++<BR>李老师<BR>2-8周<BR>教2-202</TD>
          <TD></TD>
        </TR>
      </TABLE>
    `;
    const result = parseTimetableHtml(html);
    expect(result.warnings).toEqual([]);
    expect(result.rows).toEqual<ParsedCourseRow[]>([
      {
        name: '高等数学A&B',
        teacher: '张老师',
        location: '教1-101',
        dayOfWeek: [1],
        startTime: '08:00',
        endTime: '09:40',
        startWeek: 1,
        weekCount: 16,
        weekType: 'all',
      },
      {
        name: 'C<C++',
        teacher: '李老师',
        location: '教2-202',
        dayOfWeek: [2],
        startTime: '08:00',
        endTime: '09:40',
        startWeek: 2,
        weekCount: 7,
        weekType: 'all',
      },
    ]);
  });

  it('handles bare day headers and header cells spanning several columns', () => {
    const html = `
      <table>
        <tr>
          <th>节次</th>
          <th colspan="2">一</th>
          <th colspan="2">二</th>
          <th colspan="2">三</th>
        </tr>
        <tr>
          <td>第1-2节</td>
          <td colspan="2">高等数学<br>教1-101</td>
          <td colspan="2"></td>
          <td colspan="2"></td>
        </tr>
        <tr>
          <td>第3-4节</td>
          <td colspan="2"></td>
          <td colspan="2">大学英语<br>教2-202</td>
          <td colspan="2"></td>
        </tr>
      </table>
    `;
    const result = parseTimetableHtml(html);
    expect(result.warnings).toEqual([]);
    expect(result.rows.map((row) => [row.name, row.dayOfWeek, row.startTime, row.endTime])).toEqual([
      ['高等数学', [1], '08:00', '09:40'],
      ['大学英语', [2], '10:00', '11:40'],
    ]);
  });
});

describe('parseTimetableText', () => {
  it('parses the supported pasted line formats', () => {
    const text = [
      '周一 08:00-09:40 高等数学 @教1-101',
      '周二 第3-4节 大学英语 1-16周 教2-202',
      '星期三 14:00~15:40 实验 物理实验室 单周',
      '- 星期四 第5-6节 计算机网络 | 张老师 | 教4-404',
      '• 星期五 18:00~19:40 体育 操场',
      '星期六\t08:00-09:40\t自习\t图书馆',
    ].join('\n');
    const result = parseTimetableText(text);
    expect(result.warnings).toEqual([]);
    expect(result.rows).toEqual<ParsedCourseRow[]>([
      {
        name: '高等数学',
        teacher: '',
        location: '教1-101',
        dayOfWeek: [1],
        startTime: '08:00',
        endTime: '09:40',
      },
      {
        name: '大学英语',
        teacher: '',
        location: '教2-202',
        dayOfWeek: [2],
        startTime: '10:00',
        endTime: '11:40',
        startWeek: 1,
        weekCount: 16,
        weekType: 'all',
      },
      {
        name: '实验',
        teacher: '',
        location: '物理实验室',
        dayOfWeek: [3],
        startTime: '14:00',
        endTime: '15:40',
        weekType: 'odd',
      },
      {
        name: '计算机网络',
        teacher: '张老师',
        location: '教4-404',
        dayOfWeek: [4],
        startTime: '14:00',
        endTime: '15:40',
      },
      {
        name: '体育',
        teacher: '',
        location: '操场',
        dayOfWeek: [5],
        startTime: '18:00',
        endTime: '19:40',
      },
      {
        name: '自习',
        teacher: '',
        location: '图书馆',
        dayOfWeek: [6],
        startTime: '08:00',
        endTime: '09:40',
      },
    ]);
  });

  it('reads comma-separated fields and week lists without splitting the week list', () => {
    const result = parseTimetableText('周日,10:00-11:40,高等数学 1,3,5周,教1-101');
    expect(result.warnings).toEqual([]);
    expect(result.rows).toEqual<ParsedCourseRow[]>([
      {
        name: '高等数学',
        teacher: '',
        location: '教1-101',
        dayOfWeek: [0],
        startTime: '10:00',
        endTime: '11:40',
        startWeek: 1,
        weekCount: 5,
        weekType: 'all',
      },
    ]);
  });

  it('warns about empty, garbage and incomplete input', () => {
    expect(parseTimetableText('').rows).toEqual([]);
    expect(parseTimetableText('').warnings.length).toBeGreaterThan(0);

    const garbage = parseTimetableText('hello world');
    expect(garbage.rows).toEqual([]);
    expect(garbage.warnings).toHaveLength(1);

    const incomplete = parseTimetableText([
      '周一 高等数学',
      '08:00-09:40 没有星期',
      '周二 25:00-26:00 线性代数',
      '周三 10:00-09:00 倒序',
      '周四 10:00-11:00 正常课',
    ].join('\n'));
    expect(incomplete.rows).toHaveLength(1);
    expect(incomplete.rows[0]).toMatchObject({ name: '正常课', dayOfWeek: [4], startTime: '10:00', endTime: '11:00' });
    expect(incomplete.warnings).toHaveLength(4);
  });
});

describe('parseTimetableHtml warnings', () => {
  it('reports empty and unusable markup', () => {
    for (const html of ['', '<div>hello</div>', '<table><tr><td>abc</td></tr></table>']) {
      const result = parseTimetableHtml(html);
      expect(result.rows).toEqual([]);
      expect(result.warnings.length).toBeGreaterThan(0);
    }
    expect(parseTimetableHtml('<table><tr><td>abc</td></tr></table>').warnings.join('')).toContain('星期');
  });
});
