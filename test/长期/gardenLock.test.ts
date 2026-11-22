import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hasGardenPassword, setGardenPassword, verifyGardenPassword, validGardenPin } from '../../src/utils/gardenLock';
const records = new Map<string, string>();
beforeEach(() => {
  records.clear();
  vi.stubGlobal('localStorage', { getItem: (key: string) => records.get(key) ?? null, setItem: (key: string, value: string) => records.set(key, value) });
});
describe('secret garden password', () => {
  it('sets a numeric password, stores only salted digest, and rejects wrong input', async () => {
    expect(hasGardenPassword()).toBe(false);
    await setGardenPassword('012345');
    expect(hasGardenPassword()).toBe(true);
    expect([...records.values()].join('')).not.toContain('012345');
    expect(await verifyGardenPassword('012345')).toBe(true);
    expect(await verifyGardenPassword('012346')).toBe(false);
  });
  it('accepts leading zeros and rejects nonnumeric or unsuitable lengths', async () => {
    expect(validGardenPin('0000')).toBe(true);
    for (const pin of ['', '123', '12a45', '1234567890123']) {
      expect(validGardenPin(pin)).toBe(false);
      await expect(setGardenPassword(pin)).rejects.toThrow();
    }
    expect(hasGardenPassword()).toBe(false);
  });
});
