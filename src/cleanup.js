import fs from 'node:fs';
import path from 'node:path';
import { claudeDir, claudeJsonPath, encodeDir, pathKey, driveAvailable, isDir } from './paths.js';
import { WIN } from './platform.js';
import { formatSize } from './text.js';
import { globalFolders, STATE } from './sessions.js';
import { runClaude, runClaudeSync, purgeSupported } from './claude.js';

// ---- running claude detection ----

// Claude writes ~/.claude/sessions/<pid>.json for every running session. EPERM = alive but not ours.
export function runningSessions() {
  const dir = path.join(claudeDir(), 'sessions');
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')); } catch { continue; }
    const pid = Number(j.pid) || Number(path.basename(n, '.json'));
    if (!pid) continue;
    try { process.kill(pid, 0); } catch (e) { if (e.code !== 'EPERM') continue; }
    out.push({ pid, cwd: j.cwd || '', sessionId: j.sessionId || '' });
  }
  return out;
}

// ---- scanning ----

// Path that Claude would encode to the given session dir name, for orphans with no recorded folder.
export function derivePath(dirName) {
  let p = null;
  if (WIN) {
    const m = /^([A-Za-z])--(.+)$/.exec(dirName);
    if (m) p = `${m[1]}:\\${m[2].replace(/-/g, '\\')}`;
  } else if (dirName.startsWith('-')) {
    p = dirName.replace(/-/g, '/');
  }
  return p && encodeDir(p) === dirName ? p : null;
}

function claudeJsonProjectKeys() {
  try {
    const j = JSON.parse(fs.readFileSync(claudeJsonPath(), 'utf8'));
    return j && typeof j.projects === 'object' && j.projects ? Object.keys(j.projects) : [];
  } catch { return []; }
}

export function legacyBackups() {
  const dir = path.dirname(claudeJsonPath());
  const prefix = `${path.basename(claudeJsonPath())}.backup`;
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out = [];
  for (const n of names) {
    if (!n.startsWith(prefix)) continue;
    const file = path.join(dir, n);
    try { const st = fs.statSync(file); if (st.isFile()) out.push({ file, size: st.size }); } catch { /* gone */ }
  }
  return out;
}

/**
 * Orphans = session dirs whose folder is gone or never recorded, plus ~/.claude.json project keys whose folder is gone.
 * Each has the path handed to `claude purge` (null if none can be derived).
 * @returns {{label:string,purgePath:string|null,source:string}[]}
 */
export function scanOrphans() {
  const orphans = [];
  const seen = new Set();
  for (const f of globalFolders()) {
    if (f.state === STATE.GONE) {
      orphans.push({ label: f.path, purgePath: f.path, source: 'sessions' });
      seen.add(pathKey(f.path));
    } else if (f.state === STATE.UNKNOWN) {
      const p = derivePath(path.basename(f.projDir));
      orphans.push({ label: `${f.leaf}  (unknown folder)`, purgePath: p, source: 'sessions' });
      if (p) seen.add(pathKey(p));
    }
  }
  for (const key of claudeJsonProjectKeys()) {
    const p = WIN ? path.normalize(key) : key;
    if (seen.has(pathKey(p)) || isDir(p) || !driveAvailable(p)) continue;
    orphans.push({ label: `${p}  (config entry only)`, purgePath: p, source: 'config' });
    seen.add(pathKey(p));
  }
  return orphans;
}

// ---- planning ----

