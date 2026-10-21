// items.js — 物品数值 / 兴奋剂 Buff 编辑（直接改 SPT 数据库文件，改前自动备份）
//
// 数据位置：
//   <SPT 根>\SPT\SPT_Data\database\templates\items.json     单个物品的数值（治疗量、使用时间、能量水分、伤害效果…）
//   <SPT 根>\SPT\SPT_Data\database\globals.json             config.Health.Effects.Stimulator.Buffs.<组名> = 效果定义
//   <SPT 根>\SPT\SPT_Data\database\locales\global\ch.json   中文名（"<tpl> Name"）
//
// 改完要重启服务端（数据库在启动时读入），客户端也要重开才会拿到新模板。
import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_DIR, nowStamp, isFile } from './core.js';

export function itemsPaths(root) {
  const db = path.join(root, 'SPT', 'SPT_Data', 'database');
  return {
    db,
    items: path.join(db, 'templates', 'items.json'),
    globals: path.join(db, 'globals.json'),
    locale: path.join(db, 'locales', 'global', 'ch.json'),
    backups: path.join(BACKUP_DIR, 'database'),
  };
}

// ---------------------------------------------------------------- 字段描述

const MED_FIELDS = [
  { key: 'MaxHpResource', label: '总治疗量（HP）', min: 0, max: 100000, step: 1, int: true },
  { key: 'hpResourceRate', label: '治疗速度（HP/秒）', min: 0, max: 10000, step: 1, int: true },
  { key: 'medUseTime', label: '使用时间（秒）', min: 0, max: 120, step: 0.1 },
];

const FOOD_FIELDS = [
  { key: 'MaxResource', label: '一次消耗量', min: 1, max: 1000, step: 1, int: true },
  { key: 'foodUseTime', label: '使用时间（秒）', min: 0, max: 120, step: 0.1 },
];

const HEALTH_FIELDS = [
  { key: 'Energy', label: '能量', min: -1000, max: 1000, step: 1, int: true },
  { key: 'Hydration', label: '水分', min: -1000, max: 1000, step: 1, int: true },
];

const DAMAGE_FIELDS = [
  { key: 'cost', label: '消耗治疗量', min: 0, max: 100000, step: 1, int: true },
  { key: 'duration', label: '持续（秒）', min: 0, max: 3600, step: 1 },
  { key: 'delay', label: '延迟（秒）', min: 0, max: 3600, step: 1 },
  { key: 'fadeOut', label: '淡出（秒）', min: 0, max: 3600, step: 1 },
];

