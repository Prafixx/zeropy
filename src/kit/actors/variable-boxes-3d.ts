import { Group } from 'three';
import type { Mesh, Object3D } from 'three';
import { EASE, gsap } from '../motion';
import type { Timeline } from '../motion';
import {
  CARD_REST_Y,
  CELL_REST_Y,
  CRATE,
  RACK,
  makeCard,
  makeCell,
  makeChip,
  makeCrate,
  makeDesk,
  makeLock,
  makePlaque,
  makeShelf,
  makeSign,
  makeTray,
} from '../prims3d';
import { PALETTE } from '../palette';
import { disposeObject } from '../stage3d';
import type { Stage3D } from '../stage3d';
import { diffItems, entriesOf, feedKey, MAX_BOXES, MAX_CHIPS, MAX_ITEMS } from './variable-boxes';
import type { BoxItem, BoxVar, Entry, Feed, Pick, SyncHints, VariableBoxes } from './variable-boxes';

/** Every slot has its origin at its left edge, so a list can grow to the right. */
interface SlotBase {
  key: string;
  group: Group;
  width: number;
  /** Left edge in root coordinates, after the current layout. */
  left: number;
  /** Height of the row the slot stands in, in root coordinates. */
  y: number;
}

interface CrateSlot extends SlotBase {
  kind: 'crate';
  /** Origin at the center of the crate. */
  inner: Group;
  crate: Group;
  card: Group | null;
  repr: string;
  type: string;
}

interface RackSlot extends SlotBase {
  kind: 'rack';
  tray: Group;
  /** One label for each name of this list. */
  labels: Map<string, Mesh>;
  /** Width of the part of the tray that holds the name labels. */
  labelArea: number;
  cells: Group[];
  /** A list: index numbers, one per place. They stay where they are. */
  indices: Mesh[];
  /** list and tuple: numbers under the values. dict: keys. set: nothing. */
  shape: Shape;
  /** A dictionary: one key per value. A key moves with its value. */
  keys: Mesh[];
  /** A tuple: the padlock at the end of the tray. */
  lock: Mesh | null;
  /** An object: the name of its class, above the name labels. */
  cls: Mesh | null;
  more: Mesh | null;
  moreText: string;
  items: BoxItem[];
}

type Slot = CrateSlot | RackSlot;
type Shape = 'list' | 'tuple' | 'dict' | 'set' | 'object';

function shapeOf(v: BoxVar): Shape {
  if (v.object) return 'object';
  // A text drawn as characters is sealed, like a tuple: it cannot change.
  if (v.type === 'str') return 'tuple';
  if (v.type === 'tuple' || v.type === 'dict') return v.type;
  if (v.type === 'set' || v.type === 'frozenset') return 'set';
  return 'list';
}

/** Extra room at the end of a tuple, for its padlock. */
const LOCK_ROOM = 0.4;

/** Where a new card comes from. */
interface Origin {
  x: number;
  y: number;
  /** A waiting loop value: it is used up. */
  chip?: Group;
  /** Places of a list: they hop and keep their values. */
  hops?: Group[];
  /** Size of the value where it starts. */
  scale?: number;
}

const GAP = 0.45;
/** Height of one row when the scene uses shelves. */
const ROW_H = 2.0;
const MIN_HEIGHT = 3.0;
/** The desk of a function call: room at its sides, and the sign with its name. */
const DESK_PAD = 0.3;
const SIGN_W = 1.5;
const CARD_Z = -0.06;
const CHIP_SPACING = 0.58;
const CHIP_Y = 2.12;
const LABEL_PAD = 0.06;
const LABEL_GAP = 0.12;
const LABEL_Y = RACK.height / 2;
const LABEL_Z = RACK.depth / 2 + 0.006;
/** The class name of an object: above its name labels. */
const CLASS_Y = RACK.height / 2 + 0.46;

/** A label is as wide as its name needs, so short names leave room for the values. */
function plaqueWidth(name: string): number {
  return Math.min(1.12, Math.max(0.62, 0.36 + name.length * 0.13));
}

function labelArea(names: string[]): number {
  const widths = names.length ? names.map(plaqueWidth) : [1.12];
  return LABEL_PAD + widths.reduce((sum, w) => sum + w + LABEL_GAP, 0);
}

function labelX(names: string[], index: number): number {
  let x = LABEL_PAD;
  for (let i = 0; i < index; i += 1) x += plaqueWidth(names[i]) + LABEL_GAP;
  return x + (plaqueWidth(names[index]) + LABEL_GAP) / 2;
}

function rackWidth(area: number, count: number, more: boolean): number {
  return area + Math.max(count + (more ? 1 : 0), 1) * RACK.pitch + RACK.pad;
}

