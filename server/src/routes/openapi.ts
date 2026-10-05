import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * Tiny route registry: every /api/v1 route is declared through `api.<method>`
 * with a summary, a tag and its auth requirement, and the same list feeds the
 * generated OpenAPI document at /api/v1/openapi.json. No route exists that
 * the document does not describe.
 */
export type AuthKind = 'public' | 'crew' | 'organizer' | 'display';
interface Doc {
  summary: string;
  tag: string;
  auth: AuthKind;
  permission?: string;
  body?: string;
  query?: string;
  idempotent?: boolean;
}
type Handler = (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const registry: { method: string; path: string; doc: Doc }[] = [];

export function api(app: FastifyInstance) {
  const add = (method: 'get' | 'post' | 'patch' | 'delete' | 'put') => (path: string, doc: Doc, handler: Handler) => {
    const full = `/api/v1${path}`;
    if (!registry.some((r) => r.method === method && r.path === full)) registry.push({ method, path: full, doc });
    app[method](full, handler);
  };
  return { get: add('get'), post: add('post'), patch: add('patch'), delete: add('delete'), put: add('put') };
}

export function openApiDocument(serverUrl: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of registry) {
    const p = r.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const params = [...r.path.matchAll(/:([A-Za-z]+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    const headers = [];
    if (r.doc.idempotent) headers.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' } });
    if (r.method !== 'get') headers.push({ name: 'X-Requested-With', in: 'header', required: true, schema: { type: 'string', enum: ['amongbugs'] } });
    paths[p] ??= {};
    paths[p][r.method] = {
      summary: r.doc.summary,
      tags: [r.doc.tag],
      ...(r.doc.query ? { description: `Query: ${r.doc.query}` } : {}),
      parameters: [...params, ...headers],
      ...(r.doc.body ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', description: r.doc.body } } } } } : {}),
      security: r.doc.auth === 'public' ? [] : r.doc.auth === 'display' ? [{ displayCookie: [] }, { sessionCookie: [] }] : [{ sessionCookie: [] }],
      'x-auth': r.doc.auth,
      ...(r.doc.permission ? { 'x-permission': r.doc.permission } : {}),
      responses: {
        '200': { description: 'OK' },
        '4XX': { description: 'Error envelope', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: { title: 'AMONG BUG API', version: '1.0.0', description: 'Four-slot sprint competition API. All state-changing calls require X-Requested-With: amongbugs and a same-origin Origin.' },
    servers: [{ url: serverUrl }],
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'ab_sid' },
        displayCookie: { type: 'apiKey', in: 'cookie', name: 'ab_display' },
      },
      schemas: {
        Error: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' }, details: { type: 'object', nullable: true } }, required: ['error', 'message'] },
      },
    },
    paths,
  };
}

export function registeredRoutes() {
  return registry.map((r) => ({ method: r.method.toUpperCase(), path: r.path, ...r.doc }));
}
