// 打包导出模块自检：node tests\pack-test.js
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { packCandidates, createPack, listPacks, exportFile, deletePack } from '../lib/pack.js';
import { listArchive, analyzePackage, findExtractor } from '../lib/archive.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log('  ok   ' + msg); } else { fail += 1; console.log('  FAIL ' + msg); }
}

if (!findExtractor()) {
  console.log('跳过：本机没有 7z / tar，无法打包');
  process.exit(0);
}

// 造一个假 SPT 根目录
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-root-'));
const mk = (p) => fs.mkdirSync(p, { recursive: true });

mk(path.join(root, 'SPT', 'SPT_Data', 'configs'));
fs.writeFileSync(path.join(root, 'SPT', 'SPT_Data', 'configs', 'core.json'), JSON.stringify({ sptVersion: '4.0.13' }));
mkdirDll(path.join(root, 'SPT', 'user', 'mods', 'MyServerMod'), 'MyServerMod.dll');
mkdirDll(path.join(root, 'BepInEx', 'plugins', 'MyClientMod'), 'MyClientMod.dll');
mk(path.join(root, 'BepInEx', 'patchers'));
fs.writeFileSync(path.join(root, 'BepInEx', 'patchers', 'prepatch.dll'), Buffer.alloc(64));

function mkdirDll(dir, dll) {
  mk(dir);
  fs.writeFileSync(path.join(dir, dll), Buffer.alloc(128));
  fs.writeFileSync(path.join(dir, 'readme.txt'), 'hello ' + dll);
}

const cands = packCandidates(root);
ok(cands.length === 3, `识别 3 个可打包项（实际 ${cands.length}）`);
ok(cands.some((c) => c.type === 'server' && c.id === 'MyServerMod'), '候选含服务端模组');
ok(cands.some((c) => c.type === 'plugin' && c.id === 'MyClientMod'), '候选含客户端插件');
ok(cands.some((c) => c.type === 'patcher' && c.id === 'prepatch.dll'), '候选含补丁');

const items = cands.map((c) => ({ type: c.type, id: c.id }));

(async () => {
  console.log('--- 打包 zip ---');
  const res = await createPack(root, { items, name: 'test-pack', format: 'zip', level: 'store' }, (p) => {
    if (p.percent === 100) ok(true, '进度到 100');
  });
  ok(res.ok && res.file && fs.existsSync(res.file), '生成 zip 文件');
  ok(res.size > 0, `文件大小 ${res.size} 字节`);
  const entries = listArchive(res.file);
  const paths = entries.map((e) => e.path.replace(/\\/g, '/'));
  ok(paths.some((p) => p.startsWith('SPT/user/mods/MyServerMod/')), '包内保留 SPT/user/mods 结构');
  ok(paths.some((p) => p.startsWith('BepInEx/plugins/MyClientMod/')), '包内保留 BepInEx/plugins 结构');
  ok(paths.some((p) => p === 'BepInEx/patchers/prepatch.dll'), '包内含补丁 dll');
  ok(paths.some((p) => p === 'spt-manager-pack.json'), '包根有清单文件');

  const analysis = analyzePackage(entries);
  ok(analysis.kind === 'collection' && analysis.groups.length === 3, `导入器识别为合集 3 组（实际 ${analysis.kind}/${analysis.groups.length}）`);

  console.log('--- 导出列表与下载路径 ---');
  const list = listPacks();
  ok(list.some((f) => f.name === res.name), '导出列表包含新包');
  const full = exportFile(res.name);
  ok(full === res.file, 'exportFile 返回完整路径');
  let blocked = false;
  try { exportFile('..\\settings.json'); } catch { blocked = true; }
  ok(blocked, '拒绝越权文件名');

  console.log('--- 7z 格式 ---');
  const res7 = await createPack(root, { items: [items[0]], name: 'test-pack-7z', format: '7z', level: 'fast' });
  ok(res7.name.endsWith('.7z') && fs.existsSync(res7.file), '生成 7z 文件');
  const e7 = listArchive(res7.file).map((e) => e.path.replace(/\\/g, '/'));
  ok(e7.some((p) => p.startsWith('SPT/user/mods/MyServerMod/')), '7z 结构正确');

  console.log('--- 删除 ---');
  ok(deletePack(res.name).ok && !fs.existsSync(res.file), '删除导出文件');

  // 清理
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(res7.file, { force: true }); } catch { /* ignore */ }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
