import { spawn } from 'node:child_process';
import { WIN, MAC } from './platform.js';

// Opens a folder in the OS file manager; never throws.
export function openFolder(dir) {
  const cmd = WIN ? 'explorer.exe' : MAC ? 'open' : 'xdg-open';
  try {
    const p = spawn(cmd, [dir], { detached: true, stdio: 'ignore' });
    p.on('error', () => {});
    p.unref();
  } catch { /* no file manager */ }
}
