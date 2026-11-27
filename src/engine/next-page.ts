// "What next": a path after the course, from content/next.yaml.
import { place } from '@/kit/motion';
import nextData from '../../content/next.yaml';
import { twoPane, type PaneItem } from './two-pane';
import { h, icon } from './ui';

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
  // One part for each step and each branch, then the other languages and
  // the advice: an index on the left, the chosen part on the right.
  const items: PaneItem[] = [
    ...data.stages.map((stage, i) => ({
      id: `stage-${i + 1}`,
      group: i === 0 ? 'First, for everyone' : undefined,
      label: stage.title,
      note: `Step ${i + 1} · ${stage.when}`,
      render: () =>
        h(
          'div',
          { class: 'pane-part next-part' },
          h('span', { class: 'kicker' }, `Step ${i + 1} · ${stage.when}`),
          h('h2', { class: 'pane-title' }, stage.title),
          h('p', { class: 'pane-text' }, stage.why),
          stage.ideas ? h('section', { class: 'pane-block' }, h('h3', { class: 'pane-subtitle' }, 'Ideas to build'), h('ul', { class: 'next-ideas' }, ...stage.ideas.map((idea) => h('li', null, idea)))) : null,
          h('section', { class: 'pane-block' }, h('h3', { class: 'pane-subtitle' }, 'Free resources'), links(stage.links)),
        ),
    })),
    ...data.branches.map((branch, i) => ({
      id: `branch-${i + 1}`,
      group: i === 0 ? 'Then choose a branch' : undefined,
      label: branch.title,
      note: `${branch.path.length} steps`,
      render: () =>
        h(
          'div',
          { class: 'pane-part next-part' },
          h('span', { class: 'kicker' }, 'A branch'),
          h('h2', { class: 'pane-title' }, branch.title),
          h('p', { class: 'pane-text' }, branch.why),
          h('section', { class: 'pane-block' }, h('h3', { class: 'pane-subtitle' }, 'The way, step by step'), h('ol', { class: 'next-path' }, ...branch.path.map((p) => h('li', null, h('strong', null, p.step), h('span', null, p.detail))))),
          h('section', { class: 'pane-block' }, h('h3', { class: 'pane-subtitle' }, 'Free resources'), links(branch.links)),
        ),
    })),
    {
      id: 'languages',
      group: 'Later',
      label: data.languages.title,
      note: `${data.languages.items.length} languages`,
      render: () =>
        h(
          'div',
          { class: 'pane-part next-part' },
          h('span', { class: 'kicker' }, 'Later'),
          h('h2', { class: 'pane-title' }, data.languages.title),
          h('ol', { class: 'next-path' }, ...data.languages.items.map((l) => h('li', null, h('strong', null, l.name), h('span', null, l.why)))),
          links([data.languages.link]),
        ),
    },
    {
      id: 'advice',
      label: 'Good advice',
      note: `${data.advice.length} tips`,
      render: () =>
        h(
          'div',
          { class: 'pane-part next-part' },
          h('span', { class: 'kicker' }, 'For the whole way'),
          h('h2', { class: 'pane-title' }, 'Good advice'),
          h('ol', { class: 'pane-rows' }, ...data.advice.map((a) => h('li', { class: 'pane-row' }, h('span', { class: 'pane-row-text' }, h('strong', null, a.title), h('small', null, a.text))))),
        ),
    },
  ];
  const page = h(
    'div',
    { class: 'player' },
    h(
      'main',
      { class: 'player-main', tabindex: '0' },
      h(
        'div',
        { class: 'zp-page pane-page next' },
        h('header', { class: 'zp-page-head', 'data-enter': true }, h('h1', { class: 'display' }, data.title), h('p', { class: 'lead' }, data.lead)),
        h('div', { class: 'pane-wrap', 'data-enter': true }, twoPane('Parts of what comes next', items).el),
      ),
    ),
  );
  root.replaceChildren(page);
  place(page.querySelectorAll('[data-enter]'));
  return () => undefined;
}
