import { expect, it } from 'vitest';
import { collectMemories, matchesDay, age, deal } from '../src/utils/wanderDeck';
const now = new Date(2026,10,17,12);
it('retains the original media and idea date but excludes temporary thoughts',()=>{
 const blocks=[{kind:'image' as const,id:'x',data:'data:',createdAt:1,updatedAt:1}];
 const idea={id:1,date:'2024-11-17',text:'回忆',createdAt:+now,updatedAt:+now};
 const items=collectMemories([{id:'1',title:'相片',contents:blocks,createdAt:+now,updatedAt:+now}], [idea,{...idea,kind:'wish'},{...idea,kind:'chore'}]);
 expect(items.map(i=>i.id)).toEqual(['c:1','i:1']); expect(items[0]).toHaveProperty('blocks',blocks); expect(items[1].day).toBe(idea.date);
});
it('uses inclusive bounds and excludes the present year from anniversaries',()=>{
 expect(matchesDay('2024-11-17','2024-11-17','2024-11-17',true,now)).toBe(true);expect(matchesDay('2026-11-17','','',true,now)).toBe(false);expect(matchesDay('2023-11-16','','',true,now)).toBe(false);expect(age('2026-06-20',now)).toBe('4月 28天前');
});
it('shuffles without modifying or losing source entries',()=>{const data=[1,2,3];expect(deal(data,()=>0)).toEqual([2,3,1]);expect(data).toEqual([1,2,3]);});
