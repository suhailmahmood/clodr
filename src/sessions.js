import fs from 'node:fs';
import path from 'node:path';
import { claudeDir, projectDir, pathKey, relPath, trimSep, isDir, driveAvailable } from './paths.js';
import { configDir } from './config.js';
import { messageCost } from './pricing.js';

export const STATE = { OK: 'ok', GONE: 'gone', UNKNOWN: 'unknown', OFFLINE: 'offline' };

// Transcripts of a session dir, newest first: {file, mtime, size}.
function transcripts(projDir) {
  let names;
  try { names = fs.readdirSync(projDir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      const st = fs.statSync(path.join(projDir, name));
      if (st.isFile()) out.push({ file: path.join(projDir, name), mtime: st.mtime, size: st.size });
    } catch { /* vanished */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export const sessionCount = (dir) => transcripts(projectDir(dir)).length;

// Text of byte ranges [pos, len] of a file. Throws if it cannot be read.
function readParts(file, ...ranges) {
  const fd = fs.openSync(file, 'r');
  try {
    return ranges.map(([pos, len]) => {
      const buf = Buffer.alloc(len);
      return buf.subarray(0, fs.readSync(fd, buf, 0, len, pos)).toString('utf8');
    });
  } finally { fs.closeSync(fd); }
}

const HEAD = 64 * 1024;
const TAIL = 256 * 1024;

// Both ends of a file. Titles are appended late and re-appended, the first prompt is near the start.
function readEnds(file, size) {
  if (size <= HEAD + TAIL) return { head: readParts(file, [0, size])[0], tail: '' };
  const [head, tail] = readParts(file, [0, HEAD], [size - TAIL, TAIL]);
  return { head, tail };
}

const jsonLines = (text) => text.split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });   // cut-off edge lines drop out

function firstPrompt(entries) {
  for (const e of entries) {
    if (e.type !== 'user' || e.isMeta) continue;
    const c = e.message?.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? c.find((p) => p.type === 'text')?.text : '';
    if (text && !text.trimStart().startsWith('<')) return text;     // "<command-name>", "<system-reminder>": not typed by the user
  }
  return '';
}

// Name of a session like claude -r shows it: /rename title, else the generated title, else the last / first prompt.
function sessionTitle(file, size) {
  let ends;
  try { ends = readEnds(file, size); } catch { return ''; }
  const head = jsonLines(ends.head);
  const entries = [...head, ...jsonLines(ends.tail)];
  const last = (type, key) => entries.findLast((e) => e.type === type && e[key])?.[key];
  const title = last('custom-title', 'customTitle') || last('ai-title', 'aiTitle') || last('last-prompt', 'lastPrompt') || firstPrompt(head);
  return title.replace(/\s+/g, ' ').trim();
}

// Estimated USD cost of one transcript. Claude writes one line per content block of a response, each carrying
// the same usage, so every response counts once (by message id, the last line wins as it is the most complete).
function transcriptCost(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return 0; }
  const seen = new Map();
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const m = e.message;
    if (m?.usage) seen.set(m.id || e.uuid, m);
  }
  let usd = 0;
  for (const m of seen.values()) usd += messageCost(m.model, m.usage) || 0;
  return usd;
}

// Costs are kept in the config dir per transcript file, recomputed only when its size or time changes.
const costCacheFile = () => path.join(configDir(), 'costs.json');
let costCache = null;                    // {files: {[file]: {size, mtimeMs, usd}}, dirty}

function loadCostCache() {
  try { costCache = { files: JSON.parse(fs.readFileSync(costCacheFile(), 'utf8')).files || {} }; } catch { costCache = { files: {} }; }
}

function saveCostCache() {
  if (!costCache.dirty) return;
  for (const f of Object.keys(costCache.files)) if (!fs.existsSync(f)) delete costCache.files[f];
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(costCacheFile(), JSON.stringify({ files: costCache.files }));
    costCache.dirty = false;
  } catch { /* cache only: recomputed next time */ }
}

