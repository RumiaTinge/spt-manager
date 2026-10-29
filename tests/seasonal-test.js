// seasonal-test.js — 节日配置读写（不碰真实 SPT 目录）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sptm-seasonal-'));
process.env.SPT_MANAGER_DATA_DIR = path.join(tmp, 'data');

const seasonal = await import('../lib/seasonal.js');

const root = path.join(tmp, 'game');
const cfgDir = path.join(root, 'SPT', 'SPT_Data', 'configs');
fs.mkdirSync(cfgDir, { recursive: true });
const file = path.join(cfgDir, 'seasonalevents.json');
const sample = {
  keepMe: { a: 1 },
  enableSeasonalEventDetection: true,
  events: [
    {
      enabled: true, endDay: '9', endMonth: '11', name: 'halloween', startDay: '28', startMonth: '10', type: 'HALLOWEEN',
      settings: {
        enableSummoning: true,
        removeEntryRequirement: ['laboratory'],
        replaceBotHostility: true,
        zombieSettings: { disableBosses: ['laboratory'], disableWaves: [], enabled: false, mapInfectionAmount: { bigmap: 0, laboratory: 100 } },
      },
      futureField: 'keep',
    },
    {
      enabled: true, endDay: '31', endMonth: '12', name: 'christmas', startDay: '13', startMonth: '12', type: 'CHRISTMAS',
      settings: { adjustBotAppearances: true, christmasLootBoostAmount: 0.03, enableSanta: true },
    },
    {
      enabled: true, endDay: '14', endMonth: '1', name: 'christmas January', startDay: '2', startMonth: '1', type: 'CHRISTMAS',
      settings: { enableSanta: true },
    },
  ],
};
fs.writeFileSync(file, JSON.stringify(sample, null, 2) + '\n', 'utf8');

let passed = 0;
let failed = 0;
const t = (name, fn) => {
  try { fn(); passed++; console.log('  ok   ' + name); } catch (e) { failed++; console.log('  FAIL ' + name + ' :: ' + e.message); }
};

const r = seasonal.readSeasonal(root);
t('读取路径与存在性', () => { assert.equal(r.exists, true); assert.equal(r.path, file); assert.equal(r.parseError, null); });
t('事件数量与字段', () => {
  assert.equal(r.events.length, 3);
  const h = r.events[0];
  assert.equal(h.name, 'halloween');
  assert.equal(h.type, 'HALLOWEEN');
  assert.equal(h.startMonth, 10);
  assert.equal(h.startDay, 28);
  assert.equal(h.endMonth, 11);
  assert.equal(h.endDay, 9);
});
t('全局检测开关', () => assert.equal(r.enableSeasonalEventDetection, true));
t('Zombie 嵌套设置读取', () => {
  const z = r.events[0].settings.zombieSettings;
  assert.equal(z.enabled, false);
  assert.equal(z.mapInfectionAmount.laboratory, 100);
});
t('info 小结', () => { assert.equal(r.info.gifterMaps, 0); assert.equal(r.info.christmasContainers, 0); });

t('同一年区间判断', () => {
  assert.equal(seasonal.isActiveOn({ enabled: true, startMonth: 10, startDay: 28, endMonth: 11, endDay: 9 }, 10, 28), true);
  assert.equal(seasonal.isActiveOn({ enabled: true, startMonth: 10, startDay: 28, endMonth: 11, endDay: 9 }, 11, 9), true);
  assert.equal(seasonal.isActiveOn({ enabled: true, startMonth: 10, startDay: 28, endMonth: 11, endDay: 9 }, 11, 10), false);
  assert.equal(seasonal.isActiveOn({ enabled: false, startMonth: 10, startDay: 28, endMonth: 11, endDay: 9 }, 10, 29), false);
});
t('跨年区间判断（12-13 ~ 1-14）', () => {
  const ev = { enabled: true, startMonth: 12, startDay: 13, endMonth: 1, endDay: 14 };
  assert.equal(seasonal.isActiveOn(ev, 12, 20), true);
  assert.equal(seasonal.isActiveOn(ev, 1, 5), true);
  assert.equal(seasonal.isActiveOn(ev, 1, 14), true);
  assert.equal(seasonal.isActiveOn(ev, 1, 15), false);
  assert.equal(seasonal.isActiveOn(ev, 12, 12), false);
});
t('nextChange：生效中返回结束日', () => {
  const ev = { enabled: true, startMonth: 10, startDay: 28, endMonth: 11, endDay: 9 };
  const nx = seasonal.nextChange(ev, new Date(2026, 9, 29));
  assert.equal(nx.kind, 'end');
  assert.equal(nx.days, 11);
  assert.equal(nx.date, '2026-11-09');
});
t('nextChange：未生效返回开始日', () => {
  const ev = { enabled: true, startMonth: 12, startDay: 13, endMonth: 12, endDay: 31 };
  const nx = seasonal.nextChange(ev, new Date(2026, 9, 29));
  assert.equal(nx.kind, 'start');
  assert.equal(nx.days, 45);
  assert.equal(nx.date, '2026-12-13');
});

