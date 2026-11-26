import type { GardenCipher, GardenKeyEnvelope } from '../types/garden';
import type { LongTermGoal, TrashItem } from '../types';
import { mutate, store, persist } from './store';
import { clearSnapshot } from './snapshot';

const enc = new TextEncoder();
let unlocked = new Map<string, CryptoKey>();
let activeKeyId: string | null = null;
let lockRevision = 0;

const b64 = (bytes: Uint8Array) => { let out = ''; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(out); };
const un64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const randomId = () => crypto.randomUUID();
function secretFields(g: LongTermGoal) {
  const { id, kind, createdAt, updatedAt, encrypted, ...content } = g;
  return content;
}
async function derive(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrapPrivate(privateKey: CryptoKey, passphrase: string): Promise<Pick<GardenKeyEnvelope, 'salt'|'iterations'|'iv'|'privateKey'>> {
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12)); const iterations = 310000;
  const wrappingKey = await derive(passphrase, new Uint8Array(salt), iterations);
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, pkcs8);
  return { salt: b64(salt), iterations, iv: b64(iv), privateKey: b64(new Uint8Array(cipher)) };
}
async function createEnvelope(passphrase: string, keyId = randomId()): Promise<{ envelope: GardenKeyEnvelope; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 3072, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['encrypt','decrypt']);
  const publicKey = b64(new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey)));
  return { envelope: { keyId, version: 1, publicKey, ...(await wrapPrivate(pair.privateKey, passphrase)), updatedAt: Date.now() }, privateKey: pair.privateKey };
}
async function unlockEnvelope(envelope: GardenKeyEnvelope, passphrase: string): Promise<CryptoKey> {
  const wrappingKey = await derive(passphrase, un64(envelope.salt), envelope.iterations);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(envelope.iv) }, wrappingKey, un64(envelope.privateKey));
  return crypto.subtle.importKey('pkcs8', plain, { name: 'RSA-OAEP', hash: 'SHA-256' }, true, ['decrypt']);
}

