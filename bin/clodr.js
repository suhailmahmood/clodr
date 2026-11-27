#!/usr/bin/env node
import { runMenu } from '../src/app.js';

if (process.stdin.isTTY && process.stdout.isTTY) await runMenu();
else { console.error('clodr needs an interactive terminal.'); process.exitCode = 1; }
