import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { WIN } from './platform.js';

// Finds an executable on PATH. On Windows tries the PATHEXT-style suffixes.
export function which(cmd) {
  const exts = WIN ? ['.exe', '.cmd', '.bat', '.com'] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, cmd + ext);
      try { if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
    }
  }
  return null;
}

// spawn args for a resolved executable; .cmd/.bat shims need a shell (and our own quoting).
function spawnSpec(exe, args) {
  if (WIN && /\.(cmd|bat)$/i.test(exe)) {
    const bad = [exe, ...args].find((a) => /["%\r\n]/.test(a));
    if (bad) throw new Error(`Unsupported character in argument: ${bad}`);
    return { cmd: `"${exe}" ${args.map((a) => `"${a}"`).join(' ')}`, args: [], shell: true };
  }
  return { cmd: exe, args, shell: false };
}

const failure = (err, out = '') => ({ ok: false, code: null, out, err });

// Result of a finished command: {ok, code, out, err}. Never throws.
export function runSync(cmd, args) {
  const exe = which(cmd);
  if (!exe) return failure(`${cmd} not found on PATH`);
  let s;
  try { s = spawnSpec(exe, args); } catch (e) { return failure(e.message); }
  const r = spawnSync(s.cmd, s.args, { encoding: 'utf8', shell: s.shell, windowsHide: true });
  return { ok: r.status === 0, code: r.status, out: r.stdout || '', err: r.stderr || (r.error ? r.error.message : '') };
}

export function run(cmd, args) {
  const exe = which(cmd);
  if (!exe) return Promise.resolve(failure(`${cmd} not found on PATH`));
  return new Promise((resolve) => {
    let s;
    try { s = spawnSpec(exe, args); } catch (e) { resolve(failure(e.message)); return; }
    const p = spawn(s.cmd, s.args, { shell: s.shell, windowsHide: true });
    let out = '';
    let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => resolve(failure(e.message, out)));
    p.on('close', (code) => resolve({ ok: code === 0, code, out, err }));
  });
}

// Runs cmd in cwd with inherited stdio; resolves with its exit code (1 if it cannot start).
export function launch(cmd, args, cwd) {
  const exe = which(cmd);
  if (!exe) { console.error(`${cmd} not found on PATH`); return Promise.resolve(1); }
  return new Promise((resolve) => {
    let s;
    try { s = spawnSpec(exe, args); } catch (e) { console.error(e.message); resolve(1); return; }
    const p = spawn(s.cmd, s.args, { cwd, stdio: 'inherit', shell: s.shell });
    p.on('error', (e) => { console.error(e.message); resolve(1); });
    p.on('close', (code) => resolve(code ?? 0));
  });
}
