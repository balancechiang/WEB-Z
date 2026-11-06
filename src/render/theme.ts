/**
 * OPB.App/Rendering/Theme.cs → TypeScript.
 * Colors and type of the OP-Z app (sampled from the official app's screenshots).
 * The C# version exposes SolidColorBrush/Color; on Canvas 2D we just use CSS color
 * strings, so both live side by side under a single `OpbTheme` namespace.
 *
 * The same palette is mirrored as CSS custom properties in index.html (:root) so the
 * page chrome (status bar, buttons) matches the canvas exactly.
 */
export const OpbTheme = {
  Background: '#d0d0d0',
  Rule: '#b3b3b3',
  Mid: '#808080',
  Ink: '#131313',
  Red: '#d11d32',
  Yellow: '#ebb000',
  Green: '#025a30',
  Blue: '#175e83',
  White: '#f2f2f2',
  TapeBlue: '#136aa3',

  /** The four encoder colors in dial order: green, blue, yellow, red. */
  Dials: ['#025a30', '#175e83', '#ebb000', '#d11d32'],
  /** Frame color of each parameter page (device LED: white, green, purple, orange). */
  Pages: ['#131313', '#025a30', '#175e83', '#ebb000'],

  /** CSS font stack; Bahnschrift is not on Linux/SteamOS, so we fall back to a condensed sans. */
  Font: '"Bahnschrift", "DIN Condensed", "Roboto Condensed", "Segoe UI", system-ui, sans-serif',
} as const;

export type ThemeColor = string;

/** Design space: every screen draws into a fixed 1600 x 812 box, then scaled to the canvas. */
export const DESIGN_WIDTH = 1600;
export const DESIGN_HEIGHT = 812;

/** The three font weights the C# Typeface enums map to. */
export type FontWeight = 'light' | 'normal' | 'semibold';

export function weightToCss(w: FontWeight): string {
  return w === 'light' ? '300' : w === 'semibold' ? '600' : '400';
}
