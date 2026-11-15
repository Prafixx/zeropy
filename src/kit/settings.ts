// Learner settings for graphics and motion. Stored on the device.
import { setReducedMotion } from './motion';

export type Graphics = '3d-high' | '3d-low' | '2d';
export type MotionPref = 'system' | 'full' | 'reduced';

export interface Settings {
  graphics: Graphics;
  motion: MotionPref;
}

const KEY = 'zeropy:settings';
const listeners = new Set<(s: Settings) => void>();
const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function load(): Settings {
  const base: Settings = { graphics: webglAvailable() ? '3d-high' : '2d', motion: 'system' };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return { ...base, ...saved };
  } catch {
    return base;
  }
}

let settings = load();

export function getSettings(): Settings {
  return settings;
}

export function reducedMotion(): boolean {
  return settings.motion === 'reduced' || (settings.motion === 'system' && systemReduced.matches);
}

/** True when motion is reduced only because the system asks for it. */
export function reducedBySystem(): boolean {
  return settings.motion === 'system' && systemReduced.matches;
}

/** What the stages really use. Reduced motion always means the 2D stage. */
export function effectiveGraphics(): Graphics {
  return reducedMotion() ? '2d' : settings.graphics;
}

export function setSettings(patch: Partial<Settings>): void {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage can be blocked. The setting then lasts for this visit only.
  }
  apply();
  listeners.forEach((fn) => fn(settings));
}

export function onSettings(fn: (s: Settings) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function apply(): void {
  setReducedMotion(reducedMotion());
}

systemReduced.addEventListener('change', () => {
  apply();
  listeners.forEach((fn) => fn(settings));
});
apply();
