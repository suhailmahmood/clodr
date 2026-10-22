import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeDir } from '../src/paths.js';

// Isolated Claude + Clodr homes in a temp dir; env vars point everything there.
export function sandbox() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'clodr-test-'));
  const claude = path.join(base, 'claude-home');
  const home = path.join(base, 'clodr-home');
  const root = path.join(base, 'ws');
  for (const d of [claude, home, root, path.join(claude, 'projects')]) fs.mkdirSync(d, { recursive: true });
  process.env.CLAUDE_CONFIG_DIR = claude;
  process.env.CLODR_HOME = home;
  delete process.env.CLODR_CWDFILE;
  return { base, claude, home, root, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

// Fake session dir for `dir`. cwd = what the transcript records (undefined = recorded dir, null = none). age in hours.
export function addSession(claudeDir, dir, { cwd = dir, ageH = 0, id = 'a1', dirName } = {}) {
  const pd = path.join(claudeDir, 'projects', dirName ?? encodeDir(dir));
  fs.mkdirSync(pd, { recursive: true });
  const lines = [JSON.stringify({ type: 'summary' })];
  if (cwd) lines.push(JSON.stringify({ type: 'user', cwd }));
  const file = path.join(pd, `${id}.jsonl`);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  const t = new Date(Date.now() - ageH * 3600_000);
  fs.utimesSync(file, t, t);
  return pd;
}

export const mkdirs = (...dirs) => dirs.map((d) => { fs.mkdirSync(d, { recursive: true }); return d; });

// Scripted terminal: a key queue in, captured frames out.
export function fakeTerm({ width = 100, height = 30 } = {}) {
  const keys = [];
  const t = {
    width, height, frames: [], keys,
    write(s) { t.frames.push(s); },
    cursor() {}, cursorVisible() {}, enterScreen() {}, exitScreen() {}, start() {}, stop() {},
    readKey() {
      if (!keys.length) throw new Error('fake terminal ran out of keys');
      return Promise.resolve(keys.shift());
    },
    press(...names) { for (const n of names) keys.push(n.length === 1 ? { name: n === ' ' ? 'space' : 'char', ch: n } : { name: n, ch: '' }); return t; },
    type(text) { for (const c of text) t.press(c); return t; },
    get last() { return t.frames.at(-1) ?? ''; },
    get text() { return t.frames.join('').replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); },
  };
  return t;
}

// A `claude` on PATH that logs its args to STUB_LOG and prints canned purge output.
export function stubClaude(base) {
  const bin = path.join(base, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const js = path.join(bin, 'stub.js');
  fs.writeFileSync(js, `
const fs = require('node:fs');
const a = process.argv.slice(2);
if (process.env.STUB_LOG) fs.appendFileSync(process.env.STUB_LOG, a.join(' ') + '\\n');
if (a[0] === 'purge' && a.includes('--help')) { console.log('Usage: claude purge [path]\\n  --dry-run'); process.exit(process.env.STUB_NO_PURGE ? 1 : 0); }
if (a[0] === 'purge' && a.includes('--dry-run')) {
  if (/nothing/.test(a[1])) { console.error('No matching state'); process.exit(1); }
  console.log('\\nPurge plan for ' + a[1] + ':\\n\\n  dir:    X\\\\projects\\\\p\\n           project transcripts (.jsonl) and memory/\\n  config: projects["x"]\\n           project entry in ~/.claude.json\\n  filter: X\\\\history.jsonl\\n           7 prompt(s) typed in this project\\n\\nDry run: 3 item(s) would be deleted.');
}
`);
  const shim = process.platform === 'win32'
    ? path.join(bin, 'claude.cmd')
    : path.join(bin, 'claude');
  fs.writeFileSync(shim, process.platform === 'win32' ? `@node "${js}" %*\r\n` : `#!/bin/sh\nexec node "${js}" "$@"\n`);
  if (process.platform !== 'win32') fs.chmodSync(shim, 0o755);
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  process.env.STUB_LOG = path.join(base, 'stub.log');
  delete process.env.STUB_NO_PURGE;
  return { log: () => { try { return fs.readFileSync(process.env.STUB_LOG, 'utf8').trim().split('\n').filter(Boolean); } catch { return []; } } };
}
