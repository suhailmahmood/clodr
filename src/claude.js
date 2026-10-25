import { run, runSync, launch } from './proc.js';

export const runClaude = (args) => run('claude', args);
export const runClaudeSync = (args) => runSync('claude', args);

// Runs the interactive claude in dir; resolves {code, error} when it exits.
export const launchClaude = (dir, args = []) => launch('claude', args, dir);

// Does the installed claude have `claude purge` (Claude Code v2.1.288+)?
export function purgeSupported() {
  const r = runClaudeSync(['purge', '--help']);
  return r.ok && /Usage: claude purge/.test(r.out) && /--dry-run/.test(r.out);
}
