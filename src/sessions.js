import fs from 'node:fs';
import path from 'node:path';
import { claudeDir, projectDir, pathKey, relPath, trimSep, isDir, driveAvailable } from './paths.js';

export const STATE = { OK: 'ok', GONE: 'gone', UNKNOWN: 'unknown', OFFLINE: 'offline' };

// Transcripts of a session dir, newest first.
function transcripts(projDir) {
  let names;
  try { names = fs.readdirSync(projDir); } catch { return []; }
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      const st = fs.statSync(path.join(projDir, name));
      if (st.isFile()) out.push({ file: path.join(projDir, name), mtime: st.mtime });
    } catch { /* vanished */ }
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export const sessionCount = (dir) => transcripts(projectDir(dir)).length;

const HEAD = 64 * 1024;
const TAIL = 256 * 1024;

// Both ends of a file as text. Titles are appended late and re-appended, the first prompt is near the start.
function readEnds(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const part = (pos, len) => {
      const buf = Buffer.alloc(len);
      return buf.subarray(0, fs.readSync(fd, buf, 0, len, pos)).toString('utf8');
    };
    if (size <= HEAD + TAIL) return { head: part(0, size), tail: '' };
    return { head: part(0, HEAD), tail: part(size - TAIL, TAIL) };
  } finally { fs.closeSync(fd); }
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

/**
 * Sessions of a folder, newest first. title is '' when the transcript has nothing to name it by.
 * @returns {{id:string,title:string,mtime:Date,size:number}[]}
 */
export function listSessions(dir) {
  const out = [];
  for (const { file, mtime } of transcripts(projectDir(dir))) {
    let size;
    try { size = fs.statSync(file).size; } catch { continue; }
    out.push({ id: path.basename(file, '.jsonl'), title: sessionTitle(file, size), mtime, size });
  }
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
export function sessionCwd(projDir) {
  for (const { file } of transcripts(projDir)) {
    let head;
    try {
      const fd = fs.openSync(file, 'r');
      try {
        const buf = Buffer.alloc(256 * 1024);
        head = buf.subarray(0, fs.readSync(fd, buf, 0, buf.length, 0)).toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch { continue; }
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

// Workspace view: every folder directly inside the workspace, plus deeper folders that have a session.
// `nested` = workspaces inside this one: everything rooted there belongs to them, not to this workspace.
export function workspaceFolders(root, all = globalFolders(), nested = []) {
  const taken = (p) => nested.some((n) => relPath(p, n.path) !== null);
  let direct = [];
  try {
    direct = fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !taken(path.join(root, d.name)))
      .map((d) => { const p = path.join(root, d.name); return { name: d.name, leaf: d.name, parent: '', path: p, ...activity(p) }; });
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
