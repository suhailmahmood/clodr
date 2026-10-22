import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CI } from './platform.js';

export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

export const claudeJsonPath = () =>
  process.env.CLAUDE_CONFIG_DIR ? path.join(process.env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json');

// Claude names a project's session dir after its folder: every non-alphanumeric char becomes "-" (lossy).
export const encodeDir = (dir) => dir.replace(/[^a-zA-Z0-9]/g, '-');
export const projectDir = (dir) => path.join(claudeDir(), 'projects', encodeDir(dir));

export function trimSep(p) {
  const s = path.normalize(p);
  return s.length > 1 ? s.replace(/[\\/]+$/, '') : s;
}

// Comparison key: same path -> same key, whatever the slash style, trailing slash or (on CI file systems) case.
export function pathKey(p) {
  const s = trimSep(p);
  return CI ? s.toLowerCase() : s;
}

// Path relative to the workspace root: null if outside it, '' if it is the root itself.
export function relPath(p, root) {
  const kp = pathKey(p);
  const kr = pathKey(root);
  if (kp === kr) return '';
  const prefix = kr.endsWith(path.sep) ? kr : kr + path.sep;
  return kp.startsWith(prefix) ? trimSep(p).slice(prefix.length) : null;
}

export function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch { return false; }
}

// False for a path on a drive/mount that is not there (unplugged disk): its folders are offline, not gone.
export function driveAvailable(p) {
  return fs.existsSync(path.parse(path.resolve(p)).root);
}

// Leading ~ and %VAR% (any platform) in a user-typed path.
export function expandPath(p) {
  let s = p.trim();
  if (s === '~' || s.startsWith('~/') || s.startsWith('~\\')) s = os.homedir() + s.slice(1);
  return s.replace(/%([^%]+)%/g, (m, name) => process.env[name] ?? m);
}
