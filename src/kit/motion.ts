// The one motion language of the product: place, press, stamp, shake, drop.
// Every animation in the app goes through these helpers or these constants.
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import { TextPlugin } from 'gsap/TextPlugin';

// Flip: layout changes glide. TextPlugin: text is typed. SplitText: headline lines.
gsap.registerPlugin(ScrollTrigger, Flip, TextPlugin, SplitText);

export const EASE = {
  place: 'power3.out',
  leave: 'power2.in',
  drop: 'power2.in',
  settle: 'elastic.out(1, 0.5)',
  pop: 'back.out(1.7)',
} as const;

export const DUR = { fast: 0.2, base: 0.45, slow: 0.7 } as const;

let reduced = false;

// Dev only: lets a check run animations fast without the reduced (2D) mode.
if (import.meta.env.DEV) {
  (window as unknown as { __zpSpeed?: (n: number) => void }).__zpSpeed = (n) => gsap.globalTimeline.timeScale(n);
}

/** In reduced mode every GSAP animation jumps to its end state. */
export function setReducedMotion(on: boolean): void {
  reduced = on;
  gsap.globalTimeline.timeScale(on ? 200 : 1);
  document.documentElement.dataset.motion = on ? 'reduced' : 'full';
}

export function isReduced(): boolean {
  return reduced;
}

/** Real-time pause. Not affected by reduced motion: pacing is content. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function finished(tl: gsap.core.Animation): Promise<void> {
  return new Promise((resolve) => {
    if (tl.totalProgress() >= 1 || tl.totalDuration() === 0) resolve();
    else tl.eventCallback('onComplete', () => resolve());
  });
}

/** Place: elements arrive like paper put on a desk. */
export function place(targets: gsap.TweenTarget, delay = 0): gsap.core.Tween {
  return gsap.fromTo(
    targets,
    { y: 16, opacity: 0, rotate: -0.5 },
    {
      y: 0,
      opacity: 1,
      rotate: 0,
      duration: DUR.base,
      ease: EASE.place,
      stagger: 0.05,
      delay,
      clearProps: 'transform,opacity',
    },
  );
}

export function leave(target: gsap.TweenTarget): gsap.core.Tween {
  return gsap.to(target, { x: -28, opacity: 0, duration: DUR.fast, ease: EASE.leave });
}

/** Stamp: a result lands like a rubber stamp. */
export function stamp(target: gsap.TweenTarget): gsap.core.Tween {
  return gsap.fromTo(
    target,
    { scale: 1.7, rotate: -14, opacity: 0 },
    { scale: 1, rotate: -6, opacity: 1, duration: 0.35, ease: 'power4.in' },
  );
}

/** Shake: a short "no" that never blocks the learner. */
export function shake(target: gsap.TweenTarget): gsap.core.Tween {
  return gsap.fromTo(
    target,
    { x: 0 },
    { keyframes: { x: [0, -7, 6, -4, 3, 0] }, duration: 0.36, ease: 'power1.out', clearProps: 'transform' },
  );
}

const CONFETTI = ['#F6B92B', '#2B50D6', '#1E9E6A', '#E4472B', '#1A1B2E'];

/** Paper confetti from the center of an element. Decorative, skipped when reduced. */
export function confetti(origin: Element, count = 16): void {
  if (reduced) return;
  const rect = origin.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < count; i += 1) {
    const bit = document.createElement('i');
    bit.className = 'confetti';
    bit.style.background = CONFETTI[i % CONFETTI.length];
    bit.style.left = `${cx}px`;
    bit.style.top = `${cy}px`;
    document.body.append(bit);
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const reach = 70 + Math.random() * 90;
    gsap
      .timeline({ onComplete: () => bit.remove() })
      .to(bit, {
        x: Math.cos(angle) * reach,
        y: Math.sin(angle) * reach - 40,
        rotate: Math.random() * 360,
        duration: 0.45,
        ease: 'power3.out',
      })
      .to(bit, { y: '+=90', opacity: 0, rotate: '+=120', duration: 0.5, ease: 'power2.in' });
  }
}

/** Scroll-driven reveal for every [data-reveal] inside root. Returns a cleanup. */
export function revealOnScroll(root: HTMLElement): () => void {
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-reveal]'));
  if (reduced || items.length === 0) return () => undefined;
  gsap.set(items, { y: 28, opacity: 0 });
  const triggers = ScrollTrigger.batch(items, {
    start: 'top 88%',
    once: true,
    onEnter: (batch) =>
      gsap.to(batch, { y: 0, opacity: 1, duration: DUR.slow, ease: EASE.place, stagger: 0.07, overwrite: true }),
  });
  return () => triggers.forEach((t) => t.kill());
}

/** Glide: cards that change places slide to their new place (a layout change). */
export function glide(targets: Element[], change: () => void): void {
  const state = Flip.getState(targets);
  change();
  Flip.from(state, { duration: DUR.fast, ease: EASE.place });
}

export type Timeline = gsap.core.Timeline;

/** Headline reveal: each line rises from behind a mask. Returns a cleanup. */
export function revealLines(target: HTMLElement): () => void {
  if (reduced) return () => undefined;
  const split = SplitText.create(target, { type: 'lines', mask: 'lines' });
  // Revert when done: the masks would cut letters like "y" in a tight line.
  const tween = gsap.from(split.lines, {
    yPercent: 110,
    duration: 0.8,
    ease: 'power4.out',
    stagger: 0.09,
    onComplete: () => split.revert(),
  });
  return () => {
    tween.kill();
    split.revert();
  };
}

export { Flip, gsap };
