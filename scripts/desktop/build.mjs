import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') throw new Error('The native Mac app must be built on macOS.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2), options = new Map();
for (let i = 0; i < args.length; i += 2) { if (!['--output', '--url', '--data-directory', '--workspace', '--bundle'].includes(args[i]) || !args[i + 1]) throw new Error('Use --output, --url, --data-directory, --workspace, or --bundle with a value.'); options.set(args[i], args[i + 1]); }
const output = resolve(options.get('--output') || join(root, 'release-artifacts/Litespeed.app'));
if (!output.endsWith('.app')) throw new Error('The output must end in .app.');
const contents = join(output, 'Contents'), resources = join(contents, 'Resources'), executable = join(contents, 'MacOS/Litespeed');
await mkdir(dirname(executable), { recursive: true }); await mkdir(resources, { recursive: true });
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>ai.litellm.litespeed.desktop</string><key>CFBundleName</key><string>Litespeed</string><key>CFBundleDisplayName</key><string>Litespeed</string><key>CFBundleExecutable</key><string>Litespeed</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${escape(version)}</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>14.0</string><key>NSHighResolutionCapable</key><true/><key>NSPrincipalClass</key><string>NSApplication</string><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
<key>CFBundleIconFile</key><string>Litespeed</string>
</dict></plist>`);
if (options.has('--bundle')) await cp(resolve(options.get('--bundle')), join(resources, 'litespeed'), { recursive: true, verbatimSymlinks: true });
await writeFile(join(resources, 'desktop.json'), JSON.stringify({ serverURL: options.get('--url') || 'http://127.0.0.1:3215', ...(options.has('--bundle') ? { bundledRuntime: true } : { sourceRoot: root, nodePath: process.execPath }), ...(options.has('--url') ? { attachOnly: true } : {}), ...(options.has('--data-directory') ? { dataDirectory: resolve(options.get('--data-directory')) } : {}), ...(options.has('--workspace') ? { workspace: resolve(options.get('--workspace')) } : {}) }, null, 2));
execFileSync('xcrun', ['swiftc', '-swift-version', '5', '-O', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`, '-framework', 'AppKit', '-framework', 'WebKit', join(root, 'desktop/macos/Litespeed.swift'), '-o', executable], { stdio: 'inherit' });
const iconset = join(dirname(output), 'Litespeed.iconset');
execFileSync('xcrun', ['swift', join(root, 'scripts/desktop/icon.swift'), iconset], { stdio: 'inherit' });
execFileSync('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'Litespeed.icns')], { stdio: 'inherit' });
execFileSync('/usr/bin/codesign', ['--force', ...(options.has('--bundle') ? ['--deep'] : []), '--sign', '-', output], { stdio: 'inherit' });
console.log(output);
