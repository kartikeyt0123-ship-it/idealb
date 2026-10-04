import type { StarterFile, Validation } from '../content/types.js';
import { normalizeOutput } from './normalize.js';
import { runnerExecute, type RunnerConfig, type RunnerResult } from './runnerClient.js';

type CodeValidation = Extract<Validation, { mode: 'CODE_TESTS' }>;

/**
 * Builds the exact file set the judge executes: editable files of the judged
 * language come from the submission; everything read-only (datasets) comes
 * from the task definition; hidden harness files are added last and win.
 */
export function buildJudgeFiles(
  starter: StarterFile[],
  submitted: Record<string, string>,
  validation: CodeValidation,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of starter) {
    const editable = !f.readOnly;
    files[f.name] = editable && typeof submitted[f.name] === 'string' ? submitted[f.name] : f.content;
  }
  for (const h of validation.harness ?? []) files[h.name] = h.content;
  return files;
}

export interface JudgeOutcome {
  passed: boolean;
  total: number;
  passedCount: number;
  /** First failing test summary — never includes hidden expected output. */
  firstFailure?: { index: number; reason: 'WRONG_OUTPUT' | 'RUNTIME_ERROR' | 'TIMEOUT' | 'OUTPUT_LIMIT'; stderrTail?: string };
}

export async function judgeCode(
  cfg: RunnerConfig,
  starter: StarterFile[],
  submitted: Record<string, string>,
  validation: CodeValidation,
): Promise<JudgeOutcome> {
  const files = buildJudgeFiles(starter, submitted, validation);
  let passedCount = 0;
  let firstFailure: JudgeOutcome['firstFailure'];
  for (let i = 0; i < validation.tests.length; i++) {
    const t = validation.tests[i];
    const r: RunnerResult = await runnerExecute(cfg, { language: validation.language, files, entry: validation.entry, stdin: t.stdin, timeoutMs: 4000 });
    const ok = !r.timedOut && !r.outputTruncated && r.exitCode === 0 && normalizeOutput(r.stdout) === normalizeOutput(t.expected);
    if (ok) {
      passedCount++;
      continue;
    }
    if (!firstFailure) {
      firstFailure = {
        index: i + 1,
        reason: r.timedOut ? 'TIMEOUT' : r.outputTruncated ? 'OUTPUT_LIMIT' : r.exitCode !== 0 ? 'RUNTIME_ERROR' : 'WRONG_OUTPUT',
        stderrTail: r.stderr ? r.stderr.slice(-600) : undefined,
      };
    }
    // Stop early: one failure is enough to reject; saves runner capacity.
    break;
  }
  return { passed: passedCount === validation.tests.length, total: validation.tests.length, passedCount, firstFailure };
}