function cachedCost(file) {
  let st;
  try { st = fs.statSync(file); } catch { return 0; }
  const hit = costCache.files[file];
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.usd;
  const usd = transcriptCost(file);
  costCache.files[file] = { size: st.size, mtimeMs: st.mtimeMs, usd };
  costCache.dirty = true;
  return usd;
}

// A session's transcript plus its subagents' transcripts.
function sessionCost(projDir, id) {
  const sub = path.join(projDir, id, 'subagents');
  let names = [];
  try { names = fs.readdirSync(sub).filter((n) => n.endsWith('.jsonl')); } catch { /* none */ }
  return [path.join(projDir, `${id}.jsonl`), ...names.map((n) => path.join(sub, n))].reduce((sum, f) => sum + cachedCost(f), 0);
}

/**
 * Sessions of a folder, newest first. title is '' when the transcript has nothing to name it by.
 * cost is the estimated USD cost at API prices, subagents included.
 * @returns {{id:string,title:string,mtime:Date,size:number,cost:number}[]}
 */
export function listSessions(dir) {
  const pd = projectDir(dir);
  if (!costCache) loadCostCache();
  const out = [];
  for (const { file, mtime, size } of transcripts(pd)) {
    const id = path.basename(file, '.jsonl');
    out.push({ id, title: sessionTitle(file, size), mtime, size, cost: sessionCost(pd, id) });
  }
  saveCostCache();
  return out;
}

// Newest session time (else the folder's own time) and session count of a folder, from one scan.
function activity(dir) {
  const t = transcripts(projectDir(dir));
  let last = t[0]?.mtime;
  if (!last) { try { last = fs.statSync(dir).mtime; } catch { last = new Date(0); } }
  return { last, sessions: t.length };
}

// Real folder of a session dir: the "cwd" in its transcripts (the dir name encoding is lossy).
// It is not on the first line, so look at the first few.
function sessionCwd(projDir) {
  for (const { file } of transcripts(projDir)) {
    let head;
    try { [head] = readParts(file, [0, 256 * 1024]); } catch { continue; }
    for (const line of head.split('\n', 60)) {
      const m = /"cwd":("(?:[^"\\]|\\.)*")/.exec(line);
      if (m) { try { return JSON.parse(m[1]); } catch { /* try next line */ } }
    }
  }
  return null;
}

/**
 * Every folder Claude Code has a session in, newest activity first.
 * state: STATE.OK | GONE (recorded folder deleted) | UNKNOWN (no folder recorded; path = session dir) | OFFLINE (drive not mounted)
 * projDir = the real session dir, the only reliable handle for deleting.
 * @returns {{name:string,path:string,leaf:string,parent:string,last:Date,sessions:number,state:string,projDir:string}[]}
 */
