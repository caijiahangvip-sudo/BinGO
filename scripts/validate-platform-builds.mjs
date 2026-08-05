import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));

const base = readJson('src-tauri/tauri.conf.json');
const windows = readJson('src-tauri/tauri.windows.conf.json');
const ios = readJson('src-tauri/tauri.ios.conf.json');

const failures = [];
const check = (condition, message) => {
  if (!condition) failures.push(message);
};

check(base.identifier === 'app.bingo.desktop', 'Desktop identifier must remain app.bingo.desktop');
check(ios.identifier === 'app.bingo.ipad', 'iPad identifier must remain app.bingo.ipad');
check(base.build?.frontendDist === '../desktop-loader', 'Desktop must use desktop-loader');
check(ios.build?.frontendDist === '../ipad-shell', 'iPad must use ipad-shell');
check(windows.bundle?.targets?.includes('nsis'), 'Windows must keep the NSIS target');
check(
  windows.bundle?.resources?.['binaries/node.exe'] === 'binaries/node.exe',
  'Windows must keep its bundled Node runtime',
);
check(
  !JSON.stringify(ios).includes('node.exe') && !JSON.stringify(ios).includes('nsis'),
  'iPad config must not contain Windows runtime or installer resources',
);
check(
  ios.app?.capabilities?.includes('ipad'),
  'iPad config must use the dedicated iPad capability set',
);

const shellFiles = ['ipad-shell/index.html', 'ipad-shell/main.js'];
for (const file of shellFiles) {
  const content = fs.readFileSync(path.join(root, file), 'utf8');
  check(!content.includes('ipad_connect_server'), `${file} must not connect to a computer server`);
  check(!content.includes('bingo:ipad-server-url'), `${file} must not persist a computer address`);
}

const config = fs.readFileSync(path.join(root, 'ipad-shell/config.js'), 'utf8');
check(config.includes('apiBaseUrl'), 'iPad runtime config must define apiBaseUrl');
check(config.includes('appUrl'), 'iPad runtime config must define appUrl');

if (failures.length > 0) {
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Desktop and iPad build configurations are isolated.');
