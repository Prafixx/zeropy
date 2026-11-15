// A stage is the surface a scene plays on: 3D (Three.js) or 2D (DOM).
// Scene modules and step renderers never choose; the graphics setting does.
import type { Timeline } from './motion';
import { effectiveGraphics, reducedBySystem, setSettings } from './settings';
import { FONT_MONO } from './palette';
import type { Stage3D } from './stage3d';

export interface Stage2D {
  readonly mode: '2d';
  readonly el: HTMLElement;
  dispose(): void;
}

export type Stage = Stage2D | Stage3D;

export interface SceneInstance {
  beats: Record<string, () => Timeline>;
  dispose(): void;
}

export type SceneFactory = (stage: Stage) => Promise<SceneInstance>;

/** Identity helper that gives scene modules their types. */
export function defineScene(factory: SceneFactory): SceneFactory {
  return factory;
}

function create2D(container: HTMLElement): Stage2D {
  const el = document.createElement('div');
  el.className = 'stage2d';
  container.append(el);
  let notice: HTMLButtonElement | null = null;
  if (reducedBySystem()) {
    // The system asks for reduced motion. Respect it, but say so and let
    // the learner choose animations for this course.
    notice = document.createElement('button');
    notice.type = 'button';
    notice.className = 'stage-notice';
    notice.textContent = 'Animations are off (system setting). Turn on';
    notice.addEventListener('click', () => setSettings({ motion: 'full' }));
    container.append(notice);
  }
  return {
    mode: '2d',
    el,
    dispose: () => {
      el.remove();
      notice?.remove();
    },
  };
}

export async function createStage(container: HTMLElement): Promise<Stage> {
  const graphics = effectiveGraphics();
  container.dataset.stage = graphics === '2d' ? '2d' : '3d';
  if (graphics === '2d') return create2D(container);
  try {
    const [{ Stage3D }] = await Promise.all([
      import('./stage3d'),
      document.fonts.load(`700 40px ${FONT_MONO}`),
    ]);
    return new Stage3D(container, graphics === '3d-high' ? 'high' : 'low', () => {
      setSettings({ graphics: '3d-low' });
    });
  } catch (error) {
    console.warn('[stage] 3D is not available, using 2D', error);
    container.dataset.stage = '2d';
    return create2D(container);
  }
}
