import { INIT_STORAGE_BLOCKED, loadFromFile } from './storage';

const ONBOARDING_KEY = 'dailynote_onboarding_dismissed';

type StartupResult = { phase: 'storagePermission' } | { phase: 'ready'; count: number; showOnboarding: boolean };

function hasLocalState(): boolean {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i)?.startsWith('dailynote_')) return true;
    }
    return false;
  } catch {
    // An unreadable configuration is not evidence of a fresh installation.
    return true;
  }
}

export async function initializeStartup(): Promise<StartupResult> {
  // Sample before mounting the app, which can write default preferences.
  const hadLocalState = hasLocalState();
  const count = await loadFromFile();
  if (count === INIT_STORAGE_BLOCKED) return { phase: 'storagePermission' };
  return { phase: 'ready', count, showOnboarding: count === -1 && !hadLocalState && !hasLocalState() };
}

export function dismissOnboarding(): void {
  try {
    localStorage.setItem(ONBOARDING_KEY, '1');
  } catch {
    // Still allow closing the dialog for this session.
  }
}