export function globalFolders() {
  const projects = path.join(claudeDir(), 'projects');
  let dirs;
  try { dirs = fs.readdirSync(projects, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  const found = [];
  for (const d of dirs) {
    const pd = path.join(projects, d.name);
    const ts = transcripts(pd);
    if (!ts.length) continue;                             // no transcripts = nothing to show or delete
    const base = { last: ts[0].mtime, sessions: ts.length, projDir: pd };
    const cwd = sessionCwd(pd);
    if (!cwd) {
      found.push({ ...base, name: d.name, path: pd, leaf: d.name, parent: '', state: STATE.UNKNOWN });
      continue;
    }
    let state = STATE.OK;
    if (!isDir(cwd)) state = driveAvailable(cwd) ? STATE.GONE : STATE.OFFLINE;
    const leaf = path.basename(cwd);
    found.push({ ...base, name: cwd, path: cwd, leaf: leaf || cwd, parent: leaf ? path.dirname(cwd) : '', state });
  }
  found.sort((a, b) => b.last - a.last);
  const seen = new Set();                                 // several session dirs can record the same cwd; keep the newest
  return found.filter((f) => { const k = pathKey(f.path); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Workspace view: every folder directly inside the workspace, plus deeper folders that have a session. Named by
// their path relative to the workspace (leaf and parent stay '').
// `nested` = workspaces inside this one: everything rooted there belongs to them, not to this workspace.
export function workspaceFolders(root, all = globalFolders(), nested = []) {
  const taken = (p) => nested.some((n) => relPath(p, n.path) !== null);
  let direct = [];
  try {
    direct = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !taken(path.join(root, d.name)))
      .map((d) => { const p = path.join(root, d.name); return { name: d.name, leaf: '', parent: '', path: p, ...activity(p) }; });
  } catch { /* no root yet */ }
  const deeper = [];
  for (const f of all) {
    if (f.state !== STATE.OK || taken(f.path)) continue;
    const rel = relPath(f.path, root);
    if (rel && /[\\/]/.test(rel)) deeper.push({ name: rel, leaf: '', parent: '', path: f.path, last: f.last, sessions: f.sessions });
  }
  return [...direct, ...deeper].sort((a, b) => b.last - a.last);
}

// "Everything else": existing folders with a session outside every workspace.
export function outsideFolders(roots, all = globalFolders()) {
  return all.filter((f) => f.state === STATE.OK && roots.every((r) => relPath(f.path, r) === null));
}

// Deletes one session of a folder: its subagent folder, file edit history and env dir, then the transcript last
// so a failed delete leaves the session listed and retryable. Everything is keyed by the transcript's file name,
// never by the ids inside it (a fork's transcript starts with its parent's history). Returns null on success, else a message.
export function removeSession(dir, id, projDir) {
  if (!id || id !== path.basename(id) || id === '.' || id === '..') return `Refusing: bad session id ${id}`;
  const pd = projDir || projectDir(dir);
  const targets = [path.join(pd, id), path.join(claudeDir(), 'file-history', id), path.join(claudeDir(), 'session-env', id), path.join(pd, `${id}.jsonl`)];
  for (const t of targets) {
    try { fs.rmSync(t, { recursive: true, force: true }); } catch (e) { return `Delete failed: ${e.message}`; }
  }
  return null;
}

// Deletes only the folder's Claude sessions. Returns null on success, else a message.
export function removeSessions(dir, projDir) {
  const pd = projDir || projectDir(dir);
  try { fs.rmSync(pd, { recursive: true, force: true }); } catch (e) { return `Session cleanup failed: ${e.message}`; }
  return null;
}

// Deletes a folder and its session dir. Returns null on success, else a message.
// `protect`: workspace folders that must survive (refused if one is inside the folder).
export function removeFolder(dir, root, protect = []) {
  const full = trimSep(path.resolve(dir));
  const rel = relPath(full, root);
  if (rel === null) return `Refusing: ${full} is outside ${trimSep(path.resolve(root))}`;
  if (rel === '') return `Refusing: ${full} is the workspace root`;
  const inner = protect.find((p) => relPath(p, full) !== null);
  if (inner) return `Refusing: workspace ${trimSep(path.resolve(inner))} is inside it. Remove that workspace first`;
  if (relPath(process.cwd(), full) !== null) process.chdir(path.dirname(full));   // a folder that is some process's cwd cannot be deleted on Windows
  try { fs.rmSync(full, { recursive: true, force: true }); } catch (e) {
    const busy = ['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(e.code) ? ' (in use? close terminals / editors open in it, then retry)' : '';
    return `Delete failed: ${e.message}${busy}`;
  }
  const pd = projectDir(full);
  let sibling;
  try {
    sibling = fs.readdirSync(root, { withFileTypes: true })
      .find((d) => d.isDirectory() && projectDir(path.join(root, d.name)) === pd);
  } catch { /* root unreadable */ }
  if (sibling) return `Folder deleted; sessions kept (dir shared with ${sibling.name})`;
  try { fs.rmSync(pd, { recursive: true, force: true }); } catch (e) { return `Folder deleted; session cleanup failed: ${e.message}`; }
  return null;
}
