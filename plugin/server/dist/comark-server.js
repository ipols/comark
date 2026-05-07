#!/usr/bin/env node
// comark — bundled by esbuild. Do not edit by hand. Run `npm run bundle` to regenerate.


// server/index.js
import { createServer as createServer2 } from "node:http";

// server/lib/port-manager.js
import { createServer } from "node:net";
var FALLBACK_RANGE_START = 8888;
var FALLBACK_RANGE_END = 8898;
function preferredPort() {
  const fromEnv = process.env.COMARK_PORT;
  if (!fromEnv) return FALLBACK_RANGE_START;
  const parsed = Number.parseInt(fromEnv, 10);
  if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) return parsed;
  return FALLBACK_RANGE_START;
}
function fallbackCandidates(preferred) {
  const candidates = [preferred];
  for (let p = FALLBACK_RANGE_START; p <= FALLBACK_RANGE_END; p += 1) {
    if (p !== preferred) candidates.push(p);
  }
  return candidates;
}
function isPortFree(port) {
  return new Promise((resolve2) => {
    const tester = createServer();
    tester.once("error", (err) => {
      if (err && err.code === "EADDRINUSE") resolve2(false);
      else resolve2(false);
    });
    tester.once("listening", () => {
      tester.close(() => resolve2(true));
    });
    tester.listen(port, "127.0.0.1");
  });
}
async function pickAvailablePort() {
  const preferred = preferredPort();
  for (const port of fallbackCandidates(preferred)) {
    const free = await isPortFree(port);
    if (free) return port;
  }
  throw new Error(
    `No port available in range ${FALLBACK_RANGE_START}-${FALLBACK_RANGE_END}. Set COMARK_PORT to a free port or stop the conflicting process.`
  );
}