/** Splits widths into `count` rows of similar width, keeping the order. */
function splitRows(widths: number[], count: number): number[][] {
  const total = widths.reduce((a, b) => a + b, 0) + GAP * (widths.length - 1);
  const target = total / count;
  const rows: number[][] = [[]];
  let width = 0;
  widths.forEach((w, i) => {
    const row = rows[rows.length - 1];
    const next = width + (row.length ? GAP : 0) + w;
    const left = widths.length - i;
    // Start a new row when this one is full, but keep one slot for every row that is left.
    if (row.length && next > target * 1.08 && rows.length < count && left >= count - rows.length) {
      rows.push([i]);
      width = w;
    } else {
      row.push(i);
      width = next;
    }
  });
  return rows;
}

function cellX(slot: RackSlot, index: number): number {
  return slot.labelArea + RACK.pitch * (index + 0.5);
}

/** A small fixed tilt per name: labels look placed by hand. */
function tilt(name: string): number {
  return (((name.length * 37 + name.charCodeAt(0)) % 7) - 3) * 0.012;
}

export class Boxes3D implements VariableBoxes {
  private root = new Group();
  private feedGroup = new Group();
  private slots = new Map<string, Slot>();
  /** Which slot each variable name belongs to, after the last sync. */
  private nameKey = new Map<string, string>();
  private chips = new Map<number, Group>();
  private shelves: Group[] = [];
  private desks = new Map<number, { name: string; group: Group; board: Group; width: number }>();
  /** How far the top row is raised, so that all rows are centered. */
  private lift = 0;
  private feedKey = '';
  private feedTaken = 0;
  private current: Timeline | null = null;

  constructor(private stage: Stage3D) {
    this.root.add(this.feedGroup);
    stage.scene.add(this.root);
    stage.frame(4.6, false);
  }

