import fs from 'node:fs';
import path from 'node:path';
import { runSync } from './proc.js';

// git init + empty "Init" commit. Returns why it failed, or ''.
export function initGit(dir) {
  if (fs.existsSync(path.join(dir, '.git'))) return '';
  const git = (...a) => runSync('git', ['-C', dir, ...a]);
  const init = git('init', '-q');
  if (!init.ok) return `git init failed: ${init.err.trim().split(/\r?\n/)[0] || `exit ${init.code}`}`;
  if (!git('commit', '-q', '--allow-empty', '-m', 'Init').ok) return 'git init done, but the Init commit failed (is git user.name/user.email set?)';
  return '';
}