// server/lib/lockfile.js
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { request as httpRequest } from "node:http";
var RUNTIME_DIR = join(homedir(), ".comark");
var LOCKFILE_PATH = join(RUNTIME_DIR, "server.lock");
async function ensureRuntimeDir() {
  await mkdir(RUNTIME_DIR, { recursive: true });
}
async function readLockfile() {
  if (!existsSync(LOCKFILE_PATH)) return null;
  try {
    const raw = await readFile(LOCKFILE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.pid !== "number" || typeof parsed?.port !== "number" || typeof parsed?.startedAt !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
async function writeLockfile({ port, pid, startedAt }) {
  await ensureRuntimeDir();
  const payload = JSON.stringify({ port, pid, startedAt }, null, 2);
  await writeFile(LOCKFILE_PATH, payload, "utf8");
}
async function deleteLockfile() {
  if (!existsSync(LOCKFILE_PATH)) return;
  try {
    await unlink(LOCKFILE_PATH);
  } catch {
  }
}
function isPidAlive(pid) {
  if (typeof pid !== "number" || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}
function pingHealthz(port, timeoutMs = 1500) {
  return new Promise((resolve2) => {
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path: "/healthz",
        method: "GET",
        timeout: timeoutMs
      },
      (res) => {
        res.on("data", () => {
        });
        res.on("end", () => resolve2(res.statusCode === 200));
      }
    );
    req.on("error", () => resolve2(false));
    req.on("timeout", () => {
      req.destroy();
      resolve2(false);
    });
    req.end();
  });
}
async function findRunningServer() {
  const lock = await readLockfile();
  if (!lock) return null;
  if (!isPidAlive(lock.pid)) {
    await deleteLockfile();
    return null;
  }
  const alive = await pingHealthz(lock.port);
  if (!alive) {
    return null;
  }
  return lock;
}

// server/lib/router.js
var STATE_MUTATING_METHODS = /* @__PURE__ */ new Set(["POST", "PUT", "PATCH", "DELETE"]);
function createRouter() {
  const routes = [];
  function register(method, pattern, handler, options = {}) {
    const segments = pattern.split("/").filter(Boolean);
    routes.push({
      method: method.toUpperCase(),
      pattern,
      segments,
      handler,
      // skipOriginCheck=true → allow read-only health probes / static assets
      skipOriginCheck: Boolean(options.skipOriginCheck)
    });
  }
  function get(pattern, handler, options) {
    register("GET", pattern, handler, options);
  }
  function post(pattern, handler, options) {
    register("POST", pattern, handler, options);
  }
  function matchRoute(method, path) {
    const pathSegments = path.split("/").filter(Boolean);
    for (const route of routes) {
      if (route.method !== method) continue;
      if (route.segments.length !== pathSegments.length) continue;
      const params = {};
      let matched = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const seg = route.segments[i];
        const actual = pathSegments[i];
        if (seg.startsWith(":")) {
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
async function readJsonBody(req, maxBytes = 5 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    }
    chunks.push(chunk);
  }
  if (total === 0) return null;
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw Object.assign(new Error("Invalid JSON body"), { statusCode: 400 });
  }
}
function isOriginAllowed(req, port) {
  const origin = req.headers.origin;
  if (!origin) return false;
  const allowed = /* @__PURE__ */ new Set([
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`
  ]);
  return allowed.has(origin);
}
function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store"
  });
  res.end(payload);
}

// server/api/docs.js
import { readFile as readFile4 } from "node:fs/promises";

// server/lib/shared-registry.js
import { mkdir as mkdir2, readFile as readFile2, writeFile as writeFile2, rename, stat } from "node:fs/promises";
import { existsSync as existsSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2 } from "node:path";
var RUNTIME_DIR2 = join2(homedir2(), ".comark");
var REGISTRY_PATH = join2(RUNTIME_DIR2, "docs.json");
async function ensureRuntimeDir2() {
  await mkdir2(RUNTIME_DIR2, { recursive: true });
}
async function readSharedRegistry() {
  if (!existsSync2(REGISTRY_PATH)) return { docs: [] };
  try {
    const raw = await readFile2(REGISTRY_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.docs)) return { docs: [] };
    return parsed;
  } catch {
    return { docs: [] };
  }
}
async function writeSharedRegistry(registry) {
  await ensureRuntimeDir2();
  const tmp = REGISTRY_PATH + ".tmp";
  await writeFile2(tmp, JSON.stringify(registry, null, 2), "utf8");
  await rename(tmp, REGISTRY_PATH);
}
async function upsertDocInRegistry(entry) {
  const reg = await readSharedRegistry();
  const idx = reg.docs.findIndex((d) => d.docId === entry.docId);
  if (idx >= 0) {
    reg.docs[idx] = { ...reg.docs[idx], ...entry };
  } else {
    reg.docs.push(entry);
  }
  await writeSharedRegistry(reg);
  return reg;
}

// server/lib/doc-registry.js
var docs = /* @__PURE__ */ new Map();
async function registerDoc({ docId, filePath, transcriptPath, contextSummary, model }) {
  if (!docId || !filePath) {
    throw new Error("registerDoc requires docId and filePath");
  }
  const entry = {
    docId,
    filePath,
    transcriptPath: transcriptPath ?? null,
    contextSummary: contextSummary ?? null,
    model: model ?? null,
    registeredAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  docs.set(docId, entry);
  try {
    await upsertDocInRegistry(entry);
  } catch (err) {
    process.stderr.write(`comark: shared registry write failed: ${err?.message || err}
`);
  }
  return entry;
}
function getDoc(docId) {
  return docs.get(docId) ?? null;
}

// server/lib/persistence.js
import { readFile as readFile3, writeFile as writeFile3, rename as rename2, mkdir as mkdir3 } from "node:fs/promises";
import { existsSync as existsSync3 } from "node:fs";
import { dirname as dirname2, basename, extname, join as join3 } from "node:path";

// node_modules/approx-string-match/build/src/index.js
function reverse(s) {
  return s.split("").reverse().join("");
}
function findMatchStarts(text, pattern, matches) {
  const patRev = reverse(pattern);
  return matches.map((m) => {
    const minStart = Math.max(0, m.end - pattern.length - m.errors);
    const textRev = reverse(text.slice(minStart, m.end));
    const start = findMatchEnds(textRev, patRev, m.errors).reduce((min, rm) => {
      if (m.end - rm.end < min) {
        return m.end - rm.end;
      }
      return min;
    }, m.end);
    return {
      start,
      end: m.end,
      errors: m.errors
    };
  });
}
function oneIfNotZero(n) {
  return (n | -n) >> 31 & 1;
}
function advanceBlock(ctx, peq, b, hIn) {
  let pV = ctx.P[b];
  let mV = ctx.M[b];
  const hInIsNegative = hIn >>> 31;
  const eq = peq[b] | hInIsNegative;
  const xV = eq | mV;
  const xH = (eq & pV) + pV ^ pV | eq;
  let pH = mV | ~(xH | pV);
  let mH = pV & xH;
  const hOut = oneIfNotZero(pH & ctx.lastRowMask[b]) - oneIfNotZero(mH & ctx.lastRowMask[b]);
  pH <<= 1;
  mH <<= 1;
  mH |= hInIsNegative;
  pH |= oneIfNotZero(hIn) - hInIsNegative;
  pV = mH | ~(xV | pH);
  mV = pH & xV;
  ctx.P[b] = pV;
  ctx.M[b] = mV;
  return hOut;
}
function findMatchEnds(text, pattern, maxErrors) {
  if (pattern.length === 0) {
    return [];
  }
  maxErrors = Math.min(maxErrors, pattern.length);
  const matches = [];
  const w = 32;
  const bMax = Math.ceil(pattern.length / w) - 1;
  const ctx = {
    P: new Uint32Array(bMax + 1),
    M: new Uint32Array(bMax + 1),
    lastRowMask: new Uint32Array(bMax + 1)
  };
  ctx.lastRowMask.fill(1 << 31);
  ctx.lastRowMask[bMax] = 1 << (pattern.length - 1) % w;
  const emptyPeq = new Uint32Array(bMax + 1);
  const peq = /* @__PURE__ */ new Map();
  const asciiPeq = [];
  for (let i = 0; i < 256; i++) {
    asciiPeq.push(emptyPeq);
  }
  for (let c = 0; c < pattern.length; c += 1) {
    const val = pattern.charCodeAt(c);
    if (peq.has(val)) {
      continue;
    }
    const charPeq = new Uint32Array(bMax + 1);
    peq.set(val, charPeq);
    if (val < asciiPeq.length) {
      asciiPeq[val] = charPeq;
    }
    for (let b = 0; b <= bMax; b += 1) {
      charPeq[b] = 0;
      for (let r = 0; r < w; r += 1) {
        const idx = b * w + r;
        if (idx >= pattern.length) {
          continue;
        }
        const match = pattern.charCodeAt(idx) === val;
        if (match) {
          charPeq[b] |= 1 << r;
        }
      }
    }
  }
  let y = Math.max(0, Math.ceil(maxErrors / w) - 1);
  const score = new Uint32Array(bMax + 1);
  for (let b = 0; b <= y; b += 1) {
    score[b] = (b + 1) * w;
  }
  score[bMax] = pattern.length;
  for (let b = 0; b <= y; b += 1) {
    ctx.P[b] = ~0;
    ctx.M[b] = 0;
  }
  for (let j = 0; j < text.length; j += 1) {
    const charCode = text.charCodeAt(j);
    let charPeq;
    if (charCode < asciiPeq.length) {
      charPeq = asciiPeq[charCode];
    } else {
      charPeq = peq.get(charCode);
      if (typeof charPeq === "undefined") {
        charPeq = emptyPeq;
      }
    }
    let carry = 0;
    for (let b = 0; b <= y; b += 1) {
      carry = advanceBlock(ctx, charPeq, b, carry);
      score[b] += carry;
    }
    if (score[y] - carry <= maxErrors && y < bMax && (charPeq[y + 1] & 1 || carry < 0)) {
      y += 1;
      ctx.P[y] = ~0;
      ctx.M[y] = 0;
      let maxBlockScore;
      if (y === bMax) {
        const remainder = pattern.length % w;
        maxBlockScore = remainder === 0 ? w : remainder;
      } else {
        maxBlockScore = w;
      }
      score[y] = score[y - 1] + maxBlockScore - carry + advanceBlock(ctx, charPeq, y, carry);
    } else {
      while (y > 0 && score[y] >= maxErrors + w) {
        y -= 1;
      }
    }
    if (y === bMax && score[y] <= maxErrors) {
      if (score[y] < maxErrors) {
        matches.splice(0, matches.length);
      }
      matches.push({
        start: -1,
        end: j + 1,
        errors: score[y]
      });
      maxErrors = score[y];
    }
  }
  return matches;
}
function search(text, pattern, maxErrors) {
  const matches = findMatchEnds(text, pattern, maxErrors);
  return findMatchStarts(text, pattern, matches);
}

// server/lib/normalize.js
function normalizeForAnchor(text) {
  if (typeof text !== "string") return "";
  let out = text.replace(/\r\n?/g, "\n");
  out = out.normalize("NFC");
  return out;
}

// server/lib/hash.js
import { createHash } from "node:crypto";
function sha256Hex(input) {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

// server/lib/anchor.js
var THRESHOLD_ANCHORED = 0.85;
var THRESHOLD_APPROXIMATE = 0.55;
var W_QUOTE = 50;
var W_PREFIX = 20;
var W_SUFFIX = 20;
var W_POSITION = 2;
var W_TOTAL = W_QUOTE + W_PREFIX + W_SUFFIX + W_POSITION;
async function resolveAnchor(docContent, comment) {
  const target = comment?.target || {};
  const selectors = Array.isArray(target.selectors) ? target.selectors : [];
  const normalized = normalizeForAnchor(docContent);
  const currentHash = `sha256:${sha256Hex(normalized)}`;
  if (target.docHash && target.docHash === currentHash) {
    const pos = selectors.find((s) => s?.type === "TextPositionSelector");
    if (pos && Number.isFinite(pos.start) && Number.isFinite(pos.end)) {
      return resolved(comment, {
        anchorState: "anchored",
        score: 1,
        range: { start: pos.start, end: pos.end }
      });
    }
  }
  const quote = selectors.find((s) => s?.type === "TextQuoteSelector");
  if (!quote || typeof quote.exact !== "string" || quote.exact.length === 0) {
    return orphan(comment);
  }
  const expectedPos = selectors.find((s) => s?.type === "TextPositionSelector");
  const expectedStart = Number.isFinite(expectedPos?.start) ? expectedPos.start : 0;
  const best = matchQuote({
    doc: normalized,
    exact: quote.exact,
    prefix: typeof quote.prefix === "string" ? quote.prefix : "",
    suffix: typeof quote.suffix === "string" ? quote.suffix : "",
    expectedStart
  });
  if (!best) {
    return orphan(comment);
  }
  if (best.score < THRESHOLD_APPROXIMATE) {
    return orphan(comment);
  }
  return resolved(comment, {
    anchorState: best.score >= THRESHOLD_ANCHORED ? "anchored" : "approximate",
    score: best.score,
    range: { start: best.start, end: best.end }
  });
}
function resolved(comment, { anchorState, score, range }) {
  return {
    ...comment,
    anchorState,
    lastResolvedAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastResolvedScore: round3(score),
    resolvedRange: range
  };
}
function orphan(comment) {
  return {
    ...comment,
    anchorState: "orphaned",
    lastResolvedAt: (/* @__PURE__ */ new Date()).toISOString(),
    lastResolvedScore: 0
  };
}
function matchQuote({ doc, exact, prefix, suffix, expectedStart }) {
  if (exact.length === 0 || doc.length === 0) return null;
  const maxErrors = Math.min(256, Math.max(1, Math.floor(exact.length / 2)));
  let candidates;
  try {
    candidates = search(doc, exact, maxErrors);
  } catch {
    return null;
  }
  if (!candidates || candidates.length === 0) return null;
  let best = null;
  for (const candidate of candidates) {
    const quoteScore = clamp01(1 - candidate.errors / Math.max(1, exact.length));
    let prefixScore = 1;
    if (prefix && prefix.length > 0) {
      const observed = doc.slice(Math.max(0, candidate.start - prefix.length), candidate.start);
      prefixScore = stringSimilarity(observed, prefix);
    }
    let suffixScore = 1;
    if (suffix && suffix.length > 0) {
      const observed = doc.slice(
        candidate.end,
        Math.min(doc.length, candidate.end + suffix.length)
      );
      suffixScore = stringSimilarity(observed, suffix);
    }
    const positionScore = clamp01(
      doc.length === 0 ? 1 : 1 - Math.abs(candidate.start - expectedStart) / doc.length
    );
    const score = (W_QUOTE * quoteScore + W_PREFIX * prefixScore + W_SUFFIX * suffixScore + W_POSITION * positionScore) / W_TOTAL;
    if (best === null || score > best.score) {
      best = { ...candidate, score };
    }
  }
  return best;
}
function stringSimilarity(a, b) {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const distance = levenshtein(a, b);
  return clamp01(1 - distance / Math.max(a.length, b.length));
}
function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j += 1) prev[j] = j;
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[n];
}
function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
function round3(x) {
  return Math.round(x * 1e3) / 1e3;
}

// server/lib/persistence.js
var SCHEMA_VERSION = 1;
function sidecarPathFor(docFilePath) {
  const dir = dirname2(docFilePath);
  const base = basename(docFilePath);
  const stem = base.endsWith(".md") ? base.slice(0, -3) : base.replace(extname(base), "");
  return join3(dir, `${stem}.comark.json`);
}
async function loadComments(docFilePath) {
  const path = sidecarPathFor(docFilePath);
  if (!existsSync3(path)) return [];
  try {
    const raw = await readFile3(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== SCHEMA_VERSION) {
      return [];
    }
    return Array.isArray(parsed.comments) ? parsed.comments : [];
  } catch (err) {
    try {
      const backup = `${path}.bak.${Date.now()}`;
      await rename2(path, backup);
    } catch {
    }
    return [];
  }
}
async function saveComments(docFilePath, comments) {
  const path = sidecarPathFor(docFilePath);
  const tmp = `${path}.tmp`;
  await mkdir3(dirname2(path), { recursive: true });
  const payload = JSON.stringify(
    { schemaVersion: SCHEMA_VERSION, comments },
    null,
    2
  );
  await writeFile3(tmp, payload, "utf8");
  await rename2(tmp, path);
}
async function resolveAllAnchors(docContent, comments) {
  const out = [];
  for (const comment of comments) {
    const resolved2 = await resolveAnchor(docContent, comment);
    out.push(resolved2);
  }
  return out;
}

// server/api/docs.js
async function handleRegisterDoc(req, res) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { error: err.message });
  }
  if (!body || typeof body !== "object") {
    return sendJson(res, 400, { error: "Body must be a JSON object" });
  }
  const { docId, filePath, transcriptPath, contextSummary, model } = body;
  if (typeof docId !== "string" || !docId) {
    return sendJson(res, 400, { error: "docId is required (string)" });
  }
  if (typeof filePath !== "string" || !filePath) {
    return sendJson(res, 400, { error: "filePath is required (string)" });
  }
  const entry = await registerDoc({ docId, filePath, transcriptPath, contextSummary, model });
  return sendJson(res, 200, { ok: true, doc: entry });
}
async function handleGetDoc(req, res, { docId }) {
  const entry = getDoc(docId);
  if (!entry) {
    return sendJson(res, 404, {
      error: "Doc not registered. The hook script must register the doc before the review surface can load it."
    });
  }
  let content;
  try {
    content = await readFile4(entry.filePath, "utf8");
  } catch (err) {
    return sendJson(res, 404, {
      error: `Could not read source file at ${entry.filePath}: ${err.code || err.message}`
    });
  }
  let comments = [];
  try {
    const stored = await loadComments(entry.filePath);
    comments = await resolveAllAnchors(content, stored);
  } catch (err) {
    return sendJson(res, 200, {
      docId,
      filePath: entry.filePath,
      content,
      contextSummary: entry.contextSummary,
      model: entry.model,
      comments: [],
      persistenceWarning: err.message
    });
  }
  return sendJson(res, 200, {
    docId,
    filePath: entry.filePath,
    content,
    contextSummary: entry.contextSummary,
    model: entry.model,
    comments
  });
}

// server/api/comments.js
import { readFile as readFile5 } from "node:fs/promises";
import { randomUUID } from "node:crypto";

// server/lib/event-bus.js
import { watchFile, unwatchFile, existsSync as existsSync4 } from "node:fs";
var subscribers = /* @__PURE__ */ new Map();
var watched = /* @__PURE__ */ new Map();
function ensureWatch(docId, sidecarPath) {
  if (watched.has(docId)) return;
  watched.set(docId, { sidecarPath });
  watchFile(sidecarPath, { interval: 250, persistent: false }, (curr, prev) => {
    if (curr.mtimeMs === prev.mtimeMs) return;
    emit(docId, "update", { reason: "sidecar-changed", mtimeMs: curr.mtimeMs });
  });
}
function maybeStopWatch(docId) {
  const subs = subscribers.get(docId);
  if (subs && subs.size > 0) return;
  const w = watched.get(docId);
  if (!w) return;
  unwatchFile(w.sidecarPath);
  watched.delete(docId);
}
function subscribe(docId, filePath, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write(": comark event stream open\n\n");
  let set = subscribers.get(docId);
  if (!set) {
    set = /* @__PURE__ */ new Set();
    subscribers.set(docId, set);
  }
  set.add(res);
  const sidecarPath = sidecarPathFor(filePath);
  if (existsSync4(sidecarPath)) {
    ensureWatch(docId, sidecarPath);
  } else {
  }
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch {
    }
  }, 25e3);
  res.on("close", () => {
    clearInterval(heartbeat);
    const s = subscribers.get(docId);
    if (s) {
      s.delete(res);
      if (s.size === 0) subscribers.delete(docId);
    }
    maybeStopWatch(docId);
  });
}
function emit(docId, event, data) {
  const set = subscribers.get(docId);
  if (!set || set.size === 0) return;
  const payload = `event: ${event}
data: ${JSON.stringify(data)}

`;
  for (const res of set) {
    try {
      res.write(payload);
    } catch {
    }
  }
}
function emitImmediate(docId, reason) {
  emit(docId, "update", { reason, mtimeMs: Date.now() });
}
function shutdownAll() {
  for (const [docId, w] of watched.entries()) {
    unwatchFile(w.sidecarPath);
    watched.delete(docId);
  }
  for (const set of subscribers.values()) {
    for (const res of set) {
      try {
        res.end();
      } catch {
      }
    }
    set.clear();
  }
  subscribers.clear();
}

// server/api/comments.js
async function handleListComments(req, res, { docId }) {
  const entry = getDoc(docId);
  if (!entry) return sendJson(res, 404, { error: "Doc not registered" });
  let content;
  try {
    content = await readFile5(entry.filePath, "utf8");
  } catch (err) {
    return sendJson(res, 404, { error: `Could not read source file: ${err.code || err.message}` });
  }
  const stored = await loadComments(entry.filePath);
  const comments = await resolveAllAnchors(content, stored);
  return sendJson(res, 200, { comments });
}
async function handleSaveComment(req, res, { docId }) {
  const entry = getDoc(docId);
  if (!entry) return sendJson(res, 404, { error: "Doc not registered" });
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, err.statusCode || 400, { error: err.message });
  }
  const incoming = body?.comment;
  if (!incoming || typeof incoming !== "object") {
    return sendJson(res, 400, { error: "Body.comment is required" });
  }
  const stored = await loadComments(entry.filePath);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let result;
  if (incoming.id) {
    const idx = stored.findIndex((c) => c.id === incoming.id);
    if (idx >= 0) {
      stored[idx] = { ...stored[idx], ...incoming, updatedAt: now };
      result = stored[idx];
    } else {
      result = { ...incoming, createdAt: incoming.createdAt || now, updatedAt: now };
      stored.push(result);
    }
  } else {
    result = {
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
      state: "open",
      anchorState: "anchored",
      thread: [],
      ...incoming
    };
    stored.push(result);
  }
  await saveComments(entry.filePath, stored);
  let content;
  try {
    content = await readFile5(entry.filePath, "utf8");
    const resolved2 = await resolveAllAnchors(content, [result]);
    result = resolved2[0] ?? result;
  } catch {
  }
  emitImmediate(docId, "comment-saved");
  return sendJson(res, 200, { comment: result });
}

// server/api/events.js
async function handleEventStream(req, res) {
  const url = new URL(req.url, "http://127.0.0.1");
  const docId = url.searchParams.get("docId");
  if (!docId) {
    return sendJson(res, 400, { error: "docId query param required" });
  }
  const entry = getDoc(docId);
  if (!entry) {
    return sendJson(res, 404, { error: "Doc not registered" });
  }
  subscribe(docId, entry.filePath, res);
}

// server/lib/static.js
import { readFile as readFile6, stat as stat2 } from "node:fs/promises";
import { existsSync as existsSync5 } from "node:fs";
import { dirname as dirname3, extname as extname2, join as join4, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname3(__filename);
var _CANDIDATES = [
  resolve(__dirname, "..", "..", "web", "dist"),
  // bundled context
  resolve(__dirname, "..", "..", "plugin", "web", "dist")
  // source context
];
var DIST_ROOT = _CANDIDATES.find((p) => existsSync5(p)) ?? _CANDIDATES[0];
var MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8"
};
function distExists() {
  return existsSync5(join4(DIST_ROOT, "index.html"));
}
function placeholderHtml(port) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>comark \u2014 server up</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    min-height: 100vh;
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
    display: grid;
    place-items: center;
    background: #fafaf7;
    color: #1f1d1a;
    padding: 24px;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #14130f; color: #ebe7df; }
    .card { background: #1c1a16; border-color: #2a2722; }
    code { background: #2a2722; }
  }
  .card {
    max-width: 560px;
    background: #fff;
    border: 1px solid #e6e2d8;
    border-radius: 12px;
    padding: 28px 32px;
    box-shadow: 0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.04);
  }
  h1 { margin: 0 0 8px; font-size: 18px; font-weight: 600; }
  p { margin: 8px 0; color: inherit; opacity: .8; }
  code { background: #f0ece2; padding: 2px 6px; border-radius: 6px; font-size: 13px; }
  .muted { opacity: .6; font-size: 13px; }
</style>
</head>
<body>
  <main class="card">
    <h1>comark server is running on port ${port}.</h1>
    <p>The review surface (web/dist) hasn't been built yet \u2014 that's the U5 deliverable.</p>
    <p class="muted">Health probe: <code>GET /healthz</code></p>
    <p class="muted">Doc endpoint: <code>GET /api/docs/&lt;docId&gt;</code> (registered via the PostToolUse hook)</p>
  </main>
</body>
</html>`;
}
async function serveStatic(req, res, urlPath, port) {
  const safePath = sanitizePath(urlPath);
  if (safePath === null) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden");
    return true;
  }
  if (!distExists()) {
    if (safePath === "/" || safePath === "/index.html" || extname2(safePath) === "") {
      const body = placeholderHtml(port);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store"
      });
      res.end(body);
      return true;
    }
    return false;
  }
  const candidate = safePath === "/" ? "/index.html" : safePath;
  const onDisk = resolve(DIST_ROOT, "." + candidate);
  if (!onDisk.startsWith(DIST_ROOT + sep) && onDisk !== DIST_ROOT) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden");
    return true;
  }
  let stats;
  try {
    stats = await stat2(onDisk);
  } catch {
    if (extname2(candidate) === "") {
      return serveFile(res, join4(DIST_ROOT, "index.html"));
    }
    return false;
  }
  if (stats.isDirectory()) {
    return serveFile(res, join4(onDisk, "index.html"));
  }
  return serveFile(res, onDisk);
}
function sanitizePath(p) {
  try {
    const decoded = decodeURIComponent(p);
    if (decoded.includes("\0")) return null;
    if (decoded.includes("..")) return null;
    return decoded;
  } catch {
    return null;
  }
}
async function serveFile(res, filePath) {
  try {
    const body = await readFile6(filePath);
    const ext = extname2(filePath).toLowerCase();
    const type = MIME[ext] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": type,
      "Content-Length": body.length,
      // Single-user local app: never cache. Avoids stale-asset surprises after
      // a `vite build`. The cost (one extra fetch per asset) is irrelevant on loopback.
      "Cache-Control": "no-store"
    });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

// server/index.js
var VERSION = "0.1.5";
async function bootstrap() {
  const existing = await findRunningServer();
  if (existing) {
    process.stderr.write(
      `comark: server already running on port ${existing.port} (pid ${existing.pid}); reusing.
`
    );
    process.exit(0);
  }
  await ensureRuntimeDir();
  const port = await pickAvailablePort();
  const router = createRouter();
  router.get("/healthz", (req, res) => {
    sendJson(res, 200, { ok: true, version: VERSION, port });
  }, { skipOriginCheck: true });
  router.post("/api/register-doc", (req, res) => handleRegisterDoc(req, res));
  router.get("/api/docs/:docId", (req, res, params) => handleGetDoc(req, res, params));
  router.get("/api/comments/:docId", (req, res, params) => handleListComments(req, res, params));
  router.post("/api/comments/:docId", (req, res, params) => handleSaveComment(req, res, params));
  router.get("/api/events", (req, res) => handleEventStream(req, res), { skipOriginCheck: true });
  const server = createServer2(async (req, res) => {
    try {
      await dispatch(router, req, res, port);
    } catch (err) {
      process.stderr.write(`comark request error: ${err?.message || err}
`);
      if (!res.headersSent) {
        sendJson(res, 500, { error: "internal server error" });
      } else {
        try {
          res.end();
        } catch {
        }
      }
    }
  });
  server.listen(port, "127.0.0.1", async () => {
    await writeLockfile({ port, pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() });
    const distNote = distExists() ? "" : " (placeholder UI; web/dist not built)";
    process.stderr.write(`comark: listening on http://127.0.0.1:${port}${distNote}
`);
  });
  const shutdown = async (signal) => {
    process.stderr.write(`comark: ${signal} received; shutting down.
`);
    shutdownAll();
    server.close(() => {
    });
    await deleteLockfile();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("uncaughtException", async (err) => {
    process.stderr.write(`comark: uncaught exception: ${err?.stack || err}
`);
    await deleteLockfile();
    process.exit(1);
  });
}
async function dispatch(router, req, res, port) {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const path = url.pathname;
  const method = (req.method || "GET").toUpperCase();
  const matched = router.matchRoute(method, path);
  if (matched) {
    if (STATE_MUTATING_METHODS.has(method) && !matched.route.skipOriginCheck && !isOriginAllowed(req, port)) {
      return sendJson(res, 403, {
        error: "Origin not allowed. comark only accepts requests from http://localhost:<server-port>."
      });
    }
    return matched.route.handler(req, res, matched.params);
  }
  if (method === "GET" || method === "HEAD") {
    const served = await serveStatic(req, res, path, port);
    if (served) return;
  }
  return sendJson(res, 404, { error: `No route for ${method} ${path}` });
}
var isDirectInvocation = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isDirectInvocation) {
  bootstrap().catch(async (err) => {
    process.stderr.write(`comark: fatal startup error: ${err?.message || err}
`);
    await deleteLockfile().catch(() => {
    });
    process.exit(1);
  });
}
export {
  VERSION,
  bootstrap
};
