import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/400-italic.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './styles/tokens.css';
import './styles/app.css';
import './kit/settings';
import { mountHome } from './engine/home';
import { mountLesson } from './engine/player';
import { mountReview } from './engine/review-page';
import { mountPlayground } from './engine/playground';
import { mountCheatSheet } from './engine/cheatsheet';
import { mountMistakes } from './engine/mistakes-page';
import { mountNext } from './engine/next-page';

const root = document.getElementById('app')!;
let unmount: (() => void) | null = null;

function route(): void {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  // The player updates the step number with replaceState, which fires no
  // hashchange. So every event here is a real navigation.
  unmount?.();
  if (parts[0] === 'lesson' && parts[1]) {
    unmount = mountLesson(root, parts[1], parts[2] ? Number(parts[2]) : undefined);
  } else if (parts[0] === 'review') {
    unmount = mountReview(root);
  } else if (parts[0] === 'playground') {
    unmount = mountPlayground(root);
  } else if (parts[0] === 'next') {
    unmount = mountNext(root);
  } else if (parts[0] === 'mistakes') {
    unmount = mountMistakes(root);
  } else if (parts[0] === 'cheatsheet') {
    unmount = mountCheatSheet(root);
  } else {
    unmount = mountHome(root);
  }
}

window.addEventListener('hashchange', route);
route();
