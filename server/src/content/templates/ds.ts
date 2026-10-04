import type { CodeTest, TaskTemplate } from '../types.js';

/**
 * COMMS / Data Structures & Algorithms (workspace DS, all CODE_TESTS).
 * Test inputs are generated deterministically per variant with a seeded LCG;
 * expected outputs come from the TypeScript reference implementations below.
 */

const src = String.raw;

function rng(seed: number): () => number {
  let s = Math.imul(seed + 1, 2654435761) >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function ri(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}

// ---------------------------------------------------------------------------
// EASY · JavaScript — bracket matcher forgets to check leftovers on the stack
// ---------------------------------------------------------------------------
function bracketsOk(s: string): boolean {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const st: string[] = [];
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') st.push(ch);
    else if (pairs[ch]) {
      if (st.pop() !== pairs[ch]) return false;
    }
  }
  return st.length === 0;
}

const bracketAirlock: TaskTemplate = {
  key: 'ds-bracket-airlock',
  domain: 'ds',
  difficulty: 'EASY',
  variant: (v) => {
    const sector = ['Upper Engine', 'Lower Engine', 'Specimen Room', 'Electrical'][v];
    const r = rng(700 + v * 17);
    const open = '([{';
    const close = ')]}';
    const filler = 'abxyz';
    const gen = (pairs: number): string => {
      const st: number[] = [];
      let out = '';
      let left = pairs;
      while (left > 0 || st.length) {
        if (left > 0 && (st.length === 0 || r() < 0.55)) {
          const k = ri(r, 0, 2);
          st.push(k);
          out += open[k];
          left--;
        } else {
          out += close[st.pop()!];
        }
        if (r() < 0.15) out += filler[ri(r, 0, filler.length - 1)];
      }
      return out;
    };
    const codes: string[] = [];
    for (let i = 0; i < 10; i++) {
      let s = gen(ri(r, 1, 5));
      const kind = i % 4;
      if (kind === 1) s = open[ri(r, 0, 2)] + s; // unclosed prefix
      else if (kind === 2) {
        // swap one closer for a different closer
        const idx = [...s].findIndex((c) => close.includes(c));
        const c = s[idx];
        s = s.slice(0, idx) + close[(close.indexOf(c) + 1) % 3] + s.slice(idx + 1);
      } else if (kind === 3 && i % 3 === 0) s = s + close[ri(r, 0, 2)]; // stray closer
      codes.push(s);
    }
    const toInput = (list: string[]) => `${list.length}\n${list.join('\n')}\n`;
    const sets: [string, string[]][] = [
      ['airlock-codes', codes],
      ['unclosed-only', ['(', '(([]', `{${'[]'.repeat(v + 1)}`]],
      ['empty-and-filler', ['', `a(b[c]d)e${'x'.repeat(v)}`, ')(']],
      ['single', [['[', '()', '}', '{}'][v]]],
      ['no-codes', []],
    ];
    const tests: CodeTest[] = sets.map(([name, list]) => ({
      name,
      stdin: toInput(list),
      expected: list.map((s) => (bracketsOk(s) ? 'YES' : 'NO')).join('\n'),
    }));
    const starter = src`// Airlock code validator.
// Input: first line T, then T lines (a line may be empty).
// Output: YES if the brackets ( ) [ ] { } in the line are balanced, else NO.
const lines = require('fs').readFileSync(0, 'utf8').split('\n').map((l) => l.replace(/\r$/, ''));
const t = Number(lines[0]) || 0;
const pairs = { ')': '(', ']': '[', '}': '{' };
const out = [];

for (let i = 1; i <= t; i++) {
  const code = (lines[i] || '').trim();
  const stack = [];
  let ok = true;
  for (const ch of code) {
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
    } else if (pairs[ch]) {
      if (stack.pop() !== pairs[ch]) {
        ok = false;
        break;
      }
    }
  }
  out.push(ok ? 'YES' : 'NO');
}
console.log(out.join('\n'));
`;
    const fixed = starter.replace("out.push(ok ? 'YES' : 'NO');", "out.push(ok && stack.length === 0 ? 'YES' : 'NO');");
    return {
      title: `${sector} airlock codes`,
      statement: `The ${sector} airlock only opens for codes whose brackets are balanced: every ( [ { must be closed by the matching ) ] } in the correct order. Any other characters in a code are ignored, and an empty code is balanced.\n\nmain.js reads T, then T codes (one per line) from standard input and prints YES or NO for each code on its own line. An impostor tweaked it: codes like "((" now open the airlock.\n\nFix main.js. It is verified against hidden code lists.`,
      workspace: 'DS',
      runLanguage: 'javascript',
      runEntry: 'main.js',
      files: [{ name: 'main.js', language: 'javascript', content: starter }],
      sampleStdin: tests[0].stdin,
      answerFormat: 'Submit your repaired main.js. It runs against hidden inputs on stdin; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'javascript', entry: 'main.js', tests },
      hint: 'Every closer is checked against the stack. But what if the code ends while openers are still waiting on the stack?',
      solution: {
        explanation: 'The validator never checks that the stack is empty at the end, so unclosed openers pass. Require stack.length === 0 in addition to ok.',
        files: { 'main.js': fixed },
      },
    };
  },
};

