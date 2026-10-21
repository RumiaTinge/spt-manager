// 战局实测模块自检：node tests\raidprobe-test.js
// 用临时假目录造一份服务端日志 + 一份客户端日志，验证解析和对照提示。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { compare, sendLiveCommand, liveCommandResult } from '../lib/raidprobe.js';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log('  ok   ' + msg); } else { fail += 1; console.log('  FAIL ' + msg); }
}

function makeRoot(serverLines, clientLines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'raid-root-'));
  const logDir = path.join(root, 'SPT', 'user', 'logs', 'spt');
  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(path.join(root, 'BepInEx'), { recursive: true });
  fs.writeFileSync(path.join(logDir, 'spt20261021.log'), serverLines.join('\n') + '\n', 'utf8');
  fs.writeFileSync(path.join(root, 'BepInEx', 'LogOutput.log'), clientLines.join('\n') + '\n', 'utf8');
  return root;
}

const srv = (time, text) => `[${time}][Info][NoAIBots.NoAIBotsMod] [NoAIBots] ${text}`;
const cli = (text) => `[Info   :ModulePatch] ${text}`;

// ---------- 场景 1：零改动规则（原版节奏）+ 客户端正常进场 ----------
const root1 = makeRoot(
  [
    srv('2026-10-21 04:32:00.112', '配置已重载: enabled=True, mode=followVanilla, 规则数=7'),
    srv('2026-10-21 04:32:00.112', '收到战局配置: location=bigmap, botSettings.botAmount=AsOnline(0), wavesSettings.botAmount=AsOnline(0), 客户端首领开关=true(开启)'),
    srv('2026-10-21 04:32:44.826', 'AI 生成请求 #1（开局后 44s，本局第 1 次）'),
    srv('2026-10-21 04:32:45.035', 'AI 生成完成 #1：300 只（assault×135、marksman×90、pmcUSEC×75）'),
  ],
  [
    cli('Raid has been started...'),
    cli('Set max bot cap for: bigmap from: 36 to: 26'),
    cli('Running old spawn system. Waves: 18'),
    cli('Running new spawn system.'),
    cli('MatchingType: Host, Raid Code: EXTYN0'),
    cli('Updated assault bot Иван to use: assault brain'),
    cli('Updated marksman bot Пётр to use: marksman brain'),
    cli('Updated spt bot Семён: pmcBEAR to use: pmcBEAR brain'),
    cli('Updated player scav bot to use: assault brain'),
  ],
);

const r1 = compare(root1);
ok(r1.server && r1.client, '两个日志都被读到');
ok(r1.server.map === 'bigmap', '服务端地图 = bigmap');
ok(r1.server.amounts.length === 1 && r1.server.amounts[0] === 'AsOnline', '档位解析成 AsOnline');
ok(r1.server.bossesDisabled === false, '首领开关=true 解析正确');
ok(r1.server.batches === 1 && r1.server.generated === 300, '生成批次 1 批 / 档案池 300 只');
ok(r1.server.requests.length === 1, '生成请求行只抓 1 条');
ok(r1.server.rules.length === 0 && r1.server.caps.length === 0, '零改动规则：没有规则/上限日志');
ok(r1.server.lastTime === '2026-10-21 04:32:45.035', '最后一条 AI 日志时间');
ok(r1.client.cap && r1.client.cap.from === 36 && r1.client.cap.to === 26, '客户端上限 36 → 26');
ok(r1.client.oldWaves === 18 && r1.client.oldSpawn === true, '旧刷新系统 waves=18');
ok(r1.client.newSpawn === true, '新刷新系统也开着');
ok(r1.client.raidCode === 'EXTYN0', 'Raid Code 解析');
ok(r1.client.counts.scav === 2, '普通 Scav 2 只（assault + marksman）');
ok(r1.client.counts.pmc === 1, 'PMC 1 只（spt bot 带类型）');
ok(r1.client.counts.playerScav === 1, '玩家 Scav 1 只');
ok(r1.client.counts.other === 0, '没有落进 other 的 bot');
ok(r1.client.total === 4, '进场总数 = 4');
ok(r1.notes.some((n) => n.includes('零改动')), '提示：命中的规则都是零改动');
ok(!r1.notes.some((n) => n.includes('算出的上限')), '上限一致时不提示矛盾');

