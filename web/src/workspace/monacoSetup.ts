/**
 * Bundle Monaco locally (never the CDN) and wire its web workers through Vite.
 *
 * NOTE: monaco-editor 0.57 ships an `exports` map ("./*" -> "./esm/vs/*.js"), so the
 * worker specifiers are `monaco-editor/editor/editor.worker` etc. The legacy
 * `monaco-editor/esm/vs/...` paths do NOT resolve under Vite with this version.
 */
import * as monaco from 'monaco-editor';
import { loader } from '@monaco-editor/react';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import CssWorker from 'monaco-editor/language/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker();
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker();
    if (label === 'json') return new JsonWorker();
    return new EditorWorker();
  },
};

loader.config({ monaco });

export const SHIP_THEME = 'among-bugs-ship';
export const IMPOSTER_THEME = 'among-bugs-imposter';

let themesDefined = false;
/** Define the ship themes once (idempotent). */
export function defineShipThemes(m: typeof monaco = monaco) {
  if (themesDefined) return;
  themesDefined = true;
  const rules = [
    { token: 'comment', foreground: '6c929d', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'c5abea' },
    { token: 'string', foreground: 'e0bf89' },
    { token: 'number', foreground: 'ebd68c' },
    { token: 'type', foreground: '8dc5da' },
    { token: 'identifier', foreground: 'cadbd7' },
    { token: 'delimiter', foreground: '9fb8bf' },
    { token: 'tag', foreground: '8ae4cf' },
    { token: 'attribute.name', foreground: '8dc5da' },
    { token: 'attribute.value', foreground: 'e0bf89' },
  ];
  const base = {
    'editor.foreground': '#cadbd7',
    'editorLineNumber.foreground': '#537681',
    'editorLineNumber.activeForeground': '#8ae4cf',
    'editorCursor.foreground': '#8ae4cf',
    'editor.selectionBackground': '#8ae4cf33',
    'editor.inactiveSelectionBackground': '#8ae4cf1f',
    'editor.lineHighlightBackground': '#132a38',
    'editor.lineHighlightBorder': '#00000000',
    'editorIndentGuide.background1': '#1d3644',
    'editorIndentGuide.activeBackground1': '#3c5c69',
    'editorWidget.background': '#15303c',
    'editorWidget.border': '#4e6b79',
    'editorSuggestWidget.background': '#15303c',
    'editorSuggestWidget.selectedBackground': '#2d4654',
    'scrollbarSlider.background': '#3c5c6966',
    'scrollbarSlider.hoverBackground': '#3c5c69aa',
  };
  m.editor.defineTheme(SHIP_THEME, { base: 'vs-dark', inherit: true, rules, colors: { ...base, 'editor.background': '#0d202c' } });
  m.editor.defineTheme(IMPOSTER_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules,
    colors: { ...base, 'editor.background': '#1f1a26', 'editor.lineHighlightBackground': '#2b2333', 'editorLineNumber.activeForeground': '#f0b8a2', 'editorCursor.foreground': '#f0b8a2' },
  });
}

export { monaco };
