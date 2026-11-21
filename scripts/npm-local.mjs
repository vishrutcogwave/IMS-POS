import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const node = root + '.tools/node-v24.11.1-win-x64/node.exe';
const cli = root + '.tools/node-v24.11.1-win-x64/node_modules/npm/bin/npm-cli.js';
if (!fs.existsSync(node)) throw new Error('Optional local Node is absent. Use your installed Node 22+ and npm instead.');
const child = spawn(node, [cli, ...process.argv.slice(2)], {
  cwd: root + 'frontend', stdio: 'inherit',
  env: { ...process.env, NODE_USE_SYSTEM_CA: '1', PATH: root + '.tools/node-v24.11.1-win-x64;' + process.env.PATH },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
