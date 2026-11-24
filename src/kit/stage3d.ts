// Three.js stage. Renders on demand: a frame is drawn only when something
// changed, so an idle scene costs no GPU time.
import { AmbientLight, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { Material, Object3D, Texture } from 'three';
import { gsap, isReduced } from './motion';

const FOV = 30;
const TARGET = new Vector3(0, 0.95, 0);
const DEFAULT_HEIGHT = 3.0;

export class Stage3D {
  readonly mode = '3d' as const;
  readonly el: HTMLElement;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(FOV, 1, 0.1, 100);
  /** Average frames per second of the last animated stretch (for checks). */
  fps = 60;

  private renderer: WebGLRenderer;
  private dirty = true;
  private onscreen = true;
  private last = 0;
  private samples: number[] = [];
  private view = { width: 4.6, height: DEFAULT_HEIGHT, yaw: 0, tilt: 0 };
  private resizer: ResizeObserver;
  private watcher: IntersectionObserver;

  constructor(
    private container: HTMLElement,
    private quality: 'high' | 'low',
    private onSlow: () => void,
  ) {
    this.renderer = new WebGLRenderer({ antialias: quality === 'high', alpha: true });
    this.renderer.setPixelRatio(quality === 'high' ? Math.min(window.devicePixelRatio, 2) : 1);
    this.el = this.renderer.domElement;
    this.el.className = 'stage3d';
    this.el.setAttribute('aria-hidden', 'true');
    container.append(this.el);

    // Matte light: a warm sky above, the paper below, and a soft sun from the
    // upper left, so the sides of a crate are a little darker than its front.
    this.scene.add(new HemisphereLight(0xfff6e8, 0xd8ccb8, 1.6));
    this.scene.add(new AmbientLight(0xffffff, 0.9));
    const sun = new DirectionalLight(0xfff4e2, 1.5);
    sun.position.set(-3, 6, 5);
    this.scene.add(sun);

    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(container);
    this.watcher = new IntersectionObserver(([entry]) => {
      this.onscreen = entry.isIntersecting;
      if (this.onscreen) this.invalidate();
    });
    this.watcher.observe(container);
    this.resize();
    gsap.ticker.add(this.tick);
    if (import.meta.env.DEV) (window as unknown as { __zpStage?: Stage3D }).__zpStage = this;
  }

  /** Cost of one frame, for performance checks: draw calls, triangles, CPU ms. */
  measure(frames = 120): { calls: number; triangles: number; msPerFrame: number } {
    const gl = this.renderer.getContext();
    const start = performance.now();
    for (let i = 0; i < frames; i += 1) this.renderer.render(this.scene, this.camera);
    gl.finish();
    const msPerFrame = (performance.now() - start) / frames;
    const { calls, triangles } = this.renderer.info.render;
    return { calls, triangles, msPerFrame: Math.round(msPerFrame * 100) / 100 };
  }

  /** Marks the picture as changed. The next tick draws one frame. */
  invalidate = (): void => {
    this.dirty = true;
  };

  /** A GSAP timeline that redraws the stage while it plays. */
  timeline(vars: gsap.TimelineVars = {}): gsap.core.Timeline {
    return gsap.timeline({ ...vars, onUpdate: this.invalidate });
  }

  /** Sets how tall the content is. Actors with tall scenes call this once. */
  fitHeight(height: number): void {
    this.view.height = height;
    this.applyCamera();
  }

  /** Moves the camera so that content of this width (and height) fits. */
  frame(width: number, animate = true, height = this.view.height): void {
    if (!animate || isReduced()) {
      this.view.width = width;
      this.view.height = height;
      this.applyCamera();
      return;
    }
    gsap.to(this.view, {
      width,
      height,
      duration: 0.4,
      ease: 'power2.out',
      overwrite: 'auto',
      onUpdate: () => this.applyCamera(),
    });
  }

  dispose(): void {
    gsap.ticker.remove(this.tick);
    gsap.killTweensOf(this.view);
    this.resizer.disconnect();
    this.watcher.disconnect();
    disposeObject(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.el.remove();
  }

  private applyCamera(): void {
    const half = Math.tan((FOV * Math.PI) / 360);
    const distance = Math.max(this.view.width / 2 / (half * this.camera.aspect), this.view.height / 2 / half);
    const tilt = 0.27 + this.view.tilt;
    this.camera.position.set(
      TARGET.x + Math.sin(this.view.yaw) * Math.cos(tilt) * distance,
      TARGET.y + Math.sin(tilt) * distance,
      TARGET.z + Math.cos(this.view.yaw) * Math.cos(tilt) * distance,
    );
    this.camera.lookAt(TARGET);
    this.invalidate();
  }

  private resize(): void {
    const width = Math.max(this.container.clientWidth, 1);
    const height = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.applyCamera();
  }

  private tick = (): void => {
    if (!this.dirty || !this.onscreen) return;
    this.dirty = false;
    this.renderer.render(this.scene, this.camera);
    this.sample();
  };

  // Watches frame time during animation. Steps down from high to light once.
  private sample(): void {
    const now = performance.now();
    const delta = now - this.last;
    this.last = now;
    if (delta > 100) return; // first frame after an idle period
    this.samples.push(delta);
    if (this.samples.length < 90) return;
    const average = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
    this.samples = [];
    this.fps = Math.round(1000 / average);
    if (average > 24 && this.quality === 'high') {
      this.quality = 'low';
      this.renderer.setPixelRatio(1);
      this.resize();
      this.onSlow();
    }
  }
}

/** Frees GPU memory of an object and everything below it. */
export function disposeObject(root: Object3D): void {
  root.traverse((node) => {
    const mesh = node as Object3D & { geometry?: { dispose(): void }; material?: Material | Material[] };
    mesh.geometry?.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of materials) {
      (material as Material & { map?: Texture | null }).map?.dispose();
      material.dispose();
    }
  });
}
