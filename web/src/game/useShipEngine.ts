import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { DomainDto } from '../lib/api';
import { sfx } from '../lib/sound';
import { interactables, obstacles, type Interactable } from './ShipWorld';

const MOVE_KEYS = ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd'];

/** True when the user is typing / using a form or editor — world input must be ignored. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable) return true;
  return !!el.closest?.('.monaco-editor, [role="dialog"], [role="alertdialog"], [data-no-world-keys]');
}

export interface EngineOptions {
  viewWidth: number;
  roomWidth: number;
  domains: DomainDto[];
  /** When true (dialog open, waiting overlay, not on the ship) the crewmate cannot move. */
  frozen: boolean;
  onInteract: (id: string) => void;
  worldRef: RefObject<SVGGElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
}

export function useShipEngine(o: EngineOptions) {
  const playerRef = useRef<SVGGElement | null>(null);
  const walkingRef = useRef<SVGGElement | null>(null);
  const pos = useRef({ x: o.roomWidth * 1.5, y: 690 });
  const camera = useRef(o.roomWidth * 1.5 - o.viewWidth * 0.5);
  const vel = useRef({ x: 0, y: 0 });
  const keys = useRef(new Set<string>());
  const scrollVel = useRef(0);
  const route = useRef<{ object: Interactable; stage: number } | null>(null);
  const frozen = useRef(o.frozen);
  const nearRef = useRef<string | null>(null);
  const facing = useRef(1);
  const lastRoomWidth = useRef(o.roomWidth);
  const onInteract = useRef(o.onInteract);
  onInteract.current = o.onInteract;
  frozen.current = o.frozen;

  const [room, setRoom] = useState(1);
  const [near, setNear] = useState<string | null>(null);
  const [doors, setDoors] = useState<number[]>([]);
  const roomRef = useRef(1);

  // Keep the crewmate at the same relative spot on resize.
  useEffect(() => {
    pos.current.x = (pos.current.x / lastRoomWidth.current) * o.roomWidth;
    camera.current = pos.current.x - o.viewWidth * 0.5;
    lastRoomWidth.current = o.roomWidth;
  }, [o.roomWidth, o.viewWidth]);

  const interact = useCallback(() => {
    if (frozen.current) return false;
    if (nearRef.current) {
      onInteract.current(nearRef.current);
      return true;
    }
    return false;
  }, []);

  /** Click / tap on a machine: interact if close, otherwise walk there. */
  const approach = useCallback(
    (id: string) => {
      if (frozen.current) return 'frozen' as const;
      const target = interactables(o.roomWidth, o.domains).find((t) => t.id === id);
      if (!target) return 'unknown' as const;
      if (Math.hypot(pos.current.x - target.x, (pos.current.y - target.y) * 1.1) < 145) {
        onInteract.current(id);
        return 'opened' as const;
      }
      route.current = { object: target, stage: 0 };
      return 'walking' as const;
    },
    [o.roomWidth, o.domains],
  );

  /** Teleport to the safe lobby (used after an access denial). */
  const toLobby = useCallback(() => {
    pos.current = { x: o.roomWidth * 1.5, y: 690 };
    route.current = null;
    vel.current = { x: 0, y: 0 };
  }, [o.roomWidth]);

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const k = e.key.toLowerCase();
      if (frozen.current) return;
      if (MOVE_KEYS.includes(k) || k === 'e') e.preventDefault();
      if (MOVE_KEYS.includes(k)) {
        keys.current.add(k);
        route.current = null;
      }
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.key.toLowerCase());
    const blur = () => {
      keys.current.clear();
      scrollVel.current = 0;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Clear held keys whenever input gets frozen so the crewmate never drifts.
  useEffect(() => {
    if (o.frozen) {
      keys.current.clear();
      route.current = null;
    }
  }, [o.frozen]);

  // Scroll / trackpad walks left-right (only on the world, not dialogs)
  useEffect(() => {
    const el = o.containerRef.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (frozen.current || isTypingTarget(e.target)) return;
      e.preventDefault();
      route.current = null;
      scrollVel.current = Math.max(-850, Math.min(850, scrollVel.current + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * 2.5));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [o.containerRef]);

  // Main loop
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastSlow = 0;
    let lastStep = 0;
    let walking = false;
    const items = interactables(o.roomWidth, o.domains);
    const blocks = obstacles(o.roomWidth);
    const parallax = Array.from(document.querySelectorAll('[data-parallax]'));
    const W = o.roomWidth;
    const V = o.viewWidth;
    const frame = (now: number) => {
      const dt = Math.min(0.035, (now - last) / 1000);
      last = now;
      let dx = 0;
      let dy = 0;
      if (frozen.current) {
        scrollVel.current = 0;
        route.current = null;
        vel.current = { x: 0, y: 0 };
      } else {
        const k = keys.current;
        dx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
        dy = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
        if (route.current) {
          const r = route.current;
          const tgt = r.stage === 0 ? { x: pos.current.x, y: 650 } : r.stage === 1 ? { x: r.object.x, y: 650 } : { x: r.object.x, y: r.object.y };
          const ex = tgt.x - pos.current.x;
          const ey = tgt.y - pos.current.y;
          if (Math.hypot(ex, ey) < 12) {
            if (r.stage < 2) r.stage++;
            else {
              const id = r.object.id;
              route.current = null;
              vel.current = { x: 0, y: 0 };
              setTimeout(() => onInteract.current(id), 0);
            }
          } else {
            dx = Math.abs(ex) > 10 ? Math.sign(ex) : 0;
            dy = Math.abs(ey) > 10 ? Math.sign(ey) : 0;
          }
        }
      }
      const diag = dx && dy ? 0.707 : 1;
      const tx = frozen.current ? 0 : dx * 350 * diag + (dx ? 0 : scrollVel.current);
      const ty = frozen.current ? 0 : dy * 350 * diag;
      const ease = 1 - Math.exp(-dt * 13);
      vel.current.x += (tx - vel.current.x) * ease;
      vel.current.y += (ty - vel.current.y) * ease;
      scrollVel.current *= Math.exp(-dt * 5);
      let nx = Math.max(65, Math.min(W * 4 - 65, pos.current.x + vel.current.x * dt));
      const ny = Math.max(525, Math.min(832, pos.current.y + vel.current.y * dt));
      const hit = (x: number, y: number) => blocks.some((b) => x + 25 > b.x && x - 25 < b.x + b.width && y > b.y && y - 18 < b.y + b.height);
      for (const d of [1, 2, 3]) {
        if (Math.abs(nx - d * W) < 65 && (ny < 565 || ny > 805)) {
          nx = pos.current.x;
          vel.current.x = 0;
        }
      }
      if (hit(nx, pos.current.y)) vel.current.x = 0;
      else pos.current.x = nx;
      if (hit(pos.current.x, ny)) vel.current.y = 0;
      else pos.current.y = ny;
      const moving = Math.abs(vel.current.x) + Math.abs(vel.current.y) > 35;
      if (Math.abs(vel.current.x) > 20) facing.current = vel.current.x > 0 ? 1 : -1;
      if (moving !== walking) {
        walking = moving;
        const body = walkingRef.current?.querySelector<SVGGElement>('[data-body]');
        const shadow = playerRef.current?.querySelector<SVGEllipseElement>('[data-shadow]');
        if (body) body.style.animation = moving ? 'crew-walk .32s ease-in-out infinite' : 'float 4s ease-in-out infinite';
        if (shadow) shadow.style.animation = moving ? 'shadow-walk .32s ease-in-out infinite' : 'shadow-float 4s ease-in-out infinite';
      }
      if (moving && now - lastStep > 340) {
        lastStep = now;
        sfx.step();
      }
      const camTarget = Math.max(0, Math.min(W * 4 - V, pos.current.x - V * 0.48));
      camera.current += (camTarget - camera.current) * (1 - Math.exp(-dt * 5));
      o.worldRef.current?.setAttribute('transform', `translate(${-camera.current} 0)`);
      parallax.forEach((p) => p.setAttribute('transform', `translate(${camera.current * 0.025} 0)`));
      playerRef.current?.setAttribute('transform', `translate(${pos.current.x} ${pos.current.y})`);
      walkingRef.current?.setAttribute('transform', `scale(${facing.current} 1)`);
      if (now - lastSlow > 80) {
        lastSlow = now;
        const r = Math.min(3, Math.max(0, Math.floor(pos.current.x / W)));
        if (r !== roomRef.current) {
          roomRef.current = r;
          setRoom(r);
          sfx.room();
        }
        const n = items.find((it) => Math.hypot(pos.current.x - it.x, (pos.current.y - it.y) * 1.1) < 145);
        if ((n?.id ?? null) !== nearRef.current) {
          nearRef.current = n?.id ?? null;
          setNear(nearRef.current);
        }
        const open = [1, 2, 3].filter((d) => Math.abs(pos.current.x - d * W) < 190 && pos.current.y > 545 && pos.current.y < 825);
        setDoors((prev) => (prev.join(',') === open.join(',') ? prev : open));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [o.roomWidth, o.viewWidth, o.domains, o.worldRef]);

  const press = useCallback((k: string, down: boolean) => {
    if (down) {
      if (frozen.current) return;
      keys.current.add(k);
      route.current = null;
    } else keys.current.delete(k);
  }, []);

  return { playerRef, walkingRef, room, near, doors, interact, approach, toLobby, press };
}
