import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import type { GoalNode, LongTermGoal } from '../../src/types';

// The project deliberately has no jsdom/react-test-renderer. Render real components and
// invoke their actual React event props while replaying independent hook state per component.
const hooks = vi.hoisted(() => ({ slots: new Map<string, unknown[]>(), path: '', index: 0 }));
vi.mock('react', async original => ({
  ...(await original<typeof import('react')>()),
  useState: (initial: unknown) => {
    const path = hooks.path;
    const index = hooks.index++;
    let slots = hooks.slots.get(path);
    if (!slots) { slots = []; hooks.slots.set(path, slots); }
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [slots[index], (value: unknown) => {
      const current = hooks.slots.get(path)!;
      current[index] = typeof value === 'function' ? (value as (previous: unknown) => unknown)(current[index]) : value;
    }];
  },
  useEffect: () => undefined,
}));
vi.mock('../../src/contexts/BackButtonContext', () => ({ useRegisterBackHandler: () => undefined }));
vi.mock('../../src/components/ConfirmDialog', async () => ({
  default: ({ open, message, onConfirm, onCancel }: { open: boolean; message: string; onConfirm: () => void; onCancel: () => void }) =>
    open ? createElement('div', { role: 'alertdialog' }, message,
      createElement('button', { onClick: onConfirm }, '放弃修改'), createElement('button', { onClick: onCancel }, '继续编辑')) : null,
}));

import GoalPlanEditor from '../../src/components/GoalPlanEditor';
import GoalMap from '../../src/components/GoalMap';

type Props = Record<string, any>;
type View = { type: string; props: Props; children: View[] };
function visit(node: ReactNode, path: string): View[] {
  if (Array.isArray(node)) return node.flatMap((child, index) => visit(child, `${path}/${index}`));
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Props>;
  if (typeof element.type === 'function') {
    // Lucide icons don't influence control semantics and use internal React hooks.
    if ('displayName' in element.type && String(element.type.displayName).startsWith('Lucide')) return [];
    const previousPath = hooks.path;
    const previousIndex = hooks.index;
    hooks.path = path;
    hooks.index = 0;
    try { return visit((element.type as (props: Props) => ReactNode)(element.props), `${path}/render`); }
    finally { hooks.path = previousPath; hooks.index = previousIndex; }
  }
  if (typeof element.type !== 'string') return visit(element.props.children, `${path}/fragment`);
  return [{ type: element.type, props: element.props, children: visit(element.props.children, `${path}/children`) }];
}
function mount(component: (props: Props) => ReactNode, props: Props) {
  const render = () => visit(createElement(component, props), 'root');
  const all = (): View[] => {
    const walk = (nodes: View[]): View[] => nodes.flatMap(node => [node, ...walk(node.children)]);
    return walk(render());
  };
  const find = (type: string, predicate: (props: Props) => boolean): View => {
    const matches = all().filter(node => node.type === type && predicate(node.props));
    expect(matches.length).toBe(1);
    return matches[0];
  };
  const button = (name: string) => find('button', props => props['aria-label'] === name || props.title === name ||
    (typeof props.children === 'string' && props.children === name) ||
    (Array.isArray(props.children) && props.children.includes(name)));
  const click = (name: string) => button(name).props.onClick();
  const input = (label: string) => find('input', props => props['aria-label'] === label || props.placeholder === label || props.id === label);
  const change = (field: View, value: string) => field.props.onChange({ target: { value } });
  return { render, all, find, button, click, input, change };
}
const leaf = (id: string, title: string, completed = false): GoalNode => ({ id, title, completed, children: [] });
const goal: LongTermGoal = {
  id: 2, title: '英语考试', description: '准备资料', category: '学业', tasks: [],
  nodes: [{ id: 'listening', title: '听力', completed: false, children: [leaf('a', '精听训练', true), leaf('b', '泛听')] }, leaf('words', '词汇', true)],
  createdAt: 0, updatedAt: 0,
};
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
beforeEach(() => { hooks.slots.clear(); hooks.path = ''; hooks.index = 0; });

