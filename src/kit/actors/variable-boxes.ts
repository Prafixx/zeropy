// Actor "variable boxes".
// What it clarifies: a variable is a name for a place that holds one value.
// Assignment replaces the value. Computing from a variable reads it and
// leaves it in place. A for-loop has a row of values that wait; in each
// round its variable takes the next one, until the row is empty. A list is
// one name for a row of numbered places, counted from 0; it can change in
// place: one value replaced, one added at the end, one taken out. A name
// is a label on a list, not a box around it: `b = a` puts a second label on
// the same list; a copy is a second list. A dictionary is the same tray,
// but its places have keys instead of numbers, and a key stays with its value.
// A text can be drawn as a sealed row of characters, like a tuple; a slice
// reads several places at once. A function call opens a desk with its own
// boxes: the arguments travel in, the value it gives back travels out, and
// the desk closes. An object is a tray like a dictionary, with the name of
// its class on it and the names of its attributes under the values; inside
// a method, `self` is one more name label on the same tray.
import type { Timeline } from '../motion';
import type { Stage } from '../stage';

export interface BoxItem {
  repr: string;
  type: string;
  /** A dictionary: the key of this place, as Python writes it. */
  key?: string;
}

export interface BoxVar {
  name: string;
  /** Set by the actor: the name, or `depth:name` for a name of a function call. */
  id?: string;
  type: string;
  repr: string;
  /** A list: its first values. The variable is shown as numbered places. */
  items?: BoxItem[];
  /** A list: its full length. */
  size?: number;
  /** A list: its identity. Variables with the same ref share one list. */
  ref?: string;
  /** An object of a class: `items` are its attributes (`key` is the name), `type` is the class. */
  object?: boolean;
}

/** The values of a for-loop and how many its variable has taken so far. */
export interface Feed {
  /** The loop variable. */
  name: string;
  values: BoxItem[];
  taken: number;
}

/** A value is read from one place of a list. */
export interface Pick {
  /** The list or dictionary. */
  from: string;
  index: number;
  /** The variable that gets the value, if the line stores it. */
  to?: string;
  /** The key is read, not the value: a loop over a dictionary. */
  key?: boolean;
  /** A slice: this many places from `index` are read together. */
  span?: number;
}

/** A function call that runs, with its own names. */
export interface CallFrame {
  name: string;
  vars: BoxVar[];
}

export interface SyncHints {
  /** New value of `key` was computed from variable `value`: show it travel. */
  from?: Record<string, string>;
  /** A for-loop is running: show the row of values that still wait. */
  feed?: Feed;
  /** A value is read from a list: that place hops, the value travels. */
  pick?: Pick;
  /** Function calls that run, from the outside in. Each gets a desk. */
  frames?: CallFrame[];
  /** A call ended: the value it gave back travels from its desk to `to` (an id). */
  ret?: { to: string; from: number; value?: { repr: string; type: string } };
}

export interface VariableBoxes {
  /** Animates from the current picture to this set of variables. */
  sync(vars: BoxVar[], hints?: SyncHints): Timeline;
  dispose(): void;
}

export const MAX_BOXES = 6;
/** Waiting values shown at one time. A longer row moves on as it is used. */
export const MAX_CHIPS = 10;
/** Places of a list that are drawn. A longer list shows "+3" at the end. */
export const MAX_ITEMS = 8;

export function feedKey(feed: Feed): string {
  return `${feed.name}|${feed.values.map((v) => v.repr).join(',')}`;
}

export function isList(v: BoxVar): boolean {
  return Array.isArray(v.items);
}

/** One thing on the stage: a crate for one variable, or a list with all its names. */
export interface Entry {
  key: string;
  kind: 'crate' | 'rack';
  vars: BoxVar[];
}

/** Groups the variables: names that share a list become one entry. */
export function entriesOf(vars: BoxVar[]): Entry[] {
  const entries: Entry[] = [];
  const byKey = new Map<string, Entry>();
  for (const v of vars) {
    const key = isList(v) ? `list:${v.ref ?? v.name}` : `var:${v.id ?? v.name}`;
    const entry = byKey.get(key);
    if (entry) entry.vars.push(v);
    else {
      const next: Entry = { key, kind: isList(v) ? 'rack' : 'crate', vars: [v] };
      entries.push(next);
      byKey.set(key, next);
    }
  }
  return entries;
}

function same(a: BoxItem, b: BoxItem): boolean {
  return a.repr === b.repr && a.type === b.type && a.key === b.key;
}

/**
 * How a list changed. One value put in or taken out in the middle moves
 * the values after it. Everything else is shown place by place: changed
 * places get a new value, new places at the end are filled.
 */
export type ListChange =
  | { kind: 'insert'; index: number }
  | { kind: 'remove'; index: number }
  | { kind: 'edit'; changed: number[] };

export function diffItems(old: BoxItem[], next: BoxItem[]): ListChange {
  const prefix = (n: number, a: BoxItem[], b: BoxItem[]) => {
    for (let i = 0; i < n; i += 1) if (!same(a[i], b[i])) return false;
    return true;
  };
  if (next.length === old.length + 1) {
    for (let k = 0; k < old.length; k += 1) {
      if (prefix(k, old, next) && old.slice(k).every((item, j) => same(item, next[k + 1 + j]))) {
        return { kind: 'insert', index: k };
      }
    }
  }
  if (next.length === old.length - 1) {
    for (let k = 0; k < old.length - 1; k += 1) {
      if (prefix(k, old, next) && next.slice(k).every((item, j) => same(item, old[k + 1 + j]))) {
        return { kind: 'remove', index: k };
      }
    }
  }
  const changed: number[] = [];
  next.forEach((item, i) => {
    if (i >= old.length || !same(item, old[i])) changed.push(i);
  });
  return { kind: 'edit', changed };
}

export async function variableBoxes(stage: Stage): Promise<VariableBoxes> {
  if (stage.mode === '3d') {
    const { Boxes3D } = await import('./variable-boxes-3d');
    return new Boxes3D(stage);
  }
  const { Boxes2D } = await import('./variable-boxes-2d');
  return new Boxes2D(stage);
}
