import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { Course } from '../../src/types';

const db = vi.hoisted(() => ({ getSemester: vi.fn(), saveCourse: vi.fn() }));
vi.mock('../../src/db', () => db);
// 不依赖 DOM：保留真实组件和保存事件，只为表单提供已有的合法课程名。
vi.mock('react', async importOriginal => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => [
    initial && typeof initial === 'object' && 'name' in initial
      ? { ...initial, name: '测试课程' }
      : initial,
    vi.fn(),
  ],
}));

import CourseEditModal from '../../src/components/CourseEditModal';

function findSave(node: ReactNode): (() => Promise<void>) | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findSave(child);
      if (found) return found;
    }
  } else if (node && typeof node === 'object' && 'props' in node) {
    const element = node as ReactElement<{ children?: ReactNode; onClick?: () => Promise<void> }>;
    if (element.type === 'button' && element.props.children === '保存') return element.props.onClick;
    return findSave(element.props.children);
  }
}

const existing: Course = {
  id: 8, name: '原课程', teacher: '', location: '', dayOfWeek: [1],
  startTime: '08:00', endTime: '09:40', weekType: 'all', startWeek: 1, weekCount: 18,
  semesterStartDate: '2026-02-23', createdAt: 100, updatedAt: 200,
};

beforeEach(() => {
  vi.clearAllMocks();
  db.getSemester.mockResolvedValue({ id: 1, startDate: '2026-09-07', specialDates: [], updatedAt: 1 });
  db.saveCourse.mockResolvedValue(1);
});

describe('CourseEditModal — 保存学期归属', () => {
  it('新建保存当前学期开学日期，并通知保存完成', async () => {
    const onSaved = vi.fn();
    const save = findSave(CourseEditModal({ course: null, onClose: vi.fn(), onSaved }));
    expect(save).toBeTypeOf('function');
    await save!();
    expect(db.getSemester).toHaveBeenCalledOnce();
    expect(db.saveCourse).toHaveBeenCalledWith(expect.objectContaining({ semesterStartDate: '2026-09-07' }));
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('编辑其他学期课程保留原学期和创建时间，不读取当前学期重绑', async () => {
    await findSave(CourseEditModal({ course: existing, onClose: vi.fn(), onSaved: vi.fn() }))!();
    expect(db.getSemester).not.toHaveBeenCalled();
    expect(db.saveCourse).toHaveBeenCalledWith(expect.objectContaining({
      id: 8, semesterStartDate: '2026-02-23', createdAt: 100,
    }));
  });

  it('尚未设置学期的新课保留缺字段兼容，等待存储层首次设学期归属', async () => {
    db.getSemester.mockResolvedValue({ id: 1, startDate: null, specialDates: [], updatedAt: 1 });
    await findSave(CourseEditModal({ course: null, onClose: vi.fn(), onSaved: vi.fn() }))!();
    expect(db.saveCourse.mock.calls[0][0].semesterStartDate).toBeUndefined();
  });

  it('编辑缺字段旧课不在组件中自动归属，交给存储层一次性处理', async () => {
    const { semesterStartDate: _semesterStartDate, ...legacy } = existing;
    await findSave(CourseEditModal({ course: legacy, onClose: vi.fn(), onSaved: vi.fn() }))!();
    expect(db.getSemester).not.toHaveBeenCalled();
    expect(db.saveCourse.mock.calls[0][0].semesterStartDate).toBeUndefined();
  });
});