  sync(vars: BoxVar[], hints: SyncHints = {}): Timeline {
    this.current?.progress(1);
    const outer = this.stage.timeline();
    this.current = outer;
    // A call gives a value back: first the value rises out of its desk,
    // then the desk closes, then the value travels to where it goes.
    const lifted = this.liftReturn(outer, vars, hints);
    let tl = outer;
    if (lifted) {
      tl = gsap.timeline();
      outer.add(tl, 0.5);
    }
    // Every name gets an id: a global name is its own id, a name of a
    // function call is `depth:name`. So `x` outside and `x` inside a call
    // are two different boxes.
    const frames = hints.frames ?? [];
    const all: BoxVar[] = [
      ...vars.slice(0, MAX_BOXES).map((v) => ({ ...v, id: v.id ?? v.name })),
      ...frames.flatMap((frame, d) => frame.vars.slice(0, MAX_BOXES).map((v) => ({ ...v, id: `${d}:${v.name}` }))),
    ];
    const entries = entriesOf(all);
    const keys = new Set(entries.map((e) => e.key));

    // Where each name label is now, so a name that moves to another list
    // can travel from there.
    const oldLabels = new Map<string, { x: number; y: number }>();
    for (const slot of this.slots.values()) {
      if (slot.kind !== 'rack') continue;
      for (const [id, label] of slot.labels) {
        oldLabels.set(id, { x: slot.group.position.x + label.position.x, y: slot.group.position.y });
      }
    }
    this.nameKey = new Map();
    for (const entry of entries) for (const v of entry.vars) this.nameKey.set(v.id!, entry.key);

    for (const [key, slot] of this.slots) {
      if (keys.has(key)) continue;
      this.slots.delete(key);
      // A name that moves on: its label here vanishes, and a label travels.
      if (slot.kind === 'rack') {
        for (const [id, label] of slot.labels) if (this.nameKey.has(id)) label.visible = false;
      }
      tl.to(
        slot.group.scale,
        { x: 0.001, y: 0.001, z: 0.001, duration: 0.25, ease: 'back.in(1.6)', onComplete: () => this.drop(slot.group) },
        0,
      );
    }

    const origin = this.syncFeed(tl, hints.feed);
    const created = new Set<string>();
    for (const entry of entries) {
      if (this.slots.has(entry.key)) continue;
      this.addSlot(entry);
      created.add(entry.key);
    }

    // A list is as wide as its names and its places.
    const widths = entries.map((entry) => {
      if (entry.kind === 'crate') return CRATE.width;
      const v = entry.vars[0];
      const shown = Math.min(v.items!.length, MAX_ITEMS);
      const lock = shapeOf(v) === 'tuple' ? LOCK_ROOM : 0;
      return rackWidth(labelArea(entry.vars.map((item) => item.name)), shown, (v.size ?? v.items!.length) > MAX_ITEMS) + lock;
    });

    // Blocks: each global box on its own, and each function call as one desk
    // with its own boxes on it.
    const zoneOf = (entry: Entry) => {
      const match = /^(\d+):/.exec(entry.vars[0].id ?? '');
      return match ? Number(match[1]) : -1;
    };
    const blocks: { frame: number; entries: number[]; width: number }[] = [];
    entries.forEach((entry, i) => {
      if (zoneOf(entry) < 0) blocks.push({ frame: -1, entries: [i], width: widths[i] });
    });
    frames.forEach((_, d) => {
      const inside = entries.flatMap((entry, i) => (zoneOf(entry) === d ? [i] : []));
      const boxes = inside.reduce((sum, i) => sum + widths[i], 0) + GAP * Math.max(inside.length - 1, 0);
      blocks.push({ frame: d, entries: inside, width: DESK_PAD * 2 + SIGN_W + (inside.length ? GAP + boxes : 0) });
    });

    // A wide scene goes on shelves, in two or three rows, when that makes
    // everything bigger on the screen. The order stays: left to right, then
    // the next row.
    const blockWidths = blocks.map((b) => b.width);
    const rows = this.planRows(blockWidths);
    const rowWidths = rows.map((row) => row.reduce((sum, b) => sum + blockWidths[b], 0) + GAP * Math.max(row.length - 1, 0));
    this.lift = ((rows.length - 1) * ROW_H) / 2;
    const place = (i: number, left: number, y: number) => {
      const slot = this.slots.get(entries[i].key)!;
      if (created.has(entries[i].key)) slot.group.position.set(left, y, 0);
      else if (slot.group.position.x !== left || slot.group.position.y !== y) {
        tl.to(slot.group.position, { x: left, y, duration: 0.45, ease: EASE.place }, 0);
      }
      slot.width = widths[i];
      slot.left = left;
      slot.y = y;
    };
    const desks: { depth: number; name: string; left: number; width: number; y: number }[] = [];
    rows.forEach((row, r) => {
      let left = -rowWidths[r] / 2;
      const y = this.lift - r * ROW_H;
      for (const b of row) {
        const block = blocks[b];
        if (block.frame < 0) place(block.entries[0], left, y);
        else {
          desks.push({ depth: block.frame, name: frames[block.frame].name, left, width: block.width, y });
          let x = left + DESK_PAD + SIGN_W + GAP;
          for (const i of block.entries) {
            place(i, x, y);
            x += widths[i] + GAP;
          }
        }
        left += block.width + GAP;
      }
    });
    const { back, opened } = this.syncDesks(tl, desks, hints.ret?.from);
    // A value that is given back but not stored (for example in print()) goes away.
    if (lifted?.chip && !all.some((v) => v.id === hints.ret?.to)) {
      const chip = lifted.chip;
      tl.to(chip.scale, { x: 0.001, y: 0.001, z: 0.001, duration: 0.3, ease: EASE.leave, onComplete: () => this.drop(chip) }, 0.4);
    }
    this.syncShelves(tl, rows.length > 1 ? rowWidths.map((w, r) => ({ width: w + 0.5, y: this.lift - r * ROW_H })) : []);
    const widest = Math.max(0, ...rowWidths);
    const width = Math.max(4.6, widest + 0.9, this.chips.size * CHIP_SPACING + 1.4);
    // More rows need more room below: the camera looks down a little.
    const height = Math.max(MIN_HEIGHT, rows.length * ROW_H + 0.9 + (rows.length - 1) * 0.5) + (this.chips.size > 0 ? 0.5 : 0);
    tl.call(() => this.stage.frame(width, true, height), [], 0);

    // The boxes of a call that opens arrive together, after the desk.
    const main = tl;
    let arriving = 0;
    for (const entry of entries) {
      const slot = this.slots.get(entry.key)!;
      const depth = Number(/^(\d+):/.exec(entry.vars[0].id ?? '')?.[1] ?? -1);
      const tl = opened.has(depth) ? gsap.timeline() : main;
      if (tl !== main) main.add(tl, 0.3 + 0.12 * arriving++);
      if (created.has(entry.key)) {
        // Crates grow from their center, lists from their left edge.
        const grow = slot.kind === 'crate' ? slot.inner.scale : slot.group.scale;
        tl.set(slot.group, { visible: true })
          .fromTo(grow, { x: 0.001, y: 0.001, z: 0.001 }, { x: 1, y: 1, z: 1, duration: 0.4, ease: EASE.pop })
          .fromTo(slot.group.position, { y: slot.y + 0.7 }, { y: slot.y, duration: 0.4, ease: 'bounce.out' }, '<');
      }
      if (slot.kind === 'rack') {
        this.syncNames(tl, slot, entry, oldLabels);
        this.syncRack(tl, slot, entry.vars[0]);
        continue;
      }
      const v = entry.vars[0];
      const id = v.id!;
      const taking = origin?.name === id ? origin.origin : undefined;
      const picking = hints.pick?.to === id ? this.pickOrigin(hints.pick) : undefined;
      // The value that a function gives back comes from its desk.
      const returning = hints.ret?.to === id && lifted ? lifted : hints.ret?.to === id ? back : undefined;
      const from = taking ?? picking ?? returning;
      // A loop or a list can give the same value twice. The card still arrives again.
      if (!from && slot.card && slot.repr === v.repr && slot.type === v.type) continue;
      this.replaceCard(tl, slot, v, hints.from?.[id], from);
    }
    // A value is read but not stored, for example in print(): the place hops.
    if (hints.pick && !hints.pick.to) {
      const read = this.pickOrigin(hints.pick);
      read?.hops?.forEach((cell, i) => this.hop(tl, cell, i * 0.06));
    }
    return tl;
  }

