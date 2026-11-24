import { BoxGeometry, ConeGeometry, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, PlaneGeometry } from 'three';
import { EASE } from '../motion';
import type { Timeline } from '../motion';
import { FONT_MONO, PALETTE, valueColor } from '../palette';
import { canvasTexture, fitText, outline } from '../prims3d';
import { disposeObject } from '../stage3d';
import type { Stage3D } from '../stage3d';
import { looksLikeNumber, MAX_OUT_LINES, onlyAppends, visibleCode } from './program-run';
import type { ProgramRun, RunFrame } from './program-run';

const STRIP = { x: -1.2, width: 3.0, depth: 0.08, centerY: 0.95, maxGap: 0.5, room: 3.3 };
const SCREEN = { x: 2.0, y: 0.95, width: 2.5, height: 2.5 };
const ROW = { width: 2.1, height: 0.33, top: 1.83, gap: 0.37 };
const CAPTION_Y = 2.64;
const CODE_TEXT = '#f6f1e7';
const CODE_DIM = '#8f8ca3';
const SKIPPED_TINT = '#6f6f78';

function rowY(index: number): number {
  return ROW.top - index * ROW.gap;
}

function caption(text: string): Mesh {
  return new Mesh(
    new PlaneGeometry(1.9, 0.38),
    new MeshBasicMaterial({
      transparent: true,
      map: canvasTexture(500, 100, (ctx) => {
        ctx.fillStyle = PALETTE.ink;
        ctx.globalAlpha = 0.62;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `700 50px ${FONT_MONO}`;
        ctx.fillText(text.toUpperCase(), 250, 54);
      }),
    }),
  );
}

interface Strip {
  mesh: Mesh;
  face: MeshBasicMaterial;
  badge: Mesh | null;
  verdict: boolean | undefined;
}

export class Run3D implements ProgramRun {
  private root = new Group();
  private stripGroup = new Group();
  private rowGroup = new Group();
  private strips: Strip[] = [];
  private gap = STRIP.maxGap;
  private codeKey = '';
  private out: string[] = [];
  private pointer: Mesh;
  private pointerMaterial = new MeshLambertMaterial({ color: PALETTE.sun });
  private current: Timeline | null = null;

  constructor(private stage: Stage3D) {
    // The screen: an ink frame with a paper face, on a small stand.
    const frame = new Mesh(new BoxGeometry(SCREEN.width, SCREEN.height, 0.06), new MeshLambertMaterial({ color: PALETTE.frame }));
    frame.position.set(SCREEN.x, SCREEN.y, 0);
    const face = new Mesh(
      new PlaneGeometry(SCREEN.width - 0.2, SCREEN.height - 0.2),
      new MeshBasicMaterial({ color: PALETTE.paper2 }),
    );
    face.position.set(SCREEN.x, SCREEN.y, 0.035);
    const standGeometry = new BoxGeometry(1.1, 0.12, 0.7);
    const stand = new Mesh(standGeometry, new MeshLambertMaterial({ color: PALETTE.kraft }));
    stand.add(outline(standGeometry));
    stand.position.set(SCREEN.x, SCREEN.y - SCREEN.height / 2 - 0.06, 0);

    const left = caption('program');
    left.position.set(STRIP.x, CAPTION_Y, 0);
    const right = caption('screen');
    right.position.set(SCREEN.x, CAPTION_Y, 0);

    this.pointer = new Mesh(new ConeGeometry(0.15, 0.36, 4), this.pointerMaterial);
    this.pointer.rotation.z = -Math.PI / 2;
    this.pointer.position.set(STRIP.x - STRIP.width / 2 - 0.36, STRIP.centerY, 0.1);
    this.pointer.scale.setScalar(0.001);

    this.root.add(frame, face, stand, left, right, this.pointer, this.stripGroup, this.rowGroup);
    stage.scene.add(this.root);
    stage.fitHeight(3.7);
    stage.frame(7.0, false);
  }

