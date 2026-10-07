/** Monaco code editor with a tab per task file. Monaco is bundled locally (see monacoSetup). */
import Editor from '@monaco-editor/react';
import { FileCode2, Lock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { TaskFile } from '../lib/api';
import { defineShipThemes, IMPOSTER_THEME, monaco, SHIP_THEME } from './monacoSetup';
import { monacoLanguage } from './util';

export function CodeEditor({
  files, contents, active, onActive, onChange, disabled, modelPrefix, imposter, protect = false,
}: {
  files: TaskFile[];
  contents: Record<string, string>;
  active: string;
  onActive: (name: string) => void;
  onChange: (name: string, value: string) => void;
  disabled: boolean;
  /** Unique per crew+target+generation so stale Monaco models are never reused. */
  modelPrefix: string;
  imposter: boolean;
  /** Content protection: Monaco's copy / cut / context menu are disabled (typing and paste still work). */
  protect?: boolean;
}) {
  const protectRef = useRef(protect);
  protectRef.current = protect;
  const file = files.find((f) => f.name === active) ?? files[0];

  // Dispose this workspace's models on unmount / generation change.
  useEffect(() => {
    return () => {
      // Deferred + skip models still shown by a live editor (StrictMode remounts, fast re-open).
      window.setTimeout(() => {
        const inUse = new Set(monaco.editor.getEditors().map((e) => e.getModel()));
        for (const m of monaco.editor.getModels()) if (m.uri.path.startsWith(`/${modelPrefix}/`) && !inUse.has(m)) m.dispose();
      }, 0);
    };
  }, [modelPrefix]);

  if (!file) return <p className="p-4 font-mono text-xs text-muted">This system has no editable files.</p>;
  const readOnly = file.readOnly || disabled;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Files" className={`flex shrink-0 gap-1 overflow-x-auto border-b px-2 py-1 ${imposter ? 'border-[#6e4a4f]' : 'border-[#36515f]'}`}>
        {files.map((f) => {
          const on = f.name === file.name;
          return (
            <button
              key={f.name}
              type="button"
              role="tab"
              aria-selected={on}
              title={f.readOnly ? `${f.name} (read-only)` : f.name}
              onClick={() => onActive(f.name)}
              className={`flex shrink-0 items-center gap-1.5 rounded px-2.5 py-1 font-mono text-[10px] ${on ? 'bg-[#1d3a48] text-[#e4f3ee]' : 'text-[#8eafb8] hover:bg-white/5'}`}
            >
              {f.readOnly ? <Lock size={11} className="text-[#e5cf8f]" aria-label="read-only" /> : <FileCode2 size={11} />}
              {f.name}
            </button>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">
        <Editor
          path={`${modelPrefix}/${file.name}`}
          language={monacoLanguage(file)}
          value={contents[file.name] ?? file.content}
          theme={imposter ? IMPOSTER_THEME : SHIP_THEME}
          beforeMount={(m) => defineShipThemes(m as unknown as typeof monaco)}
          onMount={(editor, m) => {
            // Belt and braces next to the window-level copy/cut blocker (lib/contentProtection).
            editor.onKeyDown((e) => {
              if (!protectRef.current) return;
              const mod = e.ctrlKey || e.metaKey;
              if ((mod && (e.keyCode === m.KeyCode.KeyC || e.keyCode === m.KeyCode.KeyX || e.keyCode === m.KeyCode.Insert)) || (e.shiftKey && e.keyCode === m.KeyCode.Delete)) {
                e.preventDefault();
                e.stopPropagation();
              }
            });
          }}
          onChange={(v) => {
            if (!file.readOnly && !disabled && typeof v === 'string') onChange(file.name, v);
          }}
          loading={<div className="p-4 font-mono text-[10px] text-muted">Booting editor…</div>}
          options={{
            readOnly,
            contextmenu: !protect,
            dragAndDrop: !protect,
            readOnlyMessage: { value: file.readOnly ? 'This file is read-only evidence.' : 'This system is closed.' },
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 13,
            lineHeight: 21,
            minimap: { enabled: false },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            tabSize: file.name.endsWith('.py') ? 4 : 2,
            renderWhitespace: 'selection',
            smoothScrolling: true,
            padding: { top: 10, bottom: 10 },
            wordWrap: 'off',
            fixedOverflowWidgets: true,
            ariaLabel: `${file.name}${file.readOnly ? ' (read-only)' : ''} code editor`,
          }}
        />
      </div>
    </div>
  );
}