const EFFECT_TYPES = ['duringUse', 'afterUse'];
const BUFF_VALUE_MIN = -1000;
const BUFF_VALUE_MAX = 1000;

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function clampNumber(def, value, what) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${what} 不是数字`);
  if (n < def.min || n > def.max) throw new Error(`${what} 需要在 ${def.min} ~ ${def.max} 之间`);
  return def.int ? Math.round(n) : n;
}

// ---------------------------------------------------------------- 索引 / 中文名

const CACHE = { key: '', index: null, cnKey: '', cn: null, groups: null, groupsKey: '' };

function statKey(p) {
  try { const s = fs.statSync(p); return `${s.size}:${s.mtimeMs}`; } catch { return '0'; }
}

/** 从 ch.json 里扫出 "<tpl> Name": "中文名"，不整份 parse（18MB） */
function readLocaleNames(p) {
  const key = statKey(p);
  if (CACHE.cnKey === key && CACHE.cn) return CACHE.cn;
  const map = new Map();
  let raw = '';
  try { raw = fs.readFileSync(p, 'utf8'); } catch { /* 没中文包就空着 */ }
  if (raw) {
    const re = /"([0-9a-zA-Z_]{6,64}) Name"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let m;
    while ((m = re.exec(raw))) {
      try { map.set(m[1], JSON.parse(`"${m[2]}"`)); } catch { map.set(m[1], m[2]); }
    }
  }
  CACHE.cnKey = key;
  CACHE.cn = map;
  return map;
}

/** 可编辑物品索引（只收有 medUseTime / foodUseTime 的物品，几百个） */
export function itemIndex(root) {
  const p = itemsPaths(root);
  const key = statKey(p.items);
  if (CACHE.key === key && CACHE.index) return CACHE.index;
  const raw = fs.readFileSync(p.items, 'utf8');
  const obj = JSON.parse(raw);
  const cn = readLocaleNames(p.locale);
  const index = [];
  for (const [id, it] of Object.entries(obj)) {
    const pr = it && it._props;
    if (!pr) continue;
    const kind = pr.foodUseTime !== undefined ? 'food' : pr.medUseTime !== undefined ? 'med' : null;
    if (!kind) continue;
    index.push({ id, name: it._name || id, cn: cn.get(id) || '', kind });
  }
  index.sort((a, b) => (a.cn || a.name).localeCompare(b.cn || b.name, 'zh-CN'));
  CACHE.key = key;
  CACHE.index = index;
  return index;
}

export function searchItems(root, q, limit = 40) {
  const index = itemIndex(root);
  const s = String(q || '').trim().toLowerCase();
  const hit = s
    ? index.filter((it) => it.id.toLowerCase().includes(s) || it.name.toLowerCase().includes(s) || it.cn.includes(s))
    : index;
  return { total: hit.length, items: hit.slice(0, Math.max(1, Math.min(200, limit))) };
}

// ---------------------------------------------------------------- 文本定位

/** 在 items.json 原文里定位某个物品对象的 {...} 区间（不整份 parse） */
function itemBlock(raw, id) {
  const marker = `  "${id}": {`;
  const at = raw.indexOf(marker);
  if (at < 0) throw new Error(`items.json 里找不到物品 ${id}`);
  const start = at + marker.length - 1;
  let depth = 0;
  let inStr = false;
  let end = -1;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  if (end < 0) throw new Error('items.json 结构异常，找不到对象结尾');
  return { start, end, text: raw.slice(start, end) };
}

// ---------------------------------------------------------------- 读物品

function describeFields(root, props) {
  const kind = props.foodUseTime !== undefined ? 'food' : props.medUseTime !== undefined ? 'med' : null;
  const groups = [];

  const base = (kind === 'food' ? FOOD_FIELDS : MED_FIELDS).filter((f) => props[f.key] !== undefined);
  if (base.length) {
    groups.push({
      title: kind === 'food' ? '食物 / 饮料' : '医疗 / 兴奋剂',
      fields: base.map((f) => ({ key: f.key, label: f.label, min: f.min, max: f.max, step: f.step, value: props[f.key] })),
    });
  }

  const typeKey = kind === 'food' ? 'foodEffectType' : 'medEffectType';
  if (props[typeKey] !== undefined) {
    groups.push({
      title: '使用时机',
      fields: [{ key: typeKey, label: '生效时机', type: 'select', value: props[typeKey], options: EFFECT_TYPES }],
    });
  }

  const health = props.effects_health;
  if (health && !Array.isArray(health) && typeof health === 'object') {
    const fields = HEALTH_FIELDS.filter((f) => health[f.key] && isNum(health[f.key].value))
      .map((f) => ({ key: `effects_health.${f.key}.value`, label: f.label, min: f.min, max: f.max, step: f.step, value: health[f.key].value }));
    if (fields.length) groups.push({ title: '能量 / 水分', fields });
  }

  const dmg = props.effects_damage;
  if (dmg && !Array.isArray(dmg) && typeof dmg === 'object') {
    for (const [state, val] of Object.entries(dmg)) {
      if (!val || typeof val !== 'object') continue;
      const fields = DAMAGE_FIELDS.filter((f) => isNum(val[f.key]))
        .map((f) => ({ key: `effects_damage.${state}.${f.key}`, label: f.label, min: f.min, max: f.max, step: f.step, value: val[f.key] }));
      if (fields.length) groups.push({ title: `效果：${state}`, fields });
    }
  }

  if (typeof props.StimulatorBuffs === 'string' && (props.StimulatorBuffs || kind === 'med')) {
    const ids = buffCatalog(root).groups.map((g) => g.id);
    groups.push({
      title: '兴奋剂 / 食物 Buff 组',
      fields: [{ key: 'StimulatorBuffs', label: 'Buff 组', type: 'select', value: props.StimulatorBuffs || '', options: ['', ...ids] }],
    });
  }

  return { kind, groups };
}

export function readItem(root, id) {
  const p = itemsPaths(root);
  const raw = fs.readFileSync(p.items, 'utf8');
  const item = JSON.parse(itemBlock(raw, id).text);
  const props = item._props || {};
  const cn = readLocaleNames(p.locale).get(id) || '';
  return {
    id,
    name: item._name || id,
    cn,
    shortName: props.ShortName || '',
    ...describeFields(root, props),
    files: { items: p.items, size: fs.statSync(p.items).size, mtime: fs.statSync(p.items).mtimeMs },
  };
}

// ---------------------------------------------------------------- 写物品

function setPath(obj, dotted, value) {
  const parts = dotted.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') throw new Error(`字段不存在: ${dotted}`);
    cur = cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  if (cur[last] === undefined) throw new Error(`字段不存在: ${dotted}`);
  cur[last] = value;
}

function extField(root, key) {
  if (key.startsWith('effects_damage.')) {
    const [, state, field] = key.split('.');
    const def = DAMAGE_FIELDS.find((f) => f.key === field);
    if (!def) throw new Error(`不支持改 effects_damage.${field}`);
    return { def, label: `${state}.${field}` };
  }
  if (key.startsWith('effects_health.')) {
    const [, state] = key.split('.');
    const def = HEALTH_FIELDS.find((f) => f.key === state);
    if (!def) throw new Error(`不支持改 effects_health.${state}`);
    return { def, label: `${state} 数值` };
  }
  const def = [...MED_FIELDS, ...FOOD_FIELDS].find((f) => f.key === key);
  if (!def) throw new Error(`不支持改字段 ${key}`);
  return { def, label: def.label };
}

export function writeItem(root, id, patch) {
  const p = itemsPaths(root);
  const raw = fs.readFileSync(p.items, 'utf8');
  const blk = itemBlock(raw, id);
  const item = JSON.parse(blk.text);
  const props = item._props || {};

  for (const [key, value] of Object.entries(patch || {})) {
    if (value === undefined || value === null) continue;
    if (key === 'StimulatorBuffs') {
      const v = String(value);
      if (v && !buffCatalog(root).groups.some((g) => g.id === v)) throw new Error(`没有这个 Buff 组: ${v}`);
      if (props.StimulatorBuffs === undefined) throw new Error('这个物品没有 StimulatorBuffs 字段');
      props.StimulatorBuffs = v;
      continue;
    }
    if (key === 'medEffectType' || key === 'foodEffectType') {
      const v = String(value);
      if (!EFFECT_TYPES.includes(v)) throw new Error('生效时机只能是 duringUse / afterUse');
      if (props[key] === undefined) throw new Error(`这个物品没有 ${key} 字段`);
      props[key] = v;
      continue;
    }
    const { def, label } = extField(root, key);
    setPath(item._props, key, clampNumber(def, value, label));
  }

  // 保持原文件的换行风格（SPT 的数据库文件是 CRLF）
  const nl = raw.includes('\r\n') ? '\r\n' : '\n';
  const text = JSON.stringify(item, null, 2).replace(/\n/g, `${nl}  `);
  writeWithBackup(p.items, p.backups, raw.slice(0, blk.start) + text + raw.slice(blk.end));
  CACHE.key = '';
  CACHE.index = null;
  return readItem(root, id);
}

// ---------------------------------------------------------------- Buff 组

export function buffCatalog(root) {
  const p = itemsPaths(root);
  const key = statKey(p.globals);
  if (CACHE.groupsKey === key && CACHE.groups) return CACHE.groups;
  let stim = {};
  try {
    const g = JSON.parse(fs.readFileSync(p.globals, 'utf8'));
    stim = g?.config?.Health?.Effects?.Stimulator || {};
  } catch { stim = {}; }
  const groups = Object.entries(stim.Buffs || {}).map(([id, entries]) => ({
    id,
    entries: Array.isArray(entries) ? entries : [],
  }));
  const out = { loopTime: stim.BuffLoopTime ?? null, groups, path: p.globals };
  CACHE.groupsKey = key;
  CACHE.groups = out;
  return out;
}

const BUFF_ENTRY_KEYS = ['BuffType', 'Chance', 'Delay', 'Duration', 'Value', 'AbsoluteValue', 'SkillName'];

export function writeBuffGroup(root, id, entries) {
  const p = itemsPaths(root);
  const g = JSON.parse(fs.readFileSync(p.globals, 'utf8'));
  const stim = g?.config?.Health?.Effects?.Stimulator;
  if (!stim || !stim.Buffs || !stim.Buffs[id]) throw new Error(`没有这个 Buff 组: ${id}`);
  if (!Array.isArray(entries) || !entries.length || entries.length > 20) throw new Error('Buff 条目数量需要在 1 ~ 20 条');

  const next = entries.map((e, i) => {
    if (!e || typeof e !== 'object') throw new Error(`第 ${i + 1} 条不是对象`);
    const out = {};
    for (const k of Object.keys(e)) if (!BUFF_ENTRY_KEYS.includes(k)) throw new Error(`第 ${i + 1} 条有未知字段 ${k}`);
    const type = String(e.BuffType || '').trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{1,40}$/.test(type)) throw new Error(`第 ${i + 1} 条的 BuffType 不合法`);
    const skill = String(e.SkillName ?? '');
    if (skill.length > 40) throw new Error(`第 ${i + 1} 条的 SkillName 太长`);
    const num = (k, min, max, label) => {
      const n = Number(e[k]);
      if (!Number.isFinite(n) || n < min || n > max) throw new Error(`第 ${i + 1} 条的 ${label} 需要在 ${min} ~ ${max} 之间`);
      return n;
    };
    out.BuffType = type;
    out.Chance = num('Chance', 0, 1, '触发概率');
    out.Delay = num('Delay', 0, 3600, '延迟');
    out.Duration = num('Duration', 0, 86400, '持续时间');
    out.SkillName = skill;
    out.Value = num('Value', BUFF_VALUE_MIN, BUFF_VALUE_MAX, '数值');
    if (e.AbsoluteValue !== undefined) out.AbsoluteValue = !!e.AbsoluteValue;
    // 保持字段顺序和原文件一致
    return {
      AbsoluteValue: out.AbsoluteValue ?? true,
      BuffType: out.BuffType,
      Chance: out.Chance,
      Delay: out.Delay,
      Duration: out.Duration,
      SkillName: out.SkillName,
      Value: out.Value,
    };
  });

  stim.Buffs[id] = next;
  const globalsRaw = fs.readFileSync(p.globals, 'utf8');
  const nl = globalsRaw.includes('\r\n') ? '\r\n' : '\n';
  // 原文件末尾有换行，JSON.stringify 不会带，补回来保证字节数/风格一致
  const out = JSON.stringify(g, null, 2).replace(/\n/g, nl) + nl;
  writeWithBackup(p.globals, p.backups, out);
  CACHE.groupsKey = '';
  CACHE.groups = null;
  return buffCatalog(root).groups.find((x) => x.id === id);
}

// ---------------------------------------------------------------- 备份 / 还原

function pruneBackups(dir, base, keep) {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => f.startsWith(base + '.') && f.endsWith('.bak'))
      .map((f) => ({ f, m: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.m - a.m);
    for (const old of files.slice(keep)) fs.rmSync(path.join(dir, old.f), { force: true });
  } catch { /* 清理失败不影响保存 */ }
}

function writeWithBackup(file, backupDir, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (isFile(file)) {
    fs.mkdirSync(backupDir, { recursive: true });
    const base = `${path.basename(file)}.${nowStamp()}`;
    let name = `${base}.bak`;
    let i = 1;
    while (isFile(path.join(backupDir, name))) name = `${base}-${i++}.bak`; // 同一秒内多次保存不要互相覆盖
    fs.copyFileSync(file, path.join(backupDir, name));
    pruneBackups(backupDir, path.basename(file), 6);
  }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

export function listDbBackups(root) {
  const p = itemsPaths(root);
  let files = [];
  try { files = fs.readdirSync(p.backups); } catch { return []; }
  return files
    .map((name) => {
      let mtime = 0; let size = 0;
      try { const st = fs.statSync(path.join(p.backups, name)); mtime = st.mtimeMs; size = st.size; } catch { /* ignore */ }
      return { name, mtime, size };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 20);
}

export function restoreDbBackup(root, name) {
  const p = itemsPaths(root);
  const base = path.basename(String(name || ''));
  if (!/^(items|globals)\.json\.[\w.-]+\.bak$/.test(base)) throw new Error('备份文件名不合法');
  const src = path.join(p.backups, base);
  if (!isFile(src)) throw new Error('备份不存在: ' + base);
  const target = base.startsWith('items.json.') ? p.items : p.globals;
  const raw = fs.readFileSync(src, 'utf8');
  JSON.parse(raw); // 坏了就别覆盖
  writeWithBackup(target, p.backups, raw);
  CACHE.key = ''; CACHE.index = null; CACHE.groupsKey = ''; CACHE.groups = null;
  return { restored: base, target };
}