  show(frame: RunFrame): Timeline {
    this.current?.progress(1);
    const tl = this.stage.timeline();
    this.current = tl;

    const code = visibleCode(frame.code);
    const key = code.join('\n');
    if (key !== this.codeKey) {
      this.codeKey = key;
      this.buildStrips(code, tl);
      this.clearRows();
    }

    const index = frame.line === null ? -1 : frame.line - 1;
    const active = index >= 0 && index < this.strips.length ? this.strips[index] : null;
    const skipped = new Set(frame.skipped ?? []);
    this.pointerMaterial.color.set(frame.error ? PALETTE.tomato : PALETTE.sun);
    this.strips.forEach((strip, i) => {
      const on = strip === active;
      strip.face.color.set(skipped.has(i + 1) ? SKIPPED_TINT : '#ffffff');
      tl.to(strip.mesh.position, { z: on ? 0.24 : 0, x: STRIP.x + (on ? 0.12 : 0), duration: 0.28, ease: EASE.place }, 'move');
    });
    if (active) {
      tl.to(this.pointer.scale, { x: 1, y: 1, z: 1, duration: 0.2, ease: EASE.pop }, 'move').to(
        this.pointer.position,
        { y: this.stripY(index), duration: 0.3, ease: EASE.place },
        'move',
      );
      if (frame.error) {
        const x = STRIP.x + 0.12;
        tl.to(active.mesh.position, { keyframes: { x: [x, x - 0.14, x + 0.08, x - 0.06, x] }, duration: 0.36 });
      }
    } else {
      tl.to(this.pointer.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.2 }, 'move');
    }

    this.strips.forEach((strip, i) => this.setBadge(tl, strip, frame.verdicts?.[i + 1], strip === active));

