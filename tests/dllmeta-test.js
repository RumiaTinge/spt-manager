// 开发自检：扫描已安装模组的 DLL 元数据
import { readDllMeta } from '../lib/dllmeta.js';
import path from 'node:path';
import fs from 'node:fs';

const SPT = process.argv[2] || process.env.SPT_ROOT || 'E:\\game\\EFT\\Client.0.16.9.0.40087';
if (!fs.existsSync(path.join(SPT, 'SPT', 'SPT.Server.exe'))) {
  console.log(`跳过：${SPT} 不是 SPT 安装目录（用法：node tests\\dllmeta-test.js <SPT 安装目录>）`);
  process.exit(0);
}
const targets = [
  path.join(SPT, 'SPT', 'user', 'mods', 'MC-MXLR', 'mc_addweapon.dll'),
  path.join(SPT, 'SPT', 'user', 'mods', 'WTT-ServerCommonLib', 'WTT-ServerCommonLib.dll'),
  path.join(SPT, 'SPT', 'user', 'mods', 'mpstark-dynamicmaps', 'mpstark-dynamicmaps.dll'),
  path.join(SPT, 'BepInEx', 'plugins', 'Fika', 'Fika.Core.dll'),
  path.join(SPT, 'BepInEx', 'plugins', 'WTT-ClientCommonLib', 'WTT-ClientCommonLib.dll'),
  path.join(SPT, 'BepInEx', 'plugins', 'DynamicMaps', 'DynamicMaps.dll'),
  path.join(SPT, 'SPT', 'user', 'mods', 'fika-server', 'FikaServer.dll'),
];
for (const t of targets) {
  if (!fs.existsSync(t)) { console.log('MISS', t); continue; }
  const t0 = Date.now();
  const m = readDllMeta(t);
  console.log(`${path.basename(path.dirname(t))}/${path.basename(t)}  (${Date.now() - t0}ms)`);
  console.log(`  server=${m.isServerMod} plugin=${m.isPlugin} patcher=${m.isPatcher} bepDep=${m.hasBepInDependency}`);
  console.log(`  guid=${m.guids[0] || '-'}  all=${m.guids.join(',')}`);
  console.log(`  name=${m.name || '-'}  author=${m.author || '-'}  version=${m.version || '-'}  spt=${m.sptRange || '-'}  lic=${m.license || '-'}`);
}
