// "What next": a path after the course, from content/next.yaml.
import { place } from '@/kit/motion';
import nextData from '../../content/next.yaml';
import { h, icon, sectionHead } from './ui';

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
        { class: 'zp-page next' },
        h('header', { class: 'zp-page-head', 'data-enter': true }, h('h1', { class: 'display' }, data.title), h('p', { class: 'lead' }, data.lead)),
        // First: the steps for everyone, in order, side by side.
        h(
          'section',
          { class: 'zp-section', 'data-enter': true },
          sectionHead('Step by step', 'First, for everyone'),
          h(
            'div',
            { class: 'zp-stack' },
            ...data.stages.map((stage, i) =>
              h(
                'article',
                { class: 'zp-card zp-card-split next-card' },
                h('span', { class: 'zp-card-kicker' }, `${i + 1} · ${stage.when}`),
                h('h3', { class: 'zp-card-title' }, stage.title),
                h('p', { class: 'zp-card-text' }, stage.why),
                stage.ideas ? h('ul', { class: 'next-ideas' }, ...stage.ideas.map((idea) => h('li', null, idea))) : null,
                h('div', { class: 'zp-card-foot' }, links(stage.links)),
              ),
            ),
          ),
        ),
        // Then: one branch to choose, each a card of the same size.
        h(
          'section',
          { class: 'zp-section', 'data-enter': true },
          sectionHead('Your choice', 'Then choose a branch', `${data.branches.length} branches`),
          h(
            'div',
            { class: 'zp-grid' },
            ...data.branches.map((branch) =>
              h(
                'article',
                { class: 'zp-card next-card' },
                h('h3', { class: 'zp-card-title' }, branch.title),
                h('p', { class: 'zp-card-text' }, branch.why),
                h(
                  'ol',
                  { class: 'next-path' },
                  ...branch.path.map((p) => h('li', null, h('strong', null, p.step), h('span', null, p.detail))),
                ),
                h('div', { class: 'zp-card-foot' }, links(branch.links)),
              ),
            ),
          ),
        ),
        // Last: other languages, and advice, side by side.
        h(
          'section',
          { class: 'zp-section', 'data-enter': true },
          sectionHead('Later', data.languages.title),
          h(
            'div',
            { class: 'zp-stack' },
            h(
              'article',
              { class: 'zp-card next-card' },
              h(
                'ol',
                { class: 'next-path' },
                ...data.languages.items.map((l) => h('li', null, h('strong', null, l.name), h('span', null, l.why))),
              ),
              h('div', { class: 'zp-card-foot' }, links([data.languages.link])),
            ),
            h(
              'article',
              { class: 'zp-card next-card' },
              h('h3', { class: 'zp-card-title' }, 'Good advice'),
              ...data.advice.map((a) => h('div', { class: 'next-tip' }, h('strong', null, a.title), h('p', null, a.text))),
            ),
          ),
        ),
      ),
    ),
  );
  root.replaceChildren(page);
  place(page.querySelectorAll('[data-enter]'));
  return () => undefined;
}
