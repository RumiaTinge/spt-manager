// Fika 配置与启动模块自检：node tests\fika-test.js
import fs from 'node:fs';
import path from 'node:path';
import { parseJsonc, setInJsonc, getInJsonc } from '../lib/jsonc.js';
import * as fika from '../lib/fika.js';
import * as launch from '../lib/launch.js';

const ROOT = process.argv[2] || process.env.SPT_ROOT || 'E:\\game\\EFT\\Client.0.16.9.0.40087';
if (!fs.existsSync(path.join(ROOT, 'SPT', 'SPT.Server.exe'))) {
  console.log(`跳过：${ROOT} 不是 SPT 安装目录（用法：node tests\\fika-test.js <SPT 安装目录>）`);
  process.exit(0);
}
let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log('  ok   ' + msg); } else { fail += 1; console.log('  FAIL ' + msg); }
}

console.log('--- jsonc ---');
const sample = `{
  // 行注释
  "a": { "b": [1, 2], "c": "x" },
  /* 块注释 */
  "d": true
}`;
const obj = parseJsonc(sample);
ok(obj.a.b.length === 2 && obj.d === true, '解析带注释的 JSONC');
const out = setInJsonc(sample, ['a', 'c'], 'y');
ok(parseJsonc(out).a.c === 'y', '修改嵌套字符串');
ok(out.includes('// 行注释') && out.includes('/* 块注释 */'), '注释保留');
ok(getInJsonc(parseJsonc(sample), ['a', 'b', 1]) === 2, '按路径取值');

console.log('--- fika.jsonc ---');
const srv = fika.readFikaServer(ROOT);
ok(srv.ok, '读取服务端配置');
ok(srv.config && srv.config.client && typeof srv.config.client.useBtr === 'boolean', 'client.useBtr 是布尔');
ok(srv.config && srv.config.headless && srv.config.headless.profiles, 'headless.profiles 存在');

console.log('--- com.fika.core.cfg ---');
const cfg = fika.readFikaClientCfg(ROOT);
ok(cfg.ok, '读取客户端 cfg');
const itemCount = (cfg.sections || []).reduce((n, s) => n + s.items.length, 0);
ok(itemCount >= 60, `解析出 ${itemCount} 项配置`);
ok((cfg.sections || []).length >= 8, `解析出 ${(cfg.sections || []).length} 个分组`);
const coop = (cfg.sections || []).find((s) => s.name === 'Coop');
ok(!!coop, '存在 [Coop] 分组');

console.log('--- headless ---');
const st = fika.fikaStatus(ROOT, {});
ok(st.installed, 'Fika 服务端已安装');
ok(st.clientInstalled, 'Fika 客户端已安装');
ok(st.http && st.http.port === 6969, 'http.port = 6969');
const hs = fika.headlessSummary(ROOT, { headlessDirs: [] });
ok(Array.isArray(hs.installs), '无头安装列表是数组');

console.log('--- launch ---');
const lp = launch.launchPaths(ROOT);
ok(fs.existsSync(lp.launcherExe), 'SPT.Launcher.exe 存在');
const pl = launch.profileList(ROOT);
ok(pl.list.length >= 1, `存档数量 ${pl.list.length}`);
ok(!!pl.active, `当前存档 ${pl.active}`);
ok(pl.list.some((p) => p.active), '存档列表里标出了激活项');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
