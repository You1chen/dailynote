const KEY = 'dailynote_garden_lock';
interface GardenLock { salt: string; hash: string }
export function hasGardenPassword(): boolean { return localStorage.getItem(KEY) !== null; }
export function validGardenPin(pin: string): boolean { return /^\d{4,12}$/.test(pin); }
async function digest(pin: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, '0')).join('');
}
export async function setGardenPassword(pin: string): Promise<void> {
  if (!validGardenPin(pin)) throw new Error('请使用 4–12 位数字密码');
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(24)), n => n.toString(16).padStart(2, '0')).join('');
  const record: GardenLock = { salt, hash: await digest(pin, salt) };
  localStorage.setItem(KEY, JSON.stringify(record));
}
export async function verifyGardenPassword(pin: string): Promise<boolean> {
  const raw = localStorage.getItem(KEY);
  if (!raw || !validGardenPin(pin)) return false;
  const lock: GardenLock = JSON.parse(raw);
  return await digest(pin, lock.salt) === lock.hash;
}
