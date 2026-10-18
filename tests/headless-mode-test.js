// 单份客户端切换无头主机 / 客户端模式的自检：node tests\headless-mode-test.js
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as fika from '../lib/fika.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log('  ok   ' + msg); } else { fail += 1; console.log('  FAIL ' + msg); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-headless-'));
const root = path.join(tmp, 'Client');
const pluginDir = path.join(root, 'BepInEx', 'plugins', 'Fika');
fs.mkdirSync(pluginDir, { recursive: true });
const dll = path.join(pluginDir, 'Fika.Headless.dll');
fs.writeFileSync(dll, 'stub');
fs.writeFileSync(path.join(root, 'FikaHeadlessManager.exe'), 'stub');
fs.writeFileSync(path.join(root, 'HeadlessConfig.json'), JSON.stringify({ ProfileId: 'aaaaaaaaaaaaaaaaaaaaaaaa', BackendUrl: 'https://127.0.0.1:6969' }));

console.log('--- headlessModeState ---');
let st = fika.headlessModeState(root);
ok(st.hasPlugin && st.pluginEnabled, '识别到已启用的 Fika.Headless.dll');
ok(!!st.manager, '识别到 FikaHeadlessManager.exe');
ok(st.ready, '插件 + 管理器 + 配置齐全时 ready=true');

console.log('--- setHeadlessPluginEnabled ---');
const off = fika.setHeadlessPluginEnabled(root, false);
ok(off.changed && !fs.existsSync(dll) && fs.existsSync(dll + '.disabled'), '停用后改名为 .dll.disabled');
ok(fika.headlessModeState(root).pluginEnabled === false, '停用后状态为未启用');
const again = fika.setHeadlessPluginEnabled(root, false);
ok(again.changed === false, '重复停用不报错、不再改名');
const on = fika.setHeadlessPluginEnabled(root, true);
ok(on.changed && fs.existsSync(dll) && !fs.existsSync(dll + '.disabled'), '重新启用后名字还原');

console.log('--- ensureHeadlessConfig ---');
const root2 = path.join(tmp, 'Client2');
fs.mkdirSync(path.join(root2, 'BepInEx', 'plugins', 'Fika'), { recursive: true });
fs.writeFileSync(path.join(root2, 'BepInEx', 'plugins', 'Fika', 'Fika.Headless.dll'), 'stub');
fs.writeFileSync(path.join(root2, 'FikaHeadlessManager.exe'), 'stub');
const scripts = path.join(root2, 'SPT', 'user', 'mods', 'fika-server', 'assets', 'scripts', 'u1');
fs.mkdirSync(scripts, { recursive: true });
fs.writeFileSync(path.join(scripts, 'HeadlessConfig.json'), JSON.stringify({ ProfileId: 'bbbbbbbbbbbbbbbbbbbbbbbb', BackendUrl: 'https://127.0.0.1:6969' }));
const c1 = fika.ensureHeadlessConfig(root2);
ok(c1.created && c1.config.ProfileId === 'bbbbbbbbbbbbbbbbbbbbbbbb', '缺配置时从服务端生成的目录复制');
const c2 = fika.ensureHeadlessConfig(root2);
ok(!c2.created, '已有配置时不覆盖');
const root3 = path.join(tmp, 'Client3');
fs.mkdirSync(path.join(root3, 'BepInEx', 'plugins', 'Fika'), { recursive: true });
fs.writeFileSync(path.join(root3, 'BepInEx', 'plugins', 'Fika', 'Fika.Headless.dll'), 'stub');
let threw = false;
try { fika.ensureHeadlessConfig(root3); } catch { threw = true; }
ok(threw, '没有服务端生成的 HeadlessConfig.json 时报错');

console.log('--- headlessSummary 区分本机 / 单独副本 ---');
const other = path.join(tmp, 'HeadlessCopy');
fs.mkdirSync(path.join(other, 'BepInEx', 'plugins', 'Fika'), { recursive: true });
fs.writeFileSync(path.join(other, 'BepInEx', 'plugins', 'Fika', 'Fika.Headless.dll'), 'stub');
fs.writeFileSync(path.join(other, 'FikaHeadlessManager.exe'), 'stub');
const sum = fika.headlessSummary(root, { headlessDirs: [other] });
ok(sum.local && path.resolve(sum.local.dir).toLowerCase() === path.resolve(root).toLowerCase(), 'local 指向当前客户端目录');
ok(sum.installs.length === 1 && path.resolve(sum.installs[0].dir).toLowerCase() === path.resolve(other).toLowerCase(), 'installs 只列单独的无头副本');
const sum2 = fika.headlessSummary(root, { headlessDirs: [] });
ok(sum2.installs.length === 0, '没有单独副本时 installs 为空（= 单份切换模式）');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
