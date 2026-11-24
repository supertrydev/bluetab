import * as fs from 'fs';
import * as path from 'path';
import { PROJECT_COLORS } from '@/types/models';
import { PROJECT_TINTS } from './project-tints';

type Rgb = [number, number, number];
const hex = (value: string): Rgb => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as Rgb;
const hsl = (h: number, s: number, l: number): Rgb => {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
};
const over = (top: Rgb, alpha: number, base: Rgb) => top.map((c, i) => c * alpha + base[i] * (1 - alpha)) as Rgb;
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const css = fs.readFileSync(path.join(__dirname, '../styles/project-tint.css'), 'utf-8');
const [darkCss, lightCss] = [css.slice(0, css.indexOf('[data-theme="light"]')), css.slice(css.indexOf('[data-theme="light"]'))];
const read = (source: string, name: string) => {
  const match = source.match(new RegExp(`--${name}: hsl\\((\\d+) (\\d+)% ([\\d.]+)%(?: / ([\\d.]+))?\\)`));
  if (!match) throw new Error(`--${name} not found`);
  return { color: hsl(+match[1], +match[2], +match[3]), alpha: match[4] ? +match[4] : 1 };
};
const strength = (source: string) => Number(source.match(/--tint-bg: color-mix\(in srgb, var\(--tint-\w+-bg\) (\d+)%, var\(--bg-1\)\)/)?.[1]) / 100;
const THEMES = {
  light: { css: lightCss, card: hsl(0, 0, 100), page: hsl(220, 20, 97), hover: { color: hsl(220, 30, 20), alpha: 0.08 } },
  dark: { css: darkCss, card: hsl(222, 14, 10.5), page: hsl(222, 16, 7), hover: { color: hsl(220, 40, 90), alpha: 0.1 } },
};

describe('project tints', () => {
  it('has a tint for every project color', () => {
    expect(Object.keys(PROJECT_TINTS).sort()).toEqual(Object.keys(PROJECT_COLORS).sort());
  });

  describe.each(Object.keys(PROJECT_TINTS) as (keyof typeof PROJECT_TINTS)[])('%s', (color) => {
    it.each(['light', 'dark'] as const)('keeps text readable in the %s theme', (name) => {
      const theme = THEMES[name];
      const tint = PROJECT_TINTS[color][name];
      const bg = over(hex(tint.bg), strength(theme.css), theme.card);
      const hovered = over(theme.hover.color, theme.hover.alpha, bg);
      const soft = read(theme.css, 'primary-muted');
      const text = (token: string, on: Rgb) => contrast(read(theme.css, token).color, on);

      expect(text('text-strong', hovered)).toBeGreaterThanOrEqual(7);
      expect(text('text-muted', hovered)).toBeGreaterThanOrEqual(4.5);
      expect(text('muted-foreground', hovered)).toBeGreaterThanOrEqual(4.5);
      expect(text('primary-text', over(soft.color, soft.alpha, bg))).toBeGreaterThanOrEqual(4.5);
      expect(text('warning-text', bg)).toBeGreaterThanOrEqual(4.5);
      expect(text('success-text', hovered)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(hex(tint.text), theme.page)).toBeGreaterThanOrEqual(4.5);
      // Clearly a different surface than a plain card.
      expect(contrast(bg, hex(tint.border))).toBeGreaterThanOrEqual(1.5);
    });
  });
});
