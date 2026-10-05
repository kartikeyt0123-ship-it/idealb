import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireDisplay, type Deps } from '../http.js';
import { displayState } from '../services/display.js';
import { api } from './openapi.js';

const uuid = z.string().uuid();

/** Projector payloads: approved standings fields only (no emails, members, answers or admin data). */
export async function displayRoutes(app: FastifyInstance, deps: Deps) {
  const r = api(app);
  r.get('/display/overall', { summary: 'Overall board across slots (PROVISIONAL until finalized)', tag: 'display', auth: 'display' }, async (req) => {
    await requireDisplay(deps, req);
    return displayState(deps.db, { kind: 'OVERALL' });
  });
  r.get('/display/slots/:slotId', { summary: 'Slot cumulative board', tag: 'display', auth: 'display' }, async (req) => {
    const { slotId } = z.object({ slotId: uuid }).parse(req.params);
    await requireDisplay(deps, req);
    return displayState(deps.db, { kind: 'SLOT', slotId });
  });
  r.get('/display/slots/:slotId/sprints/:sprintId', { summary: 'Live / frozen sprint board', tag: 'display', auth: 'display' }, async (req) => {
    const { slotId, sprintId } = z.object({ slotId: uuid, sprintId: uuid }).parse(req.params);
    await requireDisplay(deps, req);
    return displayState(deps.db, { kind: 'SLOT', slotId, sprintId });
  });
}
