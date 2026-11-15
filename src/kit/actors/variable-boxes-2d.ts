import { EASE, Flip, gsap } from '../motion';
import { shortRepr, valueColor } from '../palette';
import type { Stage2D } from '../stage';
import { diffItems, entriesOf, feedKey, MAX_BOXES, MAX_CHIPS, MAX_ITEMS } from './variable-boxes';
import type { BoxItem, BoxVar, Entry, Feed, Pick, SyncHints, VariableBoxes } from './variable-boxes';

interface CrateSlot {
  kind: 'crate';
  el: HTMLElement;
  crate: HTMLElement;
  card: HTMLElement | null;
  repr: string;
  type: string;
}

interface RackSlot {
  kind: 'rack';
  el: HTMLElement;
  /** Holds one label for each name of this list. */
  namesEl: HTMLElement;
  cellsEl: HTMLElement;
  more: HTMLElement;
  /** Places with their index number. */
  cells: HTMLElement[];
  /** The values, in the same order as the places. */
  values: HTMLElement[];
  items: BoxItem[];
}

type Slot = CrateSlot | RackSlot;

/** Where a new card comes from. */
interface Origin {
  el: HTMLElement;
  /** A place of a list keeps its value. A waiting loop value is used up. */
  keep: boolean;
  /** Places of a list that hop: one, or all places of a slice. */
  hops?: HTMLElement[];
}

const LOCK_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>';

function div(className: string, text = ''): HTMLElement {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  return el;
}

function valueEl(item: BoxItem): HTMLElement {
  const color = valueColor(item.type);
  // A place with a key (a dictionary or an object) may show a little more.
  const el = div('vb2d-item', shortRepr(item.repr, item.key === undefined ? 8 : 12));
  el.style.background = color.bg;
  el.style.color = color.fg;
  return el;
}

export class Boxes2D implements VariableBoxes {
  private root = div('vb2d');
  private feedEl = div('vb2d-feed');
  private slots = new Map<string, Slot>();
  /** The label of every name that is on a list. */
  private nameEls = new Map<string, HTMLElement>();
  private nameKey = new Map<string, string>();
  /** One desk for each function call that runs. */
  private desks = new Map<number, { name: string; el: HTMLElement; title: HTMLElement; boxes: HTMLElement }>();
  /** Desks of calls that ended: they stay until the value has left them. */
  private closing: HTMLElement[] = [];
  private chips = new Map<number, HTMLElement>();
  private feedKey = '';
  private feedTaken = 0;
  private current: gsap.core.Timeline | null = null;

  private resizer: ResizeObserver;

  constructor(private stage: Stage2D) {
    stage.el.append(this.feedEl, this.root);
    this.resizer = new ResizeObserver(() => this.fit(false));
    this.resizer.observe(stage.el);
  }

  /** Scales the picture down when it is wider than the stage. */
  private fit(animate: boolean): void {
    const room = this.stage.el.clientWidth;
    const need = this.root.offsetWidth;
    const scale = room > 0 && need > room ? room / need : 1;
    if (animate) gsap.to(this.root, { scale, duration: 0.35, ease: EASE.place, overwrite: 'auto' });
    else gsap.set(this.root, { scale });
  }

