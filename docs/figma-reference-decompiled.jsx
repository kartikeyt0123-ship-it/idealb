function N_({
  color: e = `#51cfdf`,
  size: t = 48,
  state: n = `idle`,
  accessory: r = !1,
  className: i = ``,
}) {
  return (
    <svg
      width={t}
      height={t * 1.15}
      viewBox="0 0 100 115"
      fill="none"
      role="img"
      aria-label={`${n} crewmate`}
      className={`${n === `ejected` ? `animate-[eject_6s_ease-in-out_infinite_alternate]` : n === `idle` ? `animate-[float_5s_ease-in-out_infinite]` : ``} ${i}`}
    >
      <ellipse cx="49" cy="109" rx="32" ry="4" fill="#000" opacity=".25" />
      <rect
        x="9"
        y="44"
        width="24"
        height="46"
        rx="10"
        fill={e}
        stroke="#111724"
        strokeWidth="5"
      />
      <path
        d="M28 43C28 23 40 14 57 14C76 14 87 25 87 46V98C87 104 82 106 76 106H65V87H51V106H35C29 106 26 102 26 97V49"
        fill={e}
        stroke="#111724"
        strokeWidth="5"
        strokeLinejoin="round"
      />
      <path
        d="M72 22C79 28 82 35 82 49V97H69V85C69 80 65 78 61 78H33V69C56 79 76 64 72 22Z"
        fill="#000"
        opacity=".13"
      />
      <path
        d="M47 37C47 30 55 28 68 28C85 28 94 32 94 44C94 56 85 60 70 60C54 60 45 54 45 45L47 37Z"
        fill="#91c3d3"
        stroke="#111724"
        strokeWidth="5"
      />
      <path
        d="M53 36C61 33 76 33 85 37"
        stroke="#e0f9ff"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {r && (
        <>
          <path
            d="M36 19L45 4H74L81 20Z"
            fill="#e5cf82"
            stroke="#111724"
            strokeWidth="4"
          />
          <path d="M41 15H76" stroke="#111724" strokeWidth="4" />
          <rect
            x="86"
            y="40"
            width="9"
            height="21"
            rx="4"
            fill="#e5cf82"
            stroke="#111724"
            strokeWidth="3"
          />
          <path
            d="M91 56V68H77"
            stroke="#e5cf82"
            strokeWidth="4"
            strokeLinecap="round"
          />
        </>
      )}
      {n === `celebrating` && (
        <path
          d="M19 50L8 33L13 26"
          stroke={e}
          strokeWidth="10"
          strokeLinecap="round"
        />
      )}
      {n === `warning` && (
        <>
          <path d="M66 5L62 11" stroke="#ef6473" strokeWidth="3" />
          <path d="M84 6L87 13" stroke="#ef6473" strokeWidth="3" />
        </>
      )}
    </svg>
  );
}
var P_ = [
    {
      name: `Web Development`,
      room: `COMMUNICATIONS`,
      color: `#b5a2ec`,
      symbol: `</>`,
      prefix: `WEB`,
    },
    {
      name: `Data`,
      room: `DATABASE CORE`,
      color: `#87b6e5`,
      symbol: `≡`,
      prefix: `DATA`,
    },
    {
      name: `Data Structures`,
      room: `NAVIGATION`,
      color: `#e1b775`,
      symbol: `⌘`,
      prefix: `DS`,
    },
    {
      name: `Basic Programming`,
      room: `REACTOR`,
      color: `#8ae4bf`,
      symbol: `>_`,
      prefix: `REACTOR`,
    },
    {
      name: `Designing`,
      room: `DESIGN LAB`,
      color: `#dea4ca`,
      symbol: `✧`,
      prefix: `DESIGN`,
    },
    {
      name: `Miscellaneous`,
      room: `STORAGE`,
      color: `#e3a178`,
      symbol: `{}`,
      prefix: `MISC`,
    },
  ],
  F_ = `#include <iostream>
using namespace std;

int main() {
    int readings[] = {6, 8, 10, 18};
    int total = 0;

    for (int i = 0; i < 3; i++) {
        total += readings[i];
    }

    cout << total << endl;
    return 0;
}`,
  I_ = [
    {
      id: `CRW-001`,
      name: `CODEX`,
      color: `#f37983`,
      coins: 2450,
      members: 4,
      tasks: 12,
      status: `ACTIVE`,
    },
    {
      id: `CRW-012`,
      name: `BYTEFORCE`,
      color: `#86cd97`,
      coins: 2210,
      members: 3,
      tasks: 10,
      status: `ACTIVE`,
    },
    {
      id: `CRW-007`,
      name: `DEBUGGERS`,
      color: `#edd478`,
      coins: 1980,
      members: 4,
      tasks: 9,
      status: `ACTIVE`,
    },
    {
      id: `CRW-042`,
      name: `NEXORA`,
      color: `#51cfdf`,
      coins: 1250,
      members: 4,
      tasks: 6,
      status: `ACTIVE`,
    },
    {
      id: `CRW-019`,
      name: `NULLPTR`,
      color: `#b298e7`,
      coins: 1100,
      members: 3,
      tasks: 5,
      status: `ACTIVE`,
    },
    {
      id: `CRW-017`,
      name: `STACKOVERFLOW`,
      color: `#efae77`,
      coins: 850,
      members: 4,
      tasks: 4,
      status: `ACTIVE`,
    },
    {
      id: `CRW-024`,
      name: `BITSHIFT`,
      color: `#d693b9`,
      coins: 700,
      members: 3,
      tasks: 3,
      status: `ACTIVE`,
    },
    {
      id: `CRW-029`,
      name: `SEGFAULT`,
      color: `#7dace9`,
      coins: 450,
      members: 4,
      tasks: 2,
      status: `ACTIVE`,
    },
  ];
function L_() {
  let e = I_;
  try {
    let t = JSON.parse(localStorage.getItem(`debug-crews`) || `null`);
    t?.length &&
      (e = t
        .filter((e) => String(e.status) !== `REMOVED`)
        .map((e) => ({
          ...e,
          id: e.id === `CRW-004` ? `CRW-042` : e.id,
          status: String(e.status) === `ELIMINATED` ? `ELIMINATED` : `ACTIVE`,
        })));
  } catch {}
  let t = P_.flatMap((e) =>
    Array.from(
      {
        length: 5,
      },
      (t, n) => ({
        id: `${e.prefix}-0${n + 1}`,
        name: [
          `Lost transmission`,
          `A loop in the system`,
          `Restore the power`,
          `Signal mismatch`,
          `Final diagnostic`,
        ][n],
        category: e.name,
        difficulty: n < 2 ? `EASY` : n < 4 ? `MEDIUM` : `HARD`,
        reward: n < 2 ? 100 : n < 4 ? 200 : 400,
        hintCost: 50,
        status: n === 1 ? `CLAIMED` : n === 4 ? `SOLVED` : `AVAILABLE`,
        claimedBy: n === 1 ? `CRW-001` : void 0,
        code: F_,
        objective: `The ship’s power monitor is reporting an incorrect total. Repair the loop so it sums every sensor reading: 6, 8, 10, and 18. Submit the single integer produced by the corrected program.`,
        answer: `42`,
        hint: `There are four readings, but the loop currently visits only three. Check its upper bound.`,
        hints: [],
      }),
    ),
  );
  try {
    let e = JSON.parse(localStorage.getItem(`debug-tasks`) || `null`);
    if (Array.isArray(e))
      for (let n of t) {
        let t = e.find((e) => e.id === n.id);
        t &&
          ((n.status = t.status),
          (n.claimedBy = t.claimedBy === `CRW-004` ? `CRW-042` : t.claimedBy));
      }
  } catch {}
  return {
    crews: e,
    tasks: t,
    round: 2,
    endsAt: Date.now() + 1800 * 1e3,
    pausedAt: null,
    activity: [
      `Round 02 is live. Welcome aboard, crews.`,
      `Engineering systems ready. Find the bugs.`,
    ],
  };
}
var R_ = ``.replace(/\/$/, ``),
  z_ = !R_,
  B_ = `among-bugs-competition-v1`,
  V_ = new Set(),
  H_ = U_();
function U_() {
  try {
    let e = localStorage.getItem(B_);
    if (e) return JSON.parse(e);
  } catch {}
  let e = L_();
  return (localStorage.setItem(B_, JSON.stringify(e)), e);
}
var W_ =
  typeof BroadcastChannel < `u`
    ? new BroadcastChannel(`among-bugs-competition`)
    : null;
function G_(e) {
  ((H_ = e),
    localStorage.setItem(B_, JSON.stringify(e)),
    V_.forEach((t) => t(e)),
    W_?.postMessage(`refresh`));
}
(W_?.addEventListener(`message`, () => {
  ((H_ = U_()), V_.forEach((e) => e(H_)));
}),
  window.addEventListener(`storage`, (e) => {
    e.key === B_ && ((H_ = U_()), V_.forEach((e) => e(H_)));
  }));
