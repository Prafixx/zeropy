// The title bar of the desktop app: the app's own, in place of the plain
// bar of Windows. Left: the name in the tiny pixel font. Right: a pixel
// meter of the Python lessons done, like the status bar of a game. Windows
// draws its own buttons to the right of it, in the colors of the theme.
import { course } from './registry';
import { lessonState } from './store';
import { h, icon } from './ui';

interface WindowBridge {
  titleBar(colors: { color: string; symbolColor: string }): void;
  fullScreen?(on: boolean): void;
  onState?(listener: (state: { full: boolean; zoom: number }) => void): void;
}

const bridge = (): WindowBridge | undefined => (window as unknown as { zeropyWindow?: WindowBridge }).zeropyWindow;

const CELLS = 10;
let meter: HTMLElement | null = null;
let count: HTMLElement | null = null;
let full = false;

/** Draws the bar once, in the desktop app only. */
export function mountTitleBar(): void {
  if (!bridge() || document.querySelector('.titlebar')) return;
  document.documentElement.classList.add('has-titlebar');
  meter = h('span', { class: 'titlebar-meter', 'aria-hidden': 'true' }, ...Array.from({ length: CELLS }, () => h('i')));
  count = h('span', { class: 'titlebar-count' });
  // Full screen: fills the whole screen, over the taskbar. Esc leaves it.
  const toggle = h('button', { type: 'button', class: 'titlebar-full' });
  const win = bridge()!;
  const show = (on: boolean): void => {
    full = on;
    document.documentElement.classList.toggle('is-full-screen', on);
    toggle.replaceChildren(icon(on ? 'shrink' : 'expand', 16));
    const text = on ? 'Leave full screen (Esc)' : 'Full screen (F11)';
    toggle.title = text;
    toggle.setAttribute('aria-label', text);
  };
  show(false);
  toggle.addEventListener('click', () => win.fullScreen?.(!full));
  win.onState?.((state) => show(state.full));
  document.addEventListener('keydown', (event) => {
    // Esc closes a dialog or a menu first; only a free Esc leaves full screen.
    if (event.key !== 'Escape' || !full || event.defaultPrevented) return;
    if (document.querySelector('dialog[open], .menu:not([hidden])')) return;
    win.fullScreen?.(false);
  });
  document.body.prepend(
    h(
      'header',
      { class: 'titlebar' },
      h('span', { class: 'titlebar-name' }, 'ZEROPY'),
      h('span', { class: 'titlebar-hud' }, meter, count, win.fullScreen ? toggle : null),
    ),
  );
  paintTitleBar();
  updateTitleBar();
}

/** The lessons done, after each move in the app. */
export function updateTitleBar(): void {
  if (!meter || !count) return;
  const ids = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
  const done = ids.filter((id) => lessonState(id).done).length;
  const full = Math.round((done / Math.max(ids.length, 1)) * CELLS);
  meter.querySelectorAll('i').forEach((cell, i) => cell.classList.toggle('is-on', i < full || (i === 0 && done > 0)));
  count.textContent = `${done}/${ids.length} LESSONS`;
}

/** The window buttons take the colors of the bar (after a change of theme). */
export function paintTitleBar(): void {
  const win = bridge();
  if (!win) return;
  const css = getComputedStyle(document.documentElement);
  win.titleBar({ color: css.getPropertyValue('--paper-2').trim(), symbolColor: css.getPropertyValue('--ink').trim() });
}