  sync(vars: BoxVar[], hints: SyncHints = {}): gsap.core.Timeline {
    this.current?.progress(1);
    const tl = gsap.timeline();
    this.current = tl;
    // A global name is its own id; a name of a function call is `depth:name`.
    const frames = hints.frames ?? [];
    const all: BoxVar[] = [
      ...vars.slice(0, MAX_BOXES).map((v) => ({ ...v, id: v.id ?? v.name })),
      ...frames.flatMap((frame, d) => frame.vars.slice(0, MAX_BOXES).map((v) => ({ ...v, id: `${d}:${v.name}` }))),
    ];
    const entries = entriesOf(all);
    const keys = new Set(entries.map((e) => e.key));
    this.nameKey = new Map();
    for (const entry of entries) for (const v of entry.vars) this.nameKey.set(v.id!, entry.key);

    // One Flip for everything that can move: boxes, name labels, values, desks.
    const tracked: HTMLElement[] = [];
    for (const slot of this.slots.values()) {
      tracked.push(slot.el);
      if (slot.kind === 'rack') tracked.push(...slot.values);
    }
    tracked.push(...this.nameEls.values());
    for (const desk of this.desks.values()) tracked.push(desk.el);
    const before = tracked.length ? Flip.getState(tracked) : null;
    this.root.dataset.count = String(entries.length);
    const origin = this.syncFeed(tl, hints.feed);

    const created: HTMLElement[] = [];
    for (const entry of entries) {
      if (this.slots.has(entry.key)) continue;
      const slot = this.addSlot(entry);
      created.push(slot.kind === 'crate' ? slot.crate : slot.el);
    }

    // Names on lists. A label that moves to another list is the same
    // element: Flip lets it travel. `=` moves a label, it copies nothing.
    const freshNames: HTMLElement[] = [];
    const onLists = new Set<string>();
    for (const entry of entries) {
      const slot = this.slots.get(entry.key)!;
      if (slot.kind !== 'rack') continue;
      for (const v of entry.vars) {
        onLists.add(v.id!);
        let el = this.nameEls.get(v.id!);
        if (!el) {
          el = div('vb2d-rack-name', v.name);
          this.nameEls.set(v.id!, el);
          freshNames.push(el);
        }
        slot.namesEl.append(el);
      }
    }
    for (const [id, el] of this.nameEls) {
      if (onLists.has(id)) continue;
      this.nameEls.delete(id);
      el.remove();
    }

    // Desks: one for each function call that runs, with its own boxes.
    let back: Origin | undefined;
    const freshDesks: HTMLElement[] = [];
    for (const [depth, desk] of this.desks) {
      if (frames[depth]?.name === desk.name) continue;
      if (depth === hints.ret?.from) back = { el: desk.title, keep: true };
      this.desks.delete(depth);
      this.closing.push(desk.el);
    }
    frames.forEach((frame, depth) => {
      if (this.desks.has(depth)) return;
      const el = div('vb2d-desk');
      const title = div('vb2d-desk-name', `${frame.name}()`);
      const boxes = div('vb2d-desk-boxes');
      el.append(title, boxes);
      this.desks.set(depth, { name: frame.name, el, title, boxes });
      freshDesks.push(el);
    });

    for (const [key, slot] of this.slots) {
      if (keys.has(key)) continue;
      this.slots.delete(key);
      slot.el.remove();
    }

    const freshValues: HTMLElement[] = [];
    for (const entry of entries) {
      const slot = this.slots.get(entry.key)!;
      if (slot.kind === 'rack') {
        freshValues.push(...this.syncRack(slot, entry.vars[0]));
        continue;
      }
      const v = entry.vars[0];
      const id = v.id!;
      const taking = origin?.name === id ? origin.origin : undefined;
      const picking = hints.pick?.to === id ? this.pickOrigin(hints.pick) : undefined;
      // The value that a function gives back comes from its desk.
      const returning = hints.ret?.to === id ? back : undefined;
      const from = taking ?? picking ?? returning;
      // A loop or a list can give the same value twice. The card still arrives again.
      if (!from && slot.card && slot.repr === v.repr && slot.type === v.type) continue;
      this.replaceCard(tl, slot, v, hints.from?.[id], from);
    }
    if (hints.pick && !hints.pick.to) {
      const read = this.pickOrigin(hints.pick);
      read?.hops?.forEach((el) => this.hop(tl, el));
    }
    // Keep DOM order equal to the order of the variables. The boxes of a
    // call go on its desk; the desks come after the global boxes.
    for (const entry of entries) {
      const match = /^(\d+):/.exec(entry.vars[0].id ?? '');
      const desk = match ? this.desks.get(Number(match[1])) : undefined;
      (desk ? desk.boxes : this.root).append(this.slots.get(entry.key)!.el);
    }
    for (const depth of [...this.desks.keys()].sort((a, b) => a - b)) this.root.append(this.desks.get(depth)!.el);

    if (before) {
      const targets = tracked.filter((el) => el.isConnected);
      tl.add(Flip.from(before, { targets, duration: 0.45, ease: EASE.place, nested: true }), 0);
    }
    if (freshDesks.length) tl.fromTo(freshDesks, { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: EASE.place }, 0);
    if (created.length) tl.fromTo(created, { scale: 0, y: -30 }, { scale: 1, y: 0, duration: 0.4, ease: EASE.pop }, 0.1);
    if (freshNames.length) tl.fromTo(freshNames, { scale: 0 }, { scale: 1, duration: 0.3, ease: EASE.pop }, 0.15);
    if (freshValues.length) {
      tl.fromTo(freshValues, { y: -60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.38, ease: EASE.drop, stagger: 0.08 }, 0.1);
    }
    // A desk that closes shrinks away after the value has left it.
    const closing = this.closing.splice(0);
    if (closing.length) {
      tl.to(closing, { scale: 0, opacity: 0, duration: 0.3, ease: 'back.in(1.4)', onComplete: () => closing.forEach((el) => el.remove()) }, 0.35);
    }
    this.fit(true);
    return tl;
  }

