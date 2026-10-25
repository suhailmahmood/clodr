// Regenerates screenshots/screenshot.svg: runs the real menu against fake projects in a temp sandbox and turns the frame it draws into SVG.
// Layout, hints and colors come from the live code; only the fake projects and the key presses below are fixed here.
// Usage: npm run screenshot
import path from 'node:path';
import fs from 'node:fs';
import { sandbox, addSession, mkdirs, fakeTerm } from '../test/helpers.js';
import { selectEntry } from '../src/ui/menu.js';
import { saveConfig } from '../src/config.js';

const out = path.join(import.meta.dirname, 'screenshot.svg');

const sb = sandbox();
const root = path.join(sb.base, 'Workspace');
const clones = path.join(root, 'Clones');
const names = [
  ['Clodr', 1, true], ['Payments-API', 2, true], ['Blog-Redesign', 3, true], ['Dotfiles', 4, false],
  ['Invoice-Parser', 5, true], ['Home-Lab-Notes', 6, false], ['Chess-Engine', 7, true],
  ['Weekend-Hack', 8, false], ['Resume-Builder', 9, true], ['Garden-Planner', 10, false],
];
for (const [n, age, has] of names) {
  const d = mkdirs(path.join(root, n))[0];
  if (has) addSession(sb.claude, d, { ageH: age });
  else { const t = new Date(Date.now() - age * 3600_000); fs.utimesSync(d, t, t); }
}
mkdirs(clones);
const workspaces = [{ path: root, name: 'Workspace' }, { path: clones, name: 'Clones' }];
saveConfig({ workspaces, view: '' });

const term = fakeTerm({ width: 96, height: 24 }).press('down', 'ctrl-s');
await selectEntry(term, { workspaces, view: '' });
const frame = term.last.split(root).join('D:' + String.fromCharCode(92) + 'Workspace');
sb.cleanup();

// ANSI -> spans
const CY = '#3fc1a5';
const lines = frame.replace(/\x1b\[J$/, '').split('\r\n').map((l) => l.replace(/\x1b\[K/g, ''));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const parse = (line) => {
  const spans = []; let st = { fill: '#d4d4d4', bold: false, under: false }; let i = 0; let buf = '';
  const flush = () => { if (buf) { spans.push({ ...st, text: buf }); buf = ''; } };
  while (i < line.length) {
    const m = /^\x1b\[([0-9;]*)m/.exec(line.slice(i));
    if (m) {
      flush();
      const c = m[1].split(';').map(Number);
      for (let k = 0; k < c.length; k++) {
        if (c[k] === 0) st = { fill: '#d4d4d4', bold: false, under: false };
        else if (c[k] === 1) st.bold = true;
        else if (c[k] === 4) st.under = true;
        else if (c[k] === 36) st.fill = CY;
        else if (c[k] === 33) st.fill = '#e5c07b';
        else if (c[k] === 38 && c[k + 1] === 2) { st.fill = `rgb(${c[k + 2]},${c[k + 3]},${c[k + 4]})`; k += 4; }
      }
      i += m[0].length;
    } else { buf += line[i]; i += 1; }
  }
  flush();
  return spans;
};
const plain = (l) => l.replace(/\x1b\[[0-9;]*m/g, '');
while (lines.length && !plain(lines.at(-1)).trim()) lines.pop();
const cols = Math.max(...lines.map((l) => plain(l).length)) + 1;
const CW = 9.6, LH = 22, PADX = 28, TOP = 56, PADB = 24;
const W = Math.ceil(cols * CW + PADX * 2), H = TOP + lines.length * LH + PADB;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Clodr menu">
<rect width="${W}" height="${H}" rx="10" fill="#1b1f27"/>
<rect width="${W}" height="36" rx="10" fill="#262b35"/><rect y="26" width="${W}" height="10" fill="#262b35"/>
<circle cx="22" cy="18" r="6" fill="#ff5f56"/><circle cx="42" cy="18" r="6" fill="#ffbd2e"/><circle cx="62" cy="18" r="6" fill="#27c93f"/>
<g font-family="Cascadia Mono, Consolas, Menlo, 'DejaVu Sans Mono', monospace" font-size="16" xml:space="preserve">\n`;
// Box-drawing cells are drawn as paths so they join up whatever font the viewer has.
const R = 6;
const cell = (c, x0, y0, stroke) => {
  const cx = x0 + CW / 2, cy = y0 + LH / 2, x1 = x0 + CW, y1 = y0 + LH;
  const d = {
    '─': `M${x0} ${cy}H${x1}`, '│': `M${cx} ${y0}V${y1}`,
    '╭': `M${x1} ${cy}H${cx + R}Q${cx} ${cy} ${cx} ${cy + R}V${y1}`,
    '╮': `M${x0} ${cy}H${cx - R}Q${cx} ${cy} ${cx} ${cy + R}V${y1}`,
    '╰': `M${x1} ${cy}H${cx + R}Q${cx} ${cy} ${cx} ${cy - R}V${y0}`,
    '╯': `M${x0} ${cy}H${cx - R}Q${cx} ${cy} ${cx} ${cy - R}V${y0}`,
    '┌': `M${x1} ${cy}H${cx}V${y1}`, '└': `M${x1} ${cy}H${cx}V${y0}`,
    '├': `M${cx} ${y0}V${y1}M${cx} ${cy}H${x1}`,
    '\\': `M${cx - 3.5} ${cy - 6}L${cx + 3.5} ${cy + 6}`,
  }[c];
  return d ? `<path d="${d}" stroke="${stroke}" stroke-width="1.6" fill="none" stroke-linecap="round"/>
` : '';
};
lines.forEach((l, r) => {
  let x = PADX; const y = TOP + r * LH;
  for (const sp of parse(l)) {
    let txt = ''; const xs = [];
    Array.from(sp.text).forEach((c, k) => {
      const cx = x + k * CW;
      const path = cell(c, cx, y - 16, sp.fill);
      if (path) svg += path;
      else if (c !== ' ') { txt += c; xs.push(cx.toFixed(1)); }
    });
    if (txt) svg += `<text x="${xs.join(' ')}" y="${y}" fill="${sp.fill}"${sp.bold ? ' font-weight="bold"' : ''}${sp.under ? ' text-decoration="underline"' : ''}>${esc(txt)}</text>
`;
    x += Array.from(sp.text).length * CW;
  }
});
svg += '</g>\n</svg>\n';
fs.writeFileSync(out, svg);
console.log(`${out}: ${W}x${H}, ${lines.length} lines`);
