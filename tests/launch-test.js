// 启动器 GamePath 自检：正确值、错误值、修复后是否真的能读 spt-core.dll
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import * as launch from '../lib/launch.js';

let failures = 0;
const cases = [];
function t(name, fn) {
  try { fn(); cases.push(`  ok   ${name}`); } catch (e) { failures++; cases.push(`  FAIL ${name}\n         ${e.message}`); }
}

// 造一个假的客户端目录
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-launch-'));
const launcherDir = path.join(root, 'SPT', 'user', 'launcher');
fs.mkdirSync(launcherDir, { recursive: true });
fs.writeFileSync(path.join(root, 'EscapeFromTarkov.exe'), 'stub');
fs.mkdirSync(path.join(root, 'BepInEx', 'plugins', 'spt'), { recursive: true });
fs.writeFileSync(path.join(root, 'BepInEx', 'plugins', 'spt', 'spt-core.dll'), 'stub');
fs.writeFileSync(path.join(root, 'SPT', 'SPT.Launcher.exe'), 'stub');
const cfgFile = path.join(launcherDir, 'config.json');

const writeCfg = (cfg) => fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2), 'utf8');
const readCfg = () => JSON.parse(fs.readFileSync(cfgFile, 'utf8'));

t('游戏根目录算合法 GamePath', () => {
  assert.equal(launch.isGamePathUsable(root, root), true);
  assert.equal(launch.isGamePathUsable(root, `${root}\\`), true);
});
t('SPT 子目录不算合法 GamePath', () => {
  assert.equal(launch.isGamePathUsable(root, path.join(root, 'SPT')), false);
  assert.equal(launch.isGamePathUsable(root, path.join(root, 'SPT') + '\\'), false);
});
t('空值 / 乱填都不合法', () => {
  assert.equal(launch.isGamePathUsable(root, null), false);
  assert.equal(launch.isGamePathUsable(root, ''), false);
  assert.equal(launch.isGamePathUsable(root, 'E:\\nope'), false);
});

t('ensureGamePath 会把 root\\SPT\\ 改成根目录', () => {
  const cfg = { GamePath: `${root}\\SPT\\` };
  const changed = launch.ensureGamePath(root, cfg);
  assert.equal(changed, true);
  assert.equal(cfg.GamePath, `${root}\\`);
});
t('ensureGamePath 对正确路径只补最后的反斜杠', () => {
  const cfg = { GamePath: root };
  assert.equal(launch.ensureGamePath(root, cfg), false);
  assert.equal(cfg.GamePath, `${root}\\`);
});
t('ensureGamePath 不覆盖正确路径', () => {
  const good = `${root}\\`;
  const cfg = { GamePath: good };
  assert.equal(launch.ensureGamePath(root, cfg), false);
  assert.equal(cfg.GamePath, good);
});

t('repairLauncherConfig 修复坏路径并备份', () => {
  writeCfg({ FirstRun: false, GamePath: `${root}\\SPT\\`, Server: { Url: 'https://127.0.0.1:6969', Name: 'SPT' } });
  const backupDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'backups', 'config');
  const beforeCount = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).length : 0;
  const r = launch.repairLauncherConfig(root);
  assert.equal(r.ok, true);
  assert.equal(r.fixed, true);
  assert.equal(r.before, `${root}\\SPT\\`);
  assert.equal(readCfg().GamePath, `${root}\\`);
  // 其它字段不能丢
  assert.equal(readCfg().Server.Url, 'https://127.0.0.1:6969');
  // 修复前要先备份
  const afterCount = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).length : 0;
  assert.equal(afterCount, beforeCount + 1);
});
t('repairLauncherConfig 对正确路径不动文件', () => {
  writeCfg({ GamePath: `${root}\\`, Server: { Url: 'https://127.0.0.1:6969', Name: 'SPT' } });
  const before = fs.readFileSync(cfgFile, 'utf8');
  const r = launch.repairLauncherConfig(root);
  assert.equal(r.fixed, false);
  assert.equal(fs.readFileSync(cfgFile, 'utf8'), before);
});

t('缺 config.json 时返回错误而不是抛异常', () => {
  fs.unlinkSync(cfgFile);
  const r = launch.repairLauncherConfig(root);
  assert.equal(r.ok, false);
  assert.match(r.error, /config\.json/);
});

// ---- 直接启动：登录换 token 的出错路径（不依赖真服务端）
async function at(name, fn) {
  try { await fn(); cases.push(`  ok   ${name}`); } catch (e) { failures++; cases.push(`  FAIL ${name}\n         ${e.message}`); }
}

await at('没有账号名时先报错，不去连服务端', async () => {
  await assert.rejects(
    () => launch.serverLogin(root, { serverUrl: 'https://127.0.0.1:1' }),
    /账号名/,
  );
});

await at('服务端连不上时报错带地址', async () => {
  await assert.rejects(
    () => launch.serverLogin(root, { username: 'Rumia', serverUrl: 'https://127.0.0.1:1' }),
    /连不上服务端/,
  );
});

await at('client 目录不是 SPT 客户端时拒绝直接启动', async () => {
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-bare-'));
  fs.writeFileSync(path.join(bare, 'EscapeFromTarkov.exe'), 'stub');
  await assert.rejects(() => launch.launchGameDirect(bare, { username: 'Rumia' }), /spt-core\.dll/);
  fs.rmSync(bare, { recursive: true, force: true });
});

fs.rmSync(root, { recursive: true, force: true });

console.log(cases.join('\n'));
console.log(`\n${cases.length - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
