import './check-node.mjs';
import { existsSync } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'darwin') throw new Error('The native desktop launcher currently supports macOS. The browser interface remains available with litespeed serve.');
const arguments_ = process.argv.slice(2), outputIndex = arguments_.indexOf('--output');
const app = resolve(outputIndex >= 0 && arguments_[outputIndex + 1] || resolve(root, 'release-artifacts/Litespeed.app'));
if (!existsSync(resolve(root, 'dist/server/index.js'))) execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
// Regenerate the development wrapper so it always uses this checkout/runtime.
execFileSync(process.execPath, [resolve(root, 'scripts/desktop/build.mjs'), ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
const child = spawn('/usr/bin/open', [app], { stdio: 'inherit' });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