  dispose(): void {
    this.current?.kill();
    this.resizer.disconnect();
    this.root.remove();
    this.feedEl.remove();
    this.slots.clear();
    this.nameEls.clear();
    this.desks.clear();
    this.chips.clear();
  }

  private addSlot(entry: Entry): Slot {
    if (entry.kind === 'rack') {
      const el = div('vb2d-slot is-rack');
      const type = entry.vars[0].type;
      // A tuple is sealed (darker, with a padlock). A set has no numbers.
      const object = entry.vars[0].object === true;
      const shape = object ? ' is-object' : type === 'tuple' || type === 'str' ? ' is-tuple' : type === 'set' || type === 'frozenset' ? ' is-set' : type === 'dict' ? ' is-dict' : '';
      const rack = div(`vb2d-rack${shape}`);
      const namesEl = div('vb2d-names');
      const cellsEl = div('vb2d-cells');
      const more = div('vb2d-more');
      rack.append(namesEl, cellsEl, more);
      // An object shows the name of its class, like a stamp on its tray.
      if (object) rack.append(div('vb2d-class', type));
      if (type === 'tuple' || type === 'str') {
        const lock = div('vb2d-lock');
        lock.innerHTML = LOCK_SVG;
        rack.append(lock);
      }
      el.append(rack);
      this.root.append(el);
      const slot: RackSlot = { kind: 'rack', el, namesEl, cellsEl, more, cells: [], values: [], items: [] };
      this.slots.set(entry.key, slot);
      return slot;
    }
    const el = div('vb2d-slot');
    const crate = div('vb2d-crate');
    crate.append(div('vb2d-label', entry.vars[0].name));
    el.append(crate);
    this.root.append(el);
    const slot: CrateSlot = { kind: 'crate', el, crate, card: null, repr: '', type: '' };
    this.slots.set(entry.key, slot);
    return slot;
  }

  // ---- the places of a list --------------------------------------------------

  /** Updates the places. Returns the new value elements, for their drop-in. */
  private syncRack(slot: RackSlot, v: BoxVar): HTMLElement[] {
    const next = v.items!.slice(0, MAX_ITEMS);
    const size = v.size ?? v.items!.length;
    const change = diffItems(slot.items, next);

    let values: HTMLElement[];
    const fresh: HTMLElement[] = [];
    const make = (item: BoxItem) => {
      const el = valueEl(item);
      fresh.push(el);
      return el;
    };
    if (change.kind === 'insert') {
      values = [...slot.values.slice(0, change.index), make(next[change.index]), ...slot.values.slice(change.index)];
    } else if (change.kind === 'remove') {
      values = slot.values.filter((_, i) => i !== change.index);
    } else {
      values = slot.values.slice(0, next.length);
      for (const i of change.changed) values[i] = make(next[i]);
    }

    // The index numbers belong to the places, not to the values.
    while (slot.cells.length < next.length) {
      const cell = div('vb2d-cell');
      cell.append(div('vb2d-idx', String(slot.cells.length)));
      slot.cellsEl.append(cell);
      slot.cells.push(cell);
    }
    while (slot.cells.length > next.length) slot.cells.pop()!.remove();
    values.forEach((el, i) => slot.cells[i].prepend(el));
    // A dictionary shows its keys under the values, a list its index numbers.
    slot.cells.forEach((cell, i) => {
      const label = cell.querySelector('.vb2d-idx')!;
      label.textContent = next[i].key ?? String(i);
      label.classList.toggle('is-key', next[i].key !== undefined);
    });
    // Values that left the list are no longer in a place.
    for (const el of slot.values) if (!values.includes(el)) el.remove();
    slot.values = values;
    slot.items = next;
    slot.more.textContent = size > MAX_ITEMS ? `+${size - MAX_ITEMS}` : '';
    return fresh;
  }

  private hop(tl: gsap.core.Timeline, el: HTMLElement): void {
    tl.to(el, { y: -14, duration: 0.16, ease: 'power2.out' }, 0).to(el, { y: 0, duration: 0.26, ease: 'bounce.out' });
  }

  private pickOrigin(pick: Pick): Origin | undefined {
    const key = this.nameKey.get(pick.from);
    const slot = key ? this.slots.get(key) : undefined;
    if (slot?.kind !== 'rack') return undefined;
    if (pick.key) {
      const el = slot.cells[pick.index]?.querySelector<HTMLElement>('.vb2d-idx');
      return el ? { el, keep: true, hops: [el] } : undefined;
    }
    const hops = slot.values.slice(pick.index, pick.index + Math.max(1, pick.span ?? 1));
    if (hops.length === 0) return undefined;
    // A slice travels from the middle of the places it reads.
    return { el: hops[Math.floor((hops.length - 1) / 2)], keep: true, hops };
  }