export function isGardenUnlocked(): boolean { return unlocked.size > 0; }
export function getLockedWishCount(): number { return store.longTermGoals.filter(g => !!g.encrypted && !unlocked.has(g.encrypted.keyId)).length; }
export function hasGardenVault(): boolean { return store.gardenKeys.length > 0; }
export function hasLegacyGardenContent(): boolean {
  return store.longTermGoals.some(g => g.kind === 'wish' && !g.encrypted) || store.trashItems.some(t => t.originalTable === 'longTermGoals' && (t.originalData as LongTermGoal)?.kind === 'wish' && !(t.originalData as LongTermGoal).encrypted) || store.activityEvents.some(e => e.category === 'wish-milestone' && !e.encrypted);
}
export function lockGarden(): void { lockRevision++; unlocked.clear(); activeKeyId = null; }
export async function unlockGarden(passphrase: string): Promise<void> {
  const revision = lockRevision;
  const keys = new Map<string, CryptoKey>();
  let active: string | null = null;
  for (const envelope of store.gardenKeys) {
    try { keys.set(envelope.keyId, await unlockEnvelope(envelope, passphrase)); active ??= envelope.keyId; } catch { /* Separate imported vaults may use separate passphrases. */ }
  }
  if (!keys.size) throw new Error('口令不正确，或此备份密钥使用了不同口令');
  if (revision !== lockRevision) throw new Error('解锁已取消，请重新输入口令');
  unlocked = keys; activeKeyId = active;
}
export async function setupGarden(passphrase: string): Promise<void> {
  const revision = lockRevision;
  const legacy = await import('../utils/gardenLock');
  if (legacy.hasGardenPassword() && !(await legacy.verifyGardenPassword(passphrase))) throw new Error('请使用原来的数字密码完成迁移');
  if (passphrase.trim().length < 4) throw new Error('密码至少需要 4 个字符');
  const { envelope, privateKey } = await createEnvelope(passphrase);
  if (revision !== lockRevision) throw new Error('设置已取消，请重试');
  const previous = [...store.gardenKeys];
  const ok = await mutate(() => { store.gardenKeys.push({ ...envelope, id: Date.now() }); });
  if (!ok) { store.gardenKeys = previous; throw new Error('保存加密密钥失败'); }
  if (revision !== lockRevision) throw new Error('解锁已取消，请重新输入口令');
  unlocked = new Map([[envelope.keyId, privateKey]]); activeKeyId = envelope.keyId;
}
export async function changeGardenPassphrase(current: string, next: string): Promise<void> {
  const revision = lockRevision;
  if (next.trim().length < 4) throw new Error('密码至少需要 4 个字符');
  await unlockGarden(current);
  const replacement: GardenKeyEnvelope[] = [];
  for (const old of store.gardenKeys) {
    const privateKey = unlocked.get(old.keyId);
    replacement.push(privateKey ? { ...old, ...(await wrapPrivate(privateKey, next)), updatedAt: Date.now() } : old);
  }
  if (revision !== lockRevision) throw new Error('更改已取消，请重试');
  const previous = store.gardenKeys;
  const ok = await mutate(() => { store.gardenKeys = replacement; });
  if (!ok) { store.gardenKeys = previous; throw new Error('保存新密码失败'); }
  lockGarden();
}
async function encryptValue(keyId: string, value: unknown): Promise<GardenCipher> {
  const aes = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt','decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(JSON.stringify(value)));
  const envelope = store.gardenKeys.find(k => k.keyId === keyId)!;
  const publicKey = await crypto.subtle.importKey('spki', un64(envelope.publicKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const rawKey = await crypto.subtle.exportKey('raw', aes);
  const wrappedKey = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, publicKey, rawKey);
  return { version: 1, keyId, wrappedKey: b64(new Uint8Array(wrappedKey)), iv: b64(iv), ciphertext: b64(new Uint8Array(ciphertext)) };
}
export async function decryptWish(goal: LongTermGoal): Promise<LongTermGoal> {
  if (!goal.encrypted) return goal;
  const key = unlocked.get(goal.encrypted.keyId); if (!key) throw new Error('花园已锁定');
  const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, key, un64(goal.encrypted.wrappedKey));
  const aes = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: un64(goal.encrypted.iv) }, aes, un64(goal.encrypted.ciphertext));
  const content = JSON.parse(new TextDecoder().decode(plain));
  if (!content || typeof content.title !== 'string' || typeof content.description !== 'string' || !Array.isArray(content.tasks)) throw new Error('花园密文内容格式无效');
  return { ...content, id: goal.id, kind: 'wish', createdAt: goal.createdAt, updatedAt: goal.updatedAt, encrypted: goal.encrypted };
}
export async function encryptWish(goal: LongTermGoal): Promise<LongTermGoal> {
  if (goal.kind !== 'wish') return goal;
  if (!activeKeyId || !unlocked.has(activeKeyId)) throw new Error('请先解锁花园');
  if (goal.encrypted && !unlocked.has(goal.encrypted.keyId)) throw new Error('此愿望需要导入备份的原口令，请勿覆盖');
  const encrypted = await encryptValue(activeKeyId, secretFields(goal));
  return { id: goal.id, kind: 'wish', createdAt: goal.createdAt, updatedAt: goal.updatedAt, title: '', description: '', category: '', tasks: [], encrypted };
}
export async function migrateLegacyWishes(): Promise<number> {
  if (!isGardenUnlocked()) throw new Error('请先解锁花园');
  const goals: LongTermGoal[] = [];
  for (const goal of store.longTermGoals) goals.push(goal.kind === 'wish' && !goal.encrypted ? await encryptWish(goal) : goal);
  const trash: TrashItem[] = [];
  for (const item of store.trashItems) {
    if (item.originalTable !== 'longTermGoals' || (item.originalData as LongTermGoal)?.kind !== 'wish' || (item.originalData as LongTermGoal).encrypted) trash.push(item);
    else {
      const originalData = await encryptWish(item.originalData as LongTermGoal);
      trash.push({ ...item, title: '已加密愿望', originalData });
    }
  }
  const events: import('../types/settlement').ActivityEvent[] = [];
  for (const event of store.activityEvents) {
    if (event.category === 'wish-milestone' && !event.encrypted) events.push({ ...event, encrypted: await encryptValue(activeKeyId!, { title: event.title, parentTitle: event.parentTitle }), title: '秘密花园活动', parentTitle: undefined });
    else events.push(event);
  }
  const previous = { goals: store.longTermGoals, trash: store.trashItems, events: store.activityEvents };
  const ok = await mutate(() => { store.longTermGoals = goals; store.trashItems = trash; store.activityEvents = events; }, { skipActivity: true });
  if (!ok) { store.longTermGoals = previous.goals; store.trashItems = previous.trash; store.activityEvents = previous.events; }
  if (!ok) throw new Error('加密迁移未能保存，原始数据仍保留');
  if (!(await persist())) throw new Error('保存加密数据失败');
  await clearSnapshot();
  localStorage.removeItem('dailynote_garden_lock');
  return goals.filter(g => g.encrypted).length;
}
export async function decryptGoals(goals: LongTermGoal[]): Promise<LongTermGoal[]> {
  if (!isGardenUnlocked()) return goals.filter(g => g.kind !== 'wish');
  return Promise.all(goals.filter(g => !g.encrypted || unlocked.has(g.encrypted.keyId)).map(g => g.encrypted ? decryptWish(g) : g));
}
