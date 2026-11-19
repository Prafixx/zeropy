// Settings popover: graphics quality, motion, colors and progress.
import { getSettings, reducedMotion, setSettings } from '@/kit/settings';
import type { Graphics, MotionPref, ThemePref } from '@/kit/settings';
import { exportProgress, pickProgressFile } from './backup';
import { resetProgress } from './store';
import { updateBlock } from './updates';
import { h, icon } from './ui';

const GRAPHICS: { value: Graphics; label: string; note: string }[] = [
  { value: '3d-high', label: '3D', note: 'Best picture' },
  { value: '3d-low', label: '3D light', note: 'For slow computers' },
  { value: '2d', label: '2D', note: 'Simplest, fastest' },
];

const MOTION: { value: MotionPref; label: string }[] = [
  { value: 'system', label: 'Same as my system' },
  { value: 'full', label: 'Full' },
  { value: 'reduced', label: 'Reduced' },
];

const THEME: { value: ThemePref; label: string }[] = [
  { value: 'system', label: 'Same as my system' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

export function settingsButton(): HTMLElement {
  const menu = h('div', { class: 'menu', hidden: true, role: 'dialog', 'aria-label': 'Settings' });
  const toggle = h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Settings', 'aria-expanded': 'false' }, icon('gear', 20));
  const wrap = h('div', { class: 'menu-wrap' }, toggle, menu);

  function group<T extends string>(title: string, name: string, options: { value: T; label: string; note?: string }[], current: T, onPick: (v: T) => void): HTMLElement {
    return h(
      'fieldset',
      { class: 'menu-group' },
      h('legend', null, title),
      ...options.map((option) => {
        const input = h('input', { type: 'radio', name, value: option.value });
        input.checked = option.value === current;
        input.addEventListener('change', () => onPick(option.value));
        return h('label', { class: 'menu-option' }, input, h('span', null, option.label), option.note ? h('small', null, option.note) : null);
      }),
    );
  }

  function render(): void {
    const settings = getSettings();
    const parts = [
      group('Graphics', 'graphics', GRAPHICS, settings.graphics, (graphics) => setSettings({ graphics })),
      reducedMotion() ? h('p', { class: 'menu-note' }, 'Reduced motion is on, so scenes use 2D.') : null,
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
          h('button', { type: 'button', class: 'btn btn-plain btn-small', onclick: () => exportProgress() }, h('span', { class: 'btn-label' }, 'Save to a file')),
          h('button', { type: 'button', class: 'btn btn-plain btn-small', onclick: () => pickProgressFile() }, h('span', { class: 'btn-label' }, 'Load a file')),
        ),
        h('p', { class: 'menu-note' }, 'Keep a copy, or move your progress to another computer.'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'menu-reset',
          onclick: () => {
            if (window.confirm('Delete all progress on this device?')) {
              resetProgress();
              window.location.hash = '#/';
              window.location.reload();
            }
          },
        },
        'Reset my progress',
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
    h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, h('i', null)),
    h('span', { class: 'brand-name' }, 'Zero', h('b', null, 'Py')),
  );
}
