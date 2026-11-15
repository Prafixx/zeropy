import type { Lesson } from '../types';

export interface Dock {
  /** Sets the main button of the screen. Default click goes to the next step. */
  primary(label: string, enabled: boolean, onClick?: () => void): void;
  note(text: string): void;
}

export interface StepContext {
  lesson: Lesson;
  dock: Dock;
  /** The step's objective is met: the learner may continue. */
  done(): void;
  /** Shows which objective the current screen serves (for mixed items). */
  objective(id: string): void;
  /** Records one graded answer for the lesson summary. */
  grade(firstTry: boolean): void;
}

export interface StepView {
  el: HTMLElement;
  /** Called after the enter transition. */
  entered?(): void;
  dispose?(): void;
}
