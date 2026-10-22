import fs from 'node:fs';
import path from 'node:path';
import { which, runSync } from './proc.js';

// git init + empty "Init" commit. Never throws; warns on failure.
export function initGit(dir) {
  if (!which('git')) { console.warn('git is not installed, skipping git init'); return; }
  if (fs.existsSync(path.join(dir, '.git'))) return;
  const git = (...a) => runSync('git', ['-C', dir, ...a]).ok;
  if (!git('init', '-q')) { console.warn(`git init failed in ${dir}`); return; }
  if (!git('commit', '-q', '--allow-empty', '-m', 'Init')) console.warn('git init done, but the Init commit failed (is git user.name/user.email set?)');
}
