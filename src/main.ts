// Pixelify Sans (titles, buttons, numbers), Silkscreen (tiny labels, and the
// Z of the titles), Figtree (text), JetBrains Mono (code).
import '@fontsource-variable/pixelify-sans';
import '@fontsource/silkscreen/400.css';
import '@fontsource-variable/figtree';
import '@fontsource-variable/figtree/wght-italic.css';
import '@fontsource-variable/jetbrains-mono';
import './styles/tokens.css';
import './styles/app.css';
import { onSettings } from './kit/settings';
import { mountSky } from './kit/sky';
import { mountHome } from './engine/home';
import { mountLesson } from './engine/player';
import { mountReview } from './engine/review-page';
import { mountPlayground } from './engine/playground';
import { mountCheatSheet } from './engine/cheatsheet';
import { mountMistakes } from './engine/mistakes-page';
import { mountNext } from './engine/next-page';
import { mountPractice } from './engine/practice-page';
import { mountKnowledge } from './engine/knowledge-page';
import { mountTitleBar, paintTitleBar, updateTitleBar } from './engine/titlebar';
import { createShell, type Place, type Shell } from './engine/shell';

const root = document.getElementById('app')!;
let unmount: (() => void) | null = null;
let shell: Shell | null = null;

function route(): void {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  // The player updates the step number with replaceState, which fires no
  // hashchange. So every event here is a real navigation.
  unmount?.();
  updateTitleBar();
  // A lesson opens in focus mode: full screen, without the sidebar.
  if (parts[0] === 'lesson' && parts[1]) {
    shell?.remove();
    shell = null;
    unmount = mountLesson(root, parts[1], parts[2] ? Number(parts[2]) : undefined);
    return;
  }
  shell ??= createShell(root);
  const page = shell.page;
  const at = (place: Place): void => shell!.show(place);
  if (parts[0] === 'review') {
    unmount = mountReview(page);
    at('review');
  } else if (parts[0] === 'playground') {
    unmount = mountPlayground(page);
    at('playground');
  } else if (parts[0] === 'next') {
    unmount = mountNext(page);
    at('next');
  } else if (parts[0] === 'mistakes') {
    unmount = mountMistakes(page);
    at('mistakes');
  } else if (parts[0] === 'practice') {
    unmount = mountPractice(page, parts[1], parts.slice(2));
    at('practice');
  } else if (parts[0] === 'knowledge') {
    unmount = mountKnowledge(page);
    at('knowledge');
  } else if (parts[0] === 'cheatsheet') {
    unmount = mountCheatSheet(page);
    at('cheatsheet');
  } else {
    unmount = mountHome(page, parts[0] === 'course' ? 'course' : 'start');
    at('course');
  }
}

mountSky();
mountTitleBar();
onSettings(() => paintTitleBar());
window.addEventListener('hashchange', route);
route();

// In a browser, ask to keep the progress: without this, Safari may delete
// the data of a site that was not opened for some days.
if (window.location.protocol !== 'app:') void navigator.storage?.persist?.().catch(() => false);
