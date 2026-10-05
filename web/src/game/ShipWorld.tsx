/**
 * The playable spaceship, ported from the Figma Make design: four horizontally
 * arranged rooms (Command Bridge → Lobby → Task Deck → Rankings) rendered as
 * one SVG. Positions are presentation only; nothing here is security state.
 */
import { motion } from 'motion/react';
import { forwardRef, memo, type Ref, type RefObject } from 'react';
import type { BoardRow, DomainDto } from '../lib/api';
import { Crewmate } from '../components/ui';

export const ROOM_NAMES = ['EMERGENCY BRIDGE', 'MAIN LOBBY', 'TASK DECK', 'CREW RANKINGS'];
export const ROOM_SHORT = ['BRIDGE', 'LOBBY', 'TASKS', 'RANKINGS'];
export const ROOM_LINES = [
  'Emergency broadcasts land here. Watch for the imposter.',
  'Your adventure starts here. Make yourself at home.',
  'A broken system is an opportunity in disguise.',
  'Every repair brings your crew closer to the stars.',
];

/** Static fallbacks so the ship renders before the first snapshot. */
export const DEFAULT_DOMAINS: DomainDto[] = [
  { slug: 'web', name: 'Web Development', room: 'COMMUNICATIONS', color: '#b5a2ec', symbol: '</>', prefix: 'WEB', workspace: 'WEB' },
  { slug: 'data', name: 'Data', room: 'DATABASE CORE', color: '#87b6e5', symbol: '≡', prefix: 'DATA', workspace: 'DATA' },
  { slug: 'ds', name: 'Data Structures', room: 'NAVIGATION', color: '#e1b775', symbol: '⌘', prefix: 'DS', workspace: 'DS' },
  { slug: 'basic', name: 'Basic Programming', room: 'REACTOR', color: '#8ae4bf', symbol: '>_', prefix: 'REACTOR', workspace: 'BASIC' },
  { slug: 'design', name: 'Designing', room: 'DESIGN LAB', color: '#dea4ca', symbol: '✧', prefix: 'DESIGN', workspace: 'DESIGN' },
  { slug: 'misc', name: 'Miscellaneous', room: 'STORAGE', color: '#e3a178', symbol: '{}', prefix: 'MISC', workspace: 'MISC' },
].map((d) => ({ ...d, counts: { total: 0, available: 0, solvedByYou: 0, solvedByOthers: 0, expired: 0 } }));

export interface Interactable {
  id: string;
  label: string;
  room: number;
  x: number;
  y: number;
}

const COLS = [370, 800, 1230];

export function interactables(roomWidth: number, domains: DomainDto[]): Interactable[] {
  const k = roomWidth / 1600;
  return [
    { id: 'command', label: 'OPEN EMERGENCY CONSOLE', room: 0, x: roomWidth * 0.5, y: 670 },
    { id: 'manifest', label: 'VIEW CREW ACCESS CARD', room: 1, x: roomWidth * 1.5, y: 580 },
    ...domains.slice(0, 6).map((d, i) => ({ id: `station-${i}`, label: `OPEN ${d.room}`, room: 2, x: 2 * roomWidth + COLS[i % 3] * k, y: i < 3 ? 568 : 650 })),
    { id: 'rankings', label: 'VIEW CREW RANKINGS', room: 3, x: roomWidth * 3.5, y: 665 },
  ];
}

export function obstacles(roomWidth: number) {
  const k = roomWidth / 1600;
  const r = (room: number, x: number, y: number, w: number, h: number) => ({ x: room * roomWidth + x * k, y, width: w * k, height: h });
  return [
    r(0, 380, 555, 840, 60), r(0, 470, 700, 180, 145), r(0, 950, 700, 180, 145),
    r(1, 260, 510, 330, 80), r(1, 1110, 750, 180, 90), r(3, 610, 700, 390, 50),
    ...[0, 1, 2].map((i) => r(2, COLS[i] - 110, 710, 220, 140)),
  ];
}