// ---------------------------------------------------------------------------
// EASY · Python — lower-bound binary search with a wrong upper boundary
// ---------------------------------------------------------------------------
function lowerBound(a: number[], t: number): number {
  let i = 0;
  while (i < a.length && a[i] < t) i++;
  return i;
}

const dockingLowerBound: TaskTemplate = {
  key: 'ds-docking-lower-bound',
  domain: 'ds',
  difficulty: 'EASY',
  variant: (v) => {
    const port = ['Alpha', 'Bravo', 'Charlie', 'Delta'][v];
    const mkArr = (seed: number, n: number): number[] => {
      const r = rng(seed);
      const a: number[] = [];
      let x = ri(r, 1, 10);
      for (let i = 0; i < n; i++) {
        a.push(x);
        x += r() < 0.3 ? 0 : ri(r, 1, 9);
      }
      return a;
    };
    const mkQueries = (seed: number, a: number[], q: number): number[] => {
      const r = rng(seed);
      const hi = a.length ? a[a.length - 1] : 20;
      const qs: number[] = [];
      for (let i = 0; i < q; i++) qs.push(ri(r, 0, hi + 5));
      qs.push(hi + 1 + v); // beyond every slot
      if (a.length) qs.push(a[0]);
      return qs;
    };
    const main = mkArr(800 + v * 5, 12 + v);
    const cases: [string, number[], number[]][] = [
      ['schedule', main, mkQueries(850 + v, main, 8)],
      ['duplicates', [4, 4, 4, 7, 7, 9 + v], [4, 5, 7, 8, 9 + v, 10 + v, 1]],
      ['single-slot', [10 + v], [5, 10 + v, 99]],
      ['empty-schedule', [], [3, 0]],
      ['all-later', [2, 3, 5 + v], [100, 6 + v]],
    ];
    const tests: CodeTest[] = cases.map(([name, a, qs]) => ({
      name,
      stdin: `${a.length} ${qs.length}\n${a.join(' ')}\n${qs.join(' ')}\n`,
      expected: qs.map((t) => String(lowerBound(a, t))).join('\n'),
    }));
    const starter = src`import sys


def lower_bound(slots, target):
    """Index of the first slot >= target (len(slots) if there is none)."""
    lo, hi = 0, len(slots) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if slots[mid] < target:
            lo = mid + 1
        else:
            hi = mid
    return lo


data = sys.stdin.read().split()
n, q = int(data[0]), int(data[1])
slots = [int(x) for x in data[2:2 + n]]
queries = [int(x) for x in data[2 + n:2 + n + q]]
print('\n'.join(str(lower_bound(slots, t)) for t in queries))
`;
    const fixed = starter.replace('lo, hi = 0, len(slots) - 1', 'lo, hi = 0, len(slots)');
    return {
      title: `Docking port ${port} scheduler`,
      statement: `Docking port ${port} keeps its free arrival slots as a sorted list of integers (duplicates allowed). For every ship request time t, the scheduler must print the index of the FIRST slot whose value is >= t. If every slot is earlier than t, it must print n (the number of slots).\n\nInput on stdin:\n\`\`\`\nn q\nslot_1 ... slot_n      (this line is empty when n = 0)\nt_1 ... t_q\n\`\`\`\nOutput: q lines, one index per request.\n\nmain.py uses binary search, but late ships keep getting assigned to the last slot. Fix main.py; it is verified against hidden schedules.`,
      workspace: 'DS',
      runLanguage: 'python',
      runEntry: 'main.py',
      files: [{ name: 'main.py', language: 'python', content: starter }],
      sampleStdin: tests[0].stdin,
      answerFormat: 'Submit your repaired main.py. It runs against hidden inputs on stdin; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'main.py', tests },
      hint: 'The answer can be any index from 0 to n inclusive. Can the search range as written ever produce n?',
      solution: {
        explanation: 'The search interval [lo, hi] must allow the answer n. Start with hi = len(slots) (half-open search), otherwise targets larger than every slot return n - 1.',
        files: { 'main.py': fixed },
      },
    };
  },
};

