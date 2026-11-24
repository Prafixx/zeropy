// Colors for code that cannot use CSS (canvas textures, Three.js materials).
// They match the tokens in src/styles/tokens.css, with a set for each theme.
// A stage calls refreshPalette() when it is built, so a scene always gets
// the colors of the current theme.

type Palette = {
  /** The page behind a scene (for things that must blend in). */
  paper: string;
  /** Surfaces drawn in a scene: name labels, screens. */
  paper2: string;
  /** Text on those surfaces. */
  ink: string;
  /** Thin outlines of objects. */
  line: string;
  /** Frames of screens and boards. */
  frame: string;
  /** Soft shadows under objects. */
  shadow: string;
  shadowOpacity: number;
  sun: string;
  blue: string;
  leaf: string;
  tomato: string;
  kraft: string;
  kraftDark: string;
  grey: string;
};

const LIGHT: Palette = {
  paper: '#F7F3EC',
  paper2: '#FDFBF7',
  ink: '#1D1C26',
  line: '#3A3846',
  frame: '#1D1C26',
  shadow: '#1D1C26',
  shadowOpacity: 0.1,
  sun: '#F2B01E',
  blue: '#2B4FC9',
  leaf: '#1E9E6A',
  tomato: '#E4472B',
  kraft: '#C99B63',
  kraftDark: '#A97C47',
  grey: '#B9B4C0',
};

const DARK: Palette = {
  paper: '#16161D',
  paper2: '#272732',
  ink: '#ECE8DF',
  line: '#0D0D12',
  frame: '#101017',
  shadow: '#000000',
  shadowOpacity: 0.35,
  sun: '#F2B01E',
  blue: '#5B79E6',
  leaf: '#2BAE78',
  tomato: '#E8583D',
  kraft: '#B48A57',
  kraftDark: '#8E6B3F',
  grey: '#8F8B9D',
};

/** The colors of the current theme. Read them when an object is built. */
export const PALETTE: Palette = { ...LIGHT };

/** Takes the colors of the theme on the page now (light or dark). */
export function refreshPalette(): void {
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  Object.assign(PALETTE, dark ? DARK : LIGHT);
}

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
    return { bg: PALETTE.sun, fg: '#1D1C26', label: 'number' };
  }
  if (type === 'str') return { bg: PALETTE.blue, fg: '#FFFFFF', label: 'text' };
  if (type === 'NoneType') return { bg: PALETTE.grey, fg: '#1D1C26', label: 'nothing' };
  return { bg: PALETTE.paper2, fg: PALETTE.ink, label: type };
}

export function shortRepr(repr: string, max = 11): string {
  return repr.length > max ? `${repr.slice(0, max - 1)}…` : repr;
}
