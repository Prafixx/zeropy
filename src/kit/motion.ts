// The one motion language of the product. Motion is short and explains a
// change; nothing bounces, tilts or celebrates on every answer. The values
// match the motion tokens in tokens.css (70 to 400 ms, no overshoot).
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { TextPlugin } from 'gsap/TextPlugin';

// Flip: layout changes glide. TextPlugin: text is typed.
gsap.registerPlugin(Flip, TextPlugin);

export const EASE = {
  place: 'power2.out',
  leave: 'power2.in',
  drop: 'power2.in',
  // The scenes used an elastic and a "back" ease; both are calm now.
  settle: 'power2.out',
  pop: 'power2.out',
} as const;

export const DUR = { fast: 0.15, base: 0.24, slow: 0.4 } as const;

let reduced = false;

// Dev only: lets a check run animations fast without the reduced (2D) mode.
if (import.meta.env.DEV) {
  (window as unknown as { __zpSpeed?: (n: number) => void }).__zpSpeed = (n) => gsap.globalTimeline.timeScale(n);
}

/**
 * Reduced motion: the interface helpers below skip to their end state at
 * once (no frames in between). Scene timelines still run in order, as fast
 * as possible (time scale 200), because their order is content.
 */
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

/** A finished tween: the end state, set at once. */
function done(target: gsap.TweenTarget, vars: gsap.TweenVars): gsap.core.Tween {
  return gsap.set(target, vars);
}

/** Place: an element arrives with a short fade and rise. */
export function place(targets: gsap.TweenTarget, delay = 0): gsap.core.Tween {
  if (reduced) return done(targets, { clearProps: 'transform,opacity' });
  return gsap.fromTo(
    targets,
    { y: 6, opacity: 0 },
    {
      y: 0,
      opacity: 1,
      duration: DUR.base,
      ease: EASE.place,
      stagger: 0.03,
      delay,
      clearProps: 'transform,opacity',
    },
  );
}

export function leave(target: gsap.TweenTarget): gsap.core.Tween {
  if (reduced) return done(target, { opacity: 0 });
  return gsap.to(target, { opacity: 0, duration: 0.11, ease: EASE.leave });
}

/** A result appears: a short fade, no rotation. */
export function stamp(target: gsap.TweenTarget): gsap.core.Tween {
  if (reduced) return done(target, { opacity: 1 });
  return gsap.fromTo(target, { opacity: 0 }, { opacity: 1, duration: DUR.fast, ease: EASE.place });
}

/** Shake: a short "no" that never blocks the learner. Reduced: no move (the panel says it). */
export function shake(target: gsap.TweenTarget): gsap.core.Tween {
  if (reduced) return done(target, { clearProps: 'transform' });
  return gsap.fromTo(
    target,
    { x: 0 },
    { keyframes: { x: [0, -4, 3, -2, 0] }, duration: 0.24, ease: 'power1.out', clearProps: 'transform' },
  );
}

const CONFETTI = ['#F2B01E', '#2B4FC9', '#1E9E6A', '#E4472B', '#1D1C26'];

/** A few paper bits: only for the end of a lesson. Skipped when reduced. */
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

/** Glide: cards that change places slide to their new place (a layout change). */
export function glide(targets: Element[], change: () => void): void {
  if (reduced) {
    change();
    return;
  }
  const state = Flip.getState(targets);
  change();
  Flip.from(state, { duration: DUR.fast, ease: EASE.place });
}

export type Timeline = gsap.core.Timeline;

export { Flip, gsap };
