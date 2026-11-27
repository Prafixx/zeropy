// The title bar of the desktop app: the app's own, in place of the plain
// bar of Windows. Left: the name in the tiny pixel font. In the middle: a
// meter with one cell for each Python lesson, like the status bar of a game.
// Right: the window buttons (minimize, full screen, close), the app's own.
// In full screen the bar hides; it slides down when the pointer reaches the
// top edge of the screen.
import { course } from './registry';
import { lessonState } from './store';
import { h, icon } from './ui';

interface WindowBridge {
  minimize?(): void;
  close?(): void;
  fullScreen?(on: boolean): void;
  onState?(listener: (state: { full: boolean; zoom: number }) => void): void;
}

const bridge = (): WindowBridge | undefined => (window as unknown as { zeropyWindow?: WindowBridge }).zeropyWindow;

let meter: HTMLElement | null = null;
let full = false;

/** Draws the bar once, in the desktop app only. */
export function mountTitleBar(): void {
  if (!bridge() || document.querySelector('.titlebar')) return;
  document.documentElement.classList.add('has-titlebar');
  meter = h('span', { class: 'titlebar-meter', 'aria-hidden': 'true' });
  const win = bridge()!;
  // The window buttons: the same size and line, in the style of the app.
  const control = (cls: string, name: string, label: string, onClick: () => void): HTMLButtonElement => {
    const el = h('button', { type: 'button', class: `titlebar-btn ${cls}`, 'aria-label': label, title: label }, icon(name, 20));
    el.addEventListener('click', onClick);
    return el;
  };
  // Full screen: fills the whole screen, over the taskbar. Esc leaves it.
  const toggle = control('titlebar-full', 'expand', 'Full screen (F11)', () => win.fullScreen?.(!full));
  const show = (on: boolean): void => {
    full = on;
    document.documentElement.classList.toggle('is-full-screen', on);
    toggle.replaceChildren(icon(on ? 'shrink' : 'expand', 20));
    const text = on ? 'Leave full screen (Esc)' : 'Full screen (F11)';
    toggle.setAttribute('aria-label', text);
    toggle.title = text;
  };
  show(false);
  win.onState?.((state) => show(state.full));
  document.addEventListener('keydown', (event) => {
    // Esc closes a dialog or a menu first; only a free Esc leaves full screen.
    if (event.key !== 'Escape' || !full || event.defaultPrevented) return;
    if (document.querySelector('dialog[open], .menu:not([hidden])')) return;
    win.fullScreen?.(false);
  });
  // The thin edge at the top of the screen that calls the bar in full screen.
  const edge = h('div', { class: 'titlebar-edge', 'aria-hidden': 'true' });
  document.body.prepend(
    edge,
    h(
      'header',
      { class: 'titlebar' },
      h('span', { class: 'titlebar-name' }, 'ZEROPY'),
      h('span', { class: 'titlebar-progress' }, meter),
      h(
        'span',
        { class: 'titlebar-controls' },
        win.minimize ? control('titlebar-min', 'minus', 'Minimize', () => win.minimize?.()) : null,
        win.fullScreen ? toggle : null,
        win.close ? control('titlebar-close', 'close', 'Close', () => win.close?.()) : null,
      ),
    ),
  );
  updateTitleBar();
}

/** The lessons done, after each move in the app: one cell for each lesson. */
export function updateTitleBar(): void {
  if (!meter) return;
  const ids = course.modules.flatMap((m) => m.lessons.map((l) => l.id));
  if (meter.children.length !== ids.length) meter.replaceChildren(...ids.map(() => h('i')));
  let done = 0;
  ids.forEach((id, i) => {
    const on = lessonState(id).done;
    if (on) done += 1;
    meter!.children[i].classList.toggle('is-on', on);
  });
  meter.title = `${done} of ${ids.length} Python lessons done`;
}