  /**
   * One desk for each function call that runs, with the name of the
   * function on a sign. A desk that is gone closes. Returns where the desk
   * of `closing` was, so the value it gives back can travel from there.
   */
  private syncDesks(
    tl: Timeline,
    specs: { depth: number; name: string; left: number; width: number; y: number }[],
    closing?: number,
  ): { back?: Origin; opened: Set<number> } {
    let back: Origin | undefined;
    const opened = new Set<number>();
    for (const [depth, desk] of this.desks) {
      const spec = specs.find((s) => s.depth === depth);
      if (spec && spec.name === desk.name) continue;
      if (depth === closing) {
        back = { x: desk.group.position.x + desk.width / 2, y: desk.group.position.y + 0.9 };
      }
      this.desks.delete(depth);
      tl.to(
        desk.group.scale,
        { x: 0.001, y: 0.001, z: 0.001, duration: 0.3, ease: 'back.in(1.4)', onComplete: () => this.drop(desk.group) },
        0.35,
      );
    }
    for (const spec of specs) {
      let desk = this.desks.get(spec.depth);
      if (!desk) {
        const group = new Group();
        const board = makeDesk();
        const sign = makeSign(`${spec.name}()`, SIGN_W - 0.1);
        sign.position.set(DESK_PAD + SIGN_W / 2, 0.5, 0.25);
        group.add(board, sign);
        group.position.set(spec.left, spec.y, 0);
        board.scale.x = spec.width;
        this.root.add(group);
        desk = { name: spec.name, group, board, width: spec.width };
        this.desks.set(spec.depth, desk);
        opened.add(spec.depth);
        // A call opens: the desk unfolds, then its boxes arrive.
        tl.fromTo(board.scale, { x: 0.001 }, { x: spec.width, duration: 0.4, ease: EASE.place }, 0).fromTo(
          sign.scale,
          { x: 0.001, y: 0.001 },
          { x: 1, y: 1, duration: 0.3, ease: EASE.pop },
          0.15,
        );
        continue;
      }
      desk.width = spec.width;
      tl.to(desk.group.position, { x: spec.left, y: spec.y, duration: 0.45, ease: EASE.place }, 0).to(
        desk.board.scale,
        { x: spec.width, duration: 0.45, ease: EASE.place },
        0,
      );
    }
    return { back, opened };
  }

  dispose(): void {
    this.current?.kill();
    this.stage.scene.remove(this.root);
    disposeObject(this.root);
    this.slots.clear();
    this.chips.clear();
    this.shelves = [];
    this.desks.clear();
  }

  /**
   * When a call ends with a value, that value rises out of the desk of the
   * call, while the desk is still there. Returns where it waits.
   */
  private liftReturn(tl: Timeline, vars: BoxVar[], hints: SyncHints): Origin | undefined {
    const ret = hints.ret;
    const desk = ret ? this.desks.get(ret.from) : undefined;
    if (!ret || !desk || (hints.frames ?? []).some((f, d) => d === ret.from && f.name === desk.name)) return undefined;
    const value = vars.find((v) => (v.id ?? v.name) === ret.to) ?? ret.value;
    if (!value) return undefined;
    const card = makeCard(value.repr, value.type);
    const x = desk.group.position.x + desk.width / 2;
    // Above the cards on the desk, and a little in front of them.
    const y = desk.group.position.y + 2.5;
    const scale = 0.7;
    card.position.set(x, y - 1.4, 0.6);
    card.scale.setScalar(0.001);
    this.root.add(card);
    tl.to(card.position, { y, duration: 0.45, ease: 'power2.out' }, 0).to(
      card.scale,
      { x: scale, y: scale, z: scale, duration: 0.35, ease: EASE.pop },
      0,
    );
    return { x, y, chip: card, scale };
  }

