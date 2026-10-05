/** Small presentation helpers shared by the gate screens and the ship. */
import { useEffect, useState } from 'react';
import { api, V1, type Meta } from '../lib/api';

/** "2026-10-08" → "Thu, 8 Oct 2026" (date-only; no timezone shift). */
export function formatSlotDate(date: string | null | undefined): string {
  if (!date) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
}

/** "Slot 1 · Day 1 · Thu, 8 Oct 2026" */
export function slotLine(s: { name?: string | null; number?: number; dayLabel?: string | null; date?: string | null } | null | undefined): string {
  if (!s) return '';
  return [s.name || (s.number ? `Slot ${s.number}` : ''), s.dayLabel, formatSlotDate(s.date)].filter(Boolean).join(' · ');
}

let metaCache: Meta | null = null;
let metaPromise: Promise<Meta | null> | null = null;

/** Public branding from GET /api/v1/meta (cached for the tab's lifetime). */
export function useEventMeta(): Meta | null {
  const [meta, setMeta] = useState<Meta | null>(metaCache);
  useEffect(() => {
    if (metaCache) return;
    metaPromise ??= api.get<Meta>(`${V1}/meta`).then(
      (m) => (metaCache = m),
      () => {
        metaPromise = null;
        return null;
      },
    );
    let alive = true;
    void metaPromise.then((m) => alive && m && setMeta(m));
    return () => {
      alive = false;
    };
  }, []);
  return meta;
}