    if (onlyAppends(this.out, frame.out)) {
      for (let i = this.out.length; i < frame.out.length; i += 1) this.printRow(tl, frame.out[i], i, active ? index : null);
    } else {
      // Output that scrolled or changed: redraw the last lines at once.
      this.clearRows();
      frame.out.slice(-MAX_OUT_LINES).forEach((text, i) => this.rowGroup.add(this.makeRow(text, i)));
    }
    this.out = frame.out.slice(-MAX_OUT_LINES);
    return tl;
  }

  dispose(): void {
    this.current?.kill();
    this.stage.scene.remove(this.root);
    disposeObject(this.root);
  }

  /** Strips are centered as a block, so a short program does not sit in a corner. */
  private stripY(index: number): number {
    return STRIP.centerY + ((this.strips.length - 1) / 2 - index) * this.gap;
  }

  private buildStrips(code: string[], tl: Timeline): void {
    disposeObject(this.stripGroup);
    this.stripGroup.clear();
    // Long programs get thinner strips so that all lines fit.
    this.gap = Math.min(STRIP.maxGap, STRIP.room / Math.max(code.length, 1));
    const height = this.gap * 0.84;
    const pixels = Math.round((1024 * height) / STRIP.width);
    const side = new MeshLambertMaterial({ color: PALETTE.frame });
    this.strips = [];
    // stripY needs the final count, so reserve the slots first.
    this.strips.length = code.length;
    code.forEach((text, i) => {
      const face = new MeshBasicMaterial({
        map: canvasTexture(1024, pixels, (ctx) => {
          ctx.fillStyle = PALETTE.ink;
          ctx.fillRect(0, 0, 1024, pixels);
          ctx.textBaseline = 'middle';
          ctx.font = `500 ${Math.round(pixels * 0.4)}px ${FONT_MONO}`;
          ctx.fillStyle = CODE_DIM;
          ctx.fillText(String(i + 1), 28, pixels * 0.53);
          ctx.fillStyle = CODE_TEXT;
          // A condition line leaves room on the right for a True / False badge.
          const room = /^\s*(if|elif|while)\s/.test(text) ? 600 : 890;
          fitText(ctx, text, room, Math.round(pixels * 0.5), 600);
          ctx.fillText(text, 104, pixels * 0.53);
        }),
      });
      const mesh = new Mesh(new BoxGeometry(STRIP.width, height, STRIP.depth), [side, side, side, side, face, side]);
      this.strips[i] = { mesh, face, badge: null, verdict: undefined };
      mesh.position.set(STRIP.x, this.stripY(i), 0);
      this.stripGroup.add(mesh);
      tl.fromTo(mesh.scale, { x: 0.001, y: 0.001 }, { x: 1, y: 1, duration: 0.3, ease: EASE.pop }, i * 0.05);
    });
  }

  // The answer of a condition: a green True or a red False card on its line.
  private setBadge(tl: Timeline, strip: Strip, verdict: boolean | undefined, asked: boolean): void {
    if (strip.verdict === verdict) {
      // A loop asks the same question again: the badge jumps to show it.
      if (asked && strip.badge) {
        tl.fromTo(strip.badge.scale, { x: 1.5, y: 1.5 }, { x: 1, y: 1, duration: 0.35, ease: EASE.pop });
      }
      return;
    }
    strip.verdict = verdict;
    if (strip.badge) {
      strip.mesh.remove(strip.badge);
      disposeObject(strip.badge);
      strip.badge = null;
    }
    if (verdict === undefined) return;
    const height = this.gap * 0.7;
    const badge = new Mesh(
      new PlaneGeometry(height * 2.5, height),
      new MeshBasicMaterial({
        map: canvasTexture(250, 100, (ctx) => {
          ctx.fillStyle = verdict ? PALETTE.leaf : PALETTE.tomato;
          ctx.fillRect(0, 0, 250, 100);
          ctx.lineWidth = 6;
          ctx.strokeStyle = PALETTE.line;
          ctx.strokeRect(5, 5, 240, 90);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `700 54px ${FONT_MONO}`;
          ctx.fillText(verdict ? 'True' : 'False', 125, 54);
        }),
      }),
    );
    badge.position.set(STRIP.width / 2 - height * 1.1, 0, STRIP.depth / 2 + 0.03);
    badge.rotation.z = verdict ? -0.06 : 0.06;
    strip.mesh.add(badge);
    strip.badge = badge;
    tl.fromTo(badge.scale, { x: 0.001, y: 0.001 }, { x: 1, y: 1, duration: 0.3, ease: EASE.pop });
  }

  private clearRows(): void {
    disposeObject(this.rowGroup);
    this.rowGroup.clear();
    this.out = [];
  }

  private makeRow(text: string, index: number): Mesh {
    const geometry = new PlaneGeometry(ROW.width, ROW.height);
    geometry.translate(ROW.width / 2, 0, 0); // scale from the left edge
    const row = new Mesh(
      geometry,
      new MeshBasicMaterial({
        map: canvasTexture(900, 141, (ctx) => {
          ctx.fillStyle = PALETTE.paper2;
          ctx.fillRect(0, 0, 900, 141);
          ctx.fillStyle = PALETTE.ink;
          ctx.textBaseline = 'middle';
          fitText(ctx, text, 880, 92, 600);
          ctx.fillText(text, 6, 76);
        }),
      }),
    );
    row.position.set(SCREEN.x - ROW.width / 2, rowY(index), 0.05);
    return row;
  }

  // A value leaves the current line, flies to the screen and becomes text.
  private printRow(tl: Timeline, text: string, index: number, fromStrip: number | null): void {
    const row = this.makeRow(text, index);
    row.scale.x = 0.001;
    this.rowGroup.add(row);
    if (fromStrip !== null) {
      const color = valueColor(looksLikeNumber(text) ? 'int' : 'str').bg;
      const geometry = new BoxGeometry(0.6, 0.26, 0.06);
      const token = new Mesh(geometry, new MeshLambertMaterial({ color }));
      token.add(outline(geometry));
      token.visible = false;
      token.position.set(STRIP.x + 0.9, this.stripY(fromStrip), 0.4);
      this.rowGroup.add(token);
      tl.set(token, { visible: true })
        .to(token.position, { x: SCREEN.x - ROW.width / 2 + 0.3, y: rowY(index), duration: 0.5, ease: 'power2.inOut' })
        .to(token.position, { z: 1.1, duration: 0.25, ease: 'power2.out' }, '<')
        .to(token.position, { z: 0.12, duration: 0.25, ease: 'power2.in' }, '>')
        .to(token.scale, {
          x: 0.001,
          y: 0.001,
          z: 0.001,
          duration: 0.18,
          onComplete: () => {
            this.rowGroup.remove(token);
            disposeObject(token);
          },
        });
    }
    tl.to(row.scale, { x: 1, duration: 0.3, ease: EASE.place }, fromStrip !== null ? '<' : '>');
  }
}
