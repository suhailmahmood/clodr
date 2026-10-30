// Zero-dep terminal layer: raw key reader + frame output. Tests swap it for a fake with the same shape.

const ESC = '\x1b';

// readKey option for screens that redraw: also wakes on a terminal resize ({name:'resize'}).
// Add `timeout` for a periodic {name:'tick'}.
export const LIVE = { live: true };

// Parses raw stdin chunks into {name, ch}. name: up down ctrl-up ctrl-down left right home end pageup pagedown delete enter ctrl-enter ctrl-<letter> escape backspace space ctrl-c char unknown
export function parseKeys(chunk) {
  const keys = [];
  let i = 0;
  while (i < chunk.length) {
    const c = chunk[i];
    if (c === ESC) {
      const rest = chunk.slice(i);
      const m = /^\x1b(?:\[|O)([0-9;]*)([A-Za-z~])/.exec(rest);
      if (m) {
        const map = { A: 'up', B: 'down', C: 'right', D: 'left', H: 'home', F: 'end' };
        let name = map[m[2]];
        if (m[1].split(';')[1] === '5' && (m[2] === 'A' || m[2] === 'B')) name = 'ctrl-' + name;   // Ctrl+Up/Down = ESC[1;5A / ESC[1;5B
        if (m[2] === '~') name = { 1: 'home', 7: 'home', 4: 'end', 8: 'end', 3: 'delete', 5: 'pageup', 6: 'pagedown' }[m[1].split(';')[0]];
        keys.push({ name: name || 'unknown', ch: '' });
        i += m[0].length;
      } else if (rest.length > 1 && rest[1] !== ESC && rest[1] !== '[' && rest[1] !== 'O') {
        keys.push({ name: 'unknown', ch: '' });                       // Alt+key: ESC then the key
        i += 2;
      } else {
        keys.push({ name: 'escape', ch: '' });
        i += 1;
      }
      continue;
    }
    const cp = chunk.codePointAt(i);
    const s = String.fromCodePoint(cp);
    i += s.length;
    if (s === '\r') keys.push({ name: 'enter', ch: s });
    else if (s === '\n') keys.push({ name: 'ctrl-enter', ch: s });   // Ctrl+Enter (= Ctrl+J) is LF where the terminal tells it from Enter
    else if (s === '\x7f' || s === '\b') keys.push({ name: 'backspace', ch: s });
    else if (s === ' ') keys.push({ name: 'space', ch: s });
    else if (s === '\x03') keys.push({ name: 'ctrl-c', ch: s });
    else if (cp < 32) keys.push({ name: `ctrl-${String.fromCharCode(cp + 96)}`, ch: '' });   // Ctrl+letter = one control byte: ^N = 0x0E
    else keys.push({ name: 'char', ch: s });
  }
  return keys;
}

export function createTerm({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const queue = [];
  let waiter = null;
  let active = false;

  const dispatch = (k) => {
    if (waiter && (waiter.live || k.name !== 'resize')) { const w = waiter; waiter = null; w.resolve(k); }
    else if (k.name !== 'resize') queue.push(k);
  };

  const onData = (buf) => {
    for (const k of parseKeys(buf.toString('utf8'))) {
      if (k.name === 'ctrl-c') { term.restore(); process.exit(130); }
      dispatch(k);
    }
  };

  const onResize = () => dispatch({ name: 'resize', ch: '' });

  const term = {
    get width() { return stdout.columns || 80; },
    get height() { return stdout.rows || 24; },
    write: (s) => stdout.write(s),
    start() {
      if (active) return;
      active = true;
      if (stdin.isTTY) stdin.setRawMode(true);
      stdin.resume();
      stdin.on('data', onData);
      stdout.on('resize', onResize);
    },
    stop() {
      if (!active) return;
      active = false;
      stdin.off('data', onData);
      stdout.off('resize', onResize);
      if (stdin.isTTY) stdin.setRawMode(false);
      stdin.pause();
    },
    restore() { term.exitScreen(); if (stdin.isTTY) { try { stdin.setRawMode(false); } catch { /* closed */ } } },
    // timeout (ms): resolves {name:'tick'} if no key arrives in time. Implies live.
    readKey({ live = false, timeout = 0 } = {}) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve) => {
        let timer;
        const me = { live: live || timeout > 0, resolve: (k) => { clearTimeout(timer); resolve(k); } };
        waiter = me;
        if (timeout > 0) timer = setTimeout(() => { if (waiter === me) { waiter = null; resolve({ name: 'tick', ch: '' }); } }, timeout);
      });
    },
    enterScreen() { stdout.write(`${ESC}[?1049h${ESC}[2J${ESC}[H${ESC}[?25l`); },
    exitScreen() { stdout.write(`${ESC}[?25h${ESC}[?1049l`); },
    cursor(row) { stdout.write(`${ESC}[${row + 1};1H`); },
    cursorVisible(v) { stdout.write(`${ESC}[?25${v ? 'h' : 'l'}`); },
  };
  return term;
}
