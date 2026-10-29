// seasonal.js — 节日 / 季节性活动配置（SPT_Data\configs\seasonalevents.json）
import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_DIR, isFile, nowStamp, readJson } from './core.js';

export const EVENT_TYPES = ['HALLOWEEN', 'CHRISTMAS', 'NEWYEARS', 'APRILFOOLS'];

/** 活动里能显示/编辑的地图感染表用的名字（客户端用的 map 键） */
export const INFECTION_MAP_CN = {
  bigmap: '海关',
  woods: '森林',
  shoreline: '海岸线',
  interchange: '立交桥',
  laboratory: '实验室',
  lighthouse: '灯塔',
  rezervbase: '储备站',
  factory4: '工厂',
  tarkovstreets: '塔科夫街区',
  sandbox: '中心区',
};

export function seasonalPath(root) {
  return path.join(root, 'SPT', 'SPT_Data', 'configs', 'seasonalevents.json');
}

const pad2 = (n) => String(n).padStart(2, '0');
const num = (v, lo, hi, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
};

/** 月/日 → 可比较的 mmdd 数字 */
export function mmdd(month, day) {
  return Number(month || 1) * 100 + Number(day || 1);
}

/** 这个「月/日」是否落在活动区间里（支持跨年，例如 12-13 ~ 1-14） */
export function isActiveOn(ev, month, day) {
  if (!ev || ev.enabled === false) return false;
  const today = mmdd(month, day);
  const start = mmdd(ev.startMonth, ev.startDay);
  const end = mmdd(ev.endMonth, ev.endDay);
  return start <= end ? (today >= start && today <= end) : (today >= start || today <= end);
}

