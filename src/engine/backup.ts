// Save progress to a file and load it back (on another PC, or after a reinstall).
// The file holds the same data the app keeps on the device: lessons,
// review cards, the learner's code and the settings.

const KEYS = { progress: 'zeropy:v1', settings: 'zeropy:settings' } as const;

interface Backup {
  app: 'zeropy';
  version: 1;
  savedAt: string;
  progress: unknown;
  settings: unknown;
}

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Starts a download of the progress file. */
export function exportProgress(): void {
  const backup: Backup = {
    app: 'zeropy',
    version: 1,
    savedAt: new Date().toISOString(),
    progress: read(KEYS.progress) ?? {},
    settings: read(KEYS.settings) ?? {},
  };
  const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `zeropy-progress-${backup.savedAt.slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Checks a progress file. Returns an error message, or null when it is good. */
export function checkBackup(text: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return 'This file is not a ZeroPy progress file.';
  }
  if (!isRecord(data) || data.app !== 'zeropy') return 'This file is not a ZeroPy progress file.';
  if (data.version !== 1) return 'This file comes from a newer version of ZeroPy. Update the app first.';
  const progress = data.progress;
  if (!isRecord(progress)) return 'The progress in this file is damaged.';
  for (const part of ['lessons', 'cards', 'code', 'mistakes', 'practiced', 'knowledge', 'skipped']) {
    if (progress[part] !== undefined && !isRecord(progress[part])) return 'The progress in this file is damaged.';
  }
  return null;
}

/** Replaces the progress on this device with the file. Call checkBackup first. */
export function importProgress(text: string): void {
  const data = JSON.parse(text) as Backup;
  localStorage.setItem(KEYS.progress, JSON.stringify(data.progress));
  if (isRecord(data.settings)) localStorage.setItem(KEYS.settings, JSON.stringify(data.settings));
}

/** Lets the learner pick a progress file, then loads it. */
export function pickProgressFile(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const problem = checkBackup(text);
      if (problem) {
        window.alert(problem);
        return;
      }
      if (!window.confirm('Replace the progress on this device with the progress in this file?')) return;
      try {
        importProgress(text);
      } catch {
        window.alert('The progress could not be saved on this device.');
        return;
      }
      window.location.hash = '#/';
      window.location.reload();
    });
  });
  input.click();
}
