import { gsap, shake } from '../motion';
import type { Timeline } from '../motion';
import type { Stage2D } from '../stage';
import { MAX_OUT_LINES, onlyAppends, visibleCode } from './program-run';
import type { ProgramRun, RunFrame } from './program-run';

function el(tag: string, className: string, text = ''): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

export class Run2D implements ProgramRun {
  private root = el('div', 'pr2d');
  private list = el('ol', 'pr2d-code');
  private screen = el('div', 'pr2d-screen');
  private lines: HTMLElement[] = [];
  private codeKey = '';
  private out: string[] = [];
  private current: Timeline | null = null;

  constructor(stage: Stage2D) {
    const left = el('div', 'pr2d-col');
    left.append(el('div', 'pr2d-cap', 'program'), this.list);
    const right = el('div', 'pr2d-col');
    right.append(el('div', 'pr2d-cap', 'screen'), this.screen);
    this.root.append(left, right);
    stage.el.append(this.root);
  }

  show(frame: RunFrame): Timeline {
    this.current?.progress(1);
    const tl = gsap.timeline();
    this.current = tl;

    const code = visibleCode(frame.code);
    const key = code.join('\n');
    if (key !== this.codeKey) {
      this.codeKey = key;
      this.lines = code.map((text) => {
        const line = el('li', 'pr2d-line');
        line.append(el('span', 'pr2d-text', text || '​'));
        return line;
      });
      this.list.replaceChildren(...this.lines);
      this.list.classList.toggle('is-long', code.length > 6);
      this.screen.replaceChildren();
      this.out = [];
      tl.fromTo(this.lines, { x: -14, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, stagger: 0.05, ease: 'power3.out' });
    }

    const index = frame.line === null ? -1 : frame.line - 1;
    const active = this.lines[index];
    const skipped = new Set(frame.skipped ?? []);
    tl.call(() => {
      this.lines.forEach((line, i) => {
        line.classList.toggle('is-active', line === active);
        line.classList.toggle('is-error', line === active && Boolean(frame.error));
        line.classList.toggle('is-skipped', skipped.has(i + 1));
        // The answer of a condition, as a small True / False badge.
        const verdict = frame.verdicts?.[i + 1];
        const wanted = verdict === undefined ? '' : String(verdict);
        if ((line.dataset.verdict ?? '') === wanted) {
          // A loop asks the same question again: the badge jumps to show it.
          const old = line === active ? line.querySelector('.pr2d-badge') : null;
          if (old) gsap.fromTo(old, { scale: 1.5 }, { scale: 1, duration: 0.35, ease: 'back.out(1.7)' });
          return;
        }
        line.dataset.verdict = wanted;
        line.querySelector('.pr2d-badge')?.remove();
        if (verdict !== undefined) {
          const badge = el('span', `pr2d-badge ${verdict ? 'is-true' : 'is-false'}`, verdict ? 'True' : 'False');
          line.append(badge);
          gsap.fromTo(badge, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(1.7)' });
        }
      });
    });
    if (active && frame.error) tl.add(shake(active));

    if (onlyAppends(this.out, frame.out)) {
      for (let i = this.out.length; i < frame.out.length; i += 1) {
        const row = el('div', 'pr2d-row');
        this.screen.append(row);
        // TextPlugin types the line, like a real terminal.
        const text = frame.out[i];
        tl.to(row, { text: { value: text || ' ' }, duration: Math.min(0.6, 0.12 + text.length * 0.035), ease: 'none' });
      }
    } else {
      this.screen.replaceChildren(...frame.out.slice(-MAX_OUT_LINES).map((text) => el('div', 'pr2d-row', text)));
    }
    this.out = frame.out.slice(-MAX_OUT_LINES);
    return tl;
  }

  dispose(): void {
    this.current?.kill();
    this.root.remove();
  }
}