  private addSlot(entry: Entry): void {
    const group = new Group();
    group.visible = false;
    this.root.add(group);
    const base = { key: entry.key, group, width: 0, left: 0, y: 0 };
    if (entry.kind === 'rack') {
      const shape = shapeOf(entry.vars[0]);
      // A tuple has a darker tray and a padlock: it cannot change.
      const tray = makeTray(shape === 'tuple' ? PALETTE.kraftDark : PALETTE.kraft);
      tray.scale.x = rackWidth(labelArea([]), 0, false);
      group.add(tray);
      const lock = shape === 'tuple' ? makeLock() : null;
      if (lock) {
        lock.position.set(0, RACK.height / 2, RACK.depth / 2 + 0.008);
        group.add(lock);
      }
      // An object shows the name of its class, like a stamp on its tray.
      const area = labelArea(entry.vars.map((v) => v.name));
      const cls = shape === 'object' ? makePlaque(entry.vars[0].type, Math.max(0.8, area - 0.1), 0.36, 'more') : null;
      if (cls) {
        cls.position.set(area / 2, CLASS_Y, LABEL_Z);
        group.add(cls);
      }
      this.slots.set(entry.key, {
        ...base,
        kind: 'rack',
        tray,
        labels: new Map(),
        labelArea: area,
        cells: [],
        indices: [],
        shape,
        keys: [],
        lock,
        cls,
        more: null,
        moreText: '',
        items: [],
      });
      return;
    }
    const inner = new Group();
    inner.position.x = CRATE.width / 2;
    const crate = makeCrate(entry.vars[0].name);
    inner.add(crate);
    group.add(inner);
    this.slots.set(entry.key, { ...base, kind: 'crate', inner, crate, card: null, repr: '', type: '' });
  }

  /** Splits the slots into rows. Picks the number of rows that shows the scene biggest. */
  private planRows(widths: number[]): number[][] {
    const all = widths.map((_, i) => i);
    if (widths.length < 3) return [all];
    const aspect = this.stage.camera.aspect;
    const sizeOf = (rows: number[][]) => {
      const widest = Math.max(
        ...rows.map((row) => row.reduce((sum, i) => sum + widths[i], 0) + GAP * Math.max(row.length - 1, 0)),
      );
      // The camera distance that the scene needs: the bigger value wins.
      return Math.max((widest + 0.9) / aspect, rows.length * ROW_H + 0.9 + (rows.length - 1) * 0.5, MIN_HEIGHT);
    };
    let best = [all];
    let bestSize = sizeOf(best);
    for (let count = 2; count <= Math.min(3, widths.length); count += 1) {
      const rows = splitRows(widths, count);
      const size = sizeOf(rows);
      // Fewer rows are easier to read: change only for a clear gain.
      if (size < bestSize * 0.85) {
        best = rows;
        bestSize = size;
      }
    }
    return best;
  }

  private syncShelves(tl: Timeline, specs: { width: number; y: number }[]): void {
    while (this.shelves.length > specs.length) {
      const shelf = this.shelves.pop()!;
      tl.to(shelf.scale, { x: 0.001, duration: 0.3, ease: EASE.leave, onComplete: () => this.drop(shelf) }, 0);
    }
    specs.forEach((spec, i) => {
      let shelf = this.shelves[i];
      if (!shelf) {
        shelf = makeShelf();
        shelf.position.y = spec.y;
        shelf.scale.x = 0.001;
        this.root.add(shelf);
        this.shelves.push(shelf);
      }
      tl.to(shelf.scale, { x: spec.width, duration: 0.45, ease: EASE.place }, 0).to(
        shelf.position,
        { y: spec.y, duration: 0.45, ease: EASE.place },
        0,
      );
    });
  }

  private drop(object: Object3D): void {
    object.parent?.remove(object);
    disposeObject(object);
    this.stage.invalidate();
  }

  // ---- names on a list -------------------------------------------------------

  /**
   * Puts one label on the list for each of its names. A name that comes
   * from another list travels over: `=` moves a label, it copies nothing.
   */
  private syncNames(tl: Timeline, slot: RackSlot, entry: Entry, oldLabels: Map<string, { x: number; y: number }>): void {
    const names = entry.vars.map((v) => v.name);
    const ids = entry.vars.map((v) => v.id ?? v.name);
    slot.labelArea = labelArea(names);
    if (slot.cls && slot.cls.position.x !== slot.labelArea / 2) {
      tl.to(slot.cls.position, { x: slot.labelArea / 2, duration: 0.4, ease: EASE.place }, 0);
    }
    for (const [id, label] of slot.labels) {
      if (ids.includes(id)) continue;
      slot.labels.delete(id);
      if (this.nameKey.has(id)) this.drop(label);
      else tl.to(label.scale, { x: 0.001, y: 0.001, duration: 0.25, ease: 'back.in(1.6)', onComplete: () => this.drop(label) }, 0);
    }
    names.forEach((name, i) => {
      const id = ids[i];
      const x = labelX(names, i);
      const label = slot.labels.get(id);
      if (label) {
        if (label.position.x !== x) tl.to(label.position, { x, duration: 0.4, ease: EASE.place }, 0);
        return;
      }
      const fresh = makePlaque(name, plaqueWidth(name), 0.32, 'name');
      fresh.rotation.z = tilt(name);
      fresh.position.set(x, LABEL_Y, LABEL_Z);
      slot.group.add(fresh);
      slot.labels.set(id, fresh);
      const from = oldLabels.get(id);
      if (from !== undefined) {
        // The name leaves another list and is put on this one.
        const startY = LABEL_Y + from.y - slot.y;
        tl.fromTo(fresh.position, { x: from.x - slot.left }, { x, duration: 0.65, ease: 'power2.inOut' }, 0.05)
          .to(fresh.position, { keyframes: { y: [startY, Math.max(startY, LABEL_Y) + 1.1, LABEL_Y] }, duration: 0.65, ease: 'power1.inOut' }, 0.05)
          .to(fresh.position, { keyframes: { z: [LABEL_Z, LABEL_Z + 0.5, LABEL_Z] }, duration: 0.65 }, 0.05);
      } else {
        tl.fromTo(fresh.scale, { x: 0.001, y: 0.001 }, { x: 1, y: 1, duration: 0.3, ease: EASE.pop }, 0.15);
      }
    });
  }

