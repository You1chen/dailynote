import { INIT_STORAGE_BLOCKED, loadFromFile } from './storage';

type StartupResult = { phase: 'storagePermission' } | { phase: 'ready'; count: number };

export async function initializeStartup(): Promise<StartupResult> {
  const count = await loadFromFile();
  if (count === INIT_STORAGE_BLOCKED) return { phase: 'storagePermission' };
  return { phase: 'ready', count };
}