/** 距离下一次开始（未生效）或结束（生效中）还有几天；返回 {kind:'start'|'end', days, date} */
export function nextChange(ev, now = new Date()) {
  if (!ev) return null;
  const start = mmdd(ev.startMonth, ev.startDay);
  const end = mmdd(ev.endMonth, ev.endDay);
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const active = isActiveOn(ev, now.getMonth() + 1, now.getDate());
  const target = active ? end : start;
  for (let i = 0; i <= 400; i++) {
    const d = new Date(base.getTime() + i * 86400000);
    if (mmdd(d.getMonth() + 1, d.getDate()) === target) {
      return { kind: active ? 'end' : 'start', days: i, date: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` };
    }
  }
  return null;
}

export function readSeasonal(root) {
  const file = seasonalPath(root);
  const out = {
    ok: true, path: file, exists: isFile(file), parseError: null, mtime: null,
    enableSeasonalEventDetection: true, events: [],
    today: (() => { const d = new Date(); return { month: d.getMonth() + 1, day: d.getDate() }; })(),
    active: [],
    info: {},
  };
  if (!out.exists) { out.ok = false; out.parseError = '没有找到 seasonalevents.json'; return out; }
  try { out.mtime = fs.statSync(file).mtime.toISOString(); } catch { /* ignore */ }
  let raw;
  try { raw = readJson(file); } catch (e) { out.ok = false; out.parseError = `JSON 解析失败：${e.message}`; return out; }
  out.enableSeasonalEventDetection = raw.enableSeasonalEventDetection !== false;
  const events = Array.isArray(raw.events) ? raw.events : [];
  out.today = (() => { const d = new Date(); return { month: d.getMonth() + 1, day: d.getDate() }; })();
  out.events = events.map((ev, i) => ({
    index: i,
    name: String(ev.name || `事件 ${i + 1}`),
    type: String(ev.type || ''),
    enabled: ev.enabled !== false,
    startMonth: num(ev.startMonth, 1, 12, 1),
    startDay: num(ev.startDay, 1, 31, 1),
    endMonth: num(ev.endMonth, 1, 12, 12),
    endDay: num(ev.endDay, 1, 31, 31),
    settings: ev.settings && typeof ev.settings === 'object' ? ev.settings : {},
  }));
  out.active = out.events.filter((ev) => isActiveOn(ev, out.today.month, out.today.day)).map((ev) => ev.name);
  for (const ev of out.events) ev.next = nextChange(ev);
  // 数据侧的小结（这些是季节活动附带的表，只读展示）
  const boss = raw.eventBossSpawns && typeof raw.eventBossSpawns === 'object' ? Object.keys(raw.eventBossSpawns) : [];
  const gear = raw.eventGear && typeof raw.eventGear === 'object' ? Object.keys(raw.eventGear) : [];
  const loot = raw.eventLoot && typeof raw.eventLoot === 'object' ? Object.keys(raw.eventLoot) : [];
  const gifter = Array.isArray(raw.gifterSettings) ? raw.gifterSettings : [];
  out.info = {
    detection: out.enableSeasonalEventDetection,
    eventBossSpawns: boss,
    eventGear: gear,
    eventLoot: loot,
    gifterMaps: gifter.length,
    christmasContainers: Array.isArray(raw.christmasContainerIds) ? raw.christmasContainerIds.length : 0,
    khorovodMaps: raw.khorovodEventTransitWhitelist ? Object.keys(raw.khorovodEventTransitWhitelist) : [],
    hostilityFor: raw.hostilitySettingsForEvent ? Object.keys(raw.hostilitySettingsForEvent) : [],
    botAppearanceFor: raw.botAppearanceChanges ? Object.keys(raw.botAppearanceChanges) : [],
  };
  return out;
}

/** 把一个值按「参照值」的类型规整（保留结构、丢弃非法值） */
function coerceLike(value, ref) {
  if (Array.isArray(ref)) {
    if (Array.isArray(value)) return value.map((v) => String(v));
    if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
    return ref;
  }
  if (typeof ref === 'boolean') return value === true || value === 'true' || value === 1 || value === '1';
  if (typeof ref === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : ref;
  }
  if (ref && typeof ref === 'object') {
    const out = { ...ref };
    if (value && typeof value === 'object') {
      for (const k of Object.keys(ref)) {
        if (k in value) out[k] = coerceLike(value[k], ref[k]);
      }
    }
    return out;
  }
  if (typeof ref === 'string') {
    if (typeof value === 'string') return value;
    if (value === undefined || value === null) return ref;
    return String(value);
  }
  return value;
}

/** 原本是字符串的月/日字段保持字符串写回（SPT 按字符串反序列化） */
function mdLike(ref, n) {
  return typeof ref === 'string' ? String(n) : n;
}

/** 校验 + 规整前端传来的活动列表（按 index 合回磁盘上的原对象，保留没显示的字段） */
export function normalizeSeasonalInput(baseRaw, input) {
  const eventsIn = Array.isArray(input && input.events) ? input.events : [];
  const baseEvents = Array.isArray(baseRaw.events) ? baseRaw.events : [];
  const events = baseEvents.map((orig, i) => {
    const ev = eventsIn[i] || {};
    const next = { ...orig };
    next.name = String(ev.name ?? orig.name ?? `事件 ${i + 1}`).slice(0, 80);
    next.type = String(ev.type ?? orig.type ?? '').slice(0, 40);
    next.enabled = ev.enabled === undefined ? orig.enabled !== false : ev.enabled !== false;
    // 原始文件里月/日是字符串（SPT 的模型按字符串读），写回时保持原类型
    next.startMonth = mdLike(orig.startMonth, num(ev.startMonth ?? orig.startMonth, 1, 12, num(orig.startMonth, 1, 12, 1)));
    next.startDay = mdLike(orig.startDay, num(ev.startDay ?? orig.startDay, 1, 31, num(orig.startDay, 1, 31, 1)));
    next.endMonth = mdLike(orig.endMonth, num(ev.endMonth ?? orig.endMonth, 1, 12, num(orig.endMonth, 1, 12, 12)));
    next.endDay = mdLike(orig.endDay, num(ev.endDay ?? orig.endDay, 1, 31, num(orig.endDay, 1, 31, 31)));
    // 设置项：只按原字段类型逐个覆盖，避免把未显示的字段写丢
    const baseSettings = orig.settings && typeof orig.settings === 'object' ? orig.settings : {};
    const inSettings = ev.settings && typeof ev.settings === 'object' ? ev.settings : {};
    const settings = { ...baseSettings };
    for (const key of Object.keys(baseSettings)) {
      if (key in inSettings) settings[key] = coerceLike(inSettings[key], baseSettings[key]);
    }
    next.settings = settings;
    return next;
  });
  return {
    enableSeasonalEventDetection: input && input.enableSeasonalEventDetection !== undefined
      ? input.enableSeasonalEventDetection !== false
      : baseRaw.enableSeasonalEventDetection !== false,
    events,
  };
}

export function writeSeasonal(root, input) {
  const file = seasonalPath(root);
  if (!isFile(file)) throw new Error('没有找到 SPT_Data\\configs\\seasonalevents.json（先检查 SPT 目录）');
  const raw = readJson(file);
  const normalized = normalizeSeasonalInput(raw, input || {});
  const next = { ...raw, ...normalized };
  // 备份
  const bdir = path.join(BACKUP_DIR, 'configs');
  fs.mkdirSync(bdir, { recursive: true });
  const stamp = nowStamp();
  const bak = path.join(bdir, `seasonalevents.json.${stamp}.bak`);
  fs.copyFileSync(file, bak);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
  const saved = readSeasonal(root);
  return { ...saved, backup: bak, savedAt: new Date().toISOString() };
}
