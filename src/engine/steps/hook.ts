// Hook: the concept as a visual metaphor. One beat per click (segmenting),
// each beat tied to one line of code.
import { gsap } from '@/kit/motion';
import { valueColor } from '@/kit/palette';
import { createStage } from '@/kit/stage';
import type { SceneInstance, Stage } from '@/kit/stage';
import { loadScene } from '../registry';
import type { HookStep } from '../types';
import { codeBlock, h, mdInline } from '../ui';
import type { StepContext, StepView } from './context';

export function legend(): HTMLElement {
  return h(
    'div',
    { class: 'legend', 'aria-label': 'Color code of values' },
    ...['int', 'str', 'bool'].map((type) => {
      const color = valueColor(type);
      return h('span', { class: 'legend-chip' }, h('i', { style: `background:${color.bg}` }), color.label);
    }),
  );
}

export function renderHook(step: HookStep, ctx: StepContext): StepView {
  const code = codeBlock(step.code, { numbers: true });
  const caption = h('p', { class: 'hook-caption', 'aria-live': 'polite' });
  const counter = h('span', { class: 'hook-counter' });
  const loading = h('div', { class: 'stage-loading' }, 'Loading the scene…');
  const frame = h('div', { class: 'stage-frame stage-tall' }, loading);
  const el = h(
    'div',
    { class: 'split' },
    h(
      'div',
      { class: 'split-text' },
      h('h1', { class: 'display', 'data-enter': true }, step.question),
      h('div', { 'data-enter': true }, code.el),
      h('div', { class: 'hook-beat', 'data-enter': true }, counter, caption),
    ),
    h('div', { class: 'split-visual', 'data-enter': true }, frame, step.legend === false ? null : legend()),
  );

  let stage: Stage | null = null;
  let scene: SceneInstance | null = null;
  let timeline: gsap.core.Timeline | null = null;
  let disposed = false;

  function play(index: number): void {
    const beat = step.beats[index];
    const last = index === step.beats.length - 1;
    code.setActive(beat.line ?? null);
    counter.textContent = `${index + 1} / ${step.beats.length}`;
    caption.replaceChildren(mdInline(beat.caption));
    gsap.fromTo(caption, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power3.out' });
    timeline?.progress(1);
    timeline = scene?.beats[beat.beat]?.() ?? null;
    if (last) ctx.done();
    else ctx.dock.primary('Next', true, () => play(index + 1));
  }

  async function setup(): Promise<void> {
    try {
      stage = await createStage(frame);
      const factory = await loadScene(ctx.lesson.id);
      if (disposed) return;
      scene = await factory(stage);
    } catch (error) {
      console.error('[hook] scene failed', error);
    }
    if (disposed) {
      scene?.dispose();
      stage?.dispose();
      return;
    }
    loading.remove();
    play(0);
  }

  ctx.dock.primary('Next', false);
  return {
    el,
    entered: () => void setup(),
    dispose() {
      disposed = true;
      timeline?.kill();
      scene?.dispose();
      stage?.dispose();
    },
  };
}
