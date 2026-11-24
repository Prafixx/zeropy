// Shared 3D primitives: crates, labels, value cards. Matte materials in the
// colors of the theme (see palette.ts); thin outlines; nothing tilted.
import {
  BoxGeometry,
  CanvasTexture,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { FONT_MONO, PALETTE, shortRepr, valueColor } from './palette';

export const CRATE = { width: 1.5, height: 0.85, depth: 1.0, wall: 0.07 };
export const CARD = { width: 1.15, height: 1.6, depth: 0.12 };
/** Height of a card's center when it stands in a crate. */
export const CARD_REST_Y = CRATE.wall + CARD.height / 2;

// One outline material for each line color (light or dark theme).
const lineMaterials = new Map<string, LineBasicMaterial>();
function lineMaterial(): LineBasicMaterial {
  let material = lineMaterials.get(PALETTE.line);
  if (!material) {
    material = new LineBasicMaterial({ color: PALETTE.line });
    lineMaterials.set(PALETTE.line, material);
  }
  return material;
}

export function canvasTexture(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // A small letter spacing turns off font ligatures: >= must stay two characters.
  ctx.letterSpacing = '0.5px';
  draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, start: number, weight = 700): void {
  let size = start;
  do {
    ctx.font = `${weight} ${size}px ${FONT_MONO}`;
    size -= 4;
  } while (ctx.measureText(text).width > maxWidth && size > 16);
}

export function outline(geometry: BoxGeometry): LineSegments {
  return new LineSegments(new EdgesGeometry(geometry), lineMaterial());
}

/** An open cardboard crate with a paper name label on the front. */
export function makeCrate(name: string): Group {
  const { width: w, height: h, depth: d, wall: t } = CRATE;
  const group = new Group();
  const kraft = new MeshLambertMaterial({ color: PALETTE.kraft });
  const inside = new MeshLambertMaterial({ color: PALETTE.kraftDark });

  const parts: [BoxGeometry, number, number, number, MeshLambertMaterial][] = [
    [new BoxGeometry(w, t, d), 0, t / 2, 0, inside],
    [new BoxGeometry(w, h, t), 0, h / 2, d / 2 - t / 2, kraft],
    [new BoxGeometry(w, h, t), 0, h / 2, -d / 2 + t / 2, inside],
    [new BoxGeometry(t, h, d - 2 * t), -w / 2 + t / 2, h / 2, 0, kraft],
    [new BoxGeometry(t, h, d - 2 * t), w / 2 - t / 2, h / 2, 0, kraft],
  ];
  for (const [geometry, x, y, z, material] of parts) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    group.add(mesh);
  }
  const edges = outline(new BoxGeometry(w, h, d));
  edges.position.y = h / 2;
  group.add(edges);

  const label = new Mesh(
    new PlaneGeometry(1.2, 0.44),
    new MeshBasicMaterial({
      map: canvasTexture(480, 176, (ctx) => {
        ctx.fillStyle = PALETTE.paper2;
        ctx.fillRect(0, 0, 480, 176);
        ctx.lineWidth = 6;
        ctx.strokeStyle = PALETTE.line;
        ctx.strokeRect(6, 6, 468, 164);
        ctx.fillStyle = PALETTE.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fitText(ctx, name, 420, 92);
        ctx.fillText(name, 240, 94);
      }),
    }),
  );
  label.position.set(0, h * 0.5, d / 2 + 0.008);
  group.add(label);

  const shadow = new Mesh(
    new PlaneGeometry(w + 0.1, d + 0.1),
    new MeshBasicMaterial({ color: PALETTE.shadow, transparent: true, opacity: PALETTE.shadowOpacity, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.16, 0.004, 0.12);
  group.add(shadow);
  return group;
}

/** A value card. Color shows the type; the top half shows the value. */
export function makeCard(repr: string, type: string): Group {
  const { width: w, height: h, depth: d } = CARD;
  const color = valueColor(type);
  const side = new MeshLambertMaterial({ color: color.bg });
  const face = new MeshBasicMaterial({
    map: canvasTexture(368, 512, (ctx) => {
      ctx.fillStyle = color.bg;
      ctx.fillRect(0, 0, 368, 512);
      ctx.fillStyle = color.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = shortRepr(repr);
      fitText(ctx, text, 316, 128);
      ctx.fillText(text, 184, 122);
      // The type must be readable: lesson 3 asks the learner to look at it.
      ctx.globalAlpha = 0.85;
      ctx.font = `600 46px ${FONT_MONO}`;
      ctx.fillText(type, 184, 222);
    }),
  });
  const geometry = new BoxGeometry(w, h, d);
  // Box faces: +x, -x, +y, -y, +z (front), -z.
  const mesh = new Mesh(geometry, [side, side, side, side, face, side]);
  const group = new Group();
  group.add(mesh, outline(geometry));
  return group;
}

/** A small value that waits in a row: one of the values of a for-loop. */
export function makeChip(repr: string, type: string): Group {
  const size = 0.46;
  const color = valueColor(type);
  const side = new MeshLambertMaterial({ color: color.bg });
  const face = new MeshBasicMaterial({
    map: canvasTexture(128, 128, (ctx) => {
      ctx.fillStyle = color.bg;
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = color.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = shortRepr(repr, 6);
      fitText(ctx, text, 108, 84);
      ctx.fillText(text, 64, 68);
    }),
  });
  const geometry = new BoxGeometry(size, size, 0.08);
  const group = new Group();
  group.add(new Mesh(geometry, [side, side, side, side, face, side]), outline(geometry));
  return group;
}

// ---- A list: a flat tray with numbered places --------------------------------

/** Sizes of a list rack. `label` is the room for the name on the left. */
export const RACK = { label: 1.3, pitch: 1.0, pad: 0.18, height: 0.42, depth: 0.8 };
export const CELL = { width: 0.88, height: 0.56, depth: 0.08 };
/** Height of a cell's center when it stands on the tray. */
export const CELL_REST_Y = RACK.height + CELL.height / 2;

/**
 * One value in a list. Wider than a loop chip, so short words fit. `max` is
 * the longest text before it is cut with "…": a place with a key or the
 * name of an attribute may hold a little more, in a smaller font.
 */
export function makeCell(repr: string, type: string, max = 8): Group {
  const { width: w, height: h, depth: d } = CELL;
  const color = valueColor(type);
  const side = new MeshLambertMaterial({ color: color.bg });
  const face = new MeshBasicMaterial({
    map: canvasTexture(320, 204, (ctx) => {
      ctx.fillStyle = color.bg;
      ctx.fillRect(0, 0, 320, 204);
      ctx.fillStyle = color.fg;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const text = shortRepr(repr, max);
      fitText(ctx, text, 296, 88);
      ctx.fillText(text, 160, 108);
    }),
  });
  const geometry = new BoxGeometry(w, h, d);
  const group = new Group();
  group.add(new Mesh(geometry, [side, side, side, side, face, side]), outline(geometry));
  return group;
}

/** A flat text sign: the name of a list, an index number, or "+3". */
export function makePlaque(text: string, width: number, height: number, kind: 'name' | 'index' | 'more'): Mesh {
  const ch = 160;
  const cw = Math.round((ch * width) / height);
  const mesh = new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({
      transparent: kind !== 'name',
      map: canvasTexture(cw, ch, (ctx) => {
        if (kind === 'name') {
          ctx.fillStyle = PALETTE.paper2;
          ctx.fillRect(0, 0, cw, ch);
          ctx.lineWidth = 6;
          ctx.strokeStyle = PALETTE.line;
          ctx.strokeRect(6, 6, cw - 12, ch - 12);
        }
        ctx.fillStyle = PALETTE.ink;
        ctx.globalAlpha = kind === 'index' ? 0.82 : 1;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fitText(ctx, text, cw - 40, kind === 'name' ? 92 : 104);
        ctx.fillText(text, cw / 2, ch / 2 + 6);
      }),
    }),
  );
  return mesh;
}

/**
 * The tray of a list. Its geometry goes from x = 0 to x = 1, so the tray
 * grows to the right when the group is scaled in x.
 */
export function makeTray(color: string = PALETTE.kraft): Group {
  const { height: h, depth: d } = RACK;
  const geometry = new BoxGeometry(1, h, d);
  geometry.translate(0.5, h / 2, 0);
  const group = new Group();
  group.add(new Mesh(geometry, new MeshLambertMaterial({ color })), outline(geometry));
  const shadowGeometry = new PlaneGeometry(1, d + 0.1);
  shadowGeometry.translate(0.5, 0, 0);
  const shadow = new Mesh(
    shadowGeometry,
    new MeshBasicMaterial({ color: PALETTE.shadow, transparent: true, opacity: PALETTE.shadowOpacity, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.set(0.04, 0.004, 0.12);
  group.add(shadow);
  return group;
}

/** A padlock sign for a tuple: its places cannot change. */
export function makeLock(): Mesh {
  return new Mesh(
    new PlaneGeometry(0.3, 0.36),
    new MeshBasicMaterial({
      transparent: true,
      map: canvasTexture(100, 120, (ctx) => {
        ctx.lineWidth = 6;
        ctx.strokeStyle = PALETTE.line;
        ctx.fillStyle = PALETTE.sun;
        ctx.beginPath();
        ctx.arc(50, 48, 24, Math.PI, 0);
        ctx.stroke();
        ctx.fillRect(16, 48, 68, 56);
        ctx.strokeRect(16, 48, 68, 56);
        ctx.fillStyle = PALETTE.ink;
        ctx.fillRect(45, 66, 10, 20);
      }),
    }),
  );
}

/**
 * A shelf board, for scenes with more than one row. Its geometry is one
 * unit wide and centered, so the group is scaled in x to the row width.
 */
export function makeShelf(): Group {
  const geometry = new BoxGeometry(1, 0.08, 1.2);
  geometry.translate(0, -0.04, 0);
  const group = new Group();
  group.add(new Mesh(geometry, new MeshLambertMaterial({ color: PALETTE.kraftDark })), outline(geometry));
  return group;
}

/** The desk of a function call: a paper board. One unit wide, from x = 0 to 1. */
export function makeDesk(): Group {
  const geometry = new BoxGeometry(1, 0.08, 1.4);
  geometry.translate(0.5, -0.04, 0);
  const group = new Group();
  group.add(new Mesh(geometry, new MeshLambertMaterial({ color: PALETTE.paper2 })), outline(geometry));
  return group;
}

/** The sign of a function call, like `area()`, standing on its desk. */
export function makeSign(text: string, width: number): Mesh {
  const height = 0.42;
  const ch = 160;
  const cw = Math.round((ch * width) / height);
  return new Mesh(
    new PlaneGeometry(width, height),
    new MeshBasicMaterial({
      map: canvasTexture(cw, ch, (ctx) => {
        ctx.fillStyle = PALETTE.sun;
        ctx.fillRect(0, 0, cw, ch);
        ctx.lineWidth = 6;
        ctx.strokeStyle = PALETTE.line;
        ctx.strokeRect(6, 6, cw - 12, ch - 12);
        ctx.fillStyle = PALETTE.ink;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        fitText(ctx, text, cw - 40, 90);
        ctx.fillText(text, cw / 2, ch / 2 + 6);
      }),
    }),
  );
}
