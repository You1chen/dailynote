import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const state = vi.hoisted(()=>({items:[] as any[]}));
vi.mock('../../src/hooks/useTrash',()=>({useTrash:()=>({items:state.items,loading:false,restore:vi.fn(),permDelete:vi.fn(),clearAll:vi.fn()})}));
vi.mock('../../src/components/ConfirmDialog',()=>({default:()=>null}));
vi.mock('../../src/hooks/useRouteBack',()=>({useRouteBack:()=>vi.fn()}));
import TrashPage from '../../src/pages/Trash';
describe('garden trash privacy',()=>{
 it('keeps even legacy wish titles out of public trash while other trash stays visible',()=>{
  state.items=[{id:1,originalTable:'longTermGoals',originalId:2,title:'秘密旧愿望标题',originalData:{kind:'wish'},deletedAt:Date.now()},{id:3,originalTable:'courses',originalId:4,title:'数学课',originalData:{},deletedAt:Date.now()}];
  const html=renderToStaticMarkup(<TrashPage/>);
  expect(html).not.toContain('秘密旧愿望标题');expect(html).not.toContain('秘密花园');expect(html).toContain('数学课');
 });
});
