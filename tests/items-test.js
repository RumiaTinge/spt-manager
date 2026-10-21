// 物品效果模块自检：node tests\items-test.js
// 用临时假 SPT 库，不碰真实数据库
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) { pass += 1; console.log('  ok   ' + msg); } else { fail += 1; console.log('  FAIL ' + msg); }
}
const throws = (fn, part, msg) => {
  try { fn(); ok(false, msg + '（没有报错）'); } catch (e) { ok(String(e.message).includes(part), `${msg}（${e.message}）`); }
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'items-root-'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'items-data-'));
process.env.SPT_MANAGER_DATA_DIR = dataDir;
const db = path.join(root, 'SPT', 'SPT_Data', 'database');
fs.mkdirSync(path.join(db, 'templates'), { recursive: true });
fs.mkdirSync(path.join(db, 'locales', 'global'), { recursive: true });

const MED = 'aaaa0000000000000000med1';
const FOOD = 'bbbb0000000000000000foo1';
const medItem = {
  _id: MED, _name: 'testmed', _parent: 'p1',
  _props: {
    MaxHpResource: 400, hpResourceRate: 85, medUseTime: 3, medEffectType: 'duringUse',
    StimulatorBuffs: 'BuffsTest',
    effects_damage: { Pain: { cost: 0, duration: 80, delay: 0, fadeOut: 0 } },
  },
};
const foodItem = {
  _id: FOOD, _name: 'testfood', _parent: 'p2',
  _props: { MaxResource: 1, foodUseTime: 2, effects_health: { Energy: { value: 35 }, Hydration: { value: -15 } } },
};
const itemsPath = path.join(db, 'templates', 'items.json');
fs.writeFileSync(itemsPath, JSON.stringify({ [MED]: medItem, [FOOD]: foodItem }, null, 2).replace(/\n/g, '\r\n'), 'utf8');

const globals = {
  config: { Health: { Effects: { Stimulator: { BuffLoopTime: 0.2, Buffs: { BuffsTest: [{ AbsoluteValue: true, BuffType: 'HealthRate', Chance: 1, Delay: 1, Duration: 300, SkillName: '', Value: 1 }] } } } } },
};
const globalsPath = path.join(db, 'globals.json');
fs.writeFileSync(globalsPath, JSON.stringify(globals, null, 2) + '\n', 'utf8');

// ch.json 有重复键，只能按行扫
fs.writeFileSync(path.join(db, 'locales', 'global', 'ch.json'),
  `{\n  "${MED} Name": "测试急救包",\n  "${FOOD} Name": "测试压缩饼干",\n  "dup": "a",\n  "dup": "b"\n}\n`, 'utf8');

const items = await import('../lib/items.js');

console.log('— 索引 / 搜索');
const index = items.itemIndex(root);
ok(index.length === 2, `索引 2 个物品（实际 ${index.length}）`);
ok(index.some((x) => x.id === MED && x.cn === '测试急救包' && x.kind === 'med'), '中文名和类型 med');
ok(index.some((x) => x.id === FOOD && x.cn === '测试压缩饼干' && x.kind === 'food'), '中文名和类型 food');
ok(items.searchItems(root, '急救').total === 1, '按中文名搜索');
ok(items.searchItems(root, 'testfood').total === 1, '按英文名搜索');
ok(items.searchItems(root, '').items.length === 2, '空搜索返回全部');

console.log('— 读物品');
const med = items.readItem(root, MED);
const titles = med.groups.map((g) => g.title);
ok(titles.includes('医疗 / 兴奋剂'), '有基础数值组');
ok(titles.includes('使用时机'), '有使用时机组');
ok(titles.includes('效果：Pain'), '有伤害效果组');
ok(titles.includes('兴奋剂 / 食物 Buff 组'), '有 Buff 组选择');
ok(med.groups[0].fields.find((f) => f.key === 'MaxHpResource').value === 400, 'MaxHpResource 读出来是 400');
const food = items.readItem(root, FOOD);
ok(food.groups.some((g) => g.title === '能量 / 水分'), '食物有能量 / 水分组');