describe('GoalPlanEditor 真实组件事件', () => {
  it('展示三行字段，进入全屏层级编辑并用换行、缩进、缩退、删除完成计划', () => {
    const onSave = vi.fn(async () => true);
    const app = mount(GoalPlanEditor, { goal: null, onSave, onClose: vi.fn() });
    app.change(app.input('gp-goal-title'), '年度计划');
    app.change(app.find('textarea', p => p.id === 'gp-attachment'), '材料线索');
    expect(app.all().filter(x => x.type === 'section' && String(x.props.className).includes('gp-field'))).toHaveLength(3);
    app.find('button', p => p.className === 'gp-open-plan').props.onClick();
    expect(app.find('div', p => p.role === 'dialog' && p['aria-label'] === '编辑目标内容')).toBeTruthy();
    app.change(app.input('添加下一步'), '阶段一');
    app.click('换行');
    app.click('缩进');
    app.change(app.input('添加下一步'), '行动一');
    app.click('换行');
    expect(app.input('第 2 行目标').props.value).toBe('行动一');
    app.click('缩退');
    app.change(app.input('添加下一步'), '暂时节点');
    app.click('换行');
    app.click('删除');
    app.click('完成');
    expect(app.all().some(x => x.props['aria-label'] === '编辑目标内容')).toBe(false);
    app.click('保存');
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ title: '年度计划', description: '材料线索', nodes: [
      expect.objectContaining({ title: '阶段一', children: [expect.objectContaining({ title: '行动一' })] }),
    ] }));
  });

  it('文本格式错误阻止完成和外层保存；修复后保留已完成叶并可切换', () => {
    const onSave = vi.fn(async () => true);
    const app = mount(GoalPlanEditor, { goal, onSave, onClose: vi.fn() });
    app.find('button', p => p.className === 'gp-open-plan').props.onClick();
    expect(app.button('取消完成：精听训练')).toBeTruthy();
    app.click('文本');
    const text = () => app.find('textarea', p => p['aria-label'] === 'Markdown 目标内容');
    app.change(text(), '- 听力\n\t\t- 跳级');
    app.click('完成');
    expect(app.all().some(x => x.props.role === 'alert' && String(x.props.children).includes('第 2 行'))).toBe(true);
    expect(app.find('div', p => p['aria-label'] === '编辑目标内容')).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();
    app.change(text(), '- 听力\n\t- 精听训练\n\t- 泛听\n- 词汇');
    app.click('层级');
    expect(app.button('取消完成：精听训练')).toBeTruthy();
    app.click('取消完成：精听训练');
    expect(app.button('标记完成：精听训练')).toBeTruthy();
    app.click('完成');
    app.click('保存');
    expect(onSave.mock.lastCall?.[0].nodes[0].children[0]).toMatchObject({ id: 'a', completed: false });
    expect(onSave.mock.lastCall?.[0].nodes[1]).toMatchObject({ id: 'words', completed: true });
  });

  it('关闭已修改草稿需确认，保存失败提示且草稿仍可重试', async () => {
    const onClose = vi.fn();
    const onSave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const app = mount(GoalPlanEditor, { goal: null, onSave, onClose });
    app.change(app.input('gp-goal-title'), '新计划');
    app.click('关闭编辑');
    expect(onClose).not.toHaveBeenCalled();
    expect(app.find('div', p => p.role === 'alertdialog')).toBeTruthy();
    app.click('继续编辑');
    expect(app.all().some(x => x.props.role === 'alertdialog')).toBe(false);
    app.click('保存'); await flush();
    expect(app.all().some(x => x.props.role === 'alert' && String(x.props.children).includes('保存失败'))).toBe(true);
    app.click('保存'); await flush();
    expect(onSave).toHaveBeenCalledTimes(2);
    app.click('关闭编辑');
    app.click('放弃修改');
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('GoalMap 真实组件事件', () => {
  it('根与一级进度和逐层钻取、面包屑与返回', () => {
    const app = mount(GoalMap, { goal, onToggleLeaf: vi.fn(async () => true), onEdit: vi.fn(), onDelete: vi.fn(), onClose: vi.fn() });
    expect(app.find('strong', p => p.children === '75%')).toBeTruthy();
    app.click('查看 听力 的子目标');
    expect(app.find('strong', p => p.children === '50%')).toBeTruthy();
    expect(app.button('取消完成：精听训练')).toBeTruthy();
    app.click('返回上一级');
    expect(app.find('strong', p => p.children === '75%')).toBeTruthy();
    expect(app.button('查看 听力 的子目标')).toBeTruthy();
  });

  it('可沿多层节点钻取，再逐层返回与用面包屑回根', () => {
    const deep: LongTermGoal = {
      ...goal, nodes: [{ id: 'phase', title: '阶段', completed: false, children: [
        { id: 'step', title: '步骤', completed: false, children: [leaf('deep', '行动', true)] },
      ] }],
    };
    const app = mount(GoalMap, { goal: deep, onToggleLeaf: vi.fn(async () => true), onEdit: vi.fn(), onDelete: vi.fn(), onClose: vi.fn() });
    app.click('查看 阶段 的子目标');
    expect(app.button('查看 步骤 的子目标')).toBeTruthy();
    app.click('查看 步骤 的子目标');
    expect(app.button('取消完成：行动')).toBeTruthy();
    app.click('返回上一级');
    expect(app.button('查看 步骤 的子目标')).toBeTruthy();
    app.find('nav', p => p['aria-label'] === '目标层级').children.find(x => x.type === 'button')!.props.onClick();
    expect(app.button('查看 阶段 的子目标')).toBeTruthy();
  });

  it('叶节点保存失败明确提示且允许重试', async () => {
    const toggle = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const app = mount(GoalMap, { goal, onToggleLeaf: toggle, onEdit: vi.fn(), onDelete: vi.fn(), onClose: vi.fn() });
    app.click('取消完成：词汇'); await flush();
    expect(toggle).toHaveBeenCalledWith('words');
    expect(app.all().some(x => x.props.role === 'alert' && String(x.props.children).includes('更新完成状态失败'))).toBe(true);
    app.click('取消完成：词汇'); await flush();
    expect(toggle).toHaveBeenCalledTimes(2);
  });
});