function Rivet({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <circle cx={x} cy={y} r="5" fill="#0b1821" stroke="#506473" strokeWidth="2" />
      <path d={`M${x - 2} ${y - 2}l4 4`} stroke="#718391" />
    </g>
  );
}

function SpaceWindow({ x = 280, y = 190, width = 1040, height = 230, panorama = false }: { x?: number; y?: number; width?: number; height?: number; panorama?: boolean }) {
  return (
    <g>
      <defs>
        <clipPath id={`window-clip-${x}-${y}`}>
          <rect x={x + 9} y={y + 9} width={width - 18} height={height - 18} rx={panorama ? 64 : 27} />
        </clipPath>
      </defs>
      <rect x={x - 10} y={y - 10} width={width + 20} height={height + 20} rx={panorama ? 80 : 40} fill="#07101a" stroke="#07131d" strokeWidth="14" />
      <rect x={x} y={y} width={width} height={height} rx={panorama ? 70 : 32} fill="url(#space-window)" stroke="#536c7b" strokeWidth="7" />
      <rect x={x + 9} y={y + 9} width={width - 18} height={height - 18} rx={panorama ? 64 : 27} fill="none" stroke="#84c9c0" strokeOpacity=".32" strokeWidth="2" />
      <g clipPath={`url(#window-clip-${x}-${y})`}>
        <g data-parallax="stars">
          {Array.from({ length: 32 }, (_, a) => (
            <circle key={a} cx={x + 28 + ((a * 79) % (width - 56))} cy={y + 25 + ((a * 47) % (height - 50))} r={a % 5 === 0 ? 2 : 1} fill="#d8e8f3" opacity={a % 3 === 0 ? 0.8 : 0.3} />
          ))}
          <circle cx={x + width * 0.73} cy={y + height * 0.48} r={height * 0.33} fill="#253f55" />
          <path d={`M${x + width * 0.73 - height * 0.4} ${y + height * 0.48 + 20}q${height * 0.3} -38 ${height * 0.8} -22`} fill="none" stroke="#7f8db5" strokeWidth="10" opacity=".28" />
          <path d={`M${x + width * 0.74} ${y + 18}q-50 25 -30 ${height * 0.62}`} fill="none" stroke="#536c83" strokeWidth="15" opacity=".22" />
        </g>
      </g>
      {[0.25, 0.5, 0.75].map((f) => (
        <path key={f} d={`M${x + width * f} ${y + 2}v${height - 4}`} stroke="#435766" strokeWidth="10" />
      ))}
      <path d={`M${x + 20} ${y + 20}h${width * 0.43}l-90 ${height - 40}h-90Z`} fill="#9ce1df" opacity=".035" />
    </g>
  );
}

function Monitor({ x, y, width = 120, color = '#8ae4cf', text = 'ONLINE' }: { x: number; y: number; width?: number; color?: string; text?: string }) {
  return (
    <g>
      <rect x={x} y={y} width={width} height="72" rx="12" fill="#172631" stroke="#09141d" strokeWidth="6" />
      <rect x={x + 9} y={y + 9} width={width - 18} height="52" rx="5" fill="#092329" stroke={color} strokeOpacity=".3" strokeWidth="2" />
      <path d={`M${x + 18} ${y + 38}l12 -8 10 15 16 -23 13 13h${Math.max(5, width - 91)}`} stroke={color} strokeWidth="2" fill="none" className="animate-[monitor_4s_ease-in-out_infinite]" />
      <text x={x + width / 2} y={y + 55} fill={color} fontSize="7" textAnchor="middle" fontFamily="monospace" letterSpacing="2">
        {text}
      </text>
    </g>
  );
}

