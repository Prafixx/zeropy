// CodeMirror 6 setup for beginners: no autocomplete popups, clear colors,
// 4-space indent, Ctrl+Enter to run. Loaded as a lazy chunk.
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { pythonLanguage } from '@codemirror/lang-python';
import { bracketMatching, indentOnInput, indentUnit, LanguageSupport, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, StateEffect, StateField } from '@codemirror/state';
import { Decoration, drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { highlightCode, tagHighlighter, tags } from '@lezer/highlight';

// Token classes are styled in app.css (.tok-*), for the editor and for
// static code blocks.
const highlighter = tagHighlighter([
  { tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], class: 'tok-kw' },
  { tag: [tags.string, tags.special(tags.string)], class: 'tok-str' },
  { tag: [tags.number, tags.bool, tags.null], class: 'tok-num' },
  { tag: [tags.comment, tags.lineComment], class: 'tok-com' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], class: 'tok-fn' },
  { tag: [tags.definition(tags.variableName), tags.className], class: 'tok-def' },
  { tag: [tags.operator, tags.punctuation, tags.bracket], class: 'tok-op' },
]);

type LineMark = { line: number | null; kind: 'run' | 'error' };
const setLineMark = StateEffect.define<LineMark>();

const lineMarkField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    let next = tr.docChanged ? Decoration.none : value;
    for (const effect of tr.effects) {
      if (!effect.is(setLineMark)) continue;
      const { line, kind } = effect.value;
      if (line === null || line < 1 || line > tr.state.doc.lines) next = Decoration.none;
      else {
        const from = tr.state.doc.line(line).from;
        next = Decoration.set([Decoration.line({ class: `cm-mark-${kind}` }).range(from)]);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface CodeEditor {
  getValue(): string;
  setValue(code: string): void;
  /** Highlights one line (1-based) or clears the highlight with null. */
  markLine(line: number | null, kind?: 'run' | 'error'): void;
  focus(): void;
  /**
   * Shows another file (a tab). Each file keeps its own text, undo history
   * and cursor. A file seen for the first time starts with `doc`.
   */
  switchTo(key: string, doc: string): void;
  /** The text of a file: the shown one, or one that was shown before. */
  valueOf(key: string): string | undefined;
  /** Clears the line highlight in every file. */
  clearMarks(): void;
  destroy(): void;
}

export interface EditorOptions {
  doc: string;
  onRun: () => void;
  onChange?: () => void;
  label: string;
}

/** A new theme here makes CodeMirror measure every line again. */
const measureSlot = new Compartment();

/** True while a parent is tilted or scaled (a plain shift does not matter). */
function moving(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const transform = getComputedStyle(node).transform;
    if (transform === 'none') continue;
    const m = new DOMMatrixReadOnly(transform);
    if (m.a !== 1 || m.b !== 0 || m.c !== 0 || m.d !== 1) return true;
  }
  return false;
}

/**
 * CodeMirror measures line heights once. If that happens while the step
 * still slides in (tilted), or before the code font has loaded, the line
 * numbers drift away from their lines. So measure again when both are done.
 */
function remeasureWhenSettled(view: EditorView): void {
  const font = document.fonts.load('16px "JetBrains Mono Variable"').catch(() => undefined);
  const start = performance.now();
  const check = (): void => {
    if (!view.dom.isConnected) return;
    if (moving(view.dom) && performance.now() - start < 3000) {
      requestAnimationFrame(check);
      return;
    }
    void font.then(() => {
      if (view.dom.isConnected) view.dispatch({ effects: measureSlot.reconfigure(EditorView.theme({})) });
    });
  };
  requestAnimationFrame(check);
}

export function createEditor(parent: HTMLElement, options: EditorOptions): CodeEditor {
  const makeState = (doc: string): EditorState =>
    EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        measureSlot.of([]),
        history(),
        drawSelection(),
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        new LanguageSupport(pythonLanguage),
        indentUnit.of('    '),
        EditorState.tabSize.of(4),
        syntaxHighlighting(highlighter),
        lineMarkField,
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              options.onRun();
              return true;
            },
          },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({ 'aria-label': options.label }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) options.onChange?.();
        }),
      ],
    });
  const view = new EditorView({ parent, state: makeState(options.doc) });
  remeasureWhenSettled(view);
  // The files that are not shown now (tabs), each with its own state.
  const others = new Map<string, EditorState>();
  let shown = 'main.py';

  return {
    getValue: () => view.state.doc.toString(),
    setValue: (code) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } }),
    markLine(line, kind = 'run') {
      const effects: StateEffect<unknown>[] = [setLineMark.of({ line, kind })];
      // An error far down a long file: bring its line into view.
      if (kind === 'error' && line !== null && line >= 1 && line <= view.state.doc.lines) {
        effects.push(EditorView.scrollIntoView(view.state.doc.line(line).from, { y: 'center' }));
      }
      view.dispatch({ effects });
    },
    focus: () => view.focus(),
    switchTo(key, doc) {
      if (key === shown) return;
      others.set(shown, view.state);
      view.setState(others.get(key) ?? makeState(doc));
      others.delete(key);
      shown = key;
    },
    valueOf: (key) => (key === shown ? view.state.doc.toString() : others.get(key)?.doc.toString()),
    clearMarks() {
      const clear = setLineMark.of({ line: null, kind: 'run' });
      view.dispatch({ effects: clear });
      for (const [key, state] of others) others.set(key, state.update({ effects: clear }).state);
    },
    destroy: () => view.destroy(),
  };
}