// ---------------------------------------------------------------------------
// MEDIUM · JavaScript — queue built from two stacks
// ---------------------------------------------------------------------------
function runQueue(ops: string[]): string {
  const q: string[] = [];
  const out: string[] = [];
  for (const op of ops) {
    const [cmd, arg] = op.split(' ');
    if (cmd === 'PUSH') q.push(arg);
    else if (cmd === 'POP') out.push(q.length ? q.shift()! : 'EMPTY');
    else if (cmd === 'PEEK') out.push(q.length ? q[0] : 'EMPTY');
    else if (cmd === 'SIZE') out.push(String(q.length));
  }
  return out.join('\n');
}

const cargoQueue: TaskTemplate = {
  key: 'ds-cargo-queue',
  domain: 'ds',
  difficulty: 'MEDIUM',
  variant: (v) => {
    const bay = ['Cargo Bay A', 'Storage Deck', 'Loading Ramp', 'Supply Hold'][v];
    const mk = (seed: number, n: number): string[] => {
      const r = rng(seed);
      const ops: string[] = [];
      for (let i = 0; i < n; i++) {
        const x = r();
        if (x < 0.5) ops.push(`PUSH ${ri(r, 1, 99)}`);
        else if (x < 0.8) ops.push('POP');
        else if (x < 0.9) ops.push('PEEK');
        else ops.push('SIZE');
      }
      return ops;
    };
    const sets: [string, string[]][] = [
      ['manifest', mk(900 + v * 23, 24 + v)],
      ['interleaved', ['PUSH 1', `PUSH ${2 + v}`, 'POP', 'PUSH 3', 'SIZE', 'POP', 'PEEK', 'POP', 'POP']],
      ['empty-hold', ['POP', 'PEEK', 'SIZE']],
      ['single-crate', [`PUSH ${40 + v}`, 'PEEK', 'SIZE', 'POP', 'SIZE']],
      ['duplicates', ['PUSH 5', 'PUSH 5', 'POP', `PUSH ${6 + v}`, 'PUSH 5', 'POP', 'POP', 'SIZE', 'POP']],
    ];
    const tests: CodeTest[] = sets.map(([name, ops]) => ({ name, stdin: ops.join('\n') + '\n', expected: runQueue(ops) }));
    const starter = src`// Cargo crates must leave in the same order they arrived (FIFO),
// but the hold only has stacks, so the queue is built from two stacks.
class CargoQueue {
  constructor() {
    this.inbox = [];
    this.outbox = [];
  }
  push(x) {
    this.inbox.push(x);
  }
  transfer() {
    while (this.inbox.length) this.outbox.push(this.inbox.pop());
  }
  pop() {
    this.transfer();
    return this.outbox.length ? this.outbox.pop() : 'EMPTY';
  }
  peek() {
    this.transfer();
    return this.outbox.length ? this.outbox[this.outbox.length - 1] : 'EMPTY';
  }
  size() {
    return this.inbox.length;
  }
}

const ops = require('fs').readFileSync(0, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
const q = new CargoQueue();
const out = [];
for (const op of ops) {
  const [cmd, arg] = op.split(' ');
  if (cmd === 'PUSH') q.push(arg);
  else if (cmd === 'POP') out.push(q.pop());
  else if (cmd === 'PEEK') out.push(q.peek());
  else if (cmd === 'SIZE') out.push(String(q.size()));
}
console.log(out.join('\n'));
`;
    const fixed = starter
      .replace('    while (this.inbox.length) this.outbox.push(this.inbox.pop());', '    if (this.outbox.length) return;\n    while (this.inbox.length) this.outbox.push(this.inbox.pop());')
      .replace('    return this.inbox.length;', '    return this.inbox.length + this.outbox.length;');
    return {
      title: `${bay} crate queue`,
      statement: `Crates in the ${bay} must leave in exactly the order they arrived (first in, first out). The hold's software builds that queue out of two stacks (inbox and outbox) in main.js. It reads one command per line from stdin:\n\n\`\`\`\nPUSH x   add crate x to the back of the queue (prints nothing)\nPOP      remove the front crate and print it, or print EMPTY\nPEEK     print the front crate without removing it, or EMPTY\nSIZE     print how many crates are in the queue\n\`\`\`\n\nCrates come out in the wrong order once pushes and pops are interleaved, and SIZE lies. Keep the two-stack design but fix it. main.js is verified against hidden command lists.`,
      workspace: 'DS',
      runLanguage: 'javascript',
      runEntry: 'main.js',
      files: [{ name: 'main.js', language: 'javascript', content: starter }],
      sampleStdin: tests[1].stdin,
      answerFormat: 'Submit your repaired main.js. It runs against hidden inputs on stdin; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'javascript', entry: 'main.js', tests },
      hint: 'Crates already in the outbox are older than everything in the inbox. When is it safe to pour the inbox into the outbox? And where do crates live besides the inbox?',
      solution: {
        explanation: 'Only transfer inbox -> outbox when the outbox is empty; transferring while it still holds crates buries older crates under newer ones. SIZE must count both stacks.',
        files: { 'main.js': fixed },
      },
    };
  },
};

