// Screen pieces shared by the menu, settings, workspaces and cleanup screens. Screens build frames as arrays of
// lines; the last line is the hint row. paint() writes the whole frame in a single write.

const e = '\x1b';
export const RESET = `${e}[0m`;
export const EL = `${e}[K`;
export const T = {
  gray: `${e}[38;2;190;190;190m`,   // light gray (truecolor; palette gray follows the terminal theme)
  dim: `${e}[38;2;120;120;120m`,
  faint: `${e}[38;2;85;85;85m`,        // placeholders
  clay: `${e}[38;2;217;119;87m`,    // Claude orange #D97757
  cyan: `${e}[36m`,
  yellow: `${e}[33m`,
  danger: `${e}[48;2;170;30;30m${e}[38;2;255;255;255m`,   // white on red: destructive prompts
  bold: `${e}[1m`,
  under: `${e}[4m`,
};

const LETTERS = [
  ['╭──', '│  ', '╰──'],   // C
  ['│  ', '│  ', '╰──'],   // L
  ['╭─╮', '│ │', '╰─╯'],   // O
  ['┌─╮', '│ │', '└─╯'],   // D
  ['┌─╮', '├─╯', '│ \\'],   // R
];

export const logoLines = () =>
  [0, 1, 2].map((r) => `${T.clay} ${LETTERS.map((l) => l[r]).join(' ')}${RESET}`);

export const fit = (s, width) => (s.length > width ? s.slice(0, width) : s);

// Top of every screen: logo, a title line, a blank line.
export const header = (title) => [...logoLines(), `${T.gray} ${title}${RESET}`, ''];

// Bottom hint line; a status message replaces the hint (yellow). Cut to the width.
export const hintLine = (hint, status, width) => `${status ? T.yellow : T.gray}${fit(status || hint, width)}${RESET}`;

// A list row: " 12. text", cut to the width.
export const numberedRow = (i, text, width, color = T.gray) =>
  `${color}${fit(`${String(i + 1).padStart(3)}. ${text}`, width)}${RESET}`;

// Cursor movement in a wrapping list of n rows.
export function step(cur, n, keyName) {
  const len = Math.max(1, n);
  if (keyName === 'up') return (cur - 1 + len) % len;
  if (keyName === 'down') return (cur + 1) % len;
  return cur;
}

// Full-width red bar.
export const bar = (text, width) => `${T.danger}${fit(text, width).padEnd(width)}${RESET}`;

export const isYes = (k) => k.ch === 'y' || k.ch === 'Y';

export function paint(term, lines) {
  term.cursor(0);
  term.write(lines.map((l) => l + EL).join('\r\n') + `${e}[J`);
}

// Red y/N bar on the hint row. True only for y/Y.
export async function confirm(term, row, width, question) {
  term.cursor(row);
  term.write(bar(question, width));
  return isYes(await term.readKey());
}

// Prompt on the hint row. Returns the text, or null on Esc.
export async function readLine(term, row, width, prompt) {
  term.cursor(row);
  term.write(' '.repeat(width));
  term.cursor(row);
  term.cursorVisible(true);
  term.write(`${prompt}: `);
  let text = '';
  try {
    for (;;) {
      const k = await term.readKey();
      if (k.name === 'escape') return null;
      if (k.name === 'enter' || k.name === 'ctrl-enter') return text;
      if (k.name === 'backspace') { if (text) { text = text.slice(0, -1); term.write('\b \b'); } }
      else if (k.name === 'char' || k.name === 'space') { text += k.ch; term.write(k.ch); }
    }
  } finally { term.cursorVisible(false); }
}
