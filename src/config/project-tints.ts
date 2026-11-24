/**
 * Card colors of a project, per theme. Chosen in OKLCH so every color is about
 * equally strong. The card shows half of `bg` over its surface, see
 * project-tint.css. `project-tints.test.ts` checks the contrast of everything on them.
 */

import type { ProjectColor } from '@/types/models';

export interface ProjectTint {
  /** Card background, at full strength. */
  bg: string;
  border: string;
  /** Project name on the page background. */
  text: string;
}

export const PROJECT_TINTS: Record<ProjectColor, { light: ProjectTint; dark: ProjectTint }> = {
  red: {
    light: { bg: '#ffc8c2', border: '#ed8c83', text: '#90302c' },
    dark: { bg: '#6b221f', border: '#9c433e', text: '#ffa097' },
  },
  orange: {
    light: { bg: '#fed4a7', border: '#dc9c50', text: '#784902' },
    dark: { bg: '#593502', border: '#8b5505', text: '#f5ad5a' },
  },
  yellow: {
    light: { bg: '#f7ea83', border: '#baad4b', text: '#605601' },
    dark: { bg: '#494206', border: '#6f6502', text: '#cfc154' },
  },
  green: {
    light: { bg: '#a3f4b8', border: '#6cc185', text: '#016732' },
    dark: { bg: '#124c28', border: '#1a763f', text: '#78d694' },
  },
  blue: {
    light: { bg: '#c1dbfe', border: '#77adf5', text: '#1b549b' },
    dark: { bg: '#123e74', border: '#3063a6', text: '#92c1ff' },
  },
  purple: {
    light: { bg: '#e1cfff', border: '#b998ea', text: '#633f90' },
    dark: { bg: '#4a2c6e', border: '#70509b', text: '#ccabfe' },
  },
  pink: {
    light: { bg: '#ffc8e9', border: '#df8cc0', text: '#833269' },
    dark: { bg: '#62234e', border: '#904476', text: '#f79bd5' },
  },
};

/** Custom properties for `.project-tint`, which picks the theme's values. */
export function projectTintVars(color: ProjectColor): Record<`--tint-${string}`, string> {
  const { light, dark } = PROJECT_TINTS[color];
  return {
    '--tint-light-bg': light.bg,
    '--tint-light-border': light.border,
    '--tint-light-text': light.text,
    '--tint-dark-bg': dark.bg,
    '--tint-dark-border': dark.border,
    '--tint-dark-text': dark.text,
  };
}