const norm = seasonal.normalizeSeasonalInput(sample, {
  enableSeasonalEventDetection: false,
  events: [
    {
      enabled: false, startMonth: 99, startDay: 0, endMonth: 0, endDay: 40,
      settings: {
        enableSummoning: false,
        removeEntryRequirement: 'laboratory, woods',
        zombieSettings: { enabled: true, mapInfectionAmount: { bigmap: 55 } },
        unknownSetting: 'ignored',
      },
      name: 'x'.repeat(200),
    },
  ],
});
t('规整：月/日夹取到合法范围', () => {
  assert.equal(norm.events[0].startMonth, 12);
  assert.equal(norm.events[0].startDay, 1);
  assert.equal(norm.events[0].endMonth, 1);
  assert.equal(norm.events[0].endDay, 31);
});
t('规整：数组字符串按逗号拆开', () => assert.deepEqual(norm.events[0].settings.removeEntryRequirement, ['laboratory', 'woods']));
t('规整：布尔与数字按原类型转换', () => {
  assert.equal(norm.events[0].settings.enableSummoning, false);
  assert.equal(norm.events[0].settings.zombieSettings.enabled, true);
  assert.equal(norm.events[0].settings.zombieSettings.mapInfectionAmount.bigmap, 55);
  assert.equal(norm.events[0].settings.zombieSettings.mapInfectionAmount.laboratory, 100); // 未提交的保留
  assert.equal(norm.events[0].settings.replaceBotHostility, true);                          // 未提交的保留
});
t('规整：丢弃未知设置、保留未知事件字段', () => {
  assert.equal(norm.events[0].settings.unknownSetting, undefined);
  assert.equal(norm.events[0].futureField, 'keep');
});
t('规整：名称截断、全局开关', () => {
  assert.equal(norm.events[0].name.length, 80);
  assert.equal(norm.enableSeasonalEventDetection, false);
});
t('规整：没传的字段沿用磁盘值', () => {
  const n2 = seasonal.normalizeSeasonalInput(sample, { events: [] });
  assert.equal(n2.events.length, 3);
  assert.equal(n2.events[1].name, 'christmas');
  assert.equal(n2.events[1].settings.christmasLootBoostAmount, 0.03);
});

const saved = seasonal.writeSeasonal(root, norm);
t('写回：返回新状态', () => { assert.equal(saved.ok, true); assert.equal(saved.active.length >= 0, true); });
t('写回：备份文件存在', () => { assert.equal(fs.existsSync(saved.backup), true); });
t('写回：未知顶层键保留', () => {
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after.keepMe, { a: 1 });
  assert.equal(after.enableSeasonalEventDetection, false);
  assert.equal(after.events.length, 3);
  assert.equal(after.events[0].enabled, false);
  assert.equal(after.events[0].futureField, 'keep');
  assert.equal(after.events[1].name, 'christmas');
});
t('写回：文件以换行结尾', () => assert.equal(fs.readFileSync(file, 'utf8').endsWith('\n'), true));
t('写回：月/日沿用磁盘上的字符串类型（SPT 按字符串反序列化）', () => {
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(typeof after.events[0].startMonth, 'string');
  assert.equal(typeof after.events[0].endDay, 'string');
  assert.equal(after.events[0].startMonth, '12');
});
t('写回：再次读取解析一致', () => {
  const again = seasonal.readSeasonal(root);
  assert.equal(again.ok, true);
  assert.equal(again.enableSeasonalEventDetection, false);
  assert.equal(again.events[0].startMonth, 12);
  assert.deepEqual(again.events[0].settings.removeEntryRequirement, ['laboratory', 'woods']);
});

t('缺文件：返回错误而不是抛异常', () => {
  const bad = seasonal.readSeasonal(path.join(tmp, 'nope'));
  assert.equal(bad.ok, false);
  assert.match(bad.parseError, /seasonalevents/);
});
t('坏 JSON：返回解析错误', () => {
  const badRoot = path.join(tmp, 'bad');
  fs.mkdirSync(path.join(badRoot, 'SPT', 'SPT_Data', 'configs'), { recursive: true });
  fs.writeFileSync(path.join(badRoot, 'SPT', 'SPT_Data', 'configs', 'seasonalevents.json'), '{ oops', 'utf8');
  const bad = seasonal.readSeasonal(badRoot);
  assert.equal(bad.ok, false);
  assert.match(bad.parseError, /JSON/);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