  // ---- the places of a list --------------------------------------------------

  private syncRack(tl: Timeline, slot: RackSlot, v: BoxVar): void {
    const next = v.items!.slice(0, MAX_ITEMS);
    const size = v.size ?? v.items!.length;
    const change = diffItems(slot.items, next);
    const moved = change.kind !== 'edit' || change.changed.length > 0 || next.length !== slot.items.length;

    tl.to(slot.tray.scale, { x: slot.width, duration: 0.35, ease: EASE.place }, 0);

    // The index numbers belong to the places, not to the values.
    const numbered = slot.shape === 'list' || slot.shape === 'tuple';
    // An object has names of attributes where a dictionary has keys.
    const dict = slot.shape === 'dict' || slot.shape === 'object';
    while (numbered && slot.indices.length < next.length) {
      const i = slot.indices.length;
      const label = makePlaque(String(i), 0.4, 0.3, 'index');
      label.position.set(cellX(slot, i), RACK.height / 2, RACK.depth / 2 + 0.006);
      slot.group.add(label);
      slot.indices.push(label);
      tl.fromTo(label.scale, { x: 0.001, y: 0.001 }, { x: 1, y: 1, duration: 0.25, ease: EASE.pop }, 0.1);
    }
    while (slot.indices.length > next.length) {
      const label = slot.indices.pop()!;
      tl.to(label.scale, { x: 0.001, y: 0.001, duration: 0.2, onComplete: () => this.drop(label) }, 0.25);
    }

    if (change.kind === 'insert') {
      const cell = this.newCell(slot, next[change.index], change.index);
      slot.cells.splice(change.index, 0, cell);
      this.dropIn(tl, cell, 0.3);
      if (dict) slot.keys.splice(change.index, 0, this.newKey(tl, slot, next[change.index], change.index));
    } else if (change.kind === 'remove') {
      const [gone] = slot.cells.splice(change.index, 1);
      this.liftOut(tl, gone, 0);
      if (dict) this.shrinkKey(tl, slot.keys.splice(change.index, 1)[0]);
    } else {
      slot.cells.splice(next.length).forEach((cell) => this.liftOut(tl, cell, 0));
      if (dict) slot.keys.splice(next.length).forEach((key) => this.shrinkKey(tl, key));
      change.changed.forEach((i, n) => {
        const old = slot.cells[i];
        if (old) this.liftOut(tl, old, 0);
        const cell = this.newCell(slot, next[i], i);
        slot.cells[i] = cell;
        this.dropIn(tl, cell, 0.12 + n * 0.08);
        // A new value for the same key: the key stays where it is.
        if (dict && slot.keys[i]?.userData.key !== next[i].key) {
          if (slot.keys[i]) this.shrinkKey(tl, slot.keys[i]);
          slot.keys[i] = this.newKey(tl, slot, next[i], i);
        }
      });
    }
    slot.items = next;

    // Every value and every index number goes to the place it belongs to:
    // after an insert or a remove, and when names were added or taken away.
    const shiftAt = change.kind === 'remove' ? 0.2 : 0;
    slot.cells.forEach((cell, i) => {
      const x = cellX(slot, i);
      if (Math.abs(cell.position.x - x) > 1e-6) tl.to(cell.position, { x, duration: 0.4, ease: EASE.place }, shiftAt);
    });
    slot.indices.forEach((label, i) => {
      const x = cellX(slot, i);
      if (Math.abs(label.position.x - x) > 1e-6) tl.to(label.position, { x, duration: 0.4, ease: EASE.place }, 0);
    });
    slot.keys.forEach((label, i) => {
      const x = cellX(slot, i);
      if (Math.abs(label.position.x - x) > 1e-6) tl.to(label.position, { x, duration: 0.4, ease: EASE.place }, shiftAt);
    });

    // A long list shows how many values are not drawn.
    const moreText = size > MAX_ITEMS ? `+${size - MAX_ITEMS}` : '';
    if (moreText !== slot.moreText) {
      if (slot.more) this.drop(slot.more);
      slot.more = null;
      slot.moreText = moreText;
      if (moreText) {
        slot.more = makePlaque(moreText, 0.6, 0.34, 'more');
        slot.group.add(slot.more);
      }
    }
    slot.more?.position.set(cellX(slot, next.length), CELL_REST_Y, 0.05);
    if (slot.lock) {
      const x = slot.width - LOCK_ROOM / 2 - 0.08;
      if (slot.lock.position.x === 0) slot.lock.position.x = x;
      else tl.to(slot.lock.position, { x, duration: 0.35, ease: EASE.place }, 0);
    }
    if (moved) {
      const scale = slot.tray.scale;
      tl.to(scale, { y: 0.84, duration: 0.07, ease: 'power1.out' }, 0.45).to(scale, { y: 1, duration: 0.5, ease: EASE.settle });
    }
  }

