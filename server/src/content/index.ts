import type { TaskTemplate } from './types.js';
import { webTemplates } from './templates/web.js';
import { dataTemplates } from './templates/data.js';
import { dsTemplates } from './templates/ds.js';
import { basicTemplates } from './templates/basic.js';
import { designTemplates } from './templates/design.js';
import { miscTemplates } from './templates/misc.js';
import { imposterTemplates } from './templates/imposter.js';

/** Regular task templates: 5 per domain (2 EASY, 2 MEDIUM, 1 HARD). */
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

export const DOMAINS = [
  { slug: 'web', name: 'Web Development', room: 'COMMUNICATIONS', color: '#b5a2ec', symbol: '</>', prefix: 'WEB', workspace: 'WEB' },
  { slug: 'data', name: 'Data', room: 'DATABASE CORE', color: '#87b6e5', symbol: '≡', prefix: 'DATA', workspace: 'DATA' },
  { slug: 'ds', name: 'Data Structures', room: 'NAVIGATION', color: '#e1b775', symbol: '⌘', prefix: 'DS', workspace: 'DS' },
  { slug: 'basic', name: 'Basic Programming', room: 'REACTOR', color: '#8ae4bf', symbol: '>_', prefix: 'REACTOR', workspace: 'BASIC' },
  { slug: 'design', name: 'Designing', room: 'DESIGN LAB', color: '#dea4ca', symbol: '✧', prefix: 'DESIGN', workspace: 'DESIGN' },
  { slug: 'misc', name: 'Miscellaneous', room: 'STORAGE', color: '#e3a178', symbol: '{}', prefix: 'MISC', workspace: 'MISC' },
] as const;
