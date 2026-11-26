// "What next": a path after the course, from content/next.yaml.
import { place } from '@/kit/motion';
import nextData from '../../content/next.yaml';
import { h, icon, titled } from './ui';

interface Link {
  name: string;
  url: string;
  note: string;
}
interface NextPage {
  title: string;
  lead: string;
  stages: { title: string; when: string; why: string; ideas?: string[]; links: Link[] }[];
  branches: { title: string; why: string; path: { step: string; detail: string }[]; links: Link[] }[];
  languages: { title: string; items: { name: string; why: string }[]; link: Link };
  advice: { title: string; text: string }[];
}

const data = nextData as NextPage;

function links(list: Link[]): HTMLElement {
  return h(
    'ul',
    { class: 'next-links' },
    ...list.map((l) =>
      h(
        'li',
        null,
        h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.name, icon('right', 14)),
        h('span', null, l.note),
      ),
    ),
  );
}

export function mountNext(root: HTMLElement): () => void {
  const page = h(
    'div',
    { class: 'player' },
    h(
      'main',
      { class: 'player-main', tabindex: '0' },
      h(
        'div',
        { class: 'single next' },
        titled('next', h('h1', { class: 'display' }, data.title)),
        h('p', { class: 'lead', 'data-enter': true }, data.lead),
        ...data.stages.map((stage) =>
          h(
            'section',
            { class: 'next-card', 'data-enter': true },
            h('p', { class: 'next-when' }, stage.when),
            h('h2', { class: 'sheet-title' }, stage.title),
            h('p', null, stage.why),
            stage.ideas ? h('ul', { class: 'next-ideas' }, ...stage.ideas.map((idea) => h('li', null, idea))) : null,
            links(stage.links),
          ),
        ),
        h('h2', { class: 'display next-head', 'data-enter': true }, 'Then choose a branch'),
        ...data.branches.map((branch) =>
          h(
            'section',
            { class: 'next-card', 'data-enter': true },
            h('h2', { class: 'sheet-title' }, branch.title),
            h('p', null, branch.why),
            h(
              'ol',
              { class: 'next-path' },
              ...branch.path.map((p) => h('li', null, h('strong', null, p.step), h('span', null, p.detail))),
            ),
            links(branch.links),
          ),
        ),
        h(
          'section',
          { class: 'next-card', 'data-enter': true },
          h('h2', { class: 'sheet-title' }, data.languages.title),
          h(
            'ol',
            { class: 'next-path' },
            ...data.languages.items.map((l) => h('li', null, h('strong', null, l.name), h('span', null, l.why))),
          ),
          links([data.languages.link]),
        ),
        h(
          'div',
          { class: 'next-advice', 'data-enter': true },
          ...data.advice.map((a) => h('div', { class: 'next-tip' }, h('strong', null, a.title), h('p', null, a.text))),
        ),
      ),
    ),
  );
  root.replaceChildren(page);
  place(page.querySelectorAll('[data-enter]'));
  return () => undefined;
}