function K_() {
  return H_;
}
function q_(e) {
  return (
    V_.add(e),
    () => {
      V_.delete(e);
    }
  );
}
async function J_(e, t) {
  let n = await fetch(`${R_}${e}`, {
      method: t ? `POST` : `GET`,
      credentials: `include`,
      headers: t
        ? {
            "Content-Type": `application/json`,
          }
        : void 0,
      body: t ? JSON.stringify(t) : void 0,
    }),
    r = await n.json();
  if (!n.ok) throw Error(r.message || `Ship server unavailable. Try again.`);
  return r;
}
async function Y_(e, t) {
  if (!e.trim() || !t) throw Error(`Enter your registered team and password.`);
  if (!z_) {
    let n = await J_(`/auth/login`, {
      username: e,
      password: t,
    });
    return (n.state && G_(n.state), n.identity);
  }
  if (e.toUpperCase() === `COMMANDER`)
    return {
      crewId: `CRW-042`,
      role: `COMMANDER`,
    };
  let n = H_.crews.find(
    (t) =>
      t.name.toLowerCase() === e.toLowerCase() ||
      t.id.toLowerCase() === e.toLowerCase(),
  );
  if (!n)
    throw Error(
      `Demo crew: NEXORA. Demo commander: COMMANDER. Use any password.`,
    );
  return {
    crewId: n.id,
    role: `COMPETITOR`,
  };
}
async function X_() {
  if (!z_) {
    let e = await J_(`/competition`);
    G_(e.state || e);
  }
  return H_;
}
function Z_() {
  if (z_) return () => {};
  let e = new EventSource(`${R_}/competition/events`, {
    withCredentials: !0,
  });
  return (
    (e.onmessage = (e) => {
      try {
        let t = JSON.parse(e.data);
        G_(t.state || t);
      } catch {}
    }),
    () => e.close()
  );
}
async function Q_() {
  z_ || (await J_(`/auth/logout`, {}));
}
function $_(e, t) {
  return (
    [...e.crews]
      .sort((e, t) => t.coins - e.coins)
      .findIndex((e) => e.id === t) + 1
  );
}
function ev(e, t) {
  let n = [...e.crews]
      .filter((e) => e.status === `ACTIVE`)
      .sort((e, t) => t.coins - e.coins),
    r = n.findIndex((e) => e.id === t);
  return r < 0
    ? `DANGER`
    : r < Math.ceil(n.length * 0.25)
      ? `SAFE`
      : r >= n.length - Math.max(1, Math.floor(n.length * 0.25))
        ? `DANGER`
        : `UNCERTAIN`;
}
async function tv(e, t, n) {
  if (!z_) {
    let n = await J_(`/competition/actions`, {
      action: e,
      ...t,
    });
    return (n.state && G_(n.state), n);
  }
  let r = async () => {
    let r = U_(),
      i = r.crews.find((e) => e.id === n.crewId);
    if (!i) throw Error(`Crew not found.`);
    let a = r.tasks.find((e) => e.id === t.taskId);
    if (
      [
        `saveCrew`,
        `removeCrew`,
        `coins`,
        `eliminate`,
        `saveTask`,
        `disableTask`,
        `releaseImposter`,
        `pause`,
        `nextRound`,
        `announce`,
      ].includes(e) &&
      n.role !== `COMMANDER`
    )
      throw Error(`Command access required.`);
    let o = ``;
    if ([`claim`, `hint`, `submit`].includes(e) && i.status !== `ACTIVE`)
      throw Error(`Eliminated crews cannot repair systems.`);
    if (e === `claim`) {
      if (!a || a.status !== `AVAILABLE`)
        throw Error(`Too late. Another crew secured this task.`);
      if (a.imposter && Date.now() > (a.claimUntil || 0))
        throw Error(`The claim window has closed.`);
      ((a.status = `CLAIMED`),
        (a.claimedBy = i.id),
        a.imposter &&
          (a.solveUntil = Date.now() + (a.solveSeconds || 480) * 1e3),
        r.activity.unshift(`${i.name} secured ${a.id}.`));
    }
    if (e === `hint`) {
      if (!a || a.claimedBy !== i.id) throw Error(`Claim the task first.`);
      if (a.hints.includes(i.id))
        return {
          state: r,
          result: a.hint,
        };
      if (i.coins < a.hintCost) throw Error(`Not enough IdeaCoins.`);
      ((i.coins -= a.hintCost), a.hints.push(i.id), (o = a.hint || ``));
    }
    if (e === `submit`) {
      if (!a || a.claimedBy !== i.id || a.status !== `CLAIMED`)
        throw Error(`Task is unavailable or already solved.`);
      if (a.imposter && Date.now() > (a.solveUntil || 0))
        throw Error(`Imposter protocol time limit exceeded.`);
      if (String(t.answer).trim() !== a.answer)
        return {
          state: r,
          result: `INCORRECT`,
        };
      ((a.status = `SOLVED`),
        (i.coins += a.reward),
        i.tasks++,
        r.activity.unshift(
          `${i.name} repaired ${a.id}. +${a.reward} IdeaCoins.`,
        ),
        (o = `CORRECT`));
    }
    if (e === `run`) {
      if (!a || a.claimedBy !== i.id) throw Error(`Access denied.`);
      o = `> INITIALIZING...\n> COMPILING...\n> RUNNING DIAGNOSTIC...\n\nSYSTEM OUTPUT\n${/(?:<\s*4|<=\s*3|size\s*\(|sizeof|\b42\b)/.test(String(t.code)) ? `42` : `24`}\n\nPROCESS COMPLETE\n[Local diagnostic simulation · not a C++ compiler]`;
    }
    if (e === `saveCrew`) {
      let e = t.crew;
      if (e.members < 3 || e.members > 4 || e.coins < 0)
        throw Error(`Use 3–4 members and a nonnegative balance.`);
      if (!e.id) {
        let t =
          r.nextCrewNumber ||
          Math.max(
            0,
            ...r.crews.map((e) => Number(e.id.replace(`CRW-`, ``)) || 0),
          ) + 1;
        ((e.id = `CRW-${String(t).padStart(3, `0`)}`),
          (r.nextCrewNumber = t + 1));
      }
      let n = r.crews.findIndex((t) => t.id === e.id);
      n >= 0 ? (r.crews[n] = e) : r.crews.push(e);
    }
    if (
      (e === `removeCrew` &&
        (r.crews = r.crews.filter((e) => e.id !== t.crewId)),
      e === `coins`)
    ) {
      let e = r.crews.find((e) => e.id === t.crewId);
      e && (e.coins = Math.max(0, e.coins + Number(t.amount)));
    }
    if (e === `eliminate`) {
      let e = t.crewIds;
      r.crews.forEach((t) => {
        e.includes(t.id) && (t.status = `ELIMINATED`);
      });
    }
    if (e === `saveTask`) {
      let e = t.task;
      e.id ||= `${P_.find((t) => t.name === e.category)?.prefix || `TASK`}-${String(r.tasks.filter((t) => t.category === e.category && !t.imposter).length + 1).padStart(2, `0`)}`;
      let n = r.tasks.findIndex((t) => t.id === e.id);
      n >= 0 ? (r.tasks[n] = e) : r.tasks.push(e);
    }
    if (
      (e === `disableTask` &&
        a &&
        (a.status = a.status === `DISABLED` ? `AVAILABLE` : `DISABLED`),
      e === `releaseImposter`)
    ) {
      let e = t.task;
      ((e.id = `IMPOSTER-${String(r.tasks.filter((e) => e.imposter).length + 1).padStart(2, `0`)}`),
        r.tasks.forEach((e) => {
          e.imposter && e.status === `AVAILABLE` && (e.status = `DISABLED`);
        }),
        r.tasks.push({
          ...e,
          imposter: !0,
          status: `AVAILABLE`,
          claimUntil: Date.now() + Number(t.claimSeconds || 45) * 1e3,
          solveSeconds: Number(t.solveSeconds || 480),
        }),
        (r.imposterId = e.id),
        r.activity.unshift(
          `IMPOSTER DETECTED. Investigate the special problem.`,
        ));
    }
    if (
      (e === `pause` &&
        (r.pausedAt
          ? ((r.endsAt += Date.now() - r.pausedAt), (r.pausedAt = null))
          : (r.pausedAt = Date.now())),
      e === `nextRound` &&
        (r.round++,
        (r.endsAt = Date.now() + Number(t.seconds || 1800) * 1e3),
        (r.pausedAt = null)),
      e === `announce` && r.activity.unshift(String(t.message)),
      e === `resolveRound` && !r.pausedAt && Date.now() >= r.endsAt)
    ) {
      let e = [...r.crews]
          .filter((e) => e.status === `ACTIVE`)
          .sort((e, t) => t.coins - e.coins),
        t = e.slice(-Math.max(1, Math.floor(e.length * 0.25))).map((e) => e.id);
      (r.crews.forEach((e) => {
        t.includes(e.id) && (e.status = `ELIMINATED`);
      }),
        (r.roundResult = {
          round: r.round,
          eliminated: t,
        }),
        r.round++,
        (r.endsAt = Date.now() + 1800 * 1e3));
    }
    return (
      (r.activity = r.activity.slice(0, 30)),
      G_(r),
      {
        state: r,
        result: o,
      }
    );
  };
  if (navigator.locks) return navigator.locks.request(`among-bugs-state`, r);
  if (e === `claim`)
    throw Error(
      `Atomic demo claims require a browser with Web Locks, or a connected competition API.`,
    );
  return r();
}
var Y = `/workspaces/default/.publishing/src/app/ShipWorld.tsx`;
function nv(e) {
  let t = e / 1600;
  return P_.map((n, r) => ({
    id: `station-${r}`,
    label: `OPEN ${n.room}`,
    room: 2,
    x: 2 * e + [370, 800, 1230][r % 3] * t,
    y: r < 3 ? 568 : 650,
  }));
}
function rv(e) {
  return [
    {
      id: `command`,
      label: `ACCESS COMMAND CONSOLE`,
      room: 0,
      x: e * 0.5,
      y: 670,
    },
    {
      id: `manifest`,
      label: `VIEW CREW ACCESS CARD`,
      room: 1,
      x: e * 1.5,
      y: 580,
    },
    ...nv(e),
    {
      id: `rankings`,
      label: `VIEW CREW RANKINGS`,
      room: 3,
      x: e * 3.5,
      y: 665,
    },
  ];
}
function iv(e) {
  let t = e / 1600,
    n = (n, r, i, a, o) => ({
      x: n * e + r * t,
      y: i,
      width: a * t,
      height: o,
    });
  return [
    n(0, 380, 555, 840, 60),
    n(0, 470, 700, 180, 145),
    n(0, 950, 700, 180, 145),
    n(1, 260, 510, 330, 80),
    n(1, 1110, 750, 180, 90),
    n(3, 610, 700, 390, 50),
    ...P_.slice(3).map((e, t) =>
      n(2, [370, 800, 1230][t] - 110, 710, 220, 140),
    ),
  ];
}
function av({ x: e, y: t }) {
  return (
    <g>
      <circle
        cx={e}
        cy={t}
        r="5"
        fill="#0b1821"
        stroke="#506473"
        strokeWidth="2"
      />
      <path d={`M${e - 2} ${t - 2}l4 4`} stroke="#718391" />
    </g>
  );
}
function ov({
  x: e = 280,
  y: t = 190,
  width: n = 1040,
  height: r = 230,
  panorama: i = !1,
}) {
  return (
    <g>
      <defs>
        <clipPath id={`window-clip-${e}`}>
          <rect
            x={e + 9}
            y={t + 9}
            width={n - 18}
            height={r - 18}
            rx={i ? 64 : 27}
          />
        </clipPath>
      </defs>
      <rect
        x={e - 10}
        y={t - 10}
        width={n + 20}
        height={r + 20}
        rx={i ? 80 : 40}
        fill="#07101a"
        stroke="#07131d"
        strokeWidth="14"
      />
      <rect
        x={e}
        y={t}
        width={n}
        height={r}
        rx={i ? 70 : 32}
        fill="url(#space-window)"
        stroke="#536c7b"
        strokeWidth="7"
      />
      <rect
        x={e + 9}
        y={t + 9}
        width={n - 18}
        height={r - 18}
        rx={i ? 64 : 27}
        fill="none"
        stroke="#84c9c0"
        strokeOpacity=".32"
        strokeWidth="2"
      />
      <g clipPath={`url(#window-clip-${e})`}>
        <g data-parallax="stars">
          {Array.from(
            {
              length: 32,
            },
            (i, a) => (
              <circle
                cx={e + 28 + ((a * 79) % (n - 56))}
                cy={t + 25 + ((a * 47) % (r - 50))}
                r={a % 5 == 0 ? 2 : 1}
                fill="#d8e8f3"
                opacity={a % 3 == 0 ? 0.8 : 0.3}
              />
            ),
          )}
          <circle
            cx={e + n * 0.73}
            cy={t + r * 0.48}
            r={r * 0.33}
            fill="#253f55"
          />
          <path
            d={`M${e + n * 0.73 - r * 0.4} ${t + r * 0.48 + 20}q${r * 0.3} -38 ${r * 0.8} -22`}
            fill="none"
            stroke="#7f8db5"
            strokeWidth="10"
            opacity=".28"
          />
          <path
            d={`M${e + n * 0.74} ${t + 18}q-50 25 -30 ${r * 0.62}`}
            fill="none"
            stroke="#536c83"
            strokeWidth="15"
            opacity=".22"
          />
        </g>
      </g>
      {[0.25, 0.5, 0.75].map((i) => (
        <path
          d={`M${e + n * i} ${t + 2}v${r - 4}`}
          stroke="#435766"
          strokeWidth="10"
        />
      ))}
      <path
        d={`M${e + 20} ${t + 20}h${n * 0.43}l-90 ${r - 40}h-90Z`}
        fill="#9ce1df"
        opacity=".035"
      />
    </g>
  );
}
function sv({
  x: e,
  y: t,
  width: n = 120,
  color: r = `#8ae4cf`,
  text: i = `ONLINE`,
}) {
  return (
    <g>
      <rect
        x={e}
        y={t}
        width={n}
        height="72"
        rx="12"
        fill="#172631"
        stroke="#09141d"
        strokeWidth="6"
      />
      <rect
        x={e + 9}
        y={t + 9}
        width={n - 18}
        height="52"
        rx="5"
        fill="#092329"
        stroke={r}
        strokeOpacity=".3"
        strokeWidth="2"
      />
      <path
        d={`M${e + 18} ${t + 38}l12 -8 10 15 16 -23 13 13h${Math.max(5, n - 91)}`}
        stroke={r}
        strokeWidth="2"
        fill="none"
        className="animate-[monitor_4s_ease-in-out_infinite]"
      />
      <text
        x={e + n / 2}
        y={t + 55}
        fill={r}
        fontSize="7"
        textAnchor="middle"
        fontFamily="monospace"
        letterSpacing="2"
      >
        {i}
      </text>
    </g>
  );
}
function cv({ x: e, y: t, size: n = 110 }) {
  return (
    <g>
      <ellipse
        cx={e + n * 0.55}
        cy={t + n + 12}
        rx={n * 0.65}
        ry="13"
        fill="#04101a"
        opacity=".5"
      />
      <path
        d={`M${e} ${t + 15}l25 -15h${n - 10}v${n - 5}l-20 20h-${n - 5}Z`}
        fill="#394952"
        stroke="#0b1821"
        strokeWidth="7"
      />
      <path
        d={`M${e} ${t + 15}h${n - 5}v${n}h-${n - 5}Z`}
        fill="#58656a"
        stroke="#172b35"
        strokeWidth="5"
      />
      <path
        d={`M${e + n - 5} ${t + 15}l20 -15M${e + 15} ${t + 30}l${n - 36} ${n - 32}M${e + n - 20} ${t + 30}l-${n - 36} ${n - 32}`}
        stroke="#33464e"
        strokeWidth="9"
      />
      <rect
        x={e + n * 0.32}
        y={t + n * 0.48}
        width="37"
        height="22"
        rx="3"
        fill="#b99a64"
        stroke="#1c303b"
        strokeWidth="3"
      />
      <text
        x={e + n * 0.32 + 18}
        y={t + n * 0.48 + 15}
        fontSize="9"
        fill="#182a32"
        textAnchor="middle"
        fontFamily="monospace"
      >
        D+R
      </text>
    </g>
  );
}
function lv({ x: e, y: t }) {
  return (
    <g>
      <ellipse
        cx={e + 144}
        cy={t + 87}
        rx="160"
        ry="15"
        fill="#05141e"
        opacity=".5"
      />
      {[0, 95, 190].map((n) => (
        <g transform={`translate(${e + n} ${t})`}>
          <path
            d="M2 5Q2 -4 16 -4H61Q73 -4 75 8L83 58H0Z"
            fill="#4a696b"
            stroke="#0b1a23"
            strokeWidth="6"
          />
          <rect
            x="-4"
            y="46"
            width="92"
            height="34"
            rx="12"
            fill="#708e84"
            stroke="#0b1a23"
            strokeWidth="6"
          />
          <path
            d="M8 30H68M10 83v18M70 83v18"
            stroke="#263c44"
            strokeWidth="8"
          />
          <rect
            x="3"
            y="59"
            width="76"
            height="7"
            rx="3"
            fill="#9fba9a"
            opacity=".3"
          />
        </g>
      ))}
    </g>
  );
}
function uv({ index: e, active: t, state: n, onInteract: r }) {
  let i = P_[e],
    a = [370, 800, 1230][e % 3],
    o = e < 3 ? 345 : 675,
    s = n.tasks.filter((e) => e.category === i.name && !e.imposter),
    c = s.filter((e) => e.status === `AVAILABLE`).length,
    l = s.some((e) => e.status === `SOLVED` && e.claimedBy === `CRW-042`);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Approach ${i.name} station`}
      onClick={() => r(`station-${e}`)}
      onKeyDown={(t) => {
        t.key === `Enter` && r(`station-${e}`);
      }}
      className="cursor-pointer"
      transform={`translate(${a - 125} ${o - 100})`}
    >
      <ellipse
        cx="125"
        cy="202"
        rx="148"
        ry="17"
        fill="#04101a"
        opacity=".45"
      />
      {t && (
        <ellipse
          cx="125"
          cy="205"
          rx="160"
          ry="30"
          fill={i.color}
          opacity=".09"
        />
      )}
      <path
        d="M24 23L41 4H208L231 23V152L250 168V193H0V166L20 148Z"
        fill="#354b58"
        stroke="#0a1823"
        strokeWidth="8"
      />
      <path d="M45 10H207L215 27H38Z" fill={i.color} opacity={t ? 0.7 : 0.3} />
      <rect
        x="39"
        y="32"
        width="172"
        height="94"
        rx="12"
        fill="#061b25"
        stroke={t ? i.color : `#647783`}
        strokeWidth="5"
      />
      <rect
        x="48"
        y="40"
        width="154"
        height="76"
        rx="7"
        fill={t ? `#10363b` : `#0d262e`}
      />
      <text
        x="125"
        y="87"
        textAnchor="middle"
        fill={i.color}
        fontSize="37"
        fontWeight="700"
        fontFamily="monospace"
        className={t ? `animate-[monitor_2s_ease-in-out_infinite]` : ``}
      >
        {i.symbol}
      </text>
      <path
        d="M22 132H228L244 164H7Z"
        fill="#526879"
        stroke="#10212c"
        strokeWidth="5"
      />
      <path
        d="M42 147H103M116 147H157"
        stroke="#263d4c"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <circle cx="192" cy="148" r="7" fill={l ? `#8ae4cf` : i.color} />
      <circle cx="217" cy="148" r="5" fill="#ecbd73" />
      <rect x="60" y="173" width="132" height="17" rx="4" fill="#162e39" />
      <text
        x="125"
        y="185"
        textAnchor="middle"
        fontSize="8"
        fontFamily="monospace"
        letterSpacing="1"
        fill={i.color}
      >
        {l ? `✓ TASK COMPLETE` : `${c} SYSTEMS AVAILABLE`}
      </text>
      <text
        x="125"
        y={-19}
        textAnchor="middle"
        fontSize="13"
        fontFamily="Outfit, sans-serif"
        fontWeight="600"
        letterSpacing="1"
        fill="#d0dce3"
      >
        {i.name.toUpperCase()}
      </text>
      <text x="18" y="185" fill="#8095a3" fontSize="11" fontFamily="monospace">
        0{e + 1}
      </text>
      <av x={19} y={175} />
      <av x={231} y={175} />
    </g>
  );
}
function dv({ x: e, open: t, label: n }) {
  return (
    <g transform={`translate(${e - 70} 485)`}>
      <rect
        x="-15"
        y="-24"
        width="170"
        height="352"
        rx="29"
        fill="#0b1922"
        stroke="#061019"
        strokeWidth="10"
      />
      <rect
        x="-4"
        y="-12"
        width="149"
        height="321"
        rx="20"
        fill="#09151e"
        stroke={t ? `#8ae4cf` : `#506475`}
        strokeWidth="7"
      />
      <path
        d="M0 24V270M140 24V270"
        stroke={t ? `#8ae4cf` : `#5b8c90`}
        strokeWidth="5"
      />
      <hg.g
        animate={{
          y: t ? -230 : 0,
        }}
        transition={{
          duration: 0.45,
        }}
      >
        <path
          d="M12 0H128V291H12Z"
          fill="#405765"
          stroke="#102632"
          strokeWidth="7"
        />
        <path
          d="M23 17H117V274H23Z"
          fill="#2a424f"
          stroke="#6b7c86"
          strokeWidth="2"
        />
        <path
          d="M70 14V275M23 64H117M23 227H117"
          stroke="#132c39"
          strokeWidth="8"
        />
        <path
          d="M35 245l12 13M54 245l12 13M74 245l12 13M95 245l12 13"
          stroke="#e2b375"
          strokeWidth="6"
        />
        <rect
          x="59"
          y="125"
          width="22"
          height="45"
          rx="6"
          fill={t ? `#8ae4cf` : `#71989f`}
        />
      </hg.g>
      <rect
        x="0"
        y="-63"
        width="140"
        height="32"
        rx="8"
        fill="#1d333f"
        stroke="#081722"
        strokeWidth="4"
      />
      <text
        x="70"
        y="-43"
        textAnchor="middle"
        fill="#a7c2c8"
        fontFamily="monospace"
        fontSize="10"
        letterSpacing="2"
      >
        {n}
      </text>
      <path
        d="M-12 303H151L170 331H-32Z"
        fill="#2c414b"
        stroke="#101f29"
        strokeWidth="5"
      />
      {[0, 1, 2, 3, 4, 5].map((e) => (
        <path
          d={`M${e * 26 - 13} 314l13 13`}
          stroke="#d5a869"
          strokeWidth="7"
        />
      ))}
    </g>
  );
}
function fv({ index: e, children: t }) {
  return (
    <g>
      <rect width="1600" height="900" fill="#152733" />
      <rect y="100" width="1600" height="410" fill="url(#wall)" />
      <path d="M0 496H1600V890H0Z" fill="url(#deck-floor)" />
      <path
        d="M0 494H1600M0 514H1600M0 560H1600M0 650H1600M0 758H1600M0 880H1600"
        stroke="#0a1c28"
        strokeWidth="3"
      />
      {Array.from(
        {
          length: 13,
        },
        (e, t) => (
          <path
            d={`M${800 + (t - 6) * 108} 496L${800 + (t - 6) * 180} 900`}
            stroke="#182e3b"
            strokeWidth="3"
          />
        ),
      )}
      <path d="M0 510H1600" stroke="#627b85" strokeWidth="4" opacity=".5" />
      <rect y="862" width="1600" height="38" fill="#0c1b26" />
      <path d="M0 870H1600" stroke="#63707a" strokeWidth="3" />
      {[125, 1455].map((e) => (
        <g>
          <path d={`M${e} 111v365`} stroke="#091923" strokeWidth="37" />
          <path d={`M${e} 112v365`} stroke="#3d5563" strokeWidth="22" />
          <path d={`M${e - 8} 137v311`} stroke="#637888" strokeWidth="3" />
          {[165, 270, 380, 455].map((t) => (
            <av x={e} y={t} />
          ))}
        </g>
      ))}
      <path d="M160 135H1410" stroke="#071722" strokeWidth="30" />
      <path d="M160 135H1410" stroke="#47616b" strokeWidth="16" />
      <path d="M175 132H1390" stroke="#6f8487" strokeWidth="3" />
      {[360, 780, 1200].map((e) => (
        <g>
          <rect
            x={e - 60}
            y="119"
            width="145"
            height="28"
            rx="12"
            fill="#0b1d27"
            stroke="#1e3d48"
            strokeWidth="5"
          />
          <rect
            x={e - 51}
            y="128"
            width="126"
            height="9"
            rx="4"
            fill="#b0e0ce"
            className="animate-[monitor_8s_ease-in-out_infinite]"
          />
          <path
            d={`M${e - 54} 150l-50 185h220l-49 -185Z`}
            fill="#c0e9d6"
            opacity=".025"
          />
        </g>
      ))}
      {t}
      <g opacity=".8">
        <rect
          x="186"
          y="432"
          width="83"
          height="54"
          rx="9"
          fill="#1a303b"
          stroke="#0b1b26"
          strokeWidth="5"
        />
        {[0, 1, 2, 3, 4].map((e) => (
          <path d={`M198 ${442 + e * 8}h60`} stroke="#5d7279" strokeWidth="3" />
        ))}
        <path
          d="M237 438q-12 -15 4 -25t0 -23"
          stroke="#bfdcd6"
          strokeWidth="8"
          fill="none"
          opacity=".1"
          className="animate-[steam_4s_ease-out_infinite]"
        />
      </g>
      <text
        x="1525"
        y="854"
        textAnchor="end"
        fill="#59717e"
        fontSize="12"
        fontFamily="monospace"
        letterSpacing="2"
      >
        {`DECK `}
        {String(e).padStart(2, `0`)}
        {` / D+R`}
      </text>
    </g>
  );
}
function pv({ crew: e, state: t, onInteract: n }) {
  return (
    <>
      <ov x={315} y={192} width={970} height={200} />
      <g>
        <rect
          x="524"
          y="217"
          width="552"
          height="124"
          rx="18"
          fill="#152c34"
          stroke="#061923"
          strokeWidth="6"
        />
        <text
          x="800"
          y="264"
          textAnchor="middle"
          fill="#e4efdb"
          fontSize="37"
          fontFamily="Chakra Petch, sans-serif"
          fontWeight="700"
          letterSpacing="6"
        >
          WELCOME, CREW.
        </text>
        <text
          x="800"
          y="298"
          textAnchor="middle"
          fill="#8ae4cf"
          fontFamily="monospace"
          fontSize="17"
          letterSpacing="4"
        >
          {e.id}
          {` / TEAM `}
          {e.name}
        </text>
        <path d="M635 317H965" stroke="#496b66" strokeWidth="2" />
      </g>
      <text
        x="225"
        y="370"
        textAnchor="middle"
        fill="#93a6b2"
        fontFamily="monospace"
        fontSize="10"
        letterSpacing="3"
      >
        ← COMMAND
      </text>
      <text
        x="1380"
        y="370"
        textAnchor="middle"
        fill="#a1cfb6"
        fontFamily="monospace"
        fontSize="10"
        letterSpacing="3"
      >
        TASK DECK →
      </text>
      <lv x={285} y={480} />
      <lv x={1005} y={430} />
      <sv x={1370} y={246} width={100} text="O₂ NORMAL" />
      <sv x={133} y={246} width={106} text="ADMIN ONLY" color="#e2ba80" />
      <g
        role="button"
        tabIndex={0}
        aria-label="Approach crew manifest"
        onClick={() => n(`manifest`)}
        onKeyDown={(e) => {
          e.key === `Enter` && n(`manifest`);
        }}
        className="cursor-pointer"
        transform="translate(645 399)"
      >
        <path
          d="M0 65L25 0H277L302 65V106H0Z"
          fill="#496570"
          stroke="#091c27"
          strokeWidth="7"
        />
        <path
          d="M16 61H283L267 16H33Z"
          fill="#34525d"
          stroke="#7f9595"
          strokeWidth="3"
        />
        <rect
          x="64"
          y="24"
          width="172"
          height="27"
          rx="7"
          fill="#15333b"
          stroke="#61948f"
          strokeWidth="2"
        />
        <text
          x="150"
          y="43"
          textAnchor="middle"
          fill="#b6d5c6"
          fontSize="10"
          fontFamily="monospace"
          letterSpacing="3"
        >
          CREW MANIFEST
        </text>
        <circle cx="280" cy="88" r="5" fill="#8ae4cf" />
        <path d="M30 86H66M83 86H120" stroke="#9cafaa" strokeWidth="5" />
      </g>
      <cv x={1125} y={683} />
      <cv x={1210} y={739} size={75} />
      <g transform="translate(353 685)">
        <ellipse cx="0" cy="78" rx="27" ry="11" fill="#06141d" opacity=".5" />
        <path
          d="M-5 70V30M-5 46L-25 28M-4 34L13 13"
          stroke="#70866f"
          strokeWidth="7"
        />
        <ellipse
          cx="-27"
          cy="24"
          rx="19"
          ry="10"
          fill="#638c76"
          transform="rotate(32 -27 24)"
        />
        <ellipse cx="17" cy="13" rx="16" ry="11" fill="#7caa84" />
        <path
          d="M-28 58H24L15 88H-20Z"
          fill="#ad8468"
          stroke="#162936"
          strokeWidth="5"
        />
      </g>
      <path d="M595 748H1005L982 819H616Z" fill="#426068" opacity=".3" />
      <path
        d="M621 759H977M627 773H968M633 787H961M640 802H951"
        stroke="#7f9b9b"
        strokeWidth="2"
        opacity=".15"
      />
      <text
        x="802"
        y="806"
        textAnchor="middle"
        fill="#6e9495"
        opacity=".6"
        fontFamily="Chakra Petch, sans-serif"
        fontSize="16"
        fontWeight="700"
        letterSpacing="7"
      >
        IDEA LAB • SGSITS
      </text>
      {t.crews
        .filter((t) => t.id !== e.id)
        .slice(0, 2)
        .map((e, t) => (
          <g
            transform={`translate(${t === 0 ? 460 : 1050} ${t === 0 ? 598 : 535})`}
          >
            <N_ color={e.color} size={64} state="idle" />
            <text
              x="35"
              y="90"
              textAnchor="middle"
              fill="#8caaaa"
              fontSize="8"
              fontFamily="monospace"
              letterSpacing="2"
            >
              {e.name}
            </text>
          </g>
        ))}
    </>
  );
}
function mv({ active: e, onInteract: t }) {
  return (
    <>
      <ov x={210} y={180} width={1180} height={260} panorama={!0} />
      <text
        x="800"
        y="222"
        textAnchor="middle"
        fontFamily="Chakra Petch, sans-serif"
        fontSize="24"
        fill="#bdd9d8"
        fontWeight="700"
        letterSpacing="9"
      >
        COMMAND BRIDGE
      </text>
      <g
        role="button"
        tabIndex={0}
        aria-label="Approach command control panel"
        onClick={() => t(`command`)}
        onKeyDown={(e) => {
          e.key === `Enter` && t(`command`);
        }}
        className="cursor-pointer"
      >
        <path
          d="M380 550L445 411H1155L1220 550V602H380Z"
          fill="#385562"
          stroke="#081b27"
          strokeWidth="9"
        />
        <path
          d="M394 549L455 425H1145L1205 549Z"
          fill="#4a6975"
          stroke="#799796"
          strokeWidth="3"
        />
        <sv x={475} y={445} width={170} text="SHIP TELEMETRY" />
        <sv x={955} y={445} width={170} text="ROUND CONTROL" color="#e2b879" />
        <g transform="translate(800 485)">
          <ellipse
            rx="100"
            ry="53"
            fill="#0c343b"
            stroke={e ? `#8ae4cf` : `#567c82`}
            strokeWidth="4"
          />
          <ellipse
            rx="77"
            ry="39"
            fill="none"
            stroke="#6baa9f"
            strokeWidth="2"
          />
          <ellipse
            rx="46"
            ry="24"
            fill="none"
            stroke="#6baa9f"
            strokeWidth="2"
          />
          <path d="M-75 0H75M0 -42V42" stroke="#638d8a" />
          {[
            [-34, 10],
            [28, -8],
            [60, 5],
            [-18, -25],
          ].map(([e, t], n) => (
            <circle
              cx={e}
              cy={t}
              r="5"
              fill={n === 2 ? `#eaaa82` : `#8ae4cf`}
            />
          ))}
        </g>
        <text
          x="800"
          y="578"
          textAnchor="middle"
          fontFamily="monospace"
          fontSize="12"
          letterSpacing="4"
          fill={e ? `#8ae4cf` : `#a5b6bc`}
        >
          COMMAND CONTROL PANEL
        </text>
      </g>
      <lv x={490} y={715} />
      <lv x={960} y={715} />
      <text
        x="190"
        y="480"
        fontFamily="monospace"
        fontSize="10"
        fill="#a3bbc1"
        letterSpacing="2"
      >
        AUTHORIZED CREW ONLY
      </text>
    </>
  );
}
function hv({ state: e, crew: t, active: n, onInteract: r }) {
  let i = [...e.crews].sort((e, t) => t.coins - e.coins);
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label="Approach rankings hologram"
      onClick={() => r(`rankings`)}
      onKeyDown={(e) => {
        e.key === `Enter` && r(`rankings`);
      }}
      className="cursor-pointer"
    >
      <ov x={245} y={178} width={1110} height={215} />
      <path
        d="M465 635L590 265H1000L1130 635Z"
        fill="#8adbd4"
        opacity={n ? 0.065 : 0.035}
      />
      <rect
        x="432"
        y="225"
        width="736"
        height="388"
        rx="24"
        fill="#0e333c"
        fillOpacity=".91"
        stroke="#72bdb6"
        strokeWidth={n ? 5 : 3}
      />
      <text
        x="800"
        y="274"
        textAnchor="middle"
        fontSize="29"
        fontFamily="Chakra Petch, sans-serif"
        fontWeight="700"
        letterSpacing="7"
        fill="#b4f0df"
      >
        CREW RANKINGS
      </text>
      <path d="M475 294H1125" stroke="#4b8b8e" strokeWidth="2" />
      {i.slice(0, 5).map((e, n) => (
        <hg.g
          animate={{
            y: n * 52,
          }}
          transition={{
            duration: 0.5,
          }}
          transform="translate(0 0)"
        >
          {e.id === t.id && (
            <rect
              x="474"
              y="308"
              width="649"
              height="46"
              rx="8"
              fill="#75cfbd"
              opacity=".12"
            />
          )}
          <text
            x="495"
            y="337"
            fontSize="16"
            fill="#7dabae"
            fontFamily="monospace"
          >
            0{n + 1}
          </text>
          <g transform="translate(540 310)">
            <N_ color={e.color} size={29} state="still" />
          </g>
          <text
            x="586"
            y="334"
            fontSize="13"
            fill="#93c7c6"
            fontFamily="monospace"
          >
            {e.id}
          </text>
          <text
            x="729"
            y="335"
            fontSize="16"
            fontWeight="600"
            fill="#c6e6df"
            fontFamily="Outfit, sans-serif"
          >
            {e.name}
          </text>
          <text
            x="1085"
            y="336"
            textAnchor="end"
            fontSize="17"
            fontFamily="monospace"
            fill="#b5e2d4"
          >
            {e.coins.toLocaleString()}
          </text>
        </hg.g>
      ))}
      <text
        x="800"
        y="592"
        textAnchor="middle"
        fontFamily="monospace"
        fontSize="10"
        letterSpacing="3"
        fill="#72b4b5"
      >
        LIVE CREW TELEMETRY · APPROACH TO EXPAND
      </text>
      <path
        d="M635 681H970L1000 725H610Z"
        fill="#537783"
        stroke="#0a1a28"
        strokeWidth="7"
      />
      <rect
        x="664"
        y="682"
        width="274"
        height="23"
        rx="7"
        fill="#89d1c3"
        opacity=".3"
      />
      <path
        d="M677 720l23 -106M923 720l-24 -106"
        stroke="#6fc4c1"
        strokeWidth="4"
        opacity=".4"
      />
      <cv x={1245} y={715} size={90} />
      <lv x={255} y={723} />
    </g>
  );
}
var gv = (0, x.memo)(
    (0, x.forwardRef)(function (
      {
        width: e,
        roomWidth: t,
        state: n,
        crew: r,
        near: i,
        onInteract: a,
        playerRef: o,
        walkingRef: s,
        doorOpen: c,
      },
      l,
    ) {
      return (
        <svg
          viewBox={`0 0 ${e} 900`}
          preserveAspectRatio="none"
          className="h-full w-full select-none"
          aria-label="Playable spaceship: command bridge, lobby, task deck, rankings"
        >
          <defs>
            <linearGradient id="wall" x2="0" y2="1">
              <stop stopColor="#203642" />
              <stop offset="1" stopColor="#304651" />
            </linearGradient>
            <linearGradient id="deck-floor" x2="0" y2="1">
              <stop stopColor="#3b515d" />
              <stop offset="1" stopColor="#273e4b" />
            </linearGradient>
            <linearGradient id="space-window" x2="1" y2="1">
              <stop stopColor="#10232c" />
              <stop offset="1" stopColor="#081522" />
            </linearGradient>
          </defs>
          <g ref={l}>
            {[0, 1, 2, 3].map((e) => (
              <g transform={`translate(${e * t} 0) scale(${t / 1600} 1)`}>
                <fv index={e}>
                  {e === 0 ? (
                    <mv active={i === `command`} onInteract={a} />
                  ) : e === 1 ? (
                    <pv crew={r} state={n} onInteract={a} />
                  ) : e === 2 ? (
                    <>
                      <text
                        x="800"
                        y="209"
                        textAnchor="middle"
                        fontSize="31"
                        fontFamily="Chakra Petch, sans-serif"
                        fontWeight="700"
                        letterSpacing="7"
                        fill="#e6ece0"
                      >
                        CREW TASKS
                      </text>
                      <text
                        x="800"
                        y="238"
                        textAnchor="middle"
                        fontSize="10"
                        fontFamily="monospace"
                        letterSpacing="4"
                        fill="#9ab7b8"
                      >
                        FIX BUGS. COMPLETE TASKS. SURVIVE.
                      </text>
                      {P_.map((e, t) => (
                        <uv
                          index={t}
                          active={i === `station-${t}`}
                          state={n}
                          onInteract={a}
                        />
                      ))}
                    </>
                  ) : (
                    <hv
                      state={n}
                      crew={r}
                      active={i === `rankings`}
                      onInteract={a}
                    />
                  )}
                </fv>
              </g>
            ))}
            {[1, 2, 3].map((e) => (
              <dv
                x={e * t}
                open={c.includes(e)}
                label={[``, `COMMAND / LOBBY`, `TASK DECK`, `CREW RANKINGS`][e]}
              />
            ))}
            <g ref={o}>
              <ellipse
                cx="0"
                cy="0"
                rx="38"
                ry="11"
                fill="#03101a"
                opacity=".4"
              />
              <g ref={s}>
                <g transform="translate(-44 -103)">
                  <N_ color={r.color} size={88} state="still" />
                </g>
              </g>
              <path d="M-5 -122L0 -116L5 -122" fill="#b3efd8" />
              <rect
                x="-46"
                y="17"
                width="92"
                height="22"
                rx="6"
                fill="#0b1e2c"
                fillOpacity=".85"
                stroke="#77c8c4"
                strokeOpacity=".3"
              />
              <text
                x="0"
                y="32"
                textAnchor="middle"
                fill="#c4e9de"
                fontSize="11"
                fontFamily="monospace"
              >
                {r.id}
              </text>
            </g>
          </g>
        </svg>
      );
    }),
  ),
  X = `/workspaces/default/.publishing/src/app/App.tsx`,
  _v = [`COMMAND BRIDGE`, `MAIN LOBBY`, `TASK DECK`, `CREW RANKINGS`],
  vv = [
    `The captain’s seat comes with responsibility.`,
    `Your adventure starts here. Make yourself at home.`,
    `A broken system is an opportunity in disguise.`,
    `Every repair brings your crew closer to the stars.`,
  ],
  yv = `w-full rounded-lg border-2 border-[#344c5b] bg-[#101e2a] px-3 py-3 text-sm text-[#e4eee8] outline-none focus:border-primary`;