// ---------------------------------------------------------------------------
// MEDIUM · Python — BFS on a grid with a broken neighbour list
// ---------------------------------------------------------------------------
function bfsGrid(grid: string[]): number {
  const R = grid.length;
  const C = grid[0].length;
  let s = [0, 0];
  let e = [0, 0];
  for (let i = 0; i < R; i++)
    for (let j = 0; j < C; j++) {
      if (grid[i][j] === 'S') s = [i, j];
      if (grid[i][j] === 'E') e = [i, j];
    }
  const dist = grid.map((row) => [...row].map(() => -1));
  dist[s[0]][s[1]] = 0;
  const q = [s];
  for (let h = 0; h < q.length; h++) {
    const [i, j] = q[h];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= R || nj >= C || grid[ni][nj] === '#' || dist[ni][nj] !== -1) continue;
      dist[ni][nj] = dist[i][j] + 1;
      q.push([ni, nj]);
    }
  }
  return dist[e[0]][e[1]];
}

const ventBfs: TaskTemplate = {
  key: 'ds-vent-bfs',
  domain: 'ds',
  difficulty: 'MEDIUM',
  variant: (v) => {
    const map = ['Skeld vents', 'Polus tunnels', 'Mira corridors', 'Airship ducts'][v];
    const mk = (seed: number, R: number, C: number, wantReachable: boolean): string[] => {
      for (let k = 0; k < 400; k++) {
        const r = rng(seed + k * 101);
        const g: string[][] = Array.from({ length: R }, () => Array.from({ length: C }, () => (r() < 0.28 ? '#' : '.')));
        const si = ri(r, 0, R - 1);
        const sj = ri(r, Math.ceil(C / 2), C - 1);
        const ei = ri(r, 0, R - 1);
        const ej = ri(r, 0, Math.floor(C / 2) - 1);
        g[si][sj] = 'S';
        g[ei][ej] = 'E';
        const grid = g.map((row) => row.join(''));
        const d = bfsGrid(grid);
        if (wantReachable ? d > 2 : d === -1) return grid;
      }
      throw new Error('ds-vent-bfs: grid generation failed');
    };
    const grids: [string, string[]][] = [
      ['vent-map', mk(1000 + v * 7, 6 + (v % 2), 8 + v, true)],
      ['second-map', mk(1100 + v * 7, 5, 7, true)],
      ['blocked', mk(1200 + v * 7, 5, 6, false)],
      ['adjacent-west', ['ES']],
      ['single-column', ['E', '.', v % 2 ? '.' : 'S', ...(v % 2 ? ['S'] : [])]],
      ['detour', ['E#S', '.#.', '...']],
    ];
    const tests: CodeTest[] = grids.map(([name, grid]) => ({
      name,
      stdin: `${grid.length} ${grid[0].length}\n${grid.join('\n')}\n`,
      expected: String(bfsGrid(grid)),
    }));
    const starter = src`import sys
from collections import deque


def shortest_path(grid, rows, cols):
    start = end = None
    for i in range(rows):
        for j in range(cols):
            if grid[i][j] == 'S':
                start = (i, j)
            elif grid[i][j] == 'E':
                end = (i, j)

    moves = [(1, 0), (0, 1), (-1, 0), (1, 0)]
    seen = {start}
    queue = deque([(start, 0)])
    while queue:
        (i, j), d = queue.popleft()
        if (i, j) == end:
            return d
        for di, dj in moves:
            ni, nj = i + di, j + dj
            if 0 <= ni < rows and 0 <= nj < cols and grid[ni][nj] != '#' and (ni, nj) not in seen:
                seen.add((ni, nj))
                queue.append(((ni, nj), d + 1))
    return -1


lines = sys.stdin.read().splitlines()
rows, cols = map(int, lines[0].split())
grid = [lines[1 + i].strip() for i in range(rows)]
print(shortest_path(grid, rows, cols))
`;
    const fixed = starter.replace('moves = [(1, 0), (0, 1), (-1, 0), (1, 0)]', 'moves = [(1, 0), (0, 1), (-1, 0), (0, -1)]');
    return {
      title: `Shortest route through the ${map}`,
      statement: `A crewmate at S must reach the emergency button at E through the ${map}. The map is a grid: '.' is open floor, '#' is a wall, and each step moves one cell up, down, left or right (no diagonals).\n\nInput on stdin:\n\`\`\`\nR C\nR lines of C characters\n\`\`\`\nPrint the minimum number of steps from S to E, or -1 if E cannot be reached.\n\nmain.py runs a breadth-first search, yet it reports -1 or far-too-long routes whenever the button is to the west. Fix main.py; it is verified against hidden maps.`,
      workspace: 'DS',
      runLanguage: 'python',
      runEntry: 'main.py',
      files: [{ name: 'main.py', language: 'python', content: starter }],
      sampleStdin: tests[0].stdin,
      answerFormat: 'Submit your repaired main.py. It runs against hidden inputs on stdin; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'main.py', tests },
      hint: 'Write down the four directions a crewmate can move as (row, col) deltas and compare them with the list the BFS explores.',
      solution: {
        explanation: 'The move list contains (1, 0) twice and never (0, -1), so the search can never step left. Replace the duplicate with (0, -1).',
        files: { 'main.py': fixed },
      },
    };
  },
};

