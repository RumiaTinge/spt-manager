// bundled-test.js —— 内置基础模组（关于页一键安装）的资源与安装逻辑
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundleManifest, bundleStatus, installBundle } from '../lib/bundled.js';

let passed = 0;
function ok(name, fn) {
  try { fn(); passed += 1; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); process.exitCode = 1; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-bundled-'));
const root = path.join(tmp, 'client');
fs.mkdirSync(path.join(root, 'SPT', 'SPT_Data'), { recursive: true });
fs.writeFileSync(path.join(root, 'SPT', 'SPT.Server.exe'), '');

ok('清单里有三个内置模组', () => {
  const m = bundleManifest();
  assert.equal(m.items.length, 4, `实际 ${m.items.length}`);
  assert.deepEqual(m.items.map((i) => i.id).sort(), ['fika-client', 'fika-headless', 'fika-server', 'raidprobe-client']);
});

ok('资源文件都在（fika-client 9 个、fika-server 50+、headless 2 个、raidprobe 1 个）', () => {
  const st = bundleStatus(root);
  const by = Object.fromEntries(st.map((x) => [x.id, x]));
  assert.equal(by['fika-client'].files, 9);
  assert.ok(by['fika-server'].files >= 45, `fika-server 只有 ${by['fika-server'].files} 个文件`);
  assert.equal(by['fika-headless'].files, 2);
  assert.equal(by['raidprobe-client'].files, 1);
  assert.equal(by['raidprobe-client'].version, '0.3.0');
  assert.ok(by['fika-client'].size > 1024 * 1024);
});

ok('没装时 installed=false', () => {
  const st = bundleStatus(root);
  assert.ok(st.every((x) => !x.installed), '新目录不应该判断为已安装');
});

ok('装 fika-client 后落盘位置正确', () => {
  const r = installBundle(root, 'fika-client');
  assert.equal(r.files, 9);
  const core = path.join(root, 'BepInEx', 'plugins', 'Fika', 'Fika.Core.dll');
  assert.ok(fs.existsSync(core), '缺少 Fika.Core.dll');
  assert.equal(fs.statSync(core).size, r.bytes > 0 ? fs.statSync(core).size : 0);
  const st = bundleStatus(root).find((x) => x.id === 'fika-client');
  assert.equal(st.installed, true);
  assert.equal(st.installedVersion, '2.2.3');
});

ok('装 fika-server 后 SPT/user/mods/fika-server 有 dll 与默认配置', () => {
  installBundle(root, 'fika-server');
  const dll = path.join(root, 'SPT', 'user', 'mods', 'fika-server', 'FikaServer.dll');
  const cfg = path.join(root, 'SPT', 'user', 'mods', 'fika-server', 'assets', 'configs', 'fika.jsonc');
  assert.ok(fs.existsSync(dll), '缺少 FikaServer.dll');
  assert.ok(fs.existsSync(cfg), '缺少默认 fika.jsonc');
  // 运行期产物不该被打进资源
  assert.ok(!fs.existsSync(path.join(root, 'SPT', 'user', 'mods', 'fika-server', 'assets', 'scripts')), '不该带 assets/scripts');
});

ok('装 headless 后 dll 与 manager 都到位', () => {
  installBundle(root, 'fika-headless');
  assert.ok(fs.existsSync(path.join(root, 'BepInEx', 'plugins', 'Fika', 'Fika.Headless.dll')));
  assert.ok(fs.existsSync(path.join(root, 'FikaHeadlessManager.exe')));
});

ok('重复安装会先备份被覆盖的文件', () => {
  const before = fs.existsSync(path.join(root, 'BepInEx', 'plugins', 'Fika', 'Fika.Core.dll'));
  assert.ok(before);
  const r = installBundle(root, 'fika-client');
  assert.ok(r.backup, '应该产生备份目录');
  assert.ok(fs.existsSync(r.backup), '备份目录不存在');
  const inner = path.join(r.backup, 'BepInEx', 'plugins', 'Fika', 'Fika.Core.dll');
  assert.ok(fs.existsSync(inner), '备份里没有 Fika.Core.dll');
});

ok('装了不该报 outdated', () => {
  const st = bundleStatus(root).find((x) => x.id === 'fika-client');
  assert.equal(st.outdated, false);
});

ok('客户端插件 raidprobe-client 装到 BepInEx/plugins/RaidProbe', () => {
  const r = installBundle(root, 'raidprobe-client');
  assert.equal(r.files, 1);
  const dll = path.join(root, 'BepInEx', 'plugins', 'RaidProbe', 'RaidProbeClient.dll');
  assert.ok(fs.existsSync(dll), '缺少 RaidProbeClient.dll');
  const st = bundleStatus(root).find((x) => x.id === 'raidprobe-client');
  assert.equal(st.installed, true);
  assert.equal(st.installedVersion, '0.3.0');
  assert.equal(st.outdated, false);
});

ok('未知 id 报错', () => {
  assert.throws(() => installBundle(root, 'nope'), /没有这个内置模组/);
});

ok('没有 SPT 目录报错', () => {
  assert.throws(() => installBundle('', 'fika-client'), /还没有设置 SPT 目录/);
});

ok('.disabled 的同名 dll 会被恢复', () => {
  const dll = path.join(root, 'BepInEx', 'plugins', 'Fika', 'Fika.Core.dll');
  fs.renameSync(dll, `${dll}.disabled`);
  installBundle(root, 'fika-client');
  assert.ok(fs.existsSync(dll), 'dll 没恢复');
  assert.ok(!fs.existsSync(`${dll}.disabled`), '.disabled 没删掉');
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${process.exitCode ? 'failed' : '0 failed'}`);