// ---------- 场景 2：规则命中 + 上限缩小 + 客户端还没拉新配置 ----------
const root2 = makeRoot(
  [
    srv('2026-10-21 03:38:00.000', '收到战局配置: location=bigmap, botSettings.botAmount=AsOnline(0), wavesSettings.botAmount=AsOnline(0), 客户端首领开关=true(开启)'),
    srv('2026-10-21 03:38:01.000', '命中规则: 轻松模式：PMC 三成、首领减半、上限减半 → waves 删除 0 条、BossLocationSpawn 删除 0 条、人数缩放 0 条、概率缩放 17 条、时间后移 0/14 条；本局完全无AI=False, AI上限倍率=0.5'),
    srv('2026-10-21 03:38:01.100', '地图参数已调整: BotSpawnPeriodCheck, MaxBotPerZone'),
    srv('2026-10-21 03:39:00.000', 'AI 同时存活上限: 26 → 13（倍率 0.5）'),
  ],
  [
    cli('Raid has been started...'),
    cli('Set max bot cap for: woods from: 23 to: 23'),
  ],
);

const r2 = compare(root2);
ok(r2.server.rules.length === 1, '命中规则 1 条');
ok(r2.server.tuning.length === 1, '地图参数 1 条');
ok(r2.server.caps.length === 1, '上限日志 1 条');
ok(r2.notes.some((n) => n.includes('算出的上限是 13')), '提示：服务端 13 / 客户端没拿到');
ok(r2.notes.some((n) => n.includes('bigmap') && n.includes('woods')), '提示：地图对不上');

// ---------- 场景 3：日志缺失 ----------
const root3 = fs.mkdtempSync(path.join(os.tmpdir(), 'raid-empty-'));
const r3 = compare(root3);
ok(r3.server === null && r3.client === null, '没有日志时返回 null');
ok(r3.live && r3.live.installed === false && r3.live.dllInstalled === false, '没装插件时 live.installed / dllInstalled = false');
ok(r3.notes.length === 3, '三条缺失提示（服务端日志/客户端日志/客户端插件）');
ok(r3.notes.some((n) => n.includes('RaidProbeClient')), '提示里点名要装 RaidProbeClient');

// 场景 3b：dll 已放好、但还没快照
const root3b = fs.mkdtempSync(path.join(os.tmpdir(), 'raid-dll-'));
fs.mkdirSync(path.join(root3b, 'BepInEx', 'plugins', 'RaidProbe'), { recursive: true });
fs.writeFileSync(path.join(root3b, 'BepInEx', 'plugins', 'RaidProbe', 'RaidProbeClient.dll'), 'x');
const r3b = compare(root3b);
ok(r3b.live.dllInstalled === true && r3b.live.installed === false, '只有 dll 时 dllInstalled = true');
ok(r3b.notes.some((n) => n.includes('重启游戏')), '提示：已放好插件，等重启游戏进战局');

// ---------- 场景 4：客户端插件上报了存活 AI ----------
function writeLive(root, obj, ageMs = 0) {
  const dir = path.join(root, 'BepInEx', 'plugins', 'RaidProbe');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'live-bots.json');
  fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
  if (ageMs > 0) {
    const t = new Date(Date.now() - ageMs);
    fs.utimesSync(file, t, t);
  }
  return file;
}

const root4 = makeRoot([srv('2026-10-21 04:32:00.112', '收到战局配置: location=bigmap, botSettings.botAmount=AsOnline(0), wavesSettings.botAmount=AsOnline(0), 客户端首领开关=true(开启)')], [cli('Raid has been started...')]);
writeLive(root4, {
  at: '2026-10-21T13:20:00',
  plugin: '0.1.0',
  count: 4,
  alive: 3,
  bots: [
    { name: 'Буян', role: 'bossBully', side: 'Savage', alive: true, boss: true, x: 1.5, y: 2, z: 3 },
    { name: 'Иван', role: 'assault', side: 'Savage', alive: true, boss: false, x: -10, y: 0, z: 4 },
    { name: 'Семён', role: 'pmcUSEC', side: 'Usec', alive: true, boss: false, x: 5, y: 1, z: 6 },
    { name: 'Пётр', role: 'pmcBEAR', side: 'Bear', alive: false, boss: false, x: 0, y: 0, z: 0 },
  ],
});
const r4 = compare(root4);
ok(r4.live.installed === true, '插件快照被读到');
ok(r4.live.live === true, '15 秒内算在线');
ok(r4.live.count === 4 && r4.live.alive === 3, '总数 4 / 存活 3');
ok(r4.live.byRole.bossBully === 1 && r4.live.byRole.pmcUSEC === 1, '按类型分组正确');
ok(r4.live.bots[0].boss === true && r4.live.bots[3].alive === false, '首领/死亡标记正确');
ok(!r4.notes.some((n) => n.includes('RaidProbeClient')), '装了插件就不再提示安装');

