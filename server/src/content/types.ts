/**
 * Authoring schema for AMONG BUGS challenge content.
 *
 * A TaskTemplate is a reviewed base puzzle. `variant(v)` deterministically
 * produces one of four concrete variants (v = 0..3) whose numbers / data /
 * names differ, so Day-2 answers never match exposed Day-1 answers.
 *
 * Default demo assignment: v0 -> Game 1 Sprint 1, v1 -> Game 1 Sprint 2,
 * v2 -> Game 2 Sprint 1, v3 -> Game 2 Sprint 2.
 *
 * Everything under `solution`, `validation` and `hint` is SERVER-ONLY.
 */

export type DomainSlug = 'web' | 'data' | 'ds' | 'basic' | 'design' | 'misc';
export type Difficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type WorkspaceKind = 'WEB' | 'DATA' | 'DS' | 'BASIC' | 'DESIGN' | 'MISC';
export type RunLanguage = 'javascript' | 'python';
export type FileLanguage = 'javascript' | 'python' | 'html' | 'css' | 'text' | 'csv' | 'json' | 'markdown';

export interface StarterFile {
  name: string; // e.g. "main.py", "script.js", "index.html", "sales.csv"
  language: FileLanguage;
  content: string;
  /** Data/asset files participants can read but not edit (datasets, fixtures). */
  readOnly?: boolean;
}

export interface CodeTest {
  name: string;
  stdin: string;
  /** Expected stdout; compared after normalizeOutput(). */
  expected: string;
}

export type Validation =
  | {
      /** Submit a typed answer/token. Compared with a keyed verifier after normalization. */
      mode: 'EXACT_TEXT';
      answer: string;
      caseSensitive: boolean;
      /** Collapse internal runs of whitespace to one space (always trims ends). */
      collapseWhitespace: boolean;
    }
  | {
      /** Submit a number. Accepted when |submitted - answer| <= tolerance. */
      mode: 'NUMERIC';
      answer: number;
      tolerance: number;
    }
  | {
      /**
       * Submit the edited code. The server runs it in the isolated runner
       * against hidden tests. Participant-editable files of `language` are
       * taken from the submission; read-only files come from the task;
       * `harness` files (hidden) are added; `entry` is executed per test.
       */
      mode: 'CODE_TESTS';
      language: RunLanguage;
      entry: string;
      harness?: { name: string; content: string }[];
      tests: CodeTest[];
    };

export interface TaskVariant {
  title: string;
  /** Problem statement. Plain text with optional ``` fenced code blocks. */
  statement: string;
  workspace: WorkspaceKind;
  /** Language used by the Run button; null = no server execution (pure answer task). */
  runLanguage: RunLanguage | null;
  /** File executed by the Run button (must be in files). */
  runEntry?: string;
  /** Visible starter files (buggy code, datasets, html/css). */
  files: StarterFile[];
  /** Default stdin shown in the Run panel. */
  sampleStdin?: string;
  /** Tells participants exactly what to submit and the comparison rule. */
  answerFormat: string;
  validation: Validation;
  /** Paid hint (server-only until purchased). */
  hint: string;
  /** Private reference solution (server/admin only). */
  solution: {
    explanation: string;
    /** Full fixed versions of edited files. Used by the content self-check. */
    files?: Record<string, string>;
    /** For EXACT_TEXT/NUMERIC: the answer string to type. */
    answer?: string;
  };
}

export interface TaskTemplate {
  /** Stable unique key, e.g. "web-cart-total". */
  key: string;
  domain: DomainSlug;
  difficulty: Difficulty;
  variant: (v: 0 | 1 | 2 | 3) => TaskVariant;
}

export const DOMAIN_ORDER: DomainSlug[] = ['web', 'data', 'ds', 'basic', 'design', 'misc'];
