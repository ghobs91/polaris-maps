import { colors, darkColors } from '../../src/constants/theme';

/**
 * WCAG 2.1 contrast audit for the two palettes.
 *
 * Thresholds: body text ≥ 4.5:1; large text / prominent accent UI ≥ 3:1
 * (WCAG AA for large text). `primary` is used for links and large button
 * labels, so it is held to the 3:1 large-text bar; `textSecondary` is body
 * copy and must meet 4.5:1.
 */

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

describe.each([
  ['light', colors],
  ['dark', darkColors],
])('%s palette contrast', (_name, palette) => {
  it('body text meets AA (≥ 4.5:1) on background and surface', () => {
    expect(contrastRatio(palette.text, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.text, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('secondary text meets AA (≥ 4.5:1)', () => {
    expect(contrastRatio(palette.textSecondary, palette.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(palette.textSecondary, palette.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('primary accent meets the large-text / UI bar (≥ 3:1)', () => {
    expect(contrastRatio(palette.primary, palette.background)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(palette.primary, palette.surface)).toBeGreaterThanOrEqual(3);
  });
});