function Crate({ x, y, size = 110 }: { x: number; y: number; size?: number }) {
  return (
    <g>
      <ellipse cx={x + size * 0.55} cy={y + size + 12} rx={size * 0.65} ry="13" fill="#04101a" opacity=".5" />
      <path d={`M${x} ${y + 15}l25 -15h${size - 10}v${size - 5}l-20 20h-${size - 5}Z`} fill="#394952" stroke="#0b1821" strokeWidth="7" />
      <path d={`M${x} ${y + 15}h${size - 5}v${size}h-${size - 5}Z`} fill="#58656a" stroke="#172b35" strokeWidth="5" />
      <path d={`M${x + size - 5} ${y + 15}l20 -15M${x + 15} ${y + 30}l${size - 36} ${size - 32}M${x + size - 20} ${y + 30}l-${size - 36} ${size - 32}`} stroke="#33464e" strokeWidth="9" />
      <rect x={x + size * 0.32} y={y + size * 0.48} width="37" height="22" rx="3" fill="#b99a64" stroke="#1c303b" strokeWidth="3" />
      <text x={x + size * 0.32 + 18} y={y + size * 0.48 + 15} fontSize="9" fill="#182a32" textAnchor="middle" fontFamily="monospace">
        D+R
      </text>
    </g>
  );
}

function Benches({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <ellipse cx={x + 144} cy={y + 87} rx="160" ry="15" fill="#05141e" opacity=".5" />
      {[0, 95, 190].map((n) => (
        <g key={n} transform={`translate(${x + n} ${y})`}>
          <path d="M2 5Q2 -4 16 -4H61Q73 -4 75 8L83 58H0Z" fill="#4a696b" stroke="#0b1a23" strokeWidth="6" />
          <rect x="-4" y="46" width="92" height="34" rx="12" fill="#708e84" stroke="#0b1a23" strokeWidth="6" />
          <path d="M8 30H68M10 83v18M70 83v18" stroke="#263c44" strokeWidth="8" />
          <rect x="3" y="59" width="76" height="7" rx="3" fill="#9fba9a" opacity=".3" />
        </g>
      ))}
    </g>
  );
}