function bv({
  children: e,
  onClick: t,
  secondary: n = !1,
  danger: r = !1,
  disabled: i = !1,
  type: a = `button`,
  className: o = ``,
}) {
  return (
    <button
      type={a}
      disabled={i}
      onClick={t}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border-2 px-5 py-3 font-display text-xs font-bold tracking-wide shadow-[0_4px_0_#07141d] transition hover:-translate-y-0.5 active:translate-y-[3px] active:shadow-none disabled:cursor-not-allowed disabled:opacity-40 ${r ? `border-[#bf5b5e] bg-[#71343d] text-[#ffd8c7]` : n ? `border-[#52717e] bg-[#2d4654] text-[#d6e1e1]` : `border-[#b3f3d9] bg-[#8ae4cf] text-[#14342f]`} ${o}`}
    >
      {e}
    </button>
  );
}
function xv({ size: e = 18 }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-[#f2d78b] bg-[#9b7436] text-[#ffedb2] shadow-[inset_0_0_0_2px_#be954b]"
      style={{
        width: e,
        height: e,
      }}
    >
      <Jg size={e * 0.65} />
    </span>
  );
}
function Z({ children: e, className: t = `` }) {
  return (
    <div
      className={`font-mono text-[9px] font-medium tracking-[.16em] text-[#9fb8bf] ${t}`}
    >
      {e}
    </div>
  );
}
function Sv({ seconds: e, className: t = `` }) {
  return (
    <span
      className={`font-mono font-semibold tabular-nums ${e < 60 ? `text-[#f49386]` : e < 300 ? `text-[#ebd68c]` : `text-[#d8ede3]`} ${t}`}
    >
      {Math.floor(e / 60)
        .toString()
        .padStart(2, `0`)}
      <span className="opacity-50">:</span>
      {(e % 60).toString().padStart(2, `0`)}
    </span>
  );
}
function Cv({ label: e, children: t }) {
  return (
    <label className="mb-4 block">
      <span className="mb-2 block font-mono text-[9px] tracking-widest text-[#b3c4c8]">
        {e}
      </span>
      {t}
    </label>
  );
}
function wv({ children: e }) {
  let t = [`SAFE`, `AVAILABLE`, `SOLVED`, `CORRECT`, `GRANTED`].some((t) =>
      e.includes(t),
    ),
    n = [`DANGER`, `HARD`, `DENIED`, `DISABLED`].some((t) => e.includes(t));
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 font-mono text-[9px] tracking-wider ${t ? `border-primary/25 bg-primary/10 text-primary` : n ? `border-[#ee9582]/25 bg-[#ee9582]/10 text-[#ee9582]` : `border-[#e5ce90]/25 bg-[#e5ce90]/10 text-[#e5ce90]`}`}
    >
      <span className="h-1 w-1 rounded-full bg-current" />
      {e}
    </span>
  );
}
function Tv() {
  return (
    <div className="flex items-center gap-2">
      <Jg size={24} className="text-[#e5cf8f]" />
      <div>
        <div className="font-display text-sm font-bold tracking-[.1em]">
          IDEA LAB
        </div>
        <div className="font-mono text-[7px] tracking-widest text-[#9ab2b8]">
          SGSITS INDORE
        </div>
      </div>
    </div>
  );
}
function Ev({ crew: e, identity: t, small: n = !1 }) {
  let r = t.role === `COMMANDER`;
  return (
    <div
      className={`relative overflow-hidden rounded-xl border-[3px] ${r ? `border-[#dfbd77] bg-[#37414b]` : `border-[#91d7ca] bg-[#21424c]`} p-5 shadow-[0_10px_0_#061823] ${n ? `max-w-[290px]` : `mx-auto max-w-[380px]`}`}
    >
      <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full border-[20px] border-white/[.025]" />
      <div className="flex items-center justify-between">
        <Tv />
        <span className="font-display text-[10px] font-bold text-[#afd2cc]">
          DEBUG + RUN
        </span>
      </div>
      <div className="my-3 border-t border-white/15" />
      <Z className={r ? `!text-[#e5cf8f]` : `!text-primary`}>
        {r ? `ADMIN COMMAND CARD` : `CREW ACCESS CARD`}
      </Z>
      <div className="my-4 flex items-center gap-4">
        <N_ color={e.color} accessory={r} size={n ? 58 : 84} state="still" />
        <div>
          <Z>TEAM</Z>
          <div className="mt-1 font-display text-xl font-bold">{e.name}</div>
          <Z className="mt-2">CREW ID</Z>
          <div className="mt-1 font-mono text-xl text-[#abe9df]">{e.id}</div>
        </div>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div>
          <Z>ACCESS LEVEL</Z>
          <span className="mt-1 block font-mono text-[10px] text-[#e5cf8f]">
            {t.role}
          </span>
        </div>
        <div
          className="flex h-24 max-h-9 items-stretch gap-[2px]"
          aria-label="Crew identification barcode"
        >
          {Array.from(
            {
              length: 30,
            },
            (e, t) => (
              <span
                className="bg-[#c6e5d9]/70"
                style={{
                  width: t % 3 == 0 ? 3 : 1,
                }}
              />
            ),
          )}
        </div>
      </div>
      <div className="mt-4 flex justify-between font-mono text-[7px] tracking-widest text-[#90b5b3]">
        <span>ONE CREW. ONE IDENTITY.</span>
        <span>IL / 042</span>
      </div>
    </div>
  );
}
function Dv() {
  return (
    <svg
      viewBox="0 0 360 160"
      className="h-full w-full animate-[float_8s_ease-in-out_infinite]"
      aria-hidden="true"
    >
      <path
        d="M70 53L22 22L29 100L78 112M89 110L69 146L216 118"
        fill="#324b5d"
        stroke="#091a25"
        strokeWidth="6"
      />
      <path
        d="M59 55H235L330 88L273 116H83L54 91Z"
        fill="#66848e"
        stroke="#0b1b27"
        strokeWidth="7"
      />
      <path
        d="M139 53L173 16H229L257 60"
        fill="#789493"
        stroke="#0b1b27"
        strokeWidth="6"
      />
      <path d="M182 25H224L239 48H161Z" fill="#a5e8d5" />
      <path d="M88 67H242M99 102H265" stroke="#bad5bd" strokeWidth="3" />
      {[104, 137, 170, 203, 236].map((e) => (
        <rect
          x={e}
          y="77"
          width="19"
          height="14"
          rx="5"
          fill="#1c5159"
          stroke="#0e2733"
          strokeWidth="3"
        />
      ))}
      <path d="M274 75L308 88L273 103" fill="#a5e8d5" />
      <path d="M53 65L2 82L53 98" fill="#a5e8d5" opacity=".4" />
      <rect
        x="47"
        y="65"
        width="15"
        height="32"
        rx="6"
        fill="#365769"
        stroke="#102735"
        strokeWidth="3"
      />
    </svg>
  );
}
function Ov() {
  let [e, t] = (0, x.useState)(K_),
    [n, r] = (0, x.useState)(() => {
      try {
        return JSON.parse(
          localStorage.getItem(`among-bugs-identity`) || `null`,
        );
      } catch {
        return null;
      }
    }),
    [i, a] = (0, x.useState)(() => (n ? `ship` : `login`)),
    [o, s] = (0, x.useState)(null),
    [c, l] = (0, x.useState)(``),
    [u, d] = (0, x.useState)(!1),
    [f, p] = (0, x.useState)(!0),
    [m, h] = (0, x.useState)(null),
    [g, _] = (0, x.useState)(1),
    [v, y] = (0, x.useState)([]),
    [b, S] = (0, x.useState)(!1),
    [C, w] = (0, x.useState)(Date.now()),
    [T, E] = (0, x.useState)({
      width: window.innerWidth,
      height: window.innerHeight,
    }),
    [ee, D] = (0, x.useState)(`NEXORA`),
    [te, O] = (0, x.useState)(``),
    [k, A] = (0, x.useState)(``),
    [j, M] = (0, x.useState)(`READY`),
    [ne, re] = (0, x.useState)(3),
    [ie, ae] = (0, x.useState)(() =>
      localStorage.getItem(`among-bugs-active-task`),
    ),
    [oe, se] = (0, x.useState)(null),
    [ce, le] = (0, x.useState)(`CREW`),
    [ue, de] = (0, x.useState)(null),
    [fe, pe] = (0, x.useState)(null),
    [me, he] = (0, x.useState)(null),
    [ge, _e] = (0, x.useState)(null),
    N = (900 * T.width) / T.height,
    ve = Math.max(1100, N),
    ye = (0, x.useRef)(null),
    be = (0, x.useRef)(null),
    xe = (0, x.useRef)(null),
    P = (0, x.useRef)(null),
    Se = (0, x.useRef)({
      x: ve * 1.5,
      y: 690,
    }),
    Ce = (0, x.useRef)(ve * 1.5 - N * 0.5),
    we = (0, x.useRef)({
      x: 0,
      y: 0,
    }),
    F = (0, x.useRef)(new Set()),
    Te = (0, x.useRef)(0),
    Ee = (0, x.useRef)(null),
    De = (0, x.useRef)(!0),
    Oe = (0, x.useRef)(null),
    ke = (0, x.useRef)(1),
    Ae = (0, x.useRef)(1),
    je = (0, x.useRef)(f),
    Me = (0, x.useRef)(null),
    Ne = (0, x.useRef)(ve),
    Pe = (0, x.useRef)(null),
    Fe = (0, x.useRef)(0),
    Ie = e.crews.find((e) => e.id === `CRW-042`) || e.crews[0],
    I = e.crews.find((e) => e.id === n?.crewId) || Ie,
    Le = n?.role || `COMPETITOR`,
    Re = Math.max(0, Math.ceil((e.endsAt - (e.pausedAt || C)) / 1e3)),
    ze = ev(e, I.id),
    Be = $_(e, I.id),
    Ve = e.tasks.find((t) => t.id === e.imposterId),
    He = e.tasks.find((e) => e.id === ie);
  De.current =
    i !== `ship` ||
    !!o ||
    (Re === 0 && !e.pausedAt) ||
    (I.status === `ELIMINATED` && Le === `COMPETITOR`);
  let Ue = (0, x.useRef)(null);
  ((Ue.current = o?.type || null), (je.current = f));
  let We = (0, x.useCallback)((e) => {
    (l(e),
      Me.current && clearTimeout(Me.current),
      (Me.current = setTimeout(() => l(``), 3800)));
  }, []);
  function Ge(e = 440) {
    if (!je.current)
      try {
        let t = new AudioContext(),
          n = t.createOscillator(),
          r = t.createGain();
        (n.connect(r),
          r.connect(t.destination),
          (r.gain.value = 0.025),
          (n.frequency.value = e),
          r.gain.exponentialRampToValueAtTime(0.001, t.currentTime + 0.14),
          n.start(),
          n.stop(t.currentTime + 0.15),
          (n.onended = () => {
            t.close();
          }));
      } catch {}
  }
  ((0, x.useEffect)(() => q_(t), []),
    (0, x.useEffect)(() => {
      let e = setInterval(() => w(Date.now()), 250),
        t = () =>
          E({
            width: window.innerWidth,
            height: window.innerHeight,
          });
      return (
        window.addEventListener(`resize`, t),
        () => {
          (clearInterval(e), window.removeEventListener(`resize`, t));
        }
      );
    }, []),
    (0, x.useEffect)(() => {
      if (!n || z_) return;
      X_().catch((e) => We(e.message));
      let e = Z_(),
        t = setInterval(() => {
          X_().catch((e) => We(e.message));
        }, 3e3);
      return () => {
        (clearInterval(t), e());
      };
    }, [n, We]),
    (0, x.useEffect)(() => {
      n
        ? localStorage.setItem(`among-bugs-identity`, JSON.stringify(n))
        : localStorage.removeItem(`among-bugs-identity`);
    }, [n]),
    (0, x.useEffect)(() => {
      ie
        ? localStorage.setItem(`among-bugs-active-task`, ie)
        : localStorage.removeItem(`among-bugs-active-task`);
    }, [ie]),
    (0, x.useEffect)(() => {
      ((Se.current.x = (Se.current.x / Ne.current) * ve),
        (Ce.current = Se.current.x - N * 0.5),
        (Ne.current = ve));
    }, [ve, N]),
    (0, x.useEffect)(() => {
      if (
        !(!n || i !== `ship`) &&
        Re === 0 &&
        !e.pausedAt &&
        (s({
          type: `checking`,
        }),
        z_)
      ) {
        let e = setTimeout(() => {
          tv(`resolveRound`, {}, n).catch((e) => We(e.message));
        }, 1400);
        return () => clearTimeout(e);
      }
    }, [Re, e.pausedAt, n, i, We]),
    (0, x.useEffect)(() => {
      !n ||
        !e.roundResult ||
        (localStorage.getItem(`among-bugs-seen-round-${n.crewId}`) !==
          String(e.roundResult.round) &&
          (localStorage.setItem(
            `among-bugs-seen-round-${n.crewId}`,
            String(e.roundResult.round),
          ),
          s({
            type: e.roundResult.eliminated.includes(n.crewId)
              ? `ejected`
              : `survived`,
          })));
    }, [e.roundResult, n]),
    (0, x.useEffect)(
      () => () => {
        (Me.current && clearTimeout(Me.current),
          Pe.current && clearTimeout(Pe.current));
      },
      [],
    ));
  async function Ke(e, t = {}) {
    if (!n) throw Error(`Log in to access ship systems.`);
    return tv(e, t, n);
  }
  async function qe(e, t = {}, n = `Ship systems updated.`) {
    d(!0);
    try {
      return (await Ke(e, t), We(n), Ge(660), !0);
    } catch (e) {
      return (We(e.message), !1);
    } finally {
      d(!1);
    }
  }
  function Je(e) {
    if ((Ge(550), e === `command`))
      (M(`READY`),
        s({
          type: `scan`,
        }));
    else if (e === `manifest`)
      s({
        type: `card`,
      });
    else if (e === `rankings`)
      s({
        type: `rankings`,
      });
    else if (e.startsWith(`station-`)) {
      let t = Number(e.split(`-`)[1]);
      (re(t),
        s({
          type: `tasks`,
          category: t,
        }));
    }
  }
  function Ye(e) {
    if (De.current) return;
    let t = rv(ve).find((t) => t.id === e);
    if (t) {
      if (Math.hypot(Se.current.x - t.x, (Se.current.y - t.y) * 1.1) < 145) {
        Je(e);
        return;
      }
      ((Ee.current = {
        object: t,
        stage: 0,
      }),
        We(`Walking to ${t.label.toLowerCase()}…`));
    }
  }
  let Xe = (0, x.useRef)(() => {}),
    Ze = (0, x.useRef)(Ye);
  Ze.current = Ye;
  let Qe = (0, x.useCallback)((e) => Ze.current(e), []);
  ((Xe.current = () => {
    i !== `ship` ||
      o ||
      (Oe.current
        ? Je(Oe.current)
        : We(`Walk closer to a glowing station, console, or crew manifest.`));
  }),
    (0, x.useEffect)(() => {
      if (!o && !ge) return;
      let e = document.activeElement,
        t = requestAnimationFrame(() => {
          (
            document.querySelector(`[role="alertdialog"]`) ||
            document.querySelector(`[role="dialog"]`)
          )
            ?.querySelector(`button`)
            ?.focus();
        }),
        n = (e) => {
          if (e.key !== `Tab`) return;
          let t =
            document.querySelector(`[role="alertdialog"]`) ||
            document.querySelector(`[role="dialog"]`);
          if (!t) return;
          let n = Array.from(
              t.querySelectorAll(
                `button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex="0"]`,
              ),
            ).filter((e) => e.getClientRects().length > 0),
            r = n[0],
            i = n[n.length - 1];
          r &&
            (e.shiftKey &&
            (document.activeElement === r ||
              !t.contains(document.activeElement))
              ? (e.preventDefault(), i.focus())
              : !e.shiftKey &&
                document.activeElement === i &&
                (e.preventDefault(), r.focus()));
        };
      return (
        document.addEventListener(`keydown`, n),
        () => {
          (cancelAnimationFrame(t),
            document.removeEventListener(`keydown`, n),
            e?.isConnected && e.focus?.());
        }
      );
    }, [o?.type, ge?.title]),
    (0, x.useEffect)(() => {
      let e = (e) => {
          let t = e.target;
          if ([`INPUT`, `TEXTAREA`, `SELECT`].includes(t.tagName)) return;
          let n = e.key.toLowerCase();
          (!De.current &&
            [
              `arrowleft`,
              `arrowright`,
              `arrowup`,
              `arrowdown`,
              `w`,
              `a`,
              `s`,
              `d`,
              `e`,
            ].includes(n) &&
            e.preventDefault(),
            !De.current &&
              [
                `arrowleft`,
                `arrowright`,
                `arrowup`,
                `arrowdown`,
                `w`,
                `a`,
                `s`,
                `d`,
              ].includes(n) &&
              (F.current.add(n), (Ee.current = null)),
            n === `e` && !e.repeat && Xe.current(),
            n === `escape` && (s(null), _e(null), he(null), F.current.clear()),
            n === `i` &&
              i === `ship` &&
              s({
                type: `card`,
              }),
            n === `m` && p((e) => !e));
        },
        t = (e) => F.current.delete(e.key.toLowerCase()),
        n = () => {
          (F.current.clear(), (Te.current = 0));
        };
      return (
        window.addEventListener(`keydown`, e),
        window.addEventListener(`keyup`, t),
        window.addEventListener(`blur`, n),
        () => {
          (window.removeEventListener(`keydown`, e),
            window.removeEventListener(`keyup`, t),
            window.removeEventListener(`blur`, n));
        }
      );
    }, [i]),
    (0, x.useEffect)(() => {
      let e = P.current;
      if (!e) return;
      let t = (e) => {
        De.current ||
          (e.preventDefault(),
          (Ee.current = null),
          (Te.current = Math.max(
            -850,
            Math.min(
              850,
              Te.current +
                (Math.abs(e.deltaX) > Math.abs(e.deltaY)
                  ? e.deltaX
                  : e.deltaY) *
                  2.5,
            ),
          )));
      };
      return (
        e.addEventListener(`wheel`, t, {
          passive: !1,
        }),
        () => e.removeEventListener(`wheel`, t)
      );
    }, []),
    (0, x.useEffect)(() => {
      let e = 0,
        t = performance.now(),
        n = 0,
        r = !1,
        i = rv(ve),
        a = iv(ve),
        o = Array.from(document.querySelectorAll(`[data-parallax]`)),
        s = (c) => {
          let l = Math.min(0.035, (c - t) / 1e3);
          t = c;
          let u = 0,
            d = 0;
          if (De.current)
            ((Te.current = 0),
              (Ee.current = null),
              (we.current = {
                x: 0,
                y: 0,
              }));
          else {
            let e = F.current;
            if (
              ((u =
                (e.has(`d`) || e.has(`arrowright`) ? 1 : 0) -
                (e.has(`a`) || e.has(`arrowleft`) ? 1 : 0)),
              (d =
                (e.has(`s`) || e.has(`arrowdown`) ? 1 : 0) -
                (e.has(`w`) || e.has(`arrowup`) ? 1 : 0)),
              Ee.current)
            ) {
              let e = Ee.current,
                t =
                  e.stage === 0
                    ? {
                        x: Se.current.x,
                        y: 650,
                      }
                    : e.stage === 1
                      ? {
                          x: e.object.x,
                          y: 650,
                        }
                      : {
                          x: e.object.x,
                          y: e.object.y,
                        },
                n = t.x - Se.current.x,
                r = t.y - Se.current.y;
              if (Math.hypot(n, r) < 12) {
                if (e.stage < 2) e.stage++;
                else {
                  let t = e.object.id;
                  ((Ee.current = null),
                    (we.current = {
                      x: 0,
                      y: 0,
                    }),
                    setTimeout(() => Je(t), 0));
                }
              } else
                ((u = Math.abs(n) > 10 ? Math.sign(n) : 0),
                  (d = Math.abs(r) > 10 ? Math.sign(r) : 0));
            }
          }
          let f = u && d ? 0.707 : 1,
            p = De.current ? 0 : u * 350 * f + (u ? 0 : Te.current),
            m = De.current ? 0 : d * 350 * f,
            g = 1 - Math.exp(-l * 13);
          ((we.current.x += (p - we.current.x) * g),
            (we.current.y += (m - we.current.y) * g),
            (Te.current *= Math.exp(-l * 5)));
          let v = Math.max(
              65,
              Math.min(ve * 4 - 65, Se.current.x + we.current.x * l),
            ),
            b = Math.max(525, Math.min(832, Se.current.y + we.current.y * l)),
            x = (e, t) =>
              a.some(
                (n) =>
                  e + 25 > n.x &&
                  e - 25 < n.x + n.width &&
                  t > n.y &&
                  t - 18 < n.y + n.height,
              );
          for (let e of [1, 2, 3])
            Math.abs(v - e * ve) < 65 &&
              (b < 565 || b > 805) &&
              ((v = Se.current.x), (we.current.x = 0));
          (x(v, Se.current.y) ? (we.current.x = 0) : (Se.current.x = v),
            x(Se.current.x, b) ? (we.current.y = 0) : (Se.current.y = b));
          let C = Math.abs(we.current.x) + Math.abs(we.current.y) > 35;
          (Math.abs(we.current.x) > 20 &&
            (Ae.current = we.current.x > 0 ? 1 : -1),
            C !== r &&
              ((r = C),
              S(C),
              xe.current?.firstElementChild &&
                (xe.current.firstElementChild.style.animation = C
                  ? `crew-walk .32s ease-in-out infinite`
                  : `float 4s ease-in-out infinite`)),
            C && c - Fe.current > 340 && ((Fe.current = c), Ge(100)));
          let w = Math.max(0, Math.min(ve * 4 - N, Se.current.x - N * 0.48));
          if (
            ((Ce.current += (w - Ce.current) * (1 - Math.exp(-l * 5))),
            ye.current?.setAttribute(
              `transform`,
              `translate(${-Ce.current} 0)`,
            ),
            o.forEach((e) =>
              e.setAttribute(`transform`, `translate(${Ce.current * 0.025} 0)`),
            ),
            be.current?.setAttribute(
              `transform`,
              `translate(${Se.current.x} ${Se.current.y})`,
            ),
            xe.current?.setAttribute(`transform`, `scale(${Ae.current} 1)`),
            c - n > 80)
          ) {
            n = c;
            let e = Math.min(3, Math.max(0, Math.floor(Se.current.x / ve)));
            e !== ke.current && ((ke.current = e), _(e), Ge(280));
            let t = i.find(
              (e) =>
                Math.hypot(Se.current.x - e.x, (Se.current.y - e.y) * 1.1) <
                145,
            );
            t?.id !== Oe.current &&
              ((Oe.current = t?.id || null), h(t?.id || null));
            let r = [1, 2, 3].filter(
              (e) =>
                Math.abs(Se.current.x - e * ve) < 190 &&
                Se.current.y > 545 &&
                Se.current.y < 825,
            );
            y((e) => (e.join(`,`) === r.join(`,`) ? e : r));
          }
          e = requestAnimationFrame(s);
        };
      return ((e = requestAnimationFrame(s)), () => cancelAnimationFrame(e));
    }, [ve, N]));
  async function $e(e) {
    (e.preventDefault(), d(!0), A(``));
    try {
      (r(await Y_(ee, te)), await X_(), a(`card`), Ge(700));
    } catch (e) {
      A(e.message);
    } finally {
      d(!1);
    }
  }
  function et() {
    ((Se.current = {
      x: ve * 1.5,
      y: 690,
    }),
      (Ce.current = Se.current.x - N * 0.5),
      _(1),
      (ke.current = 1),
      a(`cinematic`),
      setTimeout(() => a(`boot`), 2700),
      setTimeout(() => {
        (a(`ship`), We(`Welcome aboard. Move with WASD or arrow keys.`));
      }, 4200));
  }
  function tt() {
    j === `READY` &&
      (M(`SCANNING`),
      Ge(850),
      (Pe.current = setTimeout(() => {
        if (Ue.current !== `scan`) return;
        let e = Le === `COMMANDER`;
        (M(e ? `GRANTED` : `DENIED`),
          Ge(e ? 660 : 160),
          e &&
            (Pe.current = setTimeout(() => {
              Ue.current === `scan` &&
                (le(`CREW`),
                s({
                  type: `admin`,
                }));
            }, 800)));
      }, 1300)));
  }
  async function nt(e) {
    d(!0);
    try {
      (await Ke(`claim`, {
        taskId: e.id,
      }),
        ae(e.id),
        s({
          type: `assigned`,
          taskId: e.id,
        }),
        Ge(740),
        setTimeout(
          () =>
            s((t) =>
              t?.type === `assigned`
                ? {
                    type: `information`,
                    taskId: e.id,
                  }
                : t,
            ),
          850,
        ));
    } catch (t) {
      (We(t.message),
        s({
          type: e.imposter ? `imposter` : `tasks`,
          category: ne,
        }));
    } finally {
      d(!1);
    }
  }
  async function rt() {
    try {
      (await Q_(), r(null), s(null), a(`login`), O(``));
    } catch (e) {
      We(e.message);
    }
  }
  function it(e, t) {
    return (
      <button
        aria-label={`Move ${
          {
            w: `up`,
            a: `left`,
            s: `down`,
            d: `right`,
          }[e] || e
        }`}
        onPointerDown={(t) => {
          (t.preventDefault(),
            t.currentTarget.setPointerCapture(t.pointerId),
            F.current.add(e),
            (Ee.current = null));
        }}
        onPointerUp={() => F.current.delete(e)}
        onPointerCancel={() => F.current.delete(e)}
        onLostPointerCapture={() => F.current.delete(e)}
        className="flex h-10 w-10 touch-none items-center justify-center rounded-lg border-2 border-[#739897]/40 bg-[#1b3541]/90 text-[#bed9d4] active:bg-primary/20"
      >
        {t}
      </button>
    );
  }
  function at() {
    return (
      <div className="space-y-2">
        {[...e.crews]
          .sort((e, t) => t.coins - e.coins)
          .map((e, t) => (
            <hg.div
              layout={!0}
              className={`flex items-center gap-3 rounded-lg border-2 px-4 py-3 ${e.id === I.id ? `border-primary/40 bg-primary/10` : `border-[#304b58] bg-[#112733]`}`}
            >
              <span className="w-6 font-mono text-sm text-[#8db4b7]">
                {String(t + 1).padStart(2, `0`)}
              </span>
              <N_ color={e.color} size={34} state="still" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">
                  {e.name}
                  {` `}
                  {e.id === I.id && (
                    <span className="ml-1 text-[9px] text-primary">YOU</span>
                  )}
                </div>
                <div className="mt-1 font-mono text-[9px] text-[#90b1b5]">
                  {e.id}
                  {` · `}
                  {e.status}
                </div>
              </div>
              <xv size={15} />
              <span className="font-mono text-sm">
                {e.coins.toLocaleString()}
              </span>
            </hg.div>
          ))}
      </div>
    );
  }
  function ot() {
    let t = P_[o?.category ?? ne];
    return (
      <>
        <div className="mb-6 flex items-center gap-4">
          <div
            className="flex h-14 w-14 items-center justify-center rounded-xl border-2 border-[#577586] bg-[#14323e] font-mono text-2xl"
            style={{
              color: t.color,
            }}
          >
            {t.symbol}
          </div>
          <div>
            <Z>
              {t.room}
              {` PROGRAMMING TERMINAL`}
            </Z>
            <h2 className="mt-1 font-display text-2xl font-bold">{t.name}</h2>
          </div>
        </div>
        <p className="mb-5 text-xs text-muted">
          Secure a system. Only your crew can access it once claimed.
        </p>
        <div className="space-y-3">
          {e.tasks
            .filter((e) => e.category === t.name && !e.imposter)
            .map((e) => (
              <div className="rounded-lg border-2 border-[#365463] bg-[#142d39] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <Z>{e.id}</Z>
                    <h3 className="mt-1 text-sm font-medium">{e.name}</h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <wv>{e.difficulty}</wv>
                    <span className="flex items-center gap-1.5 font-mono text-xs text-[#e8cf8e]">
                      <xv size={15} />
                      {e.reward}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3">
                  <div>
                    <wv>{e.status}</wv>
                    <span className="ml-2 text-[9px] text-muted">
                      {e.status === `AVAILABLE`
                        ? `Classified · claim to view code`
                        : e.status === `CLAIMED`
                          ? `Secured by ${e.claimedBy}`
                          : e.status === `SOLVED`
                            ? `Bug eliminated`
                            : `Commander disabled this system`}
                    </span>
                  </div>
                  <bv
                    disabled={
                      u ||
                      e.status === `SOLVED` ||
                      e.status === `DISABLED` ||
                      (e.status === `CLAIMED` && e.claimedBy !== I.id)
                    }
                    onClick={() => {
                      e.claimedBy === I.id
                        ? (ae(e.id),
                          s({
                            type: `information`,
                            taskId: e.id,
                          }))
                        : s({
                            type: `claim`,
                            taskId: e.id,
                          });
                    }}
                    className="!px-3 !py-2"
                  >
                    {e.claimedBy === I.id && e.status === `CLAIMED`
                      ? `Resume repair`
                      : `Claim task`}
                    <Qg size={12} />
                  </bv>
                </div>
              </div>
            ))}
        </div>
      </>
    );
  }
  function st() {
    return (
      <>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <Z className="!text-[#e7c784]">COMMANDER ACCESS GRANTED</Z>
            <h2 className="mt-1 font-display text-2xl font-bold">
              Ship command terminal
            </h2>
          </div>
          <c_ size={27} className="text-primary" />
        </div>
        <div className="mb-6 flex flex-wrap gap-2">
          {[
            `CREW`,
            `TASK DATABASE`,
            `IMPOSTER PROBLEMS`,
            `ROUND CONTROL`,
            `RANKINGS`,
            `SHIP STATUS`,
          ].map((e) => (
            <bv
              secondary={ce !== e}
              onClick={() => {
                (le(e), he(null));
              }}
              className="!px-3 !py-2 !text-[9px]"
            >
              {e}
            </bv>
          ))}
        </div>
        {me === `crew` ? (
          <Av
            crew={ue}
            onCancel={() => he(null)}
            onSave={async (e) => {
              (await qe(
                `saveCrew`,
                {
                  crew: e,
                },
                `Crew manifest saved.`,
              )) && he(null);
            }}
          />
        ) : me === `task` || me === `imposter` ? (
          <jv
            task={fe}
            imposter={me === `imposter`}
            onCancel={() => he(null)}
            onSave={async (e, t, n) => {
              (await qe(
                me === `imposter` ? `releaseImposter` : `saveTask`,
                {
                  task: e,
                  claimSeconds: t,
                  solveSeconds: n,
                },
                me === `imposter`
                  ? `IMPOSTER DETECTED. Transmission sent.`
                  : `Task database saved.`,
              )) && he(null);
            }}
          />
        ) : ce === `CREW` ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <Z>
                {`CREW MANIFEST · `}
                {e.crews.length}
                {` IDENTITIES`}
              </Z>
              <bv
                onClick={() => {
                  (de(null), he(`crew`));
                }}
                className="!py-2"
              >
                <o_ size={13} />
                Add crew
              </bv>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-left text-xs">
                <thead className="border-b border-[#496370] font-mono text-[9px] text-muted">
                  <tr>
                    {[
                      `CREW`,
                      `MEMBERS`,
                      `IDEACOINS`,
                      `TASKS`,
                      `STATUS`,
                      `CONTROLS`,
                    ].map((e) => (
                      <th className="p-3 font-normal">{e}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {e.crews.map((e) => (
                    <tr className="border-b border-[#344d5b]">
                      <td className="p-3">
                        <span className="flex items-center gap-2">
                          <N_ color={e.color} size={29} state="still" />
                          <span>
                            {e.name}
                            <span className="mt-1 block font-mono text-[8px] text-muted">
                              {e.id}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="p-3">{e.members}</td>
                      <td className="p-3 font-mono">{e.coins}</td>
                      <td className="p-3">{e.tasks}</td>
                      <td className="p-3">
                        <wv>
                          {e.status === `ACTIVE`
                            ? `SAFE / ACTIVE`
                            : `DANGER / EJECTED`}
                        </wv>
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap gap-2">
                          <button
                            className="text-primary hover:underline"
                            onClick={() => {
                              (de(e), he(`crew`));
                            }}
                          >
                            Edit
                          </button>
                          <button
                            aria-label={`Add 100 coins to ${e.name}`}
                            className="text-[#e6c887] hover:underline"
                            onClick={() =>
                              qe(
                                `coins`,
                                {
                                  crewId: e.id,
                                  amount: 100,
                                },
                                `+100 IdeaCoins credited.`,
                              )
                            }
                          >
                            +100
                          </button>
                          <button
                            aria-label={`Deduct 100 coins from ${e.name}`}
                            className="text-[#e6c887] hover:underline"
                            onClick={() =>
                              qe(
                                `coins`,
                                {
                                  crewId: e.id,
                                  amount: -100,
                                },
                                `100 IdeaCoins deducted.`,
                              )
                            }
                          >
                            −100
                          </button>
                          <button
                            className="text-[#eca291] hover:underline"
                            onClick={() =>
                              _e({
                                title: `Eject ${e.name}?`,
                                action: `eliminate`,
                                payload: {
                                  crewIds: [e.id],
                                },
                              })
                            }
                          >
                            Eject
                          </button>
                          <button
                            disabled={e.id === I.id}
                            className="text-muted hover:underline disabled:opacity-30"
                            onClick={() =>
                              _e({
                                title: `Remove ${e.name} permanently?`,
                                action: `removeCrew`,
                                payload: {
                                  crewId: e.id,
                                },
                              })
                            }
                          >
                            Remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : ce === `TASK DATABASE` ? (
          <>
            <div className="mb-4 flex items-center justify-between">
              <Z>
                {e.tasks.length}
                {` SYSTEM RECORDS`}
              </Z>
              <bv
                onClick={() => {
                  (pe(null), he(`task`));
                }}
                className="!py-2"
              >
                <o_ size={13} />
                Create task
              </bv>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-xs">
                <thead className="border-b border-[#496370] font-mono text-[9px] text-muted">
                  <tr>
                    {[
                      `TASK`,
                      `CATEGORY`,
                      `DIFFICULTY`,
                      `REWARD`,
                      `STATUS`,
                      `CONTROLS`,
                    ].map((e) => (
                      <th className="p-3 font-normal">{e}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {e.tasks.map((e) => (
                    <tr className="border-b border-[#344d5b]">
                      <td className="p-3 font-mono text-[10px]">{e.id}</td>
                      <td className="p-3 text-muted">{e.category}</td>
                      <td className="p-3">
                        <wv>{e.difficulty}</wv>
                      </td>
                      <td className="p-3">{e.reward}</td>
                      <td className="p-3">
                        <wv>{e.status}</wv>
                        <span className="mt-1 block text-[8px] text-muted">
                          {e.claimedBy}
                        </span>
                      </td>
                      <td className="p-3">
                        <div className="flex gap-3">
                          <button
                            className="text-primary"
                            onClick={() => {
                              (pe(e), he(`task`));
                            }}
                          >
                            Edit
                          </button>
                          <button
                            disabled={
                              e.status === `SOLVED` || e.status === `CLAIMED`
                            }
                            className="text-[#e3ba85] disabled:opacity-30"
                            onClick={() =>
                              qe(`disableTask`, {
                                taskId: e.id,
                              })
                            }
                          >
                            {e.status === `DISABLED` ? `Enable` : `Disable`}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : ce === `IMPOSTER PROBLEMS` ? (
          <div className="rounded-xl border-2 border-[#9d635a] bg-[#442b34] p-8 text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full border-[6px] border-[#6f4d50] bg-[#ab5656] shadow-[0_6px_0_#252329]">
              <A_ size={33} />
            </div>
            <h3 className="font-display text-2xl font-bold">
              Call the imposter protocol.
            </h3>
            <p className="mx-auto my-4 max-w-md text-sm leading-6 text-[#ceafb0]">
              One emergency challenge. Every crew alerted. Only the first claim
              gets access.
            </p>
            {Ve && (
              <p className="mb-4 font-mono text-xs text-[#e9cab5]">
                {Ve.id}
                {` · `}
                {Ve.status}
                {` ·`}
                {` `}
                {Ve.claimedBy || `Waiting for a crew`}
              </p>
            )}
            <bv
              danger={!0}
              onClick={() => {
                (pe(null), he(`imposter`));
              }}
            >
              Release imposter problem
              <c_ size={14} />
            </bv>
          </div>
        ) : ce === `ROUND CONTROL` ? (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-5 rounded-xl border-2 border-[#426270] bg-[#142e3a] p-5">
              <div>
                <Z>
                  {`ROUND `}
                  {String(e.round).padStart(2, `0`)}
                </Z>
                <Sv seconds={Re} className="mt-2 block text-4xl" />
              </div>
              <div className="flex gap-2">
                <bv secondary={!0} onClick={() => qe(`pause`)}>
                  {e.pausedAt ? `Resume round` : `Pause round`}
                </bv>
                <bv onClick={() => qe(`nextRound`, {}, `Next round started.`)}>
                  Next round
                </bv>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[`SAFE`, `UNCERTAIN`, `DANGER`].map((t) => (
                <div className="rounded-xl border-2 border-[#395362] bg-[#142c38] p-4">
                  <wv>{t}</wv>
                  <div className="mt-4 space-y-3">
                    {e.crews
                      .filter((n) => n.status === `ACTIVE` && ev(e, n.id) === t)
                      .map((e) => (
                        <div className="flex items-center gap-2">
                          <N_ color={e.color} size={29} state="still" />
                          <span className="text-[11px]">{e.name}</span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <bv
                danger={!0}
                onClick={() =>
                  _e({
                    title: `Confirm ejection of all danger crews?`,
                    action: `eliminate`,
                    payload: {
                      crewIds: e.crews
                        .filter(
                          (t) =>
                            t.status === `ACTIVE` && ev(e, t.id) === `DANGER`,
                        )
                        .map((e) => e.id),
                    },
                  })
                }
              >
                Initiate ejection
                <b_ size={14} />
              </bv>
            </div>
          </>
        ) : ce === `RANKINGS` ? (
          at()
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [
                  `ACTIVE CREWS`,
                  e.crews.filter((e) => e.status === `ACTIVE`).length,
                ],
                [
                  `SYSTEMS AVAILABLE`,
                  e.tasks.filter((e) => e.status === `AVAILABLE`).length,
                ],
                [
                  `REPAIRS COMPLETE`,
                  e.tasks.filter((e) => e.status === `SOLVED`).length,
                ],
                [`CURRENT ROUND`, e.round],
              ].map(([e, t]) => (
                <div className="rounded-lg border-2 border-[#416574] bg-[#13313c] p-4">
                  <Z>{e}</Z>
                  <div className="mt-2 font-mono text-3xl text-primary">
                    {t}
                  </div>
                </div>
              ))}
            </div>
            <form
              className="mt-6"
              onSubmit={(e) => {
                e.preventDefault();
                let t = e.currentTarget;
                (qe(
                  `announce`,
                  {
                    message: String(new FormData(t).get(`message`)),
                  },
                  `Transmission sent.`,
                ),
                  t.reset());
              }}
            >
              <Cv label="SHIP-WIDE TRANSMISSION">
                <textarea
                  required={!0}
                  name="message"
                  placeholder="Write an announcement to all crews..."
                  className={`${yv} min-h-24`}
                />
              </Cv>
              <bv type="submit">
                <m_ size={13} />
                Broadcast
              </bv>
            </form>
            <div className="mt-5 space-y-2">
              {e.activity.slice(0, 5).map((e, t) => (
                <div className="flex items-center gap-2 border-b border-white/10 py-2 text-xs text-muted">
                  <c_ size={12} />
                  {e}
                </div>
              ))}
            </div>
          </>
        )}
      </>
    );
  }
  function ct() {
    let t = e.tasks.find((e) => e.id === o?.taskId) || He;
    return o?.type === `checking` ? (
      <div className="py-20 text-center">
        <Xg size={40} className="mx-auto mb-7 animate-spin text-[#e3bd86]" />
        <Z>ROUND COMPLETE</Z>
        <h2 className="mt-4 font-display text-2xl font-bold">
          CHECKING CREW STATUS…
        </h2>
        <p className="mt-5 text-xs text-muted">
          Remain calm, crewmate. Ship lights are offline.
        </p>
      </div>
    ) : o?.type === `card` ? (
      <div className="py-3 text-center">
        <Z className="mb-5 !text-primary">ONE CREW. ONE SHARED IDENTITY.</Z>
        {n && <Ev crew={I} identity={n} />}
        <p className="mt-7 text-xs text-muted">
          Press I to view your card anywhere aboard the ship.
        </p>
      </div>
    ) : o?.type === `help` ? (
      <>
        <Z className="!text-primary">FLIGHT MANUAL / 01</Z>
        <h2 className="mt-2 font-display text-3xl font-bold">
          The ship is your interface.
        </h2>
        <p className="my-5 text-sm leading-7 text-muted">
          Walk through the doors. Approach a machine. Press{` `}
          <kbd className="rounded border border-primary/40 bg-primary/10 px-2 text-primary">
            E
          </kbd>
          {` `}to use it. You can also click a machine and your crewmate will
          walk to it.
        </p>
        <div className="space-y-3">
          {[
            [`WASD / ARROWS`, `Move around the deck`],
            [`SCROLL / TRACKPAD`, `Walk left and right`],
            [`E`, `Interact with a nearby machine`],
            [`I`, `Show your team’s access card`],
            [`M`, `Mute or unmute sound cues`],
            [`ESC`, `Exit the current terminal`],
          ].map(([e, t]) => (
            <div className="flex items-center justify-between rounded border border-[#3c5c69] bg-[#16313d] p-3 text-xs">
              <span className="font-mono text-primary">{e}</span>
              <span className="text-muted">{t}</span>
            </div>
          ))}
        </div>
        <p className="mt-6 text-xs leading-6 text-muted">
          Claim a buggy program, repair it, and submit its correct output. Hints
          cost IdeaCoins. Top 25% are safe; bottom 25% face ejection every
          round. Imposter problems reward fast crews.
        </p>
        {z_ && (
          <p className="mt-4 rounded-lg border border-[#c9a16e]/30 bg-[#c9a16e]/10 p-3 text-[11px] leading-5 text-[#dfc192]">
            Local demo: shared across tabs on this device. Authentication and
            C++ execution are simulated. Live competition uses the configured
            server API.
          </p>
        )}
      </>
    ) : o?.type === `scan` ? (
      <div className="text-center">
        <Z className="!text-[#dec18a]">COMMAND AUTHENTICATION</Z>
        <h2 className="my-3 font-display text-2xl font-bold">
          {j === `READY`
            ? `Please insert ID card.`
            : j === `SCANNING`
              ? `Scanning crew identity…`
              : j === `GRANTED`
                ? `Access granted.`
                : `Access denied.`}
        </h2>
        <div
          className={`relative mx-auto my-7 h-28 max-w-xs overflow-hidden rounded-xl border-[5px] bg-[#0b1e2a] ${j === `DENIED` ? `border-[#ce7869]` : j === `GRANTED` ? `border-primary` : `border-[#60868d]`}`}
        >
          <div className="absolute inset-x-7 top-12 h-4 rounded bg-black shadow-[0_1px_0_#71949b]" />
          <div
            className={`absolute right-3 top-3 h-3 w-3 rounded-full ${j === `DENIED` ? `bg-[#f49386]` : j === `GRANTED` ? `bg-primary` : `bg-[#e3c083]`}`}
          />
          <Z className="absolute inset-x-0 bottom-3">
            {j === `READY` ? `SECURE COMMAND CARD READER` : j}
          </Z>
          {j === `SCANNING` && (
            <hg.div
              initial={{
                x: -300,
              }}
              animate={{
                x: 340,
              }}
              transition={{
                duration: 1.3,
              }}
              className="absolute left-0 top-6 h-14 w-24 rotate-6 rounded border-2 border-primary bg-[#28606a]"
            />
          )}
        </div>
        {j === `DENIED` ? (
          <hg.div
            animate={{
              x: [0, -5, 5, 0],
            }}
          >
            <N_
              color={I.color}
              state="thinking"
              size={65}
              className="mx-auto mb-4"
            />
            <wv>COMPETITOR CARD DETECTED / DENIED</wv>
            <p className="my-5 text-xs text-muted">
              Command access required. This cockpit is above your pay grade,
              crewmate.
            </p>
            <bv secondary={!0} onClick={() => s(null)}>
              Back to cockpit
            </bv>
          </hg.div>
        ) : j === `GRANTED` ? (
          <div className="my-10 font-display text-xl text-primary">
            Welcome, commander.
          </div>
        ) : (
          <>
            <hg.div
              animate={{
                y: j === `SCANNING` ? -20 : 0,
                opacity: j === `SCANNING` ? 0.5 : 1,
              }}
            >
              {n && <Ev crew={I} identity={n} small={!0} />}
            </hg.div>
            <bv disabled={j !== `READY`} onClick={tt} className="mt-6">
              <Kg size={16} />
              {j === `SCANNING` ? `Scanning…` : `Swipe ID card`}
            </bv>
          </>
        )}
      </div>
    ) : o?.type === `admin` ? (
      st()
    ) : o?.type === `rankings` ? (
      <>
        <Z className="!text-primary">OBSERVATION DECK / LIVE TELEMETRY</Z>
        <h2 className="mb-5 mt-2 font-display text-3xl font-bold">
          Crew rankings
        </h2>
        {at()}
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <wv>SAFE · TOP 25%</wv>
          <wv>UNCERTAIN · MIDDLE 50%</wv>
          <wv>DANGER · BOTTOM 25%</wv>
        </div>
      </>
    ) : o?.type === `tasks` ? (
      ot()
    ) : o?.type === `claim` && t ? (
      <div className="py-6 text-center">
        <Qg size={43} className="mx-auto mb-5 text-primary" />
        <Z>EXCLUSIVE SYSTEM ACCESS</Z>
        <h2 className="my-3 font-display text-3xl font-bold">
          Claim this task?
        </h2>
        <p className="mx-auto max-w-sm text-sm leading-7 text-muted">
          Only one crew can claim this system. Once secured, all other teams
          lose access.
        </p>
        <div className="my-6 flex items-center justify-center gap-2 font-mono text-xl text-[#e8cf8f]">
          <xv size={27} />
          {t.reward}
          {` IDEACOINS`}
        </div>
        <div className="flex justify-center gap-3">
          <bv
            secondary={!0}
            onClick={() =>
              s({
                type: t.imposter ? `imposter` : `tasks`,
                category: ne,
              })
            }
          >
            Cancel
          </bv>
          <bv disabled={u} onClick={() => nt(t)}>
            {u ? <Xg size={14} className="animate-spin" /> : <Qg size={14} />}
            Claim task
          </bv>
        </div>
      </div>
    ) : o?.type === `assigned` ? (
      <div className="py-16 text-center">
        <hg.div
          initial={{
            rotate: -30,
            scale: 1.3,
          }}
          animate={{
            rotate: 0,
            scale: 1,
          }}
        >
          <Qg size={58} className="mx-auto mb-6 text-primary" />
        </hg.div>
        <h2 className="font-display text-3xl font-bold text-primary">
          TASK ASSIGNED
        </h2>
        <p className="mt-3 font-mono text-sm text-muted">
          {I.id}
          {` / `}
          {I.name}
        </p>
      </div>
    ) : o?.type === `information` && t ? (
      <>
        <Z className="!text-primary">
          {`SYSTEM REPAIR REQUEST / `}
          {t.id}
        </Z>
        <h2 className="mb-4 mt-2 font-display text-3xl font-bold">{t.name}</h2>
        <div className="mb-6 flex items-center gap-3">
          <wv>{t.difficulty}</wv>
          <span className="flex items-center gap-2 font-mono text-xs text-[#e5cd8b]">
            <xv />
            {t.reward}
            {` IDEACOINS`}
          </span>
        </div>
        <div className="rounded-xl border-2 border-[#3b6270] bg-[#112e3a] p-5">
          <Z>PROBLEM STATEMENT</Z>
          <p className="mt-3 text-sm leading-7 text-[#d4e6e1]">{t.objective}</p>
        </div>
        <div className="relative my-5 overflow-hidden rounded-xl border-2 border-[#34505d] bg-[#0a202c] p-5">
          <pre
            aria-hidden="true"
            className="font-mono text-xs leading-6 text-primary blur-sm"
          >{`int main() {
    diagnostic.scan();
    repair_system();
}`}</pre>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#091e2b]/30">
            <g_ size={25} className="text-primary" />
            <Z>
              {`SYSTEM ACCESS SECURED BY `}
              {I.id}
            </Z>
          </div>
        </div>
        <div className="flex justify-end gap-3">
          <bv secondary={!0} onClick={() => s(null)}>
            Return to deck
          </bv>
          <bv
            onClick={() =>
              s({
                type: `engineering`,
                taskId: t.id,
              })
            }
          >
            Begin repair
            <v_ size={15} />
          </bv>
        </div>
      </>
    ) : o?.type === `engineering` && t && n ? (
      <kv
        task={t}
        crew={I}
        identity={n}
        seconds={Re}
        rank={Be}
        now={C}
        perform={Ke}
        notify={We}
        onCorrect={() => {
          (se({
            reward: t.reward,
            beforeRank: Be,
          }),
            s({
              type: `success`,
              taskId: t.id,
            }),
            Ge(880));
        }}
        onExit={() => s(null)}
      />
    ) : o?.type === `success` ? (
      <div className="py-5 text-center">
        <div className="relative mx-auto mb-5 w-fit">
          <N_ color={I.color} size={115} state="celebrating" />
          {[0, 1, 2, 3].map((e) => (
            <hg.div
              initial={{
                y: 0,
                x: e * 16 - 25,
                opacity: 1,
              }}
              animate={{
                y: -95,
                opacity: 0,
              }}
              transition={{
                duration: 1.6,
                delay: e * 0.2,
                repeat: 1 / 0,
              }}
              className="absolute right-0 top-10"
            >
              <xv size={21} />
            </hg.div>
          ))}
        </div>
        <Z className="!text-primary">SYSTEM RESTORED</Z>
        <h2 className="my-3 font-display text-4xl font-bold">TASK COMPLETE!</h2>
        <div className="font-display text-xl text-primary">BUG EJECTED.</div>
        <div className="my-6 flex items-center justify-center gap-2 font-mono text-2xl text-[#ead596]">
          <xv size={29} />+{oe?.reward || t?.reward}
          {` IDEACOINS`}
        </div>
        <Z>CREW RANK UPDATED</Z>
        <div className="my-3 flex items-center justify-center gap-4 font-mono text-2xl">
          <span className="text-muted">#{oe?.beforeRank || Be}</span>
          <Pg size={19} className="text-muted" />
          <span className="text-primary">#{Be}</span>
        </div>
        <p className="mb-6 text-xs text-muted">
          {`Balance: `}
          {I.coins.toLocaleString()}
          {` IdeaCoins`}
        </p>
        <bv
          onClick={() => {
            (s(null), ae(null));
          }}
        >
          Exit terminal
          <Pg size={15} />
        </bv>
      </div>
    ) : o?.type === `imposter` ? (
      <div className="py-5 text-center">
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border-[5px] border-[#876159] bg-[#af5754] shadow-[0_5px_0_#271d27]">
          <A_ size={36} />
        </div>
        <Z className="!text-[#f0af92]">EMERGENCY BROADCAST</Z>
        <h2 className="my-3 font-display text-3xl font-bold">
          IMPOSTER PROBLEM
        </h2>
        <p className="my-3 text-sm text-muted">
          {Ve?.name || `All systems clear. Stay alert.`}
        </p>
        {Ve && (
          <>
            <div className="my-5 flex items-center justify-center gap-3">
              <wv>{Ve.difficulty}</wv>
              <span className="flex items-center gap-2 font-mono text-lg text-[#e9ce91]">
                <xv size={23} />
                {Ve.reward}
              </span>
            </div>
            {Ve.status === `AVAILABLE` ? (
              <>
                <Z>CLAIM WINDOW</Z>
                <Sv
                  seconds={Math.max(
                    0,
                    Math.ceil(((Ve.claimUntil || 0) - C) / 1e3),
                  )}
                  className="my-3 block text-4xl"
                />
                <p className="my-4 text-xs text-muted">
                  First crew to claim wins exclusive access.
                </p>
                <bv
                  danger={!0}
                  disabled={C > (Ve.claimUntil || 0)}
                  onClick={() =>
                    s({
                      type: `claim`,
                      taskId: Ve.id,
                    })
                  }
                >
                  Claim imposter problem
                  <A_ size={14} />
                </bv>
              </>
            ) : Ve.claimedBy === I.id && Ve.status === `CLAIMED` ? (
              <bv
                danger={!0}
                onClick={() => {
                  (ae(Ve.id),
                    s({
                      type: `information`,
                      taskId: Ve.id,
                    }));
                }}
              >
                Resume imposter protocol
              </bv>
            ) : (
              <>
                <h3 className="mt-6 font-display text-2xl text-[#f1b295]">
                  {Ve.status === `SOLVED` ? `IMPOSTER ELIMINATED` : `TOO LATE!`}
                </h3>
                <p className="my-3 text-xs text-muted">
                  {Ve.status === `SOLVED`
                    ? `The ship is a little safer now.`
                    : `Another crew found the imposter.`}
                </p>
                <Z>{Ve.claimedBy}</Z>
              </>
            )}
          </>
        )}
      </div>
    ) : o?.type === `ejected` ? (
      <div className="starfield py-8 text-center">
        <N_
          color={I.color}
          size={120}
          state="ejected"
          className="mx-auto mb-12"
        />
        <Z>{I.id}</Z>
        <h2 className="my-4 font-display text-4xl font-bold">WAS EJECTED.</h2>
        <p className="my-4 text-sm text-muted">
          {`TEAM `}
          {I.name}
          {` HAS BEEN ELIMINATED`}
        </p>
        <p className="my-6 font-mono text-xs text-[#d6e9e0]">
          FINAL RANK #{Be}
          {` / `}
          {I.coins}
          {` IDEACOINS`}
        </p>
        <bv
          onClick={() =>
            s({
              type: `rankings`,
            })
          }
        >
          View crew rankings
          <S_ size={14} />
        </bv>
      </div>
    ) : o?.type === `survived` ? (
      <div className="py-8 text-center">
        <N_
          color={I.color}
          size={110}
          state="celebrating"
          className="mx-auto mb-7"
        />
        <Z className="!text-primary">ROUND COMPLETE / CREW STATUS VERIFIED</Z>
        <h2 className="my-4 font-display text-4xl font-bold text-primary">
          YOU SURVIVED.
        </h2>
        <p className="my-5 text-sm text-muted">
          Another round. Another chance to find the bugs.
        </p>
        <bv onClick={() => s(null)}>
          Return to the ship
          <Pg size={14} />
        </bv>
      </div>
    ) : null;
  }
  return (
    <div
      ref={P}
      className="fixed inset-0 overflow-hidden bg-[#0b1923] text-[#edf0e5]"
      role="application"
      aria-label="Among Bugs spaceship exploration game"
    >
      <div
        className={`absolute inset-0 transition-[filter,transform] duration-700 ${o ? `scale-[1.035]` : `scale-100`} ${i === `login` || i === `card` ? `brightness-[.25] blur-[2px]` : i === `cinematic` ? `brightness-0` : i === `boot` ? `animate-[boot_1.5s_ease-out]` : ``}`}
      >
        <gv
          ref={ye}
          width={N}
          roomWidth={ve}
          state={e}
          crew={I}
          near={m}
          onInteract={Qe}
          playerRef={be}
          walkingRef={xe}
          doorOpen={v}
        />
      </div>
      {i === `ship` && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 h-44 bg-gradient-to-b from-[#06121f]/95 via-[#091722]/60 to-transparent" />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-[#061521]/95 to-transparent" />
          {(ze === `DANGER` || Re < 10) && (
            <div className="pointer-events-none absolute inset-0 bg-[#bd554d]/10 shadow-[inset_0_0_120px_#a9323830] animate-[warning_3s_ease-in-out_infinite]" />
          )}
          <header className="absolute inset-x-0 top-0 z-20 flex items-start justify-between px-4 pt-4 sm:px-8 sm:pt-6">
            <button
              onClick={() =>
                s({
                  type: `card`,
                })
              }
              aria-label="View crew access card"
              className="flex items-center gap-2 rounded-xl border border-[#9ecac1]/20 bg-[#102737]/80 p-2 pr-4 backdrop-blur sm:gap-3"
            >
              <N_ color={I.color} size={40} state="still" />
              <div className="text-left">
                <div className="font-display text-xs font-bold tracking-wide sm:text-sm">
                  {I.name}
                </div>
                <div className="mt-0.5 font-mono text-[8px] text-[#a3c2c3] sm:text-[9px]">
                  {I.id}
                </div>
                <div className="mt-1">
                  <wv>{ze}</wv>
                </div>
              </div>
            </button>
            <div className="absolute left-1/2 top-5 -translate-x-1/2 text-center sm:top-6">
              <Z className="!text-[8px]">
                {`ROUND `}
                {String(e.round).padStart(2, `0`)}
                {e.pausedAt ? ` · PAUSED` : ``}
              </Z>
              <Sv seconds={Re} className="mt-1 block text-xl sm:text-3xl" />
              {ze === `DANGER` && (
                <Z className="mt-1 !text-[7px] !text-[#e5a18d]">
                  ⚠ EJECTION IN
                </Z>
              )}
              <div
                className="mt-4 hidden items-center justify-center gap-2 sm:flex"
                aria-label="Ship orientation map"
              >
                {[`COMMAND`, `LOBBY`, `TASKS`, `RANKINGS`].map((e, t) => (
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col items-center gap-1.5">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${g === t ? `bg-primary shadow-[0_0_8px_#8ae4cf]` : `bg-[#547581]`}`}
                      />
                      <span
                        className={`font-mono text-[7px] tracking-widest ${g === t ? `text-primary` : `text-[#829aa8]`}`}
                      >
                        {e}
                      </span>
                    </div>
                    {t < 3 && (
                      <span className="mb-4 h-px w-16 bg-[#547581]/40" />
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div className="flex items-center gap-3 rounded-xl border border-[#a6c9bc]/20 bg-[#102737]/80 px-3 py-3 backdrop-blur sm:gap-5 sm:px-5">
                <div className="text-right">
                  <Z className="hidden sm:block">CREW RANK</Z>
                  <span className="mt-0.5 block font-mono text-sm text-[#ccded6]">
                    #{String(Be).padStart(2, `0`)}
                  </span>
                </div>
                <div className="h-6 w-px bg-[#668478]/30" />
                <div>
                  <Z className="hidden sm:block">IDEACOINS</Z>
                  <div className="mt-0.5 flex items-center gap-1.5">
                    <xv size={18} />
                    <hg.span
                      initial={{
                        scale: 1.16,
                        color: `#f4d689`,
                      }}
                      animate={{
                        scale: 1,
                        color: `#dfdebf`,
                      }}
                      className="font-mono text-sm font-semibold"
                    >
                      {I.coins.toLocaleString()}
                    </hg.span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                {[
                  {
                    icon: f ? K : E_,
                    label: f ? `Unmute sound` : `Mute sound`,
                    action: () => {
                      (p(!f), (je.current = !f), Ge(550));
                    },
                  },
                  {
                    icon: n_,
                    label: `Toggle fullscreen`,
                    action: () => {
                      document.fullscreenElement
                        ? document.exitFullscreen()
                        : P.current
                            ?.requestFullscreen()
                            .catch(() =>
                              We(`Fullscreen is unavailable in this preview.`),
                            );
                    },
                  },
                  {
                    icon: Rg,
                    label: `Flight manual`,
                    action: () =>
                      s({
                        type: `help`,
                      }),
                  },
                  {
                    icon: e_,
                    label: `Exit ship`,
                    action: () => void rt(),
                  },
                ].map((e) => (
                  <button
                    title={e.label}
                    aria-label={e.label}
                    onClick={e.action}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#6b9292]/30 bg-[#0d2535]/70 text-[#adc8c7] transition hover:bg-[#36565e]"
                  >
                    <e.icon size={13} />
                  </button>
                ))}
              </div>
            </div>
          </header>
          {Ve && Ve.status === `AVAILABLE` && C < (Ve.claimUntil || 0) && (
            <hg.div
              initial={{
                y: -50,
                opacity: 0,
              }}
              animate={{
                y: 0,
                opacity: 1,
              }}
              className="absolute left-1/2 top-[115px] z-30 flex w-[90%] max-w-[610px] -translate-x-1/2 items-center gap-3 rounded-xl border-2 border-[#bf7263] bg-[#542f37]/95 p-3 shadow-xl"
            >
              <A_ size={25} className="shrink-0 text-[#f2bc94]" />
              <div className="min-w-0 flex-1">
                <div className="font-display text-xs font-bold text-[#f5d8b5]">
                  IMPOSTER DETECTED
                </div>
                <p className="mt-1 text-[9px] text-[#d2adab]">
                  Special problem available · +{Ve.reward}
                  {` IdeaCoins · First crew wins access`}
                </p>
              </div>
              <bv
                danger={!0}
                onClick={() =>
                  s({
                    type: `imposter`,
                  })
                }
                className="!px-3 !py-2 !text-[9px]"
              >
                Investigate
              </bv>
            </hg.div>
          )}
          {I.status === `ELIMINATED` && (
            <div className="absolute left-1/2 top-36 z-20 -translate-x-1/2 rounded-lg border border-[#bd7568] bg-[#4e2f3b]/95 p-4 text-center">
              <Z className="!text-[#edb191]">CREW ELIMINATED</Z>
              <button
                onClick={() =>
                  s({
                    type: `ejected`,
                  })
                }
                className="mt-2 text-xs underline"
              >
                View final crew status
              </button>
            </div>
          )}
          <div className="pointer-events-none absolute bottom-8 left-8 hidden max-w-[240px] sm:block">
            <div className="mb-2 flex items-center gap-2 font-mono text-[8px] tracking-widest text-[#e5c38a]">
              <span className="h-1 w-1 rounded-full bg-[#e5c38a]" />
              YOUR MISSION
            </div>
            <p className="font-display text-[17px] font-semibold leading-tight text-[#dce5d7]">
              Find the bug.
              <br />
              Fix the code. Stay aboard.
            </p>
            <p className="mt-2 max-w-48 text-[10px] leading-5 text-[#8eabb4]">
              {vv[g]}
            </p>
          </div>
          <div className="absolute bottom-6 left-1/2 z-20 hidden -translate-x-1/2 flex-col items-center gap-3 sm:flex">
            <bm mode="wait">
              {m && !o && (
                <hg.button
                  initial={{
                    y: 10,
                    opacity: 0,
                  }}
                  animate={{
                    y: 0,
                    opacity: 1,
                  }}
                  exit={{
                    y: 10,
                    opacity: 0,
                  }}
                  onClick={() => Xe.current()}
                  className="mb-1 flex items-center gap-3 rounded-lg border-2 border-primary/40 bg-[#0e303b]/95 px-5 py-3 shadow-[0_5px_0_#071723]"
                >
                  <kbd className="rounded border border-primary/50 bg-primary/10 px-2 py-1 font-mono text-xs text-primary">
                    E
                  </kbd>
                  <span className="font-display text-[10px] font-semibold tracking-wider">
                    {rv(ve).find((e) => e.id === m)?.label}
                  </span>
                </hg.button>
              )}
            </bm>
            <div className="flex items-center gap-5 text-[#b8cec8]">
              <div className="flex items-center gap-1">
                {[`W`, `A`, `S`, `D`].map((e) => (
                  <kbd className="flex h-6 w-6 items-center justify-center rounded border border-[#719093]/50 bg-[#17313e]/90 font-mono text-[10px]">
                    {e}
                  </kbd>
                ))}
                <span className="ml-2 text-[10px]">move</span>
              </div>
              <div className="flex items-center gap-1">
                <kbd className="flex h-6 w-6 items-center justify-center rounded border border-[#719093]/50 bg-[#17313e]/90 font-mono text-[10px]">
                  E
                </kbd>
                <span className="ml-2 text-[10px]">interact</span>
              </div>
              <span className="text-[10px] text-[#7e9da9]">
                or scroll to explore
              </span>
            </div>
          </div>
          <div className="pointer-events-none absolute bottom-8 right-8 hidden text-right sm:block">
            <Z className="!text-[#7e9faa]">YOU ARE HERE</Z>
            <div className="mt-2 flex items-center justify-end gap-2 font-display text-xs font-bold tracking-[.12em]">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {String(g).padStart(2, `0`)}
              {` / `}
              {_v[g]}
            </div>
            <div className="mt-3 font-mono text-[7px] tracking-wider text-[#668594]">
              AMONG BUGS · DEBUG + RUN{z_ ? ` · LOCAL DEMO` : ``}
            </div>
          </div>
          <div className="absolute bottom-5 left-5 z-30 grid grid-cols-3 gap-1 sm:hidden">
            <span />
            {it(`w`, <Ig size={18} />)}
            <span />
            {it(`a`, <Mg size={18} />)}
            {it(`s`, <Ag size={18} />)}
            {it(`d`, <Pg size={18} />)}
          </div>
          <button
            onClick={() => Xe.current()}
            className={`absolute bottom-7 right-5 z-30 flex h-16 w-16 flex-col items-center justify-center gap-1 rounded-full border-[3px] bg-[#163644]/95 text-[#afdfd1] shadow-[0_5px_0_#071421] sm:hidden ${m ? `border-primary` : `border-[#4e727b]`}`}
          >
            <span className="font-display text-xl font-bold">E</span>
            <span className="font-mono text-[7px]">INTERACT</span>
          </button>
          <div className="absolute bottom-28 left-1/2 -translate-x-1/2 text-center sm:hidden">
            <Z className="whitespace-nowrap !text-[8px] !text-primary">
              {m ? rv(ve).find((e) => e.id === m)?.label : _v[g]}
            </Z>
          </div>
        </>
      )}
      <bm>
        {i === `login` && (
          <hg.div
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            exit={{
              opacity: 0,
            }}
            className="absolute inset-0 z-40 overflow-y-auto bg-[#061522]/45 starfield"
          >
            <div className="relative mx-auto flex min-h-full max-w-[1450px] flex-col px-6 py-6 sm:px-12 sm:py-9">
              <header className="flex items-center justify-between">
                <Tv />
                <span className="font-mono text-[8px] tracking-widest text-[#92b0b8]">
                  DEBUG + RUN / CREW BOARDING
                </span>
              </header>
              <div className="grid flex-1 items-center gap-8 py-10 lg:grid-cols-[1.3fr_1fr]">
                <div className="relative">
                  <div className="absolute -right-8 -top-24 hidden h-40 w-72 -rotate-12 opacity-80 lg:block">
                    <Dv />
                  </div>
                  <Z className="mb-6 flex items-center gap-2 !text-[#d7c08a]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#d7c08a]" />A
                    DEBUGGING MISSION BY IDEA LAB
                  </Z>
                  <h1 className="font-display text-[14px] font-semibold tracking-[.38em] text-[#bdd8cb]">
                    DEBUG + RUN
                  </h1>
                  <h2 className="mt-3 font-sans text-[65px] font-black leading-[.88] tracking-[-.02em] text-[#f0ecdb] sm:text-[100px]">
                    AMONG
                    <br />
                    <span className="text-[#9ce4d0]">
                      BUGS<span className="text-[#e8b989]">.</span>
                    </span>
                  </h2>
                  <p className="mt-7 font-display text-sm font-medium leading-7 tracking-[.06em] text-[#dce3d2]">
                    FIND THE BUG. FIX THE CODE.
                    <br />
                    <span className="text-[#e2b984]">DON’T GET EJECTED.</span>
                  </p>
                  <div className="mt-7 flex items-center gap-4">
                    <div className="flex -space-x-2">
                      {[`#f28a86`, `#edd07e`, `#83cbaa`, `#af9ddd`].map((e) => (
                        <N_ color={e} size={35} state="still" />
                      ))}
                    </div>
                    <div className="text-[10px] leading-5 text-[#9fb9bc]">
                      One ship. Many crews.
                      <br />
                      <span className="text-[#d2e5d8]">
                        Only the sharpest survive.
                      </span>
                    </div>
                  </div>
                </div>
                <div className="relative mx-auto w-full max-w-[440px] rounded-[22px] border-[3px] border-[#64808a] bg-[#233b49]/95 p-6 shadow-[0_12px_0_#061722,0_20px_80px_#00000040] sm:p-8">
                  <span className="absolute left-4 top-4 h-2 w-2 rounded-full border border-[#758b92] bg-[#0f2431]" />
                  <span className="absolute right-4 top-4 h-2 w-2 rounded-full border border-[#758b92] bg-[#0f2431]" />
                  <div className="mb-6 flex items-center gap-3 border-b border-[#617c81]/40 pb-5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg border-2 border-[#61827e] bg-[#14323c] text-primary">
                      <Kg size={22} />
                    </div>
                    <div>
                      <Z className="!text-primary">SHIP SECURITY / 01</Z>
                      <h3 className="mt-1 font-display text-xl font-bold">
                        Crew registration
                      </h3>
                    </div>
                    <span className="ml-auto h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_#8ae4cf]" />
                  </div>
                  <form onSubmit={$e}>
                    <Cv label="TEAM NAME / REGISTERED USER">
                      <input
                        required={!0}
                        autoComplete="username"
                        value={ee}
                        onChange={(e) => D(e.target.value)}
                        className={yv}
                        placeholder="Your registered crew"
                      />
                    </Cv>
                    <Cv label="PASSWORD">
                      <input
                        required={!0}
                        autoComplete="current-password"
                        type="password"
                        value={te}
                        onChange={(e) => O(e.target.value)}
                        className={yv}
                        placeholder="Enter your password"
                      />
                    </Cv>
                    {k && (
                      <p
                        role="alert"
                        className="mb-4 text-xs leading-5 text-[#f3b399]"
                      >
                        {k}
                      </p>
                    )}
                    <bv
                      type="submit"
                      disabled={u}
                      className="mt-2 w-full !py-3.5"
                    >
                      {u ? (
                        <Xg size={16} className="animate-spin" />
                      ) : (
                        <Pg size={16} />
                      )}
                      Authenticate crew
                    </bv>
                  </form>
                  <div className="mt-6 flex items-center gap-2 border-t border-[#5b767b]/40 pt-4">
                    <g_ size={14} className="shrink-0 text-[#c9b486]" />
                    <p className="text-[9px] leading-4 text-[#acbec0]">
                      One access card for your entire team.
                      <br />
                      Your Crew ID is assigned after authentication.
                    </p>
                  </div>
                  {z_ && (
                    <div className="mt-5 rounded-lg border border-[#819a89]/20 bg-[#112b37]/70 p-3">
                      <div className="mb-2 font-mono text-[8px] tracking-wider text-[#e3c68b]">
                        LOCAL PLAYABLE DEMO
                      </div>
                      <div className="flex items-center justify-between gap-3 text-[10px]">
                        <span className="text-[#a8c1c2]">
                          NEXORA or COMMANDER
                          <br />
                          Any nonempty password
                        </span>
                        <button
                          onClick={() => {
                            (D(`NEXORA`), O(`demo`));
                          }}
                          className="text-primary underline underline-offset-4"
                        >
                          Fill demo access
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#557080]/30 pt-5">
                <span className="font-mono text-[8px] tracking-widest text-[#8aabb5]">
                  POWERED BY IDEA LAB · SGSITS INDORE
                </span>
                <div className="flex items-center gap-2 text-[9px] text-[#a2c4bc]">
                  <span className="h-1 w-1 rounded-full bg-primary" />
                  SHIP SYSTEMS READY FOR BOARDING
                </div>
              </footer>
            </div>
          </hg.div>
        )}
      </bm>
      {i === `card` && n && (
        <hg.div
          initial={{
            opacity: 0,
          }}
          animate={{
            opacity: 1,
          }}
          className="absolute inset-0 z-40 flex flex-col items-center justify-center overflow-y-auto bg-[#071722]/80 p-5 text-center starfield"
        >
          <Z className="mb-3 !text-primary">
            SHIP SECURITY / IDENTITY CONFIRMED
          </Z>
          <h1 className="mb-7 font-display text-3xl font-bold">
            Crew card generated.
          </h1>
          <hg.div
            initial={{
              y: 80,
              opacity: 0,
              rotate: 6,
            }}
            animate={{
              y: 0,
              opacity: 1,
              rotate: 0,
            }}
            transition={{
              duration: 0.8,
              type: `spring`,
            }}
            className="w-full max-w-[380px]"
          >
            <Ev crew={I} identity={n} />
          </hg.div>
          <p className="mb-7 mt-8 text-sm text-muted">
            This card belongs to your entire team.
          </p>
          <bv onClick={et} className="px-9">
            Enter ship
            <Pg size={16} />
          </bv>
        </hg.div>
      )}
      <bm>
        {i === `cinematic` && (
          <hg.div
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            exit={{
              opacity: 0,
            }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black text-center"
          >
            <hg.div
              initial={{
                opacity: 0,
                y: 15,
              }}
              animate={{
                opacity: [0, 1, 1, 0],
                y: 0,
              }}
              transition={{
                duration: 2.5,
                times: [0, 0.25, 0.8, 1],
              }}
            >
              <Z className="mb-5 !text-[#aec7bb]">WELCOME TO</Z>
              <h1 className="font-sans text-5xl font-extrabold tracking-wide text-[#f0f0dc] sm:text-7xl">
                {`AMONG `}
                <span className="text-primary">BUGS.</span>
              </h1>
              <p className="mt-6 font-display text-sm tracking-widest text-[#91b2a8]">
                DEBUG + RUN
                <br />
                <span className="mt-2 block text-xs">by Idea Lab</span>
              </p>
            </hg.div>
          </hg.div>
        )}
      </bm>
      <bm>
        {o && i === `ship` && (
          <hg.div
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            exit={{
              opacity: 0,
            }}
            className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[#04131e]/70 p-2 backdrop-blur-[3px] sm:p-6"
            style={
              [`ejected`, `checking`].includes(o.type)
                ? {
                    backgroundColor: `#030811`,
                  }
                : void 0
            }
            onClick={() => s(null)}
          >
            <hg.section
              initial={{
                opacity: 0,
                scale: 0.92,
                y: 20,
              }}
              animate={{
                opacity: 1,
                scale: 1,
                y: 0,
              }}
              exit={{
                opacity: 0,
                scale: 0.95,
                y: 10,
              }}
              transition={{
                duration: 0.25,
              }}
              role="dialog"
              aria-modal="true"
              aria-label={
                o.type === `engineering`
                  ? `Engineering terminal`
                  : o.type === `admin`
                    ? `Commander terminal`
                    : o.type
              }
              onClick={(e) => e.stopPropagation()}
              className={`relative my-auto max-h-[90vh] w-full overflow-y-auto rounded-[18px] border-[3px] border-[#668991] bg-[#203b49] p-5 shadow-[0_10px_0_#051521,0_30px_100px_#0009] sm:p-7 ${[`engineering`, `admin`].includes(o.type) ? `max-w-[1170px]` : `max-w-[680px]`} ${[`ejected`, `checking`].includes(o.type) ? `!border-transparent !bg-transparent !shadow-none starfield` : ``} ${o.type === `imposter` || (He?.imposter && o.type === `engineering`) ? `!border-[#c67c6b] !bg-[#392e3c]` : ``}`}
            >
              <div className="mb-5 flex items-center justify-between border-b border-white/15 pb-3">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  <Z className="!text-[8px]">
                    AMONG BUGS / SHIP SYSTEM INTERFACE
                  </Z>
                </div>
                <button
                  aria-label="Exit terminal"
                  onClick={() => {
                    (s(null), he(null));
                  }}
                  className="rounded-md border border-[#718e95]/40 bg-[#18333f] p-1.5 text-[#b9d2cd] hover:bg-[#3a5a63]"
                >
                  <O_ size={16} />
                </button>
              </div>
              {ct()}
            </hg.section>
          </hg.div>
        )}
      </bm>
      <bm>
        {ge && (
          <hg.div
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            className="absolute inset-0 z-[70] flex items-center justify-center bg-[#05131d]/90 p-5"
          >
            <section
              role="alertdialog"
              aria-label="Confirm command action"
              className="w-full max-w-md rounded-xl border-2 border-[#bd816b] bg-[#3a303c] p-8 text-center"
            >
              <b_ size={38} className="mx-auto mb-5 text-[#e5ac8e]" />
              <h2 className="font-display text-xl font-bold">{ge.title}</h2>
              <p className="my-4 text-xs leading-6 text-muted">
                This action affects the competition and cannot be undone.
              </p>
              <div className="flex justify-center gap-3">
                <bv secondary={!0} onClick={() => _e(null)}>
                  Cancel
                </bv>
                <bv
                  danger={!0}
                  disabled={u}
                  onClick={async () => {
                    (await qe(ge.action, ge.payload), _e(null));
                  }}
                >
                  Confirm
                </bv>
              </div>
            </section>
          </hg.div>
        )}
      </bm>
      <bm>
        {c && (
          <hg.div
            role="status"
            initial={{
              opacity: 0,
              y: 20,
            }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            exit={{
              opacity: 0,
              y: -10,
            }}
            className="absolute bottom-36 left-1/2 z-[80] flex w-max max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-lg border-2 border-[#89b7af] bg-[#13333f]/95 px-4 py-3 text-xs text-[#d7e9dd] shadow-xl sm:bottom-28"
          >
            <c_ size={14} className="shrink-0 text-primary" />
            {c}
            <button aria-label="Dismiss notification" onClick={() => l(``)}>
              <O_ size={12} />
            </button>
          </hg.div>
        )}
      </bm>
    </div>
  );
}
function kv({
  task: e,
  crew: t,
  identity: n,
  seconds: r,
  rank: i,
  now: a,
  perform: o,
  notify: s,
  onCorrect: c,
  onExit: l,
}) {
  let u = `among-bugs-code-${t.id}-${e.id}`,
    [d, f] = (0, x.useState)(
      () =>
        localStorage.getItem(u) ||
        e.code ||
        `#include <iostream>
using namespace std;

int main() {
    int readings[] = {6, 8, 10, 18};
    int total = 0;

    for (int i = 0; i < 3; i++) {
        total += readings[i];
    }

    cout << total << endl;
    return 0;
}`,
    ),
    [p, m] = (0, x.useState)([d]),
    [h, g] = (0, x.useState)(0),
    [_, v] = (0, x.useState)(`> diagnostic system ready
> awaiting repair command…`),
    [y, b] = (0, x.useState)(!1),
    [S, C] = (0, x.useState)(``),
    [w, T] = (0, x.useState)(`CODE`),
    [E, ee] = (0, x.useState)(!1),
    [D, te] = (0, x.useState)(!1),
    [O, k] = (0, x.useState)(
      e.hints.includes(n.crewId)
        ? e.hint || `Hint purchased. Request it from the server.`
        : ``,
    ),
    A = (0, x.useRef)(null),
    j = e.imposter
      ? Math.max(0, Math.ceil(((e.solveUntil || a) - a) / 1e3))
      : r;
  function M(e) {
    (f(e), localStorage.setItem(u, e));
    let t = [...p.slice(0, h + 1), e];
    (m(t), g(t.length - 1));
  }
  async function ne() {
    (b(!0),
      v(`> INITIALIZING...`),
      await new Promise((e) => setTimeout(e, 300)),
      v(`> INITIALIZING...
> COMPILING...`),
      await new Promise((e) => setTimeout(e, 300)),
      v(`> INITIALIZING...
> COMPILING...
> RUNNING DIAGNOSTIC...`));
    try {
      v(
        (
          await o(`run`, {
            taskId: e.id,
            code: d,
          })
        ).result || `> No output returned.`,
      );
    } catch (e) {
      v(`> SYSTEM ERROR\n${e.message}`);
    } finally {
      b(!1);
    }
  }
  async function re(t) {
    (t.preventDefault(), te(!0));
    try {
      (
        await o(`submit`, {
          taskId: e.id,
          answer: S,
        })
      ).result === `CORRECT`
        ? c()
        : ee(!0);
    } catch (e) {
      s(e.message);
    } finally {
      te(!1);
    }
  }
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Z className={e.imposter ? `!text-[#e8ae94]` : `!text-primary`}>
            {e.imposter ? `IMPOSTER PROTOCOL` : `ENGINEERING TERMINAL`}
          </Z>
          <h2 className="mt-1 font-display text-2xl font-bold">
            {e.id}
            {` / System repair`}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <wv>{e.difficulty}</wv>
          <span className="font-mono text-sm text-primary">#{i}</span>
          <span className="flex items-center gap-1.5 font-mono text-xs text-[#e8cf91]">
            <xv />
            {e.reward}
          </span>
          <span className="flex items-center gap-1.5 font-mono text-xs text-[#e8cf91]">
            <Hg size={14} />
            {t.coins.toLocaleString()}
          </span>
          <div>
            <Z className="!text-[7px]">
              {e.imposter ? `PROTOCOL TIME` : `ROUND TIME`}
            </Z>
            <Sv seconds={j} className="text-lg" />
            {e.imposter && (
              <div className="mt-1 font-mono text-[8px] text-muted">
                {`ROUND `}
                <Sv seconds={r} />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="mb-4 flex gap-2 md:hidden">
        {[`CODE`, `TERMINAL`, `MISSION`].map((e) => (
          <bv
            secondary={w !== e}
            onClick={() => T(e)}
            className="!px-3 !py-2 !text-[10px]"
          >
            {e}
          </bv>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.9fr)_minmax(240px,1fr)]">
        <div className="min-w-0 space-y-4">
          <div
            className={`overflow-hidden rounded-xl border-2 border-[#4e6b79] bg-[#0d202c] ${w === `CODE` ? `` : `hidden md:block`}`}
          >
            <div className="flex items-center justify-between border-b border-[#36515f] px-3 py-3">
              <span className="flex items-center gap-2 font-mono text-[10px] text-[#b5d1cc]">
                <Bg size={13} />
                BUGGED_PROGRAM.cpp
              </span>
              <div className="flex gap-1">
                {[
                  {
                    icon: w_,
                    label: `Undo`,
                    action: () => {
                      let e = Math.max(0, h - 1);
                      (g(e), f(p[e]), localStorage.setItem(u, p[e]));
                    },
                  },
                  {
                    icon: u_,
                    label: `Redo`,
                    action: () => {
                      let e = Math.min(p.length - 1, h + 1);
                      (g(e), f(p[e]), localStorage.setItem(u, p[e]));
                    },
                  },
                  {
                    icon: f_,
                    label: `Reset code`,
                    action: () =>
                      M(
                        e.code ||
                          `#include <iostream>
using namespace std;

int main() {
    int readings[] = {6, 8, 10, 18};
    int total = 0;

    for (int i = 0; i < 3; i++) {
        total += readings[i];
    }

    cout << total << endl;
    return 0;
}`,
                      ),
                  },
                  {
                    icon: Wg,
                    label: `Copy code`,
                    action: () =>
                      void navigator.clipboard
                        .writeText(d)
                        .then(() => s(`Code copied.`))
                        .catch(() =>
                          s(`Clipboard unavailable. Select and copy the code.`),
                        ),
                  },
                ].map((e) => (
                  <button
                    title={e.label}
                    aria-label={e.label}
                    onClick={e.action}
                    className="rounded p-1 text-[#8eafb8] hover:bg-[#3e5966]"
                  >
                    <e.icon size={13} />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 border-b border-[#904e46]/30 bg-[#904e46]/10 px-3 py-2 font-mono text-[8px] text-[#e4a18d]">
              <b_ size={11} />
              BUG DETECTED / REPAIR REQUIRED
            </div>
            <div className="relative h-[340px] overflow-hidden font-mono text-[11px] leading-[23px]">
              <pre
                ref={A}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre p-4 text-[#cadbd7]"
              >
                {d
                  .split(
                    `
`,
                  )
                  .map((e, t) => (
                    <div>
                      <span className="mr-5 inline-block w-5 text-right text-[#537681]">
                        {t + 1}
                      </span>
                      <span
                        className={
                          e.includes(`#include`)
                            ? `text-[#c5abea]`
                            : e.includes(`for`)
                              ? `text-[#e0bf89]`
                              : e.includes(`cout`)
                                ? `text-primary`
                                : e.includes(`int`)
                                  ? `text-[#8dc5da]`
                                  : ``
                        }
                      >
                        {e || ` `}
                      </span>
                    </div>
                  ))}
              </pre>
              <textarea
                aria-label="Editable C++ code"
                value={d}
                onChange={(e) => M(e.target.value)}
                onScroll={(e) => {
                  A.current &&
                    ((A.current.scrollTop = e.currentTarget.scrollTop),
                    (A.current.scrollLeft = e.currentTarget.scrollLeft));
                }}
                onKeyDown={(e) => {
                  if (e.key === `Tab`) {
                    e.preventDefault();
                    let t = e.currentTarget,
                      n = t.selectionStart;
                    (M(d.slice(0, n) + `    ` + d.slice(t.selectionEnd)),
                      requestAnimationFrame(() => {
                        t.selectionStart = t.selectionEnd = n + 4;
                      }));
                  }
                }}
                spellCheck={!1}
                wrap="off"
                className="absolute inset-0 h-full w-full resize-none whitespace-pre bg-transparent p-4 pl-[56px] text-transparent caret-primary outline-none selection:bg-primary/20"
              />
            </div>
            <div className="flex justify-between border-t border-[#36515f] px-3 py-2 font-mono text-[8px] text-[#6c929d]">
              <span>C++17 / UTF-8</span>
              <span>
                {z_ ? `LOCAL DIAGNOSTIC SIMULATION` : `SERVER EXECUTION`}
              </span>
            </div>
          </div>
          <div
            className={`overflow-hidden rounded-xl border-2 border-[#4e6b79] bg-[#0d202c] ${w === `TERMINAL` ? `` : `hidden md:block`}`}
          >
            <div className="flex items-center justify-between border-b border-[#36515f] px-4 py-3">
              <Z>SHIP TERMINAL</Z>
              <button
                className="text-[10px] text-muted"
                onClick={() => v(`> terminal cleared`)}
              >
                Clear
              </button>
            </div>
            <pre className="min-h-40 whitespace-pre-wrap p-4 font-mono text-[10px] leading-6 text-primary">
              {_}
            </pre>
            {y && (
              <div className="mx-4 mb-4 h-1 overflow-hidden rounded bg-primary/10">
                <hg.div
                  initial={{
                    width: 0,
                  }}
                  animate={{
                    width: `100%`,
                  }}
                  transition={{
                    duration: 1.3,
                  }}
                  className="h-full bg-primary"
                />
              </div>
            )}
            <div className="flex items-center gap-3 border-t border-[#36515f] p-4">
              <bv disabled={y} onClick={ne} className="!py-2">
                {y ? (
                  <Xg size={14} className="animate-spin" />
                ) : (
                  <i_ size={14} />
                )}
                Run system
              </bv>
              <button onClick={l} className="ml-auto text-[10px] text-muted">
                Exit terminal
              </button>
            </div>
          </div>
        </div>
        <div
          className={`space-y-4 ${w === `MISSION` ? `` : `hidden md:block`}`}
        >
          <div className="rounded-xl border-2 border-[#4e6b79] bg-[#15303c] p-5">
            <Z>REPAIR OBJECTIVE</Z>
            <p className="mt-3 text-xs leading-6 text-[#d3e1d9]">
              {e.objective}
            </p>
            <div className="mt-5 border-t border-white/15 pt-4">
              <Z className="flex items-center gap-2 !text-[#e1c18b]">
                <Qg size={12} />
                {`SYSTEM HINT / `}
                {O ? `DECRYPTED` : `ENCRYPTED`}
              </Z>
              {O ? (
                <p className="mt-3 text-xs leading-6 text-[#d8e5d8]">{O}</p>
              ) : (
                <>
                  <p className="my-3 text-[11px] leading-5 text-muted">
                    Need assistance? Classified information costs{` `}
                    {e.hintCost}
                    {` IdeaCoins.`}
                  </p>
                  <bv
                    secondary={!0}
                    disabled={D || t.coins < e.hintCost}
                    onClick={async () => {
                      te(!0);
                      try {
                        (k(
                          (
                            await o(`hint`, {
                              taskId: e.id,
                            })
                          ).result || `System hint unlocked.`,
                        ),
                          s(`−${e.hintCost} IdeaCoins / hint decrypted`));
                      } catch (e) {
                        s(e.message);
                      } finally {
                        te(!1);
                      }
                    }}
                    className="w-full !px-2 !py-2.5"
                  >
                    Decrypt hint
                    <xv size={15} />
                    {e.hintCost}
                  </bv>
                </>
              )}
            </div>
          </div>
          <div className="rounded-xl border-2 border-[#4e6b79] bg-[#15303c] p-5">
            <Z className="!text-primary">FINAL SYSTEM OUTPUT</Z>
            <p className="my-3 text-[11px] leading-5 text-muted">
              Submit the output of your repaired program.
            </p>
            <form onSubmit={re}>
              <input
                required={!0}
                value={S}
                onChange={(e) => C(e.target.value)}
                aria-label="Final system output"
                placeholder="Enter answer"
                className={`${yv} font-mono`}
              />
              <bv
                disabled={D || e.status === `SOLVED` || (e.imposter && j === 0)}
                type="submit"
                className="mt-3 w-full !px-2"
              >
                Verify repair
                <g_ size={14} />
              </bv>
            </form>
            {e.imposter && j === 0 && (
              <p className="mt-3 text-xs text-[#f3ad92]">
                Protocol time limit exceeded.
              </p>
            )}
          </div>
          <div className="flex items-center gap-3 px-2">
            <N_ color={t.color} size={42} state="working" />
            <p className="text-[10px] leading-5 text-[#b1c4c3]">
              One bug at a time.
              <br />
              Your crew is counting on you.
            </p>
          </div>
        </div>
      </div>
      <bm>
        {E && (
          <hg.div
            initial={{
              opacity: 0,
            }}
            animate={{
              opacity: 1,
            }}
            className="absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-[#06151d]/90 p-6"
          >
            <hg.div
              animate={{
                x: [0, -6, 6, -3, 3, 0],
              }}
              className="max-w-sm rounded-xl border-2 border-[#b67663] bg-[#462f39] p-8 text-center"
            >
              <b_ size={40} className="mx-auto mb-5 text-[#edab8d]" />
              <Z className="!text-[#edab8d]">REPAIR FAILED</Z>
              <h3 className="my-3 font-display text-2xl font-bold">
                BUG STILL DETECTED
              </h3>
              <p className="mb-6 text-xs text-muted">
                The bug is still among us.
              </p>
              <bv danger={!0} onClick={() => ee(!1)}>
                Try again
                <f_ size={14} />
              </bv>
            </hg.div>
          </hg.div>
        )}
      </bm>
    </>
  );
}
function Av({ crew: e, onSave: t, onCancel: n }) {
  let [r, i] = (0, x.useState)(!1);
  return (
    <form
      onSubmit={async (n) => {
        (n.preventDefault(), i(!0));
        let r = new FormData(n.currentTarget);
        (await t({
          id: e?.id || ``,
          name: String(r.get(`name`)).toUpperCase(),
          color: String(r.get(`color`)),
          members: Number(r.get(`members`)),
          coins: Number(r.get(`coins`)),
          tasks: e?.tasks || 0,
          status: e?.status || `ACTIVE`,
        }),
          i(!1));
      }}
    >
      <h3 className="mb-5 font-display text-xl font-bold">
        {e ? `Edit crew identity` : `Register a new crew`}
      </h3>
      <Cv label="TEAM NAME">
        <input
          required={!0}
          name="name"
          defaultValue={e?.name || ``}
          className={yv}
        />
      </Cv>
      <div className="grid grid-cols-2 gap-4">
        <Cv label="MEMBERS">
          <input
            required={!0}
            name="members"
            type="number"
            min="3"
            max="4"
            defaultValue={e?.members || 4}
            className={yv}
          />
        </Cv>
        <Cv label="IDEACOINS">
          <input
            required={!0}
            name="coins"
            type="number"
            min="0"
            defaultValue={e?.coins || 0}
            className={yv}
          />
        </Cv>
      </div>
      <Cv label="CREWMATE COLOR">
        <select
          name="color"
          defaultValue={e?.color || `#51cfdf`}
          className={yv}
        >
          {[
            [`Cyan`, `#51cfdf`],
            [`Red`, `#f37983`],
            [`Green`, `#86cd97`],
            [`Yellow`, `#edd478`],
            [`Purple`, `#b298e7`],
            [`Orange`, `#efae77`],
            [`Pink`, `#d693b9`],
            [`Blue`, `#7dace9`],
            [`Lime`, `#b3d77c`],
          ].map(([e, t]) => (
            <option value={t}>{e}</option>
          ))}
        </select>
      </Cv>
      <div className="flex justify-end gap-3">
        <bv secondary={!0} onClick={n}>
          Cancel
        </bv>
        <bv disabled={r} type="submit">
          Save crew
          <Lg size={14} />
        </bv>
      </div>
    </form>
  );
}
function jv({ task: e, imposter: t, onSave: n, onCancel: r }) {
  let [i, a] = (0, x.useState)(!1);
  return (
    <form
      onSubmit={async (t) => {
        (t.preventDefault(), a(!0));
        let r = new FormData(t.currentTarget),
          i = (e) => String(r.get(e) || ``);
        (await n(
          {
            id: e?.id || ``,
            name: i(`name`),
            category: i(`category`) || `Imposter`,
            difficulty: i(`difficulty`),
            reward: Number(i(`reward`)),
            hintCost: Number(i(`hintCost`)),
            status: e?.status || `AVAILABLE`,
            claimedBy: e?.claimedBy,
            hints: e?.hints || [],
            code: i(`code`),
            answer: i(`answer`),
            hint: i(`hint`),
            objective: i(`objective`),
          },
          Number(i(`claimSeconds`)) || 45,
          Number(i(`solveSeconds`)) || 480,
        ),
          a(!1));
      }}
    >
      <Z className={t ? `!text-[#eab298]` : `!text-primary`}>
        {t ? `EMERGENCY RELEASE PROTOCOL` : `SHIP TASK DATABASE`}
      </Z>
      <h3 className="my-3 font-display text-xl font-bold">
        {t
          ? `Release imposter problem`
          : e
            ? `Edit repair request`
            : `Create repair request`}
      </h3>
      <Cv label="TASK NAME">
        <input
          required={!0}
          name="name"
          defaultValue={e?.name || ``}
          placeholder="Restore the reactor"
          className={yv}
        />
      </Cv>
      <div className="grid grid-cols-2 gap-4">
        {!t && (
          <Cv label="CATEGORY">
            <select
              name="category"
              defaultValue={e?.category || `Basic Programming`}
              className={yv}
            >
              {P_.map((e) => (
                <option>{e.name}</option>
              ))}
            </select>
          </Cv>
        )}
        <Cv label="DIFFICULTY">
          <select
            name="difficulty"
            defaultValue={e?.difficulty || (t ? `HARD` : `MEDIUM`)}
            className={yv}
          >
            {[`EASY`, `MEDIUM`, `HARD`].map((e) => (
              <option>{e}</option>
            ))}
          </select>
        </Cv>
      </div>
      <Cv label="PROBLEM STATEMENT">
        <textarea
          required={!0}
          name="objective"
          defaultValue={
            e?.objective ||
            `Repair the diagnostic loop to sum all four readings: 6, 8, 10, and 18.`
          }
          className={yv}
        />
      </Cv>
      <Cv label="BUGGY CODE">
        <textarea
          required={!0}
          spellCheck={!1}
          name="code"
          defaultValue={
            e?.code ||
            `#include <iostream>
using namespace std;

int main() {
    int readings[] = {6, 8, 10, 18};
    int total = 0;

    for (int i = 0; i < 3; i++) {
        total += readings[i];
    }

    cout << total << endl;
    return 0;
}`
          }
          className={`${yv} min-h-40 font-mono text-xs`}
        />
      </Cv>
      <div className="grid grid-cols-2 gap-4">
        <Cv label="CORRECT OUTPUT">
          <input
            required={!0}
            name="answer"
            defaultValue={e?.answer || `42`}
            className={yv}
          />
        </Cv>
        <Cv label="IDEACOIN REWARD">
          <input
            required={!0}
            min="0"
            type="number"
            name="reward"
            defaultValue={e?.reward || (t ? 500 : 200)}
            className={yv}
          />
        </Cv>
      </div>
      <Cv label="SYSTEM HINT">
        <textarea
          required={!0}
          name="hint"
          defaultValue={e?.hint || `Check how many readings the loop visits.`}
          className={yv}
        />
      </Cv>
      <Cv label="HINT COST">
        <input
          required={!0}
          min="0"
          type="number"
          name="hintCost"
          defaultValue={e?.hintCost ?? 50}
          className={yv}
        />
      </Cv>
      {t && (
        <div className="grid grid-cols-2 gap-4">
          <Cv label="CLAIM WINDOW (SECONDS)">
            <input
              name="claimSeconds"
              type="number"
              min="10"
              max="300"
              required={!0}
              defaultValue={45}
              className={yv}
            />
          </Cv>
          <Cv label="SOLVE TIME (SECONDS)">
            <input
              name="solveSeconds"
              type="number"
              min="30"
              max="1800"
              required={!0}
              defaultValue={480}
              className={yv}
            />
          </Cv>
        </div>
      )}
      <div className="flex justify-end gap-3">
        <bv secondary={!0} onClick={r}>
          Cancel
        </bv>
        <bv danger={t} disabled={i} type="submit">
          {t ? `Release to all crews` : `Save system`}
          <m_ size={14} />
        </bv>
      </div>
    </form>
  );
}
var Mv = zi([
  {
    path: `*`,
    Component: Ov,
  },
]);
function Nv() {
  return (
    <Dm reducedMotion="user">
      <Yr router={Mv} />
    </Dm>
  );
}
var Pv = `/workspaces/default/.publishing/src/main.tsx`;
mg.createRoot(document.getElementById(`root`)).render(
  <x.StrictMode>
    <Nv />
  </x.StrictMode>,
);
