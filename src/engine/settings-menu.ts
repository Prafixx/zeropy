// Settings popover: graphics, motion and colors as segmented controls,
// then progress (save, load, reset) and the version.
import { getSettings, reducedMotion, setSettings } from '@/kit/settings';
import type { Graphics, MotionPref, ThemePref } from '@/kit/settings';
import { exportProgress, pickProgressFile } from './backup';
import { confirmDialog } from './dialog';
import { resetProgress } from './store';
import { updateBlock } from './updates';
import { h, icon, mascot } from './ui';

const GRAPHICS: { value: Graphics; label: string; note: string }[] = [
  { value: '3d-high', label: '3D', note: 'The best picture.' },
  { value: '3d-low', label: '3D light', note: '3D for slower computers.' },
  { value: '2d', label: '2D', note: 'The simplest and fastest picture.' },
];

const MOTION: { value: MotionPref; label: string; note: string }[] = [
  { value: 'system', label: 'System', note: 'As your computer is set.' },
  { value: 'full', label: 'Full', note: 'All animations.' },
  { value: 'reduced', label: 'Reduced', note: 'Only the animations that show how code runs.' },
];

const THEME: { value: ThemePref; label: string; note: string }[] = [
  { value: 'system', label: 'System', note: 'As your computer is set.' },
  { value: 'light', label: 'Light', note: 'Warm paper.' },
  { value: 'dark', label: 'Dark', note: 'Easy on the eyes at night.' },
];

/** `side`: the labeled button at the foot of the sidebar; its menu opens beside it. */
export function settingsButton(options: { side?: boolean } = {}): HTMLElement {
  const menu = h('div', { class: `menu${options.side ? ' menu-side' : ''}`, hidden: true, role: 'dialog', 'aria-label': 'Settings' });
  const toggle = options.side
    ? h('button', { type: 'button', class: 'side-link', 'aria-expanded': 'false' }, icon('gear', 20), h('span', { class: 'side-label' }, 'Settings'))
    : h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', 'aria-expanded': 'false' }, icon('gear', 20));
  const wrap = h('div', { class: 'menu-wrap' }, toggle, menu);

  /** A segmented control: real radio buttons, drawn as one row of segments. */
  function group<T extends string>(title: string, name: string, options: { value: T; label: string; note: string }[], current: T, onPick: (v: T) => void): HTMLElement {
    const note = h('p', { class: 'menu-note' }, options.find((o) => o.value === current)?.note ?? '');
    return h(
      'fieldset',
      { class: 'menu-group' },
      h('legend', null, title),
      h(
        'div',
        { class: 'segmented' },
        ...options.map((option) => {
          const input = h('input', { type: 'radio', name, value: option.value, class: 'sr-only' }) as HTMLInputElement;
          input.checked = option.value === current;
          input.addEventListener('change', () => {
            note.textContent = option.note;
            onPick(option.value);
          });
          return h('label', { class: 'segment' }, input, h('span', null, option.label));
        }),
      ),
      note,
    );
  }

  function render(): void {
    const settings = getSettings();
    const parts = [
      group('Graphics', 'graphics', GRAPHICS, settings.graphics, (graphics) => setSettings({ graphics })),
      reducedMotion() ? h('p', { class: 'menu-note menu-note-info' }, 'Reduced motion is on: scenes use 2D.') : null,
      group('Motion', 'motion', MOTION, settings.motion, (motion) => {
        setSettings({ motion });
        render();
      }),
      group('Colors', 'theme', THEME, settings.theme, (theme) => setSettings({ theme })),
      h(
        'fieldset',
        { class: 'menu-group' },
        h('legend', null, 'My progress'),
        h(
          'div',
          { class: 'menu-actions' },
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => exportProgress() }, icon('download', 16), h('span', { class: 'btn-label' }, 'Save a copy')),
          h('button', { type: 'button', class: 'btn btn-small', onclick: () => pickProgressFile() }, icon('upload', 16), h('span', { class: 'btn-label' }, 'Load a copy')),
        ),
        h('p', { class: 'menu-note' }, 'Keep a copy, or move your progress to another computer.'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-ghost btn-small menu-reset',
            onclick: async () => {
              close();
              const ok = await confirmDialog({
                title: 'Delete all progress?',
                body: [
                  'Your lessons, review cards, mistakes and saved code on this device are deleted. Your settings stay.',
                  'This cannot be undone. Save a copy to a file first if you may want it back.',
                ],
                confirm: 'Delete my progress',
                danger: true,
              });
              if (ok) {
                resetProgress();
                window.location.hash = '#/';
                window.location.reload();
              }
            },
          },
          h('span', { class: 'btn-label' }, 'Reset my progress'),
        ),
      ),
      updateBlock(),
    ];
    menu.replaceChildren(...parts.filter((part) => part !== null));
  }

  function close(): void {
    menu.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside);
    document.removeEventListener('keydown', onKey);
  }
  function onOutside(event: Event): void {
    if (!wrap.contains(event.target as Node)) close();
  }
  function onKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      close();
      toggle.focus();
    }
  }
  toggle.addEventListener('click', () => {
    if (!menu.hidden) return close();
    render();
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside);
    document.addEventListener('keydown', onKey);
  });
  return wrap;
}

export function brand(): HTMLElement {
  return h(
    'a',
    { class: 'brand', href: '#/', 'aria-label': 'ZeroPy home' },
    mascot(34, 'brand-mark'),
    h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, 'Zero', h('b', null, 'Py')), h('span', { class: 'brand-sub' }, 'Python from zero')),
  );
}
