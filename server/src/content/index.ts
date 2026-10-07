import type { TaskTemplate } from './types.js';
import { webTemplates } from './templates/web.js';
import { dataTemplates } from './templates/data.js';
import { dsTemplates } from './templates/ds.js';
import { basicTemplates } from './templates/basic.js';
import { designTemplates } from './templates/design.js';
import { miscTemplates } from './templates/misc.js';
import { imposterTemplates } from './templates/imposter.js';

/** Legacy seedable demo templates (content self-check only; the bank now comes from IDEALab.dev). */
export const regularTemplates: TaskTemplate[] = [
  ...webTemplates,
  ...dataTemplates,
  ...dsTemplates,
  ...basicTemplates,
  ...designTemplates,
  ...miscTemplates,
];

/** Imposter (special) templates. Their `domain` is used only for workspace styling. */
export { imposterTemplates };

/** The six ship stations are the IDEALab.dev question domains (see content/idealab.ts). */
export { IDEALAB_DOMAINS as DOMAINS } from './idealab.js';
