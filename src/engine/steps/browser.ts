// A small web browser for the Flask app of a program (src/py/server.py). Its
// requests go to the app inside the page, never to the network. A page is
// rebuilt from a short list of allowed tags and attributes: no scripts, no
// styles, no images, no event handlers. The HTML of the learner's app (and
// of anything it repeats from a form) can show text, links and forms only.
import type { ServerInfo, WebRequest, WebResult } from '../types';
import { button, h, icon } from '../ui';

export interface MiniBrowser {
  el: HTMLElement;
  /** A new run with a running server: open `path` (the home page by default). */
  start(info: ServerInfo, path?: string): void;
  /** Opens a page like a typed address. */
  open(path: string): void;
}

/** Tags that are rebuilt, with the attributes they keep. Others are unwrapped. */
const KEEP: Record<string, string[]> = {
  h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], p: [], br: [], hr: [], b: [], strong: [], i: [], em: [], u: [],
  s: [], small: [], mark: [], sub: [], sup: [], code: [], pre: [], kbd: [], q: [], blockquote: [], ul: [], ol: [],
  li: [], dl: [], dt: [], dd: [], table: [], thead: [], tbody: [], tfoot: [], tr: [], th: ['colspan', 'rowspan'],
  td: ['colspan', 'rowspan'], caption: [], div: [], span: [], section: [], article: [], header: [], footer: [],
  main: [], nav: [], aside: [], figure: [], figcaption: [], details: [], summary: [], a: [], label: ['for'],
  form: [], fieldset: [], legend: [], input: ['name', 'value', 'placeholder', 'min', 'max', 'step', 'checked', 'required', 'size', 'maxlength'],
  textarea: ['name', 'rows', 'cols', 'placeholder', 'required'], select: ['name'], option: ['value', 'selected'],
  button: ['name', 'value'],
};
/** Tags that go with everything inside them. */
const DROP = new Set(['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'link', 'meta', 'base', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'audio', 'video', 'canvas', 'picture', 'source', 'track', 'applet', 'portal']);
const INPUT_TYPES = new Set(['text', 'number', 'password', 'email', 'search', 'hidden', 'checkbox', 'radio', 'submit', 'reset', 'date', 'time', 'range', 'color', 'tel', 'url']);

let browsers = 0;

export function createBrowser(send: (request: WebRequest) => Promise<WebResult | null>): MiniBrowser {
  const prefix = `mb${++browsers}-`;
  let port = 5000;
  let current = '/';
  let busy = false;
  let view: 'page' | 'raw' = 'page';
  // Every page shown. Back opens the last page before it that came from a GET
  // (a page that answered a form is not asked for again, like in a real browser).
  const history: { path: string; get: boolean }[] = [];
  let last: { request: WebRequest; result: WebResult; chain: string[] } | null = null;

  const back = button('', { kind: 'plain', small: true, icon: 'left', onClick: () => goBack() });
  back.setAttribute('aria-label', 'Back');
  back.title = 'Back';
  const host = h('span', { class: 'mb-host' }, '127.0.0.1:5000');
  const address = h('input', {
    class: 'mb-address',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    'aria-label': 'Address: the path of the page',
  }) as HTMLInputElement;
  address.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') open(address.value);
  });
  const go = button('Go', { kind: 'ghost', small: true, onClick: () => open(address.value) });
  const status = h('span', { class: 'mb-status', 'aria-live': 'polite' });
  const pageTab = h('button', { class: 'mb-tab is-on', type: 'button', 'aria-pressed': 'true', onclick: () => setView('page') }, 'Page');
  const rawTab = h('button', { class: 'mb-tab', type: 'button', 'aria-pressed': 'false', onclick: () => setView('raw') }, 'HTTP messages');
  const body = h('div', { class: 'mb-body' });
  const el = h(
    'div',
    { class: 'mb', role: 'group', 'aria-label': 'Browser for your server' },
    h('div', { class: 'mb-bar' }, back, h('div', { class: 'mb-field' }, icon('search', 14), host, address), go),
    h('div', { class: 'mb-tabs' }, pageTab, rawTab, status),
    body,
  );

  function setView(next: 'page' | 'raw'): void {
    view = next;
    pageTab.classList.toggle('is-on', next === 'page');
    rawTab.classList.toggle('is-on', next === 'raw');
    pageTab.setAttribute('aria-pressed', String(next === 'page'));
    rawTab.setAttribute('aria-pressed', String(next === 'raw'));
    draw();
  }

  /** The path and query of an address in this browser, or null for another site. */
  function local(href: string): string | null {
    let url: URL;
    try {
      // A relative address ("/about", "?page=2", "next") is on this server.
      url = new URL(href.trim() || '/', `http://127.0.0.1:${port}${current}`);
    } catch {
      return null;
    }
    const ours = ['127.0.0.1', 'localhost', '0.0.0.0'].includes(url.hostname) && url.protocol === 'http:' && (url.port || '80') === String(port);
    return ours ? url.pathname + url.search : null;
  }

  function open(path: string): void {
    const target = local(path.startsWith('/') || /^[a-z]+:/i.test(path) ? path : `/${path}`);
    if (target === null) {
      notice('This small browser opens only the pages of your own server.');
      return;
    }
    void request({ method: 'GET', path: target }, true);
  }

  function goBack(): void {
    if (history.length < 2) return;
    history.pop();
    while (history.length > 1 && !history[history.length - 1].get) history.pop();
    const previous = history[history.length - 1];
    if (!previous.get) return;
    void request({ method: 'GET', path: previous.path }, false);
  }

  async function request(req: WebRequest, remember: boolean): Promise<void> {
    if (busy) return;
    busy = true;
    el.classList.add('is-busy');
    status.textContent = 'Loading…';
    const chain: string[] = [];
    try {
      let next: WebRequest = req;
      let result = await send(next);
      // Like a real browser: follow a redirect (at most 5 times), with GET.
      for (let hops = 0; result && result.status >= 300 && result.status < 400 && result.location && hops < 5; hops += 1) {
        const target = local(result.location);
        if (target === null) break;
        chain.push(`${result.status} ${result.reason ?? ''}: ${next.method} ${next.path} → ${target}`);
        next = { method: 'GET', path: target };
        result = await send(next);
      }
      if (!result) {
        status.textContent = '';
        return;
      }
      if (result.status === 0) {
        notice(result.error ? 'The server stopped with an error. Read the message below.' : 'The server is not running. Run the program first.');
        return;
      }
      current = next.path;
      address.value = current;
      const top = history[history.length - 1];
      const get = next.method === 'GET';
      if (remember && !(top && top.get && get && top.path === current)) history.push({ path: current, get });
      last = { request: next, result, chain };
      draw();
    } finally {
      busy = false;
      el.classList.remove('is-busy');
      back.disabled = history.length < 2;
    }
  }

  function notice(text: string): void {
    status.textContent = '';
    body.replaceChildren(h('p', { class: 'mb-notice' }, text));
  }

  function draw(): void {
    if (!last) return;
    const { request: req, result, chain } = last;
    status.replaceChildren(
      h('span', { class: `mb-code is-${result.status < 300 ? 'ok' : result.status < 400 ? 'move' : 'bad'}` }, `${result.status} ${result.reason ?? ''}`),
    );
    if (view === 'raw') {
      body.replaceChildren(raw(req, result, chain));
      return;
    }
    const type = result.type ?? '';
    const text = result.body ?? '';
    let content: HTMLElement;
    if (type === 'text/html') content = rebuild(text);
    else if (type === 'application/json') {
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // not valid JSON: show it as it is
      }
      content = h('pre', { class: 'mb-text' }, pretty);
    } else content = h('pre', { class: 'mb-text' }, text);
    body.replaceChildren(content, result.cut ? h('p', { class: 'mb-notice' }, 'The page is long: only its start is shown.') : '');
  }

  function raw(req: WebRequest, result: WebResult, chain: string[]): HTMLElement {
    const sent = [`${req.method} ${req.path} HTTP/1.1`, `Host: 127.0.0.1:${port}`];
    if (req.form) {
      const data = new URLSearchParams(req.form).toString();
      sent.push('Content-Type: application/x-www-form-urlencoded', `Content-Length: ${data.length}`, '', data);
    }
    const got = [`HTTP/1.1 ${result.status} ${result.reason ?? ''}`, ...(result.headers ?? []).map(([k, v]) => `${k}: ${v}`), '', result.body ?? ''];
    return h(
      'div',
      { class: 'mb-raw' },
      chain.length ? h('p', { class: 'mb-notice' }, `Redirects: ${chain.join('; ')}`) : '',
      h('div', { class: 'mb-raw-label' }, 'Request (from the browser)'),
      h('pre', { class: 'mb-text' }, sent.join('\n')),
      h('div', { class: 'mb-raw-label' }, 'Response (from your server)'),
      h('pre', { class: 'mb-text' }, got.join('\n')),
    );
  }

  /** A safe copy of an HTML page: only the allowed tags and attributes. */
  function rebuild(html: string): HTMLElement {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const root = h('div', { class: 'mb-page' });
    const copy = (from: Node, to: Node): void => {
      for (const node of Array.from(from.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE) {
          to.appendChild(document.createTextNode(node.textContent ?? ''));
          continue;
        }
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const source = node as Element;
        const tag = source.tagName.toLowerCase();
        if (DROP.has(tag)) continue;
        if (tag === 'img') {
          const alt = source.getAttribute('alt');
          to.appendChild(h('span', { class: 'mb-img' }, alt ? `[image: ${alt}]` : '[image]'));
          continue;
        }
        const allowed = KEEP[tag];
        if (!allowed) {
          copy(source, to);
          continue;
        }
        const made = document.createElement(tag);
        for (const name of allowed) {
          const value = source.getAttribute(name);
          if (value === null) continue;
          made.setAttribute(name, name === 'for' ? prefix + value : value);
        }
        const id = source.getAttribute('id');
        if (id) made.id = prefix + id;
        if (tag === 'input') {
          const type = (source.getAttribute('type') ?? 'text').toLowerCase();
          made.setAttribute('type', INPUT_TYPES.has(type) ? type : 'text');
        }
        if (tag === 'button') {
          const type = (source.getAttribute('type') ?? 'submit').toLowerCase();
          made.setAttribute('type', type === 'button' || type === 'reset' ? type : 'submit');
        }
        if (tag === 'a') link(made, source.getAttribute('href'));
        if (tag === 'form') form(made as HTMLFormElement, source.getAttribute('action'), source.getAttribute('method'));
        copy(source, made);
        to.appendChild(made);
      }
    };
    copy(doc.body, root);
    if (!root.hasChildNodes()) root.append(h('p', { class: 'mb-notice' }, '(an empty page)'));
    return root;
  }

  function link(a: HTMLElement, href: string | null): void {
    if (href === null) return;
    const target = local(href);
    a.setAttribute('tabindex', '0');
    a.setAttribute('role', 'link');
    a.classList.add(target === null ? 'mb-away' : 'mb-link');
    a.title = target === null ? `Another site: ${href}` : target;
    const follow = (): void => {
      if (target === null) notice(`This small browser opens only the pages of your own server, not ${href}.`);
      else void request({ method: 'GET', path: target }, true);
    };
    a.addEventListener('click', (event) => {
      event.preventDefault();
      follow();
    });
    a.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') follow();
    });
  }

  function form(f: HTMLFormElement, action: string | null, method: string | null): void {
    f.addEventListener('submit', (event) => {
      event.preventDefault();
      const target = local(action || current);
      if (target === null) {
        notice('This form sends to another site. This small browser sends only to your own server.');
        return;
      }
      const data = new FormData(f, (event as SubmitEvent).submitter ?? undefined);
      const values: Record<string, string> = {};
      for (const [k, v] of data.entries()) if (typeof v === 'string') values[k] = v;
      if ((method ?? 'get').toLowerCase() === 'post') void request({ method: 'POST', path: target, form: values }, true);
      else {
        const base = target.split('?')[0];
        const query = new URLSearchParams(values).toString();
        void request({ method: 'GET', path: query ? `${base}?${query}` : base }, true);
      }
    });
  }

  return {
    el,
    start(info, path = '/') {
      port = info.port;
      host.textContent = `127.0.0.1:${port}`;
      history.length = 0;
      last = null;
      current = '/';
      void request({ method: 'GET', path }, true);
    },
    open,
  };
}
