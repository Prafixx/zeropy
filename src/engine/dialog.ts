// In-app dialogs instead of window.confirm and window.alert: the same look
// as the rest of the app, the keyboard focus stays inside (native <dialog>),
// Esc and a click outside cancel.
import { h } from './ui';

export interface DialogOptions {
  title: string;
  /** Text under the title: one paragraph per item. */
  body?: string | string[];
  /** The label of the main button. */
  confirm?: string;
  /** The label of the other button; null for a message with one button. */
  cancel?: string | null;
  /** The main action deletes or replaces something: a danger button, and the focus starts on Cancel. */
  danger?: boolean;
}

/** Shows a dialog. Resolves true for the main button, false otherwise. */
export function showDialog(options: DialogOptions): Promise<boolean> {
  const { title, body, confirm = 'OK', cancel = 'Cancel', danger = false } = options;
  return new Promise((resolve) => {
    const id = `dlg-${Math.random().toString(36).slice(2, 8)}`;
    const ok = h('button', { type: 'button', class: `btn ${danger ? 'btn-danger' : 'btn-primary'}` }, h('span', { class: 'btn-label' }, confirm));
    const no = cancel === null ? null : h('button', { type: 'button', class: 'btn' }, h('span', { class: 'btn-label' }, cancel));
    const paragraphs = (Array.isArray(body) ? body : body ? [body] : []).map((text) => h('p', null, text));
    const dialog = h(
      'dialog',
      { class: 'zp-dialog', 'aria-labelledby': `${id}-title` },
      h('h2', { class: 'zp-dialog-title', id: `${id}-title` }, title),
      paragraphs.length ? h('div', { class: 'zp-dialog-body' }, ...paragraphs) : null,
      h('div', { class: 'zp-dialog-actions' }, no, ok),
    ) as HTMLDialogElement;

    let answered = false;
    const finish = (value: boolean): void => {
      if (answered) return;
      answered = true;
      dialog.classList.remove('is-open');
      // Wait for the fade out, then remove it.
      window.setTimeout(() => {
        dialog.close();
        dialog.remove();
      }, 150);
      resolve(value);
    };
    ok.addEventListener('click', () => finish(true));
    no?.addEventListener('click', () => finish(false));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(false);
    });
    // A click on the backdrop (outside the box) cancels.
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(false);
    });

    document.body.append(dialog);
    dialog.showModal();
    (danger && no ? no : ok).focus();
    requestAnimationFrame(() => dialog.classList.add('is-open'));
  });
}

/** Asks before an action. */
export function confirmDialog(options: DialogOptions): Promise<boolean> {
  return showDialog(options);
}

/** A message with one button. */
export function alertDialog(title: string, body?: string | string[]): Promise<boolean> {
  return showDialog({ title, body, confirm: 'OK', cancel: null });
}