function Station({ index, domain, active, locked, onInteract }: { index: number; domain: DomainDto; active: boolean; locked: boolean; onInteract: (id: string) => void }) {
  const x = COLS[index % 3];
  const y = index < 3 ? 345 : 675;
  const c = domain.counts;
  const done = c.solvedByYou > 0;
  const status = locked
    ? c.expired > 0
      ? 'SPRINT CLOSED'
      : 'AWAITING SPRINT'
    : c.total === 0
      ? 'NO SYSTEMS YET'
      : done && c.available === 0
        ? `✓ ${c.solvedByYou} REPAIRED`
        : `${c.available}/${c.total} SYSTEMS OPEN`;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Approach ${domain.name} station: ${status}`}
      onClick={() => onInteract(`station-${index}`)}
      onKeyDown={(e) => e.key === 'Enter' && onInteract(`station-${index}`)}
      className="cursor-pointer"
      transform={`translate(${x - 125} ${y - 100})`}
    >
      <ellipse cx="125" cy="202" rx="148" ry="17" fill="#04101a" opacity=".45" />
      {active && <ellipse cx="125" cy="205" rx="160" ry="30" fill={domain.color} opacity=".09" />}
      <path d="M24 23L41 4H208L231 23V152L250 168V193H0V166L20 148Z" fill="#354b58" stroke="#0a1823" strokeWidth="8" />
      <path d="M45 10H207L215 27H38Z" fill={domain.color} opacity={active ? 0.7 : 0.3} />
      <rect x="39" y="32" width="172" height="94" rx="12" fill="#061b25" stroke={active ? domain.color : '#647783'} strokeWidth="5" />
      <rect x="48" y="40" width="154" height="76" rx="7" fill={active ? '#10363b' : '#0d262e'} />
      <text x="125" y="87" textAnchor="middle" fill={domain.color} fontSize="37" fontWeight="700" fontFamily="monospace" className={active ? 'animate-[monitor_2s_ease-in-out_infinite]' : ''} opacity={locked ? 0.45 : 1}>
        {domain.symbol}
      </text>
      <path d="M22 132H228L244 164H7Z" fill="#526879" stroke="#10212c" strokeWidth="5" />
      <path d="M42 147H103M116 147H157" stroke="#263d4c" strokeWidth="7" strokeLinecap="round" />
      <circle cx="192" cy="148" r="7" fill={done ? '#8ae4cf' : locked ? '#607682' : domain.color} />
      <circle cx="217" cy="148" r="5" fill="#ecbd73" />
      <rect x="52" y="173" width="148" height="17" rx="4" fill="#162e39" />
      <text x="125" y="185" textAnchor="middle" fontSize="8" fontFamily="monospace" letterSpacing="1" fill={domain.color}>
        {status}
      </text>
      <text x="125" y={-19} textAnchor="middle" fontSize="13" fontFamily="Outfit, sans-serif" fontWeight="600" letterSpacing="1" fill="#d0dce3">
        {domain.name.toUpperCase()}
      </text>
      <text x="18" y="185" fill="#8095a3" fontSize="11" fontFamily="monospace">
        0{index + 1}
      </text>
      <Rivet x={19} y={175} />
      <Rivet x={231} y={175} />
    </g>
  );
}

function Door({ x, open, label }: { x: number; open: boolean; label: string }) {
  return (
    <g transform={`translate(${x - 70} 485)`}>
      <rect x="-15" y="-24" width="170" height="352" rx="29" fill="#0b1922" stroke="#061019" strokeWidth="10" />
      <rect x="-4" y="-12" width="149" height="321" rx="20" fill="#09151e" stroke={open ? '#8ae4cf' : '#506475'} strokeWidth="7" />
      <path d="M0 24V270M140 24V270" stroke={open ? '#8ae4cf' : '#5b8c90'} strokeWidth="5" />
      <motion.g animate={{ y: open ? -230 : 0 }} transition={{ duration: 0.45 }}>
        <path d="M12 0H128V291H12Z" fill="#405765" stroke="#102632" strokeWidth="7" />
        <path d="M23 17H117V274H23Z" fill="#2a424f" stroke="#6b7c86" strokeWidth="2" />
        <path d="M70 14V275M23 64H117M23 227H117" stroke="#132c39" strokeWidth="8" />
        <path d="M35 245l12 13M54 245l12 13M74 245l12 13M95 245l12 13" stroke="#e2b375" strokeWidth="6" />
        <rect x="59" y="125" width="22" height="45" rx="6" fill={open ? '#8ae4cf' : '#71989f'} />
      </motion.g>
      <rect x="0" y="-63" width="140" height="32" rx="8" fill="#1d333f" stroke="#081722" strokeWidth="4" />
      <text x="70" y="-43" textAnchor="middle" fill="#a7c2c8" fontFamily="monospace" fontSize="10" letterSpacing="2">
        {label}
      </text>
      <path d="M-12 303H151L170 331H-32Z" fill="#2c414b" stroke="#101f29" strokeWidth="5" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <path key={i} d={`M${i * 26 - 13} 314l13 13`} stroke="#d5a869" strokeWidth="7" />
      ))}
    </g>
  );
}

function Room({ index, children }: { index: number; children: React.ReactNode }) {
  return (
    <g>
      <rect width="1600" height="900" fill="#152733" />
      <rect y="100" width="1600" height="410" fill="url(#wall)" />
      <path d="M0 496H1600V890H0Z" fill="url(#deck-floor)" />
      <path d="M0 494H1600M0 514H1600M0 560H1600M0 650H1600M0 758H1600M0 880H1600" stroke="#0a1c28" strokeWidth="3" />
      {Array.from({ length: 13 }, (_, t) => (
        <path key={t} d={`M${800 + (t - 6) * 108} 496L${800 + (t - 6) * 180} 900`} stroke="#182e3b" strokeWidth="3" />
      ))}
      <path d="M0 510H1600" stroke="#627b85" strokeWidth="4" opacity=".5" />
      <rect y="862" width="1600" height="38" fill="#0c1b26" />
      <path d="M0 870H1600" stroke="#63707a" strokeWidth="3" />
      {[125, 1455].map((x) => (
        <g key={x}>
          <path d={`M${x} 111v365`} stroke="#091923" strokeWidth="37" />
          <path d={`M${x} 112v365`} stroke="#3d5563" strokeWidth="22" />
          <path d={`M${x - 8} 137v311`} stroke="#637888" strokeWidth="3" />
          {[165, 270, 380, 455].map((y) => (
            <Rivet key={y} x={x} y={y} />
          ))}
        </g>
      ))}
      <path d="M160 135H1410" stroke="#071722" strokeWidth="30" />
      <path d="M160 135H1410" stroke="#47616b" strokeWidth="16" />
      <path d="M175 132H1390" stroke="#6f8487" strokeWidth="3" />
      {[360, 780, 1200].map((x) => (
        <g key={x}>
          <rect x={x - 60} y="119" width="145" height="28" rx="12" fill="#0b1d27" stroke="#1e3d48" strokeWidth="5" />
          <rect x={x - 51} y="128" width="126" height="9" rx="4" fill="#b0e0ce" className="animate-[monitor_8s_ease-in-out_infinite]" />
          <path d={`M${x - 54} 150l-50 185h220l-49 -185Z`} fill="#c0e9d6" opacity=".025" />
        </g>
      ))}
      {children}
      <g opacity=".8">
        <rect x="186" y="432" width="83" height="54" rx="9" fill="#1a303b" stroke="#0b1b26" strokeWidth="5" />
        {[0, 1, 2, 3, 4].map((i) => (
          <path key={i} d={`M198 ${442 + i * 8}h60`} stroke="#5d7279" strokeWidth="3" />
        ))}
        <path d="M237 438q-12 -15 4 -25t0 -23" stroke="#bfdcd6" strokeWidth="8" fill="none" opacity=".1" className="animate-[steam_4s_ease-out_infinite]" />
      </g>
      <text x="1525" y="854" textAnchor="end" fill="#59717e" fontSize="12" fontFamily="monospace" letterSpacing="2">
        {`DECK ${String(index).padStart(2, '0')} / D+R`}
      </text>
    </g>
  );
}

function Lobby({ name, crewId, onInteract }: { name: string; crewId: string; onInteract: (id: string) => void }) {
  return (
    <>
      <SpaceWindow x={315} y={192} width={970} height={200} />
      <g>
        <rect x="524" y="217" width="552" height="124" rx="18" fill="#152c34" stroke="#061923" strokeWidth="6" />
        <text x="800" y="264" textAnchor="middle" fill="#e4efdb" fontSize="37" fontFamily="Chakra Petch, sans-serif" fontWeight="700" letterSpacing="6">
          WELCOME, CREW.
        </text>
        <text x="800" y="298" textAnchor="middle" fill="#8ae4cf" fontFamily="monospace" fontSize="17" letterSpacing="4">
          {`${crewId} / ${name}`}
        </text>
        <path d="M635 317H965" stroke="#496b66" strokeWidth="2" />
      </g>
      <text x="225" y="370" textAnchor="middle" fill="#93a6b2" fontFamily="monospace" fontSize="10" letterSpacing="3">
        ← BRIDGE
      </text>
      <text x="1380" y="370" textAnchor="middle" fill="#a1cfb6" fontFamily="monospace" fontSize="10" letterSpacing="3">
        TASK DECK →
      </text>
      <Benches x={285} y={480} />
      <Benches x={1005} y={430} />
      <Monitor x={1370} y={246} width={100} text="O₂ NORMAL" />
      <Monitor x={133} y={246} width={106} text="EMERGENCY" color="#e2ba80" />
      <g role="button" tabIndex={0} aria-label="Approach crew manifest" onClick={() => onInteract('manifest')} onKeyDown={(e) => e.key === 'Enter' && onInteract('manifest')} className="cursor-pointer" transform="translate(645 399)">
        <path d="M0 65L25 0H277L302 65V106H0Z" fill="#496570" stroke="#091c27" strokeWidth="7" />
        <path d="M16 61H283L267 16H33Z" fill="#34525d" stroke="#7f9595" strokeWidth="3" />
        <rect x="64" y="24" width="172" height="27" rx="7" fill="#15333b" stroke="#61948f" strokeWidth="2" />
        <text x="150" y="43" textAnchor="middle" fill="#b6d5c6" fontSize="10" fontFamily="monospace" letterSpacing="3">
          CREW MANIFEST
        </text>
        <circle cx="280" cy="88" r="5" fill="#8ae4cf" />
        <path d="M30 86H66M83 86H120" stroke="#9cafaa" strokeWidth="5" />
      </g>
      <Crate x={1125} y={683} />
      <Crate x={1210} y={739} size={75} />
      <g transform="translate(353 685)">
        <ellipse cx="0" cy="78" rx="27" ry="11" fill="#06141d" opacity=".5" />
        <path d="M-5 70V30M-5 46L-25 28M-4 34L13 13" stroke="#70866f" strokeWidth="7" />
        <ellipse cx="-27" cy="24" rx="19" ry="10" fill="#638c76" transform="rotate(32 -27 24)" />
        <ellipse cx="17" cy="13" rx="16" ry="11" fill="#7caa84" />
        <path d="M-28 58H24L15 88H-20Z" fill="#ad8468" stroke="#162936" strokeWidth="5" />
      </g>
      <path d="M595 748H1005L982 819H616Z" fill="#426068" opacity=".3" />
      <path d="M621 759H977M627 773H968M633 787H961M640 802H951" stroke="#7f9b9b" strokeWidth="2" opacity=".15" />
      <text x="802" y="806" textAnchor="middle" fill="#6e9495" opacity=".6" fontFamily="Chakra Petch, sans-serif" fontSize="16" fontWeight="700" letterSpacing="7">
        IDEA LAB • SGSITS
      </text>
      {/* Decorative crewmates (not live presence). */}
      <g transform="translate(460 598)" opacity=".85">
        <Crewmate color="#f37983" size={64} state="idle" />
      </g>
      <g transform="translate(1050 535)" opacity=".85">
        <Crewmate color="#edd478" size={64} state="idle" />
      </g>
    </>
  );
}

function Bridge({ active, alert, onInteract }: { active: boolean; alert: boolean; onInteract: (id: string) => void }) {
  return (
    <>
      <SpaceWindow x={210} y={180} width={1180} height={260} panorama />
      <text x="800" y="222" textAnchor="middle" fontFamily="Chakra Petch, sans-serif" fontSize="24" fill="#bdd9d8" fontWeight="700" letterSpacing="9">
        EMERGENCY BRIDGE
      </text>
      <g role="button" tabIndex={0} aria-label={`Approach emergency console${alert ? ': imposter detected' : ''}`} onClick={() => onInteract('command')} onKeyDown={(e) => e.key === 'Enter' && onInteract('command')} className="cursor-pointer">
        {alert && <path d="M380 550L445 411H1155L1220 550V602H380Z" fill="#c4544f" opacity=".25" className="animate-[monitor_1.2s_ease-in-out_infinite]" />}
        <path d="M380 550L445 411H1155L1220 550V602H380Z" fill="#385562" stroke="#081b27" strokeWidth="9" />
        <path d="M394 549L455 425H1145L1205 549Z" fill="#4a6975" stroke="#799796" strokeWidth="3" />
        <Monitor x={475} y={445} width={170} text="SHIP TELEMETRY" />
        <Monitor x={955} y={445} width={170} text={alert ? 'IMPOSTER DETECTED' : 'ALL CLEAR'} color={alert ? '#f08f80' : '#e2b879'} />
        <g transform="translate(800 485)">
          <ellipse rx="100" ry="53" fill={alert ? '#3b1f27' : '#0c343b'} stroke={alert ? '#f08f80' : active ? '#8ae4cf' : '#567c82'} strokeWidth="4" />
          <ellipse rx="77" ry="39" fill="none" stroke="#6baa9f" strokeWidth="2" />
          <ellipse rx="46" ry="24" fill="none" stroke="#6baa9f" strokeWidth="2" />
          <path d="M-75 0H75M0 -42V42" stroke="#638d8a" />
          {[[-34, 10], [28, -8], [60, 5], [-18, -25]].map(([cx, cy], n) => (
            <circle key={n} cx={cx} cy={cy} r="5" fill={n === 2 ? '#eaaa82' : '#8ae4cf'} />
          ))}
        </g>
        <text x="800" y="578" textAnchor="middle" fontFamily="monospace" fontSize="12" letterSpacing="4" fill={alert ? '#f5b8a6' : active ? '#8ae4cf' : '#a5b6bc'}>
          {alert ? 'EMERGENCY BONUS OPEN' : 'EMERGENCY CONSOLE'}
        </text>
      </g>
      <Benches x={490} y={715} />
      <Benches x={960} y={715} />
      <text x="190" y="480" fontFamily="monospace" fontSize="10" fill="#a3bbc1" letterSpacing="2">
        EMERGENCY BONUS PROTOCOL
      </text>
    </>
  );
}

function RankingsRoom({ standings, meCrewId, active, onInteract }: { standings: BoardRow[]; meCrewId: string; active: boolean; onInteract: (id: string) => void }) {
  const top = standings.slice(0, 5);
  return (
    <g role="button" tabIndex={0} aria-label="Approach rankings hologram" onClick={() => onInteract('rankings')} onKeyDown={(e) => e.key === 'Enter' && onInteract('rankings')} className="cursor-pointer">
      <SpaceWindow x={245} y={178} width={1110} height={215} />
      <path d="M465 635L590 265H1000L1130 635Z" fill="#8adbd4" opacity={active ? 0.065 : 0.035} />
      <rect x="432" y="225" width="736" height="388" rx="24" fill="#0e333c" fillOpacity=".91" stroke="#72bdb6" strokeWidth={active ? 5 : 3} />
      <text x="800" y="274" textAnchor="middle" fontSize="29" fontFamily="Chakra Petch, sans-serif" fontWeight="700" letterSpacing="7" fill="#b4f0df">
        CREW RANKINGS
      </text>
      <path d="M475 294H1125" stroke="#4b8b8e" strokeWidth="2" />
      {top.length === 0 && (
        <text x="800" y="420" textAnchor="middle" fontSize="14" fontFamily="monospace" fill="#7dabae">
          STANDINGS APPEAR WHEN A SPRINT STARTS
        </text>
      )}
      {top.map((s, n) => (
        <motion.g key={s.crewId} initial={false} animate={{ y: n * 52 }} transition={{ duration: 0.5 }}>
          {s.crewId === meCrewId && <rect x="474" y="308" width="649" height="46" rx="8" fill="#75cfbd" opacity=".12" />}
          <text x="495" y="337" fontSize="16" fill="#7dabae" fontFamily="monospace">
            {String(s.rank ?? n + 1).padStart(2, '0')}
          </text>
          <g transform="translate(540 310)">
            <Crewmate color={s.color} size={29} state="still" />
          </g>
          <text x="586" y="334" fontSize="13" fill="#93c7c6" fontFamily="monospace">
            {s.crewId}
          </text>
          <text x="729" y="335" fontSize="16" fontWeight="600" fill="#c6e6df" fontFamily="Outfit, sans-serif">
            {s.name}
          </text>
          <text x="1085" y="336" textAnchor="end" fontSize="17" fontFamily="monospace" fill="#b5e2d4">
            {s.score.toLocaleString()}
          </text>
        </motion.g>
      ))}
      <text x="800" y="592" textAnchor="middle" fontFamily="monospace" fontSize="10" letterSpacing="3" fill="#72b4b5">
        SLOT STANDINGS · APPROACH TO EXPAND
      </text>
      <path d="M635 681H970L1000 725H610Z" fill="#537783" stroke="#0a1a28" strokeWidth="7" />
      <rect x="664" y="682" width="274" height="23" rx="7" fill="#89d1c3" opacity=".3" />
      <path d="M677 720l23 -106M923 720l-24 -106" stroke="#6fc4c1" strokeWidth="4" opacity=".4" />
      <Crate x={1245} y={715} size={90} />
      <Benches x={255} y={723} />
    </g>
  );
}

export interface ShipWorldProps {
  width: number;
  roomWidth: number;
  domains: DomainDto[];
  standings: BoardRow[];
  identity: { name: string; crewId: string; color: string };
  tasksLocked: boolean;
  bonusAlert: boolean;
  near: string | null;
  onInteract: (id: string) => void;
  playerRef: RefObject<SVGGElement | null>;
  walkingRef: RefObject<SVGGElement | null>;
  doorOpen: number[];
}

export const ShipWorld = memo(
  forwardRef(function ShipWorld(p: ShipWorldProps, ref: Ref<SVGGElement>) {
    const domains = p.domains.length ? p.domains : DEFAULT_DOMAINS;
    return (
      <svg viewBox={`0 0 ${p.width} 900`} preserveAspectRatio="none" className="h-full w-full select-none" aria-label="Playable spaceship: emergency bridge, lobby, task deck, rankings">
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
        <g ref={ref}>
          {[0, 1, 2, 3].map((i) => (
            <g key={i} transform={`translate(${i * p.roomWidth} 0) scale(${p.roomWidth / 1600} 1)`}>
              <Room index={i}>
                {i === 0 ? (
                  <Bridge active={p.near === 'command'} alert={p.bonusAlert} onInteract={p.onInteract} />
                ) : i === 1 ? (
                  <Lobby name={p.identity.name} crewId={p.identity.crewId} onInteract={p.onInteract} />
                ) : i === 2 ? (
                  <>
                    <text x="800" y="209" textAnchor="middle" fontSize="31" fontFamily="Chakra Petch, sans-serif" fontWeight="700" letterSpacing="7" fill="#e6ece0">
                      CREW TASKS
                    </text>
                    <text x="800" y="238" textAnchor="middle" fontSize="10" fontFamily="monospace" letterSpacing="4" fill="#9ab7b8">
                      FIX BUGS. COMPLETE TASKS. SURVIVE.
                    </text>
                    {domains.slice(0, 6).map((d, idx) => (
                      <Station key={d.slug} index={idx} domain={d} active={p.near === `station-${idx}`} locked={p.tasksLocked} onInteract={p.onInteract} />
                    ))}
                  </>
                ) : (
                  <RankingsRoom standings={p.standings} meCrewId={p.identity.crewId} active={p.near === 'rankings'} onInteract={p.onInteract} />
                )}
              </Room>
            </g>
          ))}
          {[1, 2, 3].map((i) => (
            <Door key={i} x={i * p.roomWidth} open={p.doorOpen.includes(i)} label={['', 'BRIDGE / LOBBY', 'TASK DECK', 'CREW RANKINGS'][i]} />
          ))}
          <g ref={p.playerRef} data-testid="player">
            {/* Ground shadow sits exactly under the feet (sprite feet ≈ y -9) and breathes with the body. */}
            <ellipse data-shadow cx="0" cy="-8" rx="30" ry="8" fill="#03101a" opacity=".42" className="crew-ground-shadow" />
            <g ref={p.walkingRef}>
              {/* Animated wrapper: CSS transforms here never replace the sprite's positioning transform below. */}
              <g data-body className="crew-body-anchor">
                <g transform="translate(-44 -103)">
                  <Crewmate color={p.identity.color} size={88} state="still" shadow={false} />
                </g>
              </g>
            </g>
            <path d="M-5 -122L0 -116L5 -122" fill="#b3efd8" />
            <rect x="-46" y="17" width="92" height="22" rx="6" fill="#0b1e2c" fillOpacity=".85" stroke="#77c8c4" strokeOpacity=".3" />
            <text x="0" y="32" textAnchor="middle" fill="#c4e9de" fontSize="11" fontFamily="monospace">
              {p.identity.crewId}
            </text>
          </g>
        </g>
      </svg>
    );
  }),
);
