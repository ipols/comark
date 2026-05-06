// Shared registry between the HTTP server and the MCP server.
// Both processes coordinate through ~/.comark/docs.json:
//   - HTTP server writes the registry when /api/register-doc is called.
//   - MCP server reads it on every tool call to find which sidecars to scan.
// The MCP and HTTP processes are independent (stdio MCP vs socket HTTP),
// so this on-disk registry is the cheapest IPC.

import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RUNTIME_DIR = join(homedir(), '.comark');
export const REGISTRY_PATH = join(RUNTIME_DIR, 'docs.json');

async function ensureRuntimeDir() {
  await mkdir(RUNTIME_DIR, { recursive: true });
}

export async function readSharedRegistry() {
  if (!existsSync(REGISTRY_PATH)) return { docs: [] };
  try {
    const raw = await readFile(REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.docs)) return { docs: [] };
    return parsed;
  } catch {
    return { docs: [] };
  }
}

export async function writeSharedRegistry(registry) {
  await ensureRuntimeDir();
  const tmp = REGISTRY_PATH + '.tmp';
  await writeFile(tmp, JSON.stringify(registry, null, 2), 'utf8');
  await rename(tmp, REGISTRY_PATH);
}

/**
 * Add or update a doc in the shared registry.
 * Each entry: { docId, filePath, transcriptPath, contextSummary, model, registeredAt }.
 */
export async function upsertDocInRegistry(entry) {
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

export async function findDocInRegistry(docId) {
  const reg = await readSharedRegistry();
  return reg.docs.find((d) => d.docId === docId) ?? null;
}

export async function findDocByFilePathInRegistry(filePath) {
  const reg = await readSharedRegistry();
  return reg.docs.find((d) => d.filePath === filePath) ?? null;
}

export async function registryMtime() {
  if (!existsSync(REGISTRY_PATH)) return 0;
  try {
    const s = await stat(REGISTRY_PATH);
    return s.mtimeMs;
  } catch {
    return 0;
  }
}
