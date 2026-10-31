import { beforeEach, describe, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ values: [] as any[], cursor: 0, effects: [] as (()=>void)[] }));
vi.mock('react', () => ({
  useState: (initial: any) => { const index=hooks.cursor++; if(!(index in hooks.values)) hooks.values[index]=typeof initial==='function'?initial():initial; return [hooks.values[index], (value:any)=>{hooks.values[index]=typeof value==='function'?value(hooks.values[index]):value;}]; },
  useCallback: (fn:any)=>fn,
  useEffect: (fn:()=>void)=>{hooks.effects.push(fn);},
}));
import { usePreferences } from '../../src/hooks/usePreferences';
let memory: Record<string,string>;
beforeEach(()=>{memory={};hooks.values=[];hooks.cursor=0;hooks.effects=[];vi.stubGlobal('localStorage',{getItem:(k:string)=>memory[k]??null,setItem:(k:string,v:string)=>{memory[k]=v;}});vi.stubGlobal('window',new EventTarget());});
const render=(start:number)=>{hooks.cursor=start;return usePreferences();};
describe('shared preferences',()=>{
 it('broadcasts settings updates to mounted consumers and preserves separately updated fields',()=>{
  const first=render(0),second=render(1);hooks.effects.forEach(f=>f());
  first.updatePrefs({theme:'dark'});
  expect(render(1).prefs.theme).toBe('dark');
  second.updatePrefs({defaultDuration:45});
  expect(render(0).prefs.theme).toBe('dark');
  expect(render(0).prefs.defaultDuration).toBe(45);
 });
 it('reset broadcasts defaults to other mounted consumers',()=>{
  const first=render(0);render(1);hooks.effects.forEach(f=>f());
  first.updatePrefs({theme:'dark',futureOnly:true});first.resetPrefs();
  expect(render(1).prefs.theme).toBe('system');expect(render(1).prefs.futureOnly).toBe(false);
 });
});
