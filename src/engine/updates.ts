// "Check for updates": asks GitHub for the newest release, but only when the
// learner clicks. The app never goes online by itself. The installed app
// updates itself (desktop/main.cjs, electron-updater): download, then
// restart. The portable app and the web version get the download page.
import { h } from './ui';

/** Why a check failed (desktop/main.cjs, classify). */
type Reason = 'offline' | 'unreachable' | 'timeout' | 'limited' | 'not-ready' | 'github-down' | 'unknown';

interface UpdateBridge {
  check(): Promise<{ state: 'available' | 'none' | 'manual' | 'error'; version?: string; size?: number | null; reason?: Reason; retryAfter?: number | null }>;
  latest?(): Promise<{ state: 'latest' | 'error'; version?: string; reason?: Reason; retryAfter?: number | null }>;
  download(): Promise<boolean>;
  install(): Promise<boolean>;
  onEvent(listener: (data: { state: 'progress' | 'ready' | 'error'; percent?: number; version?: string; reason?: Reason }) => void): () => void;
}

/** Set by desktop/preload.cjs in the desktop app; undefined on the web. */
const bridge = (window as unknown as { zeropyUpdates?: UpdateBridge }).zeropyUpdates;

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

/** A plain sentence for each reason a check can fail. */
function failure(reason: Reason | undefined, retryAfter?: number | null): string {
  switch (reason) {
    case 'offline':
      return 'This computer is offline. Connect to the internet, then try again.';
    case 'unreachable':
      return 'This computer is online, but github.com could not be reached (ZeroPy tried three times). A firewall, a VPN or the network may block it. Try again, or ';
    case 'timeout':
      return 'GitHub took too long to answer (ZeroPy tried three times). Try again in a minute.';
    case 'limited': {
      const minutes = retryAfter ? Math.max(1, Math.round(retryAfter / 60)) : 0;
      return `GitHub has had many checks from your network and is waiting a little.${minutes ? ` Try again in about ${minutes} minutes.` : ' Try again later.'} Your connection is fine.`;
    }
    case 'not-ready':
      return 'A new version is being published right now. Try again in a few minutes.';
    case 'github-down':
      return 'GitHub has a problem right now (ZeroPy tried three times). Your connection is fine. Try again later.';
    default:
      return 'The check did not work this time. Try again, or ';
  }
}

/** A small block for the settings menu: the version and the check button. */
export function updateBlock(): HTMLElement {
  const result = h('p', { class: 'menu-note', 'aria-live': 'polite' });
  const check = h(
    'button',
    { type: 'button', class: 'btn btn-plain btn-small' },
    h('span', { class: 'btn-label' }, 'Check for updates'),
  );
  const button = (label: string, onClick: () => void): HTMLButtonElement => {
    const el = h('button', { type: 'button', class: 'btn btn-primary btn-small' }, h('span', { class: 'btn-label' }, label));
    el.addEventListener('click', onClick);
    return el;
  };

  // The installed desktop app: one click to download, one to restart.
  async function selfUpdate(): Promise<boolean> {
    if (!bridge) return false;
    const found = await bridge.check();
    if (found.state === 'manual') return false;
    if (found.state === 'error') {
      const text = failure(found.reason, found.retryAfter);
      result.replaceChildren(
        text,
        text.endsWith('or ') ? h('a', { href: PAGE, target: '_blank', rel: 'noopener noreferrer' }, 'open the download page') : '',
        text.endsWith('or ') ? '.' : '',
      );
      return true;
    }
    if (found.state === 'none') {
      result.textContent = 'You have the newest version.';
      return true;
    }
    const size = found.size ? ` (${Math.round(found.size / 1_000_000)} MB)` : '';
    const get = button('Download and install', () => {
      get.disabled = true;
      check.disabled = true;
      result.textContent = 'Downloading… 0%';
      const stop = bridge.onEvent((event) => {
        if (event.state === 'progress') result.textContent = `Downloading… ${event.percent ?? 0}%`;
        if (event.state === 'ready') {
          stop();
          result.replaceChildren(
            `Version ${event.version ?? found.version} is ready. ZeroPy restarts to finish. Your progress stays. `,
            button('Restart now', () => void bridge.install()),
          );
        }
        if (event.state === 'error') {
          stop();
          check.disabled = false;
          result.textContent = event.reason === 'offline' ? 'The download stopped: this computer went offline. Try again.' : 'The download stopped. Try again.';
        }
      });
      void bridge.download().then((ok) => {
        if (!ok) {
          stop();
          check.disabled = false;
          result.textContent = navigator.onLine ? 'The download stopped. Try again.' : 'The download stopped: this computer went offline. Try again.';
        }
      });
    });
    result.replaceChildren(`Version ${found.version} is ready${size}. `, get);
    return true;
  }

  check.addEventListener('click', async () => {
    check.disabled = true;
    result.textContent = 'Asking GitHub…';
    try {
      if (await selfUpdate()) return;
      let newest = '';
      if (bridge?.latest) {
        const found = await bridge.latest();
        if (found.state === 'error') {
          const text = failure(found.reason, found.retryAfter);
          result.replaceChildren(text, text.endsWith('or ') ? h('a', { href: PAGE, target: '_blank', rel: 'noopener noreferrer' }, 'open the download page') : '', text.endsWith('or ') ? '.' : '');
          return;
        }
        newest = found.version ?? '';
      } else {
        const response = await fetch(LATEST, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
        if (!response.ok) throw new Error(String(response.status));
        const release = (await response.json()) as { tag_name?: string };
        newest = (release.tag_name ?? '').replace(/^v/, '');
      }
      if (!newest) throw new Error('no version');
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
      result.replaceChildren(navigator.onLine ? failure('unknown') : failure('offline'), navigator.onLine ? h('a', { href: PAGE, target: '_blank', rel: 'noopener noreferrer' }, 'open the download page') : '', navigator.onLine ? '.' : '');
    } finally {
      check.disabled = false;
    }
  });
  // The web version is always the newest: a reload gets it.
  const web = window.location.protocol === 'http:' || window.location.protocol === 'https:';
  return h(
    'fieldset',
    { class: 'menu-group' },
    h('legend', null, 'About'),
    h('p', { class: 'menu-version' }, `ZeroPy ${APP_VERSION}`),
    web ? h('p', { class: 'menu-note' }, 'This is the web version. It is always the newest version.') : check,
    web ? null : result,
  );
}