  // ---- for-loops -------------------------------------------------------------

  private clearChips(): void {
    this.feedEl.replaceChildren();
    this.chips.clear();
  }

  /**
   * The row of values that wait for a loop variable. Returns the chip that
   * the variable takes in this step, if any. A taken chip is hidden, not
   * removed, so the other chips keep their places.
   */
  private syncFeed(tl: gsap.core.Timeline, feed: Feed | undefined): { name: string; origin: Origin } | undefined {
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
      this.clearChips();
      this.feedKey = key;
      this.feedTaken = Math.max(0, next);
      const start = Math.max(0, next);
      feed.values.slice(start, start + MAX_CHIPS).forEach((value, k) => {
        const color = valueColor(value.type);
        const chip = div('vb2d-chip', shortRepr(value.repr, 6));
        chip.style.background = color.bg;
        chip.style.color = color.fg;
        this.feedEl.append(chip);
        this.chips.set(start + k, chip);
      });
      tl.fromTo([...this.chips.values()], { scale: 0 }, { scale: 1, duration: 0.28, stagger: 0.05, ease: EASE.pop });
      // A short pause: the learner must see the whole row before it changes.
      tl.to({}, { duration: 0.35 });
    }
    for (const [index, chip] of this.chips) {
      if (index < next) chip.style.visibility = 'hidden';
    }
    const taking = feed.taken > this.feedTaken ? this.chips.get(next) : undefined;
    this.feedTaken = feed.taken;
    return taking ? { name: feed.name, origin: { el: taking, keep: false } } : undefined;
  }

  // ---- single values ---------------------------------------------------------

  private replaceCard(tl: gsap.core.Timeline, slot: CrateSlot, v: BoxVar, fromName?: string, origin?: Origin): void {
    const old = slot.card;
    if (old) {
      tl.to(old, { y: -90, rotate: 14, opacity: 0, duration: 0.32, ease: 'power2.in', onComplete: () => old.remove() });
    }
    const color = valueColor(v.type);
    const card = div('vb2d-card');
    card.style.background = color.bg;
    card.style.color = color.fg;
    const text = shortRepr(v.repr);
    const value = div('vb2d-value', text);
    // Long values get a smaller font, so they fit the card.
    if (text.length > 9) value.classList.add('is-longer');
    else if (text.length > 6) value.classList.add('is-long');
    card.append(value, div('vb2d-type', v.type));
    card.style.visibility = 'hidden';
    slot.el.prepend(card);
    slot.card = card;
    slot.repr = v.repr;
    slot.type = v.type;

    const source = fromName ? this.slots.get(`var:${fromName}`) : undefined;
    if (origin) {
      // The value comes from a waiting loop value or from a place of a list.
      const from = origin.el;
      origin.hops?.forEach((el) => this.hop(tl, el));
      tl.set(card, { visibility: 'visible' }).fromTo(
        card,
        {
          x: () => from.getBoundingClientRect().left - card.getBoundingClientRect().left,
          y: () => from.getBoundingClientRect().top - card.getBoundingClientRect().top,
          scale: 0.35,
        },
        {
          x: 0,
          y: 0,
          scale: 1,
          duration: 0.5,
          ease: 'power2.inOut',
          immediateRender: false,
          onStart: () => {
            if (!origin.keep) from.style.visibility = 'hidden';
          },
        },
      );
    } else if (source?.kind === 'crate' && source.card && source !== slot) {
      const sourceCard = source.card;
      tl.to(sourceCard, { y: -14, duration: 0.16, ease: 'power2.out' }).to(sourceCard, {
        y: 0,
        duration: 0.26,
        ease: 'bounce.out',
      });
      tl.set(card, { visibility: 'visible' }).fromTo(
        card,
        {
          x: () => sourceCard.getBoundingClientRect().left - card.getBoundingClientRect().left,
          y: -40,
          scale: 0.4,
        },
        { x: 0, y: 0, scale: 1, duration: 0.6, ease: 'power2.inOut', immediateRender: false },
      );
    } else {
      tl.set(card, { visibility: 'visible' }).fromTo(
        card,
        { y: -120, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.42, ease: EASE.drop, immediateRender: false },
      );
    }
    tl.to(slot.crate, { scaleY: 0.9, scaleX: 1.04, duration: 0.07 }).to(slot.crate, {
      scaleY: 1,
      scaleX: 1,
      duration: 0.5,
      ease: EASE.settle,
    });
  }
}
