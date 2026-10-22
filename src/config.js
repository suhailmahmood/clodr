import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathKey, relPath } from './paths.js';
import { WIN } from './platform.js';

export function configDir() {
  if (process.env.CLODR_HOME) return process.env.CLODR_HOME;
  if (WIN) return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'clodr');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'clodr');
}

export const configFile = () => path.join(configDir(), 'config.json');

export const ELSE = 'else';   // `view` value of the "Everything else" tab

// Display name of a workspace: its given name, else the folder name.
export const wsName = (w) => w.name || path.basename(w.path) || w.path;

export const makeWorkspace = (p, name) => (name ? { path: p, name } : { path: p });

// Workspaces strictly inside `ws`: their sessions are not listed under it.
export const nestedIn = (list, ws) => list.filter((w) => relPath(w.path, ws.path));

function parseWorkspaces(list) {
  if (!Array.isArray(list)) return undefined;
  const seen = new Set();
  const out = [];
  for (const w of list) {
    if (!w || typeof w.path !== 'string' || !w.path || seen.has(pathKey(w.path))) continue;
    seen.add(pathKey(w.path));
    out.push(makeWorkspace(w.path, typeof w.name === 'string' ? w.name : ''));
  }
  return out;
}

// One entry per config key: its default and a parser (undefined = unusable value, keep the default).
// workspaces: [{path, name?}] in display order. view: a workspace path or ELSE.
const SCHEMA = {
  workspaces: { fallback: () => [makeWorkspace(path.join(os.homedir(), 'Workspace'))], parse: parseWorkspaces },
  view: { fallback: () => '', parse: (v) => (typeof v === 'string' ? v : undefined) },
};

// Reported once: later reads happen inside the full-screen UI, where a warning would garble the frame.
const warned = new Set();

export function getConfig() {
  const cfg = Object.fromEntries(Object.entries(SCHEMA).map(([key, s]) => [key, s.fallback()]));
  let text;
  try { text = fs.readFileSync(configFile(), 'utf8'); } catch { return cfg; }
  let json;
  try { json = JSON.parse(text); } catch (e) {
    const msg = `Ignoring unreadable ${configFile()}: ${e.message}`;
    if (!warned.has(msg)) { warned.add(msg); console.warn(msg); }
    return cfg;
  }
  for (const [key, s] of Object.entries(SCHEMA)) {
    const v = s.parse(json?.[key]);
    if (v !== undefined) cfg[key] = v;
  }
  return cfg;
}

export function saveConfig(cfg) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(cfg, null, 2) + '\n');
}
