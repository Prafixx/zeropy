// "Check for updates": asks GitHub for the newest release, but only when the
// learner clicks. The app never goes online by itself.
import { h } from './ui';

export const APP_VERSION: string = __APP_VERSION__;
const LATEST = 'https://api.github.com/repos/Prafixx/zeropy/releases/latest';
const PAGE = 'https://github.com/Prafixx/zeropy/releases/latest';

/** -1, 0 or 1, like a comparison of "0.2.0" and "0.10.1" part by part. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

/** A small block for the settings menu: the version and the check button. */
export function updateBlock(): HTMLElement {
  const result = h('p', { class: 'menu-note', 'aria-live': 'polite' });
  const check = h(
    'button',
    { type: 'button', class: 'btn btn-plain btn-small' },
    h('span', { class: 'btn-label' }, 'Check for updates'),
  );
  check.addEventListener('click', async () => {
    check.disabled = true;
    result.textContent = 'Asking GitHub…';
    try {
      const response = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(String(response.status));
      const release = (await response.json()) as { tag_name?: string };
      const newest = (release.tag_name ?? '').replace(/^v/, '');
      if (!newest) throw new Error('no tag');
      if (compareVersions(newest, APP_VERSION) > 0) {
        result.replaceChildren(
          `Version ${newest} is ready. `,
          h('a', { href: PAGE, target: '_blank', rel: 'noopener noreferrer' }, 'Open the download page'),
          '. Your progress stays when you install it.',
        );
      } else {
        result.textContent = 'You have the newest version.';
      }
    } catch {
      result.textContent = 'GitHub could not be reached. Check your internet connection and try again.';
    } finally {
      check.disabled = false;
    }
  });
  return h(
    'fieldset',
    { class: 'menu-group' },
    h('legend', null, 'About'),
    h('p', { class: 'menu-version' }, `ZeroPy ${APP_VERSION}`),
    check,
    result,
  );
}