  /** The key of a dictionary place, on the front of the tray. */
  private newKey(tl: Timeline, slot: RackSlot, item: BoxItem, index: number): Mesh {
    const label = makePlaque(item.key ?? '', RACK.pitch - 0.08, 0.3, 'index');
    label.userData.key = item.key;
    label.position.set(cellX(slot, index), RACK.height / 2, RACK.depth / 2 + 0.006);
    slot.group.add(label);
    tl.fromTo(label.scale, { x: 0.001, y: 0.001 }, { x: 1, y: 1, duration: 0.25, ease: EASE.pop }, 0.2);
    return label;
  }

  private shrinkKey(tl: Timeline, label: Mesh): void {
    tl.to(label.scale, { x: 0.001, y: 0.001, duration: 0.2, onComplete: () => this.drop(label) }, 0.05);
  }

  private newCell(slot: RackSlot, item: BoxItem, index: number): Group {
    const cell = makeCell(item.repr, item.type, item.key === undefined ? 8 : 12);
    cell.position.set(cellX(slot, index), CELL_REST_Y, 0);
    cell.visible = false;
    slot.group.add(cell);
    return cell;
  }

  private dropIn(tl: Timeline, cell: Group, at: number): void {
    tl.set(cell, { visible: true }, at).fromTo(
      cell.position,
      { y: CELL_REST_Y + 1.6 },
      { y: CELL_REST_Y, duration: 0.38, ease: EASE.drop, immediateRender: false },
      at,
    );
  }

  private liftOut(tl: Timeline, cell: Group, at: number): void {
    tl.to(cell.position, { y: CELL_REST_Y + 1.4, duration: 0.32, ease: 'power2.in' }, at).to(
      cell.scale,
      { x: 0.001, y: 0.001, z: 0.001, duration: 0.2, onComplete: () => this.drop(cell) },
      at + 0.18,
    );
  }

  private hop(tl: Timeline, cell: Group, at = 0): void {
    tl.to(cell.position, { y: CELL_REST_Y + 0.32, duration: 0.16, ease: 'power2.out' }, at).to(cell.position, {
      y: CELL_REST_Y,
      duration: 0.28,
      ease: 'bounce.out',
    });
  }

  private pickOrigin(pick: Pick): Origin | undefined {
    const key = this.nameKey.get(pick.from);
    const slot = key ? this.slots.get(key) : undefined;
    if (slot?.kind !== 'rack') return undefined;
    const span = Math.max(1, pick.span ?? 1);
    const cells = slot.cells.slice(pick.index, pick.index + span);
    if (cells.length === 0) return undefined;
    // A loop over a dictionary gets the key: the value travels from the key.
    const y = slot.y + (pick.key ? RACK.height / 2 : CELL_REST_Y);
    // A slice travels from the middle of the places it reads.
    const middle = pick.index + (cells.length - 1) / 2;
    return { x: slot.left + cellX(slot, middle), y, hops: cells };
  }

  // ---- for-loops -------------------------------------------------------------

  private clearChips(): void {
    for (const chip of this.chips.values()) this.drop(chip);
    this.chips.clear();
  }

