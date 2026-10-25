#!/usr/bin/env node
import { runMenu } from '../src/app.js';

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('clodr needs an interactive terminal.'); return 1; }
  return runMenu();
}

process.exitCode = await main();