// ---------- 场景 5：快照过期 ----------
writeLive(root4, { at: '2026-10-21T12:00:00', count: 1, alive: 1, bots: [{ name: 'A', role: 'assault', alive: true }] }, 120000);
const r5 = compare(root4);
ok(r5.live.installed === true && r5.live.live === false, '2 分钟前的快照算过期');
ok(r5.live.ageSec >= 110, 'ageSec 计算合理');

// ---------- 场景 6：快照损坏 ----------
fs.writeFileSync(path.join(root4, 'BepInEx', 'plugins', 'RaidProbe', 'live-bots.json'), '{oops', 'utf8');
const r6 = compare(root4);
ok(r6.live.installed === true && typeof r6.live.parseError === 'string', '坏 JSON 报 parseError 而不是抛异常');

// ---------- 场景 7：插件取不到角色（旧版 0.1.0 现象）+ 累计/此刻口径不同 ----------
const root7 = makeRoot(
  [
    srv('2026-10-21 13:51:00.000', '收到战局配置: location=bigmap, botSettings.botAmount=Medium(2), wavesSettings.botAmount=Medium(2), 客户端首领开关=true(开启)'),
  ],
  [
    cli('Raid has been started...'),
    cli('Updated assault bot Иван to use: assault brain'),
    cli('Updated assault bot Кум to use: assault brain'),
    cli('Updated player scav bot to use: assault brain'),
  ],
);
writeLive(root7, {
  at: '2026-10-21T13:51:30',
  count: 2,
  alive: 2,
  bots: [
    { name: '(no name)', role: '?', side: 'Savage', alive: true, boss: false, x: 1, y: 0, z: 1 },
    { name: '(no name)', role: '?', side: 'Savage', alive: true, boss: false, x: 2, y: 0, z: 2 },
  ],
});
const r7 = compare(root7);
ok(r7.live.count === 2 && r7.live.alive === 2, '旧版插件：2 只但角色是 ?');
ok(r7.notes.some((n) => n.includes('旧版插件')), '提示：插件没取到类型/名字，换 0.2.0 并重启游戏');
ok(r7.notes.some((n) => n.includes('累计进场') && n.includes('此刻存活')), '提示：此刻存活 ≠ 日志累计进场');
ok(r7.client.total === 3, '客户端日志累计进场 3 只');
ok(r7.notes.some((n) => n.includes('0.3.0')), '提示：旧插件不能收「杀 AI」指令，需要 0.3.0');

// ---------- 场景 8：局内杀 AI 指令（command.json / command-result.json） ----------
const root8 = makeRoot([], []);
const dry = sendLiveCommand(root8, { scope: 'scav' });
ok(dry.ok === false && /还没装客户端插件/.test(dry.error || ''), '没装插件时拒绝发指令');
fs.mkdirSync(path.join(root8, 'BepInEx', 'plugins', 'RaidProbe'), { recursive: true });
fs.writeFileSync(path.join(root8, 'BepInEx', 'plugins', 'RaidProbe', 'RaidProbeClient.dll'), 'x');
const sent = sendLiveCommand(root8, { scope: 'pmc' });
ok(sent.ok === true && sent.scope === 'pmc' && !!sent.id, '发出一条 pmc 击杀指令');
const cmdFile = path.join(root8, 'BepInEx', 'plugins', 'RaidProbe', 'command.json');
const cmdRaw = JSON.parse(fs.readFileSync(cmdFile, 'utf8'));
ok(cmdRaw.id === sent.id && cmdRaw.action === 'kill' && cmdRaw.scope === 'pmc', '落盘的 command.json 内容正确');
ok(!fs.existsSync(cmdFile + '.tmp'), '原子写没有残留 .tmp');
ok(liveCommandResult(root8) === null, '没有回执时返回 null');
fs.writeFileSync(path.join(root8, 'BepInEx', 'plugins', 'RaidProbe', 'command-result.json'),
  JSON.stringify({ id: sent.id, action: 'kill', scope: 'pmc', matched: 5, killed: 4, remaining: 11 }));
const res = liveCommandResult(root8);
ok(res && res.killed === 4 && res.remaining === 11, '读到回执：击杀 4 只、剩 11 只');
const r8 = compare(root8);
ok(r8.liveResult && r8.liveResult.scope === 'pmc', 'compare() 带回执给页面');
const bad = sendLiveCommand(root8, { scope: 'nope' });
ok(bad.ok === true, '示例：未知 scope 也照发（服务端路由已归一化到 all）');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
