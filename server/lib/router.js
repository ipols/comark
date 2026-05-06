// Tiny pattern-matching router for the comark local server.
// Handles route registration with `:param` placeholders, JSON parsing,
// Origin validation on state-mutating endpoints, and graceful error
// responses. ~80 LOC, no framework dependency.

const STATE_MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function createRouter() {
  const routes = [];

  function register(method, pattern, handler, options = {}) {
    const segments = pattern.split('/').filter(Boolean);
    routes.push({
      method: method.toUpperCase(),
      pattern,
      segments,
      handler,
      // skipOriginCheck=true → allow read-only health probes / static assets
      skipOriginCheck: Boolean(options.skipOriginCheck),
    });
  }

  function get(pattern, handler, options) {
    register('GET', pattern, handler, options);
  }

  function post(pattern, handler, options) {
    register('POST', pattern, handler, options);
  }

  function matchRoute(method, path) {
    const pathSegments = path.split('/').filter(Boolean);
    for (const route of routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== pathSegments.length) continue;
      const params = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const seg = route.segments[i];
        const actual = pathSegments[i];
        if (seg.startsWith(':')) {
          params[seg.slice(1)] = decodeURIComponent(actual);
        } else if (seg !== actual) {
          matched = false;
          break;
        }
      }
      if (matched) return { route, params };
    }
    return null;
  }

  return { get, post, matchRoute };
}

export async function readJsonBody(req, maxBytes = 5 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw Object.assign(new Error('Request body too large'), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  if (total === 0) return null;
  const raw = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw Object.assign(new Error('Invalid JSON body'), { statusCode: 400 });
  }
}

// Strict Origin allow-list: the running port only.
// localhost and 127.0.0.1 both legitimate.
export function isOriginAllowed(req, port) {
  const origin = req.headers.origin;
  // Same-origin requests from <script> (e.g., the SPA loaded from /) often have
  // no Origin header on GET requests, but POST/SSE from fetch() will include it.
  // We require Origin to be present and match for any state-mutating method.
  if (!origin) return false;
  const allowed = new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);
  return allowed.has(origin);
}

export function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function sendText(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export { STATE_MUTATING_METHODS };