/** Fills line elements with highlighted Python. One element per source line. */
export function highlightLines(lineEls: HTMLElement[], code: string): void {
  let index = 0;
  lineEls.forEach((el) => el.replaceChildren());
  highlightCode(
    code,
    pythonLanguage.parser.parse(code),
    highlighter,
    (text, classes) => {
      const target = lineEls[index];
      if (!target) return;
      if (classes) {
        const span = document.createElement('span');
        span.className = classes;
        span.textContent = text;
        target.append(span);
      } else {
        target.append(text);
      }
    },
    () => {
      index += 1;
    },
  );
  // An empty line still needs height.
  lineEls.forEach((el) => {
    if (!el.hasChildNodes()) el.append('​');
  });
}

/** An element (a blank to fill) that takes the place of columns `from` to `to` of a line. */
export interface Slot {
  line: number;
  from: number;
  to: number;
  el: HTMLElement;
}

/**
 * Like highlightLines, but some parts of the code are replaced by elements:
 * the code is highlighted as a whole (with the parts in it, so the colours
 * are right), and each slot's element is put where its text would be.
 */
export function highlightWithSlots(lineEls: HTMLElement[], code: string, slots: Slot[]): void {
  let index = 0;
  let col = 0;
  const placed = new Set<Slot>();
  lineEls.forEach((el) => el.replaceChildren());
  const add = (target: HTMLElement, text: string, classes: string): void => {
    if (!text) return;
    if (classes) {
      const span = document.createElement('span');
      span.className = classes;
      span.textContent = text;
      target.append(span);
    } else target.append(text);
  };
  highlightCode(
    code,
    pythonLanguage.parser.parse(code),
    highlighter,
    (text, classes) => {
      const target = lineEls[index];
      if (!target) return;
      const start = col;
      const end = col + text.length;
      let pos = start;
      const here = slots.filter((s) => s.line === index && s.to > start && s.from < end).sort((a, b) => a.from - b.from);
      for (const slot of here) {
        if (slot.from > pos) add(target, text.slice(pos - start, slot.from - start), classes);
        if (!placed.has(slot)) {
          target.append(slot.el);
          placed.add(slot);
        }
        pos = Math.max(pos, slot.to);
      }
      if (pos < end) add(target, text.slice(pos - start), classes);
      col = end;
    },
    () => {
      index += 1;
      col = 0;
    },
  );
  // A slot the highlighter never reached (it should not happen): put it at the end of its line.
  for (const slot of slots) if (!placed.has(slot)) lineEls[slot.line]?.append(slot.el);
  lineEls.forEach((el) => {
    if (!el.hasChildNodes()) el.append('​');
  });
}
