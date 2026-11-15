// Colors shared by CSS-free code (canvas textures, Three.js materials).
// Keep in sync with src/styles/tokens.css.
export const PALETTE = {
  paper: '#F3EDE2',
  paper2: '#FBF7EF',
  ink: '#1A1B2E',
  sun: '#F6B92B',
  blue: '#2B50D6',
  leaf: '#1E9E6A',
  tomato: '#E4472B',
  kraft: '#C99B63',
  kraftDark: '#A97C47',
  grey: '#B9B4C0',
} as const;

export const FONT_MONO = '"JetBrains Mono Variable", ui-monospace, Consolas, monospace';

export interface ValueColor {
  bg: string;
  fg: string;
  /** Plain word for the legend. */
  label: string;
}

/** The value color code used in every scene: number, text, True/False, nothing. */
export function valueColor(type: string): ValueColor {
  if (type === 'bool') return { bg: PALETTE.leaf, fg: '#FFFFFF', label: 'True / False' };
  if (type === 'int' || type === 'float' || type === 'complex') {
    return { bg: PALETTE.sun, fg: PALETTE.ink, label: 'number' };
  }
  if (type === 'str') return { bg: PALETTE.blue, fg: '#FFFFFF', label: 'text' };
  if (type === 'NoneType') return { bg: PALETTE.grey, fg: PALETTE.ink, label: 'nothing' };
  return { bg: PALETTE.paper2, fg: PALETTE.ink, label: type };
}

export function shortRepr(repr: string, max = 11): string {
  return repr.length > max ? `${repr.slice(0, max - 1)}…` : repr;
}