console.log('— 写物品');
const before = fs.readFileSync(itemsPath, 'utf8');
items.writeItem(root, MED, { MaxHpResource: 500 });
const after = fs.readFileSync(itemsPath, 'utf8');
ok(items.readItem(root, MED).groups[0].fields.find((f) => f.key === 'MaxHpResource').value === 500, '写入后读到 500');
ok(!/(?<!\r)\n/.test(after), '改完仍是纯 CRLF 换行');
ok(after.includes(JSON.stringify(foodItem, null, 2).replace(/\n/g, '\r\n  ').split('\n')[0]) || after.includes('"bbbb0000000000000000foo1"'), '另一个物品还在');
ok(after.length !== 0 && Math.abs(after.length - before.length) < 200, `文件长度变化很小（${before.length} → ${after.length}）`);
ok(JSON.parse(after)[FOOD]._props.MaxResource === 1, '未编辑的物品内容不变');
throws(() => items.writeItem(root, MED, { MaxHpResource: 1e9 }), '0 ~ 100000', '越界被拒');
throws(() => items.writeItem(root, MED, { NoSuchField: 1 }), '不支持改字段', '未知字段被拒');
throws(() => items.writeItem(root, MED, { medEffectType: 'whenever' }), 'duringUse', '生效时机非法被拒');
throws(() => items.writeItem(root, MED, { StimulatorBuffs: 'BuffsNope' }), '没有这个 Buff 组', '不存在的 Buff 组被拒');
items.writeItem(root, MED, { 'effects_damage.Pain.duration': 120 });
ok(JSON.parse(fs.readFileSync(itemsPath, 'utf8'))[MED]._props.effects_damage.Pain.duration === 120, '可改嵌套的伤害效果时长');
items.writeItem(root, FOOD, { 'effects_health.Energy.value': 60 });
ok(JSON.parse(fs.readFileSync(itemsPath, 'utf8'))[FOOD]._props.effects_health.Energy.value === 60, '可改食物能量');

console.log('— Buff 组');
const cat = items.buffCatalog(root);
ok(cat.groups.length === 1 && cat.groups[0].id === 'BuffsTest', '读出 1 个 Buff 组');
ok(cat.loopTime === 0.2, 'BuffLoopTime = 0.2');
const written = items.writeBuffGroup(root, 'BuffsTest', [{ AbsoluteValue: true, BuffType: 'EnergyRate', Chance: 1, Delay: 0, Duration: 200, SkillName: '', Value: 2 }]);
ok(written.entries[0].Duration === 200 && written.entries[0].BuffType === 'EnergyRate', '写入后返回新内容');
const globalsText = fs.readFileSync(globalsPath, 'utf8');
ok(JSON.parse(globalsText).config.Health.Effects.Stimulator.Buffs.BuffsTest[0].Duration === 200, 'globals.json 落盘生效');
ok(globalsText.endsWith('\n') && !globalsText.includes('\r'), 'globals 保持 LF + 结尾换行');
throws(() => items.writeBuffGroup(root, 'BuffsTest', []), '1 ~ 20', '空条目被拒');
throws(() => items.writeBuffGroup(root, 'BuffsTest', [{ BuffType: 'Bad Type!' }]), 'BuffType', '非法 BuffType 被拒');
throws(() => items.writeBuffGroup(root, 'BuffsTest', [{ BuffType: 'HealthRate', Chance: 5 }]), '触发概率', 'Chance 越界被拒');
throws(() => items.writeBuffGroup(root, 'BuffsNope', [{ BuffType: 'HealthRate', Chance: 1, Delay: 0, Duration: 1, SkillName: '', Value: 1 }]), '没有这个 Buff 组', '不存在的组被拒');

console.log('— 备份 / 还原');
const backups = items.listDbBackups(root);
ok(backups.some((b) => b.name.startsWith('items.json.')), '生成了 items.json 备份');
ok(backups.some((b) => b.name.startsWith('globals.json.')), '生成了 globals.json 备份');
const itemsBackups = backups.filter((b) => b.name.startsWith('items.json.'));
const oldest = itemsBackups[itemsBackups.length - 1];
items.restoreDbBackup(root, oldest.name);
ok(items.readItem(root, MED).groups[0].fields.find((f) => f.key === 'MaxHpResource').value === 400, `还原 ${oldest.name} 后回到 400`);
throws(() => items.restoreDbBackup(root, '../../../etc/passwd'), '不合法', '非法备份名被拒');

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(dataDir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
