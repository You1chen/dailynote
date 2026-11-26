import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetForTest, store, exportJSON, importJSONIntoStore } from '../src/services/store';
import { setupGarden, unlockGarden, lockGarden, migrateLegacyWishes, encryptWish, decryptWish, changeGardenPassphrase, decryptGoals } from '../src/services/gardenSecurity';
import { setGardenPassword } from '../src/utils/gardenLock';
import type { LongTermGoal } from '../src/types';
const memory: Record<string,string> = {};
(globalThis as any).localStorage = { getItem: (k: string) => memory[k] ?? null, setItem: (k:string,v:string) => memory[k]=v, removeItem:(k:string)=>delete memory[k], clear:()=>Object.keys(memory).forEach(k=>delete memory[k]) };
const wish: LongTermGoal = { id: 20, kind:'wish', title:'绝密愿望', description:'秘密细节', category:'其他', tasks:[{id:'t',title:'秘密里程碑',completed:false,createdAt:1}], createdAt:1,updatedAt:1 };
beforeEach(async () => { lockGarden(); localStorage.clear(); await _resetForTest(); });
describe('portable encrypted garden', () => {
  it('verifies original PIN before migration and encrypts active, deleted, and historical labels', async () => {
    await setGardenPassword('1234'); store.longTermGoals=[wish]; store.trashItems=[{id:1,originalTable:'longTermGoals',originalId:22,originalData:{...wish,id:22},title:'绝密回收',deletedAt:1}];
    store.activityEvents=[{id:'e',date:'2026-10-31',occurredAt:1,category:'wish-milestone',action:'complete',entityId:'x',title:'绝密活动',parentTitle:'秘密父项',from:0,to:1}];
    expect(() => exportJSON()).toThrow('迁移'); await expect(setupGarden('9999')).rejects.toThrow('原来'); expect(store.longTermGoals[0].title).toBe(wish.title);
    await setupGarden('1234'); await migrateLegacyWishes(); const backup=exportJSON(); expect(backup).not.toContain('绝密'); expect(backup).not.toContain('秘密细节'); expect(backup).not.toContain('秘密父项'); expect(localStorage.getItem('dailynote_garden_lock')).toBeNull();
    expect((await decryptWish(store.longTermGoals[0])).title).toBe(wish.title);
    lockGarden(); await expect(unlockGarden('9999')).rejects.toThrow(); expect(await decryptGoals(store.longTermGoals)).toEqual([]);
  },30000);
  it('preserves independent imported key envelopes despite colliding numeric IDs', async () => {
    await setupGarden('first phrase'); store.longTermGoals=[await encryptWish(wish)]; const first=JSON.parse(exportJSON());
    await _resetForTest(); lockGarden(); await setupGarden('second phrase'); const secondEnvelope=store.gardenKeys[0]; secondEnvelope.id=first.gardenKeys[0].id;
    store.longTermGoals=[await encryptWish({...wish,id:99,title:'second secret'})]; await importJSONIntoStore(JSON.stringify(first));
    expect(store.gardenKeys).toHaveLength(2); await unlockGarden('first phrase'); expect((await decryptGoals(store.longTermGoals)).map(g=>g.title)).toEqual([wish.title]);
    await expect(encryptWish(store.longTermGoals.find(g=>g.id===99)!)).rejects.toThrow('原口令');
    await changeGardenPassphrase('first phrase','changed first phrase'); await unlockGarden('second phrase'); expect((await decryptGoals(store.longTermGoals)).map(g=>g.title)).toEqual(['second secret']);
  },30000);
  it('cancels an in-flight unlock when the garden is locked', async () => {
    await setupGarden('1234'); lockGarden(); const pending=unlockGarden('1234'); lockGarden(); await expect(pending).rejects.toThrow('取消');
  },30000);
  it('roundtrips large full content, detects tampering, and changes phrase without touching ciphertext', async () => {
    await setupGarden('1234'); const original={...wish,description:'很长的秘密'.repeat(50000),nodes:[{id:'secret-node',title:'秘密节点',children:[],completed:false}]}; const encrypted=await encryptWish(original as LongTermGoal); store.longTermGoals=[encrypted];
    expect(JSON.stringify(encrypted)).not.toContain('秘密节点'); const before=encrypted.encrypted!.ciphertext; const oldBackup=exportJSON(); await changeGardenPassphrase('1234','strong new phrase'); expect(store.longTermGoals[0].encrypted!.ciphertext).toBe(before);
    lockGarden(); await expect(unlockGarden('1234')).rejects.toThrow(); await unlockGarden('strong new phrase'); expect((await decryptWish(encrypted)).description).toBe(original.description);
    await importJSONIntoStore(oldBackup); lockGarden(); await unlockGarden('strong new phrase'); expect(store.gardenKeys).toHaveLength(1);
    const corrupt=structuredClone(encrypted); corrupt.encrypted!.ciphertext='AAAA'+corrupt.encrypted!.ciphertext.slice(4); await expect(decryptWish(corrupt)).rejects.toThrow();
    const portable=exportJSON(); await _resetForTest(); await importJSONIntoStore(portable); lockGarden(); await unlockGarden('strong new phrase'); expect((await decryptWish(store.longTermGoals[0])).title).toBe(wish.title);
  },30000);
});