// ---------------------------------------------------------------------------
// HARD · Python — Dijkstra with wrong relaxation, one-way edges, bad INF output
// ---------------------------------------------------------------------------
function dijkstra(n: number, edges: [number, number, number][], s: number): number[] {
  const dist = new Array<number>(n + 1).fill(Infinity);
  const done = new Array<boolean>(n + 1).fill(false);
  dist[s] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1;
    for (let i = 1; i <= n; i++) if (!done[i] && dist[i] < Infinity && (u === -1 || dist[i] < dist[u])) u = i;
    if (u === -1) break;
    done[u] = true;
    for (const [a, b, w] of edges) {
      if (a === u && dist[u] + w < dist[b]) dist[b] = dist[u] + w;
      if (b === u && dist[u] + w < dist[a]) dist[a] = dist[u] + w;
    }
  }
  return dist.slice(1).map((d) => (d === Infinity ? -1 : d));
}

const relayDijkstra: TaskTemplate = {
  key: 'ds-relay-dijkstra',
  domain: 'ds',
  difficulty: 'HARD',
  variant: (v) => {
    const net = ['Skeld relay mesh', 'Polus comms array', 'Mira HQ uplink grid', 'Airship signal web'][v];
    const mkGraph = (seed: number, n: number, extra: number, isolate: boolean): [number, [number, number, number][]] => {
      const r = rng(seed);
      const edges: [number, number, number][] = [];
      const last = isolate ? n - 1 : n;
      for (let i = 2; i <= last; i++) {
        const j = ri(r, 1, i - 1);
        // randomise direction as written in the input
        edges.push(r() < 0.5 ? [i, j, ri(r, 5, 20)] : [j, i, ri(r, 5, 20)]);
      }
      for (let k = 0; k < extra; k++) {
        const a = ri(r, 1, last);
        const b = ri(r, 1, last);
        edges.push([a, b, ri(r, 1, 20)]);
      }
      return [n, edges];
    };
    type Case = [string, number, [number, number, number][], number];
    const [n1, e1] = mkGraph(1300 + v * 41, 7 + v, 5 + v, true);
    const [n2, e2] = mkGraph(1400 + v * 41, 6, 4, false);
    const cases: Case[] = [
      ['relay-mesh', n1, e1, 1],
      ['other-source', n2, e2, 1 + (v % 3) + 1],
      ['single-relay', 1, [], 1],
      ['detour-cheaper', 4, [[1, 2, 2], [2, 3, 2], [1, 3, 10 + v], [4, 3, 1], [3, 3, 4], [1, 2, 9]], 1],
      ['reverse-written', 3, [[2, 1, 3 + v], [3, 2, 4]], 1],
    ];
    const tests: CodeTest[] = cases.map(([name, n, edges, s]) => ({
      name,
      stdin: `${n} ${edges.length}\n${edges.map((e) => e.join(' ')).join('\n')}${edges.length ? '\n' : ''}${s}\n`,
      expected: dijkstra(n, edges, s).map(String).join('\n'),
    }));
    const starter = src`import sys
import heapq


def main():
    data = sys.stdin.read().split()
    n, m = int(data[0]), int(data[1])
    adj = [[] for _ in range(n + 1)]
    idx = 2
    for _ in range(m):
        u, v, w = int(data[idx]), int(data[idx + 1]), int(data[idx + 2])
        idx += 3
        adj[u].append((v, w))
    source = int(data[idx])

    INF = float('inf')
    dist = [INF] * (n + 1)
    dist[source] = 0
    done = [False] * (n + 1)
    heap = [(0, source)]
    while heap:
        d, u = heapq.heappop(heap)
        if done[u]:
            continue
        done[u] = True
        for v, w in adj[u]:
            if d + w < dist[v]:
                dist[v] = w
                heapq.heappush(heap, (dist[v], v))

    print('\n'.join(str(dist[i]) for i in range(1, n + 1)))


main()
`;
    const fixed = starter
      .replace('        adj[u].append((v, w))\n', '        adj[u].append((v, w))\n        adj[v].append((u, w))\n')
      .replace('                dist[v] = w\n', '                dist[v] = d + w\n')
      .replace("print('\\n'.join(str(dist[i]) for i in range(1, n + 1)))", "print('\\n'.join(str(dist[i]) if dist[i] < INF else '-1' for i in range(1, n + 1)))");
    return {
      title: `Latency map of the ${net}`,
      statement: `The ${net} has n relays numbered 1..n connected by m links. Every link "u v w" is two-way and costs w milliseconds in either direction (w >= 1). There may be several links between the same pair of relays, and even a link from a relay to itself.\n\nInput on stdin:\n\`\`\`\nn m\nm lines: u v w\ns\n\`\`\`\nPrint n lines: line i is the minimum total latency from relay s to relay i (0 for s itself), or -1 if relay i cannot be reached.\n\nmain.py implements Dijkstra's algorithm with a heap, but an impostor sabotaged it: distances are too small, some reachable relays look unreachable, and unreachable relays print garbage. Fix main.py; it is verified against hidden networks.`,
      workspace: 'DS',
      runLanguage: 'python',
      runEntry: 'main.py',
      files: [{ name: 'main.py', language: 'python', content: starter }],
      sampleStdin: tests[3].stdin,
      answerFormat: 'Submit your repaired main.py. It runs against hidden inputs on stdin; stdout must match exactly (trailing whitespace ignored).',
      validation: { mode: 'CODE_TESTS', language: 'python', entry: 'main.py', tests },
      hint: 'Check three things: how a link is stored in the adjacency list (links are two-way), what value is written into dist[v] when an edge relaxes, and what is printed for a relay that was never reached.',
      solution: {
        explanation: 'Three bugs: (1) links were only added u -> v; add v -> u too; (2) relaxation stored the edge weight (dist[v] = w) instead of the path length (dist[v] = d + w); (3) unreachable relays printed "inf" instead of -1.',
        files: { 'main.py': fixed },
      },
    };
  },
};

export const dsTemplates: TaskTemplate[] = [bracketAirlock, dockingLowerBound, cargoQueue, ventBfs, relayDijkstra];