// Parses `claude purge --dry-run` output into items + a short summary.
export function parsePurgeOutput(text) {
  const lines = text.split(/\r?\n/);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s+(dir|config|filter):\s+(.*)$/.exec(lines[i]);
    if (m) items.push({ kind: m[1], target: m[2].trim(), desc: (lines[i + 1] || '').trim() });
  }
  const parts = [];
  if (items.some((x) => /transcripts/.test(x.desc))) parts.push('transcripts');
  const fh = items.filter((x) => /file edit history/.test(x.desc)).length;
  if (fh) parts.push(`${fh} file-history`);
  if (items.some((x) => x.kind === 'config')) parts.push('config entry');
  for (const x of items) {
    const n = x.kind === 'filter' ? /(\d+) prompt/.exec(x.desc) : null;
    if (n) parts.push(`${n[1]} prompts`);
  }
  return { items, summary: parts.join(', ') };
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => { while (next < list.length) { const i = next++; out[i] = await fn(list[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return out;
}

/**
 * Dry-runs `claude purge` for each orphan. Those with nothing to purge (exit != 0) are dropped.
 * @returns {Promise<{items:{label:string,purgePath:string,summary:string,partial:boolean}[],skipped:string[]}>}
 */
export async function planOrphans(orphans) {
  const skipped = [];
  const plans = await mapLimit(orphans, 4, async (o) => {
    if (!o.purgePath) { skipped.push(`${o.label}: cannot work out its folder`); return null; }
    const r = await runClaude(['purge', o.purgePath, '--dry-run']);
    if (!r.ok) {
      if (r.code === null) skipped.push(`${o.label}: ${r.err}`);   // could not run at all; a non-zero exit means nothing to purge
      return null;
    }
    const { items, summary } = parsePurgeOutput(r.out);
    if (!items.length) return null;
    // sessions found by a derived path may leave the config entry / prompts behind
    const partial = o.source === 'sessions' && !items.some((x) => x.kind === 'config');
    return { label: o.label, purgePath: o.purgePath, summary, partial };
  });
  return { items: plans.filter(Boolean), skipped };
}

// ---- categories ----

function backupFile(file) {
  try { fs.copyFileSync(file, `${file}.bak`); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

/**
 * Everything Cleanup can remove is a category; the screens only walk this list.
 * id, title: key and heading. tally: noun in the Settings summary. noun: in confirm and result messages.
 * hint(items): extra text on the checkbox row. unavailable(): reason the category cannot run, or ''.
 * scan(): items found. plan(items): optional async refinement -> {items, skipped}.
 * reviewTitle, reviewLines(item): the review screen. note: shown there when the category has items.
 * backsUp: keeps .bak copies of ~/.claude.json and history.jsonl before it runs.
 * run(items, progress): -> {done, failures}.
 */
const ORPHANS = {
  id: 'orphans',
  title: 'Orphaned projects',
  tally: 'orphaned',
  noun: 'project(s)',
  hint: () => 'folder gone, still has sessions / config entry',
  unavailable: () => (purgeSupported() ? '' : 'claude purge needs Claude Code v2.1.288+'),
  scan: scanOrphans,
  plan: planOrphans,
  reviewTitle: 'Orphaned projects (removed with claude purge):',
  reviewLines: (o) => [`  ${o.label}`, `    ${o.summary}${o.partial ? ' (partial: config entry / prompts may remain)' : ''}`],
  note: 'A copy of ~/.claude.json and history.jsonl is kept as .bak first.',
  backsUp: true,
  run(items, progress) {
    const out = { done: 0, failures: [] };
    items.forEach((o, i) => {
      progress(`Purging ${i + 1}/${items.length}: ${o.label}`);
      const r = runClaudeSync(['purge', o.purgePath, '--yes']);
      if (r.ok) out.done++;
      else out.failures.push(`${o.label}: ${(r.err || r.out).trim().split(/\r?\n/)[0] || `exit ${r.code}`}`);
    });
    return out;
  },
};

const BACKUPS = {
  id: 'backups',
  title: 'Legacy ~/.claude.json backups',
  tally: 'legacy backup(s)',
  noun: 'backup file(s)',
  hint: (items) => (items.length ? formatSize(items.reduce((n, b) => n + b.size, 0)) : ''),
  scan: legacyBackups,
  reviewTitle: 'Legacy ~/.claude.json backups:',
  reviewLines: (b) => [`  ${b.file}  (${formatSize(b.size)})`],
  run(items, progress) {
    const out = { done: 0, failures: [] };
    for (const b of items) {
      progress(`Deleting ${path.basename(b.file)}`);
      try { fs.rmSync(b.file, { force: true }); out.done++; } catch (e) { out.failures.push(`${b.file}: ${e.message}`); }
    }
    return out;
  },
};

export const CATEGORIES = [ORPHANS, BACKUPS];

const itemsOf = (plan, c) => plan.items[c.id] ?? [];

export const emptyScan = () => Object.fromEntries(CATEGORIES.map((c) => [c.id, []]));

/** @returns {Object<string, object[]>} items found, by category id */
export const scanCleanup = () => Object.fromEntries(CATEGORIES.map((c) => [c.id, c.scan()]));

/**
 * Plans the chosen categories.
 * @param {Object<string, object[]>} found result of scanCleanup
 * @param {string[]} ids chosen category ids
 * @returns {Promise<{items:Object<string, object[]>, skipped:string[]}>}
 */
export async function planCleanup(found, ids) {
  const plan = { items: {}, skipped: [] };
  for (const c of CATEGORIES) {
    if (!ids.includes(c.id)) { plan.items[c.id] = []; continue; }
    const p = c.plan ? await c.plan(found[c.id]) : { items: found[c.id], skipped: [] };
    plan.items[c.id] = p.items;
    plan.skipped.push(...p.skipped);
  }
  return plan;
}

// ---- executing ----

/**
 * Runs the plan. Refuses while claude is running. Keeps one .bak of ~/.claude.json and history.jsonl.
 * @returns {{error?:string, done:Object<string, number>, failures:string[]}} done = items removed, by category id
 */
export function executeCleanup(plan, onProgress = () => {}) {
  const res = { done: Object.fromEntries(CATEGORIES.map((c) => [c.id, 0])), failures: [] };
  const running = runningSessions();
  if (running.length) { res.error = `Claude is running (${running.length} session(s)). Close it first.`; return res; }
  if (CATEGORIES.some((c) => c.backsUp && itemsOf(plan, c).length)) {
    try {
      backupFile(claudeJsonPath());
      backupFile(path.join(claudeDir(), 'history.jsonl'));
    } catch (e) { res.error = `Backup failed, nothing deleted: ${e.message}`; return res; }
  }
  for (const c of CATEGORIES) {
    const items = itemsOf(plan, c);
    if (!items.length) continue;
    const r = c.run(items, onProgress);
    res.done[c.id] = r.done;
    res.failures.push(...r.failures);
  }
  return res;
}