  /**
   * The row of values that wait for a loop variable. Returns the chip that
   * the variable takes in this step, if any.
   */
  private syncFeed(tl: Timeline, feed: Feed | undefined): { name: string; origin: Origin } | undefined {
    if (!feed) {
      this.clearChips();
      this.feedKey = '';
      this.feedTaken = 0;
      return undefined;
    }
    const key = feedKey(feed);
    const next = feed.taken - 1;
    const wantsChip = next >= 0 && next < feed.values.length && feed.taken > this.feedTaken;
    if (key !== this.feedKey || feed.taken < this.feedTaken || (wantsChip && !this.chips.has(next))) {
      // A new loop, a loop that starts again, or a long row that moves on.
      this.clearChips();
      this.feedKey = key;
      this.feedTaken = Math.max(0, next);
      const start = Math.max(0, next);
      const shown = feed.values.slice(start, start + MAX_CHIPS);
      shown.forEach((value, k) => {
        const chip = makeChip(value.repr, value.type);
        chip.position.set((k - (shown.length - 1) / 2) * CHIP_SPACING, this.lift + CHIP_Y, 0);
        this.feedGroup.add(chip);
        this.chips.set(start + k, chip);
        tl.fromTo(chip.scale, { x: 0.001, y: 0.001, z: 0.001 }, { x: 1, y: 1, z: 1, duration: 0.28, ease: EASE.pop }, k * 0.05);
      });
      // A short pause: the learner must see the whole row before it changes.
      tl.to({}, { duration: 0.35 });
    }
    for (const [index, chip] of this.chips) {
      if (index < next) {
        this.chips.delete(index);
        this.drop(chip);
      }
    }
    const taking = feed.taken > this.feedTaken ? this.chips.get(next) : undefined;
    this.feedTaken = feed.taken;
    if (!taking) return undefined;
    this.chips.delete(next);
    return { name: feed.name, origin: { x: taking.position.x, y: taking.position.y, chip: taking } };
  }

  // ---- single values ---------------------------------------------------------

  private replaceCard(tl: Timeline, slot: CrateSlot, v: BoxVar, fromName?: string, origin?: Origin): void {
    const old = slot.card;
    if (old) {
      // The old value leaves: assignment replaces, it does not add.
      tl.to(old.position, { y: CARD_REST_Y + 2.1, duration: 0.34, ease: 'power2.in' })
        .to(old.rotation, { z: 0.5, duration: 0.34, ease: 'power1.in' }, '<')
        .to(
          old.scale,
          { x: 0.001, y: 0.001, z: 0.001, duration: 0.2, ease: 'power2.in', onComplete: () => this.drop(old) },
          '>-0.12',
        );
    }

    const card = makeCard(v.repr, v.type);
    card.visible = false;
    card.position.set(0, CARD_REST_Y + 3.2, CARD_Z);
    slot.inner.add(card);
    slot.card = card;
    slot.repr = v.repr;
    slot.type = v.type;

    const center = slot.left + slot.width / 2;
    const source = fromName ? this.slots.get(`var:${fromName}`) : undefined;
    if (origin) {
      // The value comes from a waiting loop value or from a place of a list.
      origin.hops?.forEach((cell, i) => this.hop(tl, cell, i * 0.06));
      const chip = origin.chip;
      if (chip) tl.set(chip, { visible: false });
      tl.set(card, { visible: true }, '<')
        .fromTo(
          card.position,
          { x: origin.x - center, y: origin.y - slot.y },
          { x: 0, y: CARD_REST_Y, duration: 0.5, ease: 'power2.inOut', immediateRender: false },
        )
        .fromTo(
          card.scale,
          { x: origin.scale ?? 0.38, y: origin.scale ?? 0.38, z: origin.scale ?? 0.38 },
          { x: 1, y: 1, z: 1, duration: 0.5, ease: 'power2.out', immediateRender: false },
          '<',
        );
      if (chip) tl.call(() => this.drop(chip));
    } else if (source?.kind === 'crate' && source.card && source !== slot) {
      // The value is read from another box: that card hops (it stays), and
      // the new card travels from there to its own box.
      const hop = source.card.position;
      tl.to(hop, { y: CARD_REST_Y + 0.35, duration: 0.18, ease: 'power2.out' }).to(hop, {
        y: CARD_REST_Y,
        duration: 0.28,
        ease: 'bounce.out',
      });
      tl.set(card, { visible: true })
        .fromTo(
          card.position,
          { x: source.left + source.width / 2 - center, y: CARD_REST_Y + 0.5 + source.y - slot.y },
          { x: 0, duration: 0.6, ease: 'power2.inOut', immediateRender: false },
        )
        .fromTo(card.scale, { x: 0.3, y: 0.3, z: 0.3 }, { x: 1, y: 1, z: 1, duration: 0.3, ease: EASE.pop, immediateRender: false }, '<')
        .to(card.position, { y: CARD_REST_Y + 1.7, duration: 0.3, ease: 'power2.out' }, '<')
        .to(card.position, { y: CARD_REST_Y, duration: 0.3, ease: EASE.drop }, '>');
    } else {
      tl.set(card, { visible: true }).to(card.position, { y: CARD_REST_Y, duration: 0.42, ease: EASE.drop });
    }

    // Landing: the crate takes the weight.
    const scale = slot.crate.scale;
    tl.to(scale, { y: 0.86, x: 1.05, z: 1.05, duration: 0.07, ease: 'power1.out' }).to(scale, {
      x: 1,
      y: 1,
      z: 1,
      duration: 0.55,
      ease: EASE.settle,
    });
  }
}
