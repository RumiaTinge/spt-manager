// aiRules.js — NoAIBots 服务器 mod 的规则配置：读取、校验、保存、备份、预演
//
// 配置文件位置：<SPT 根>\SPT\user\mods\NoAIBots\config.json
// mod 每局开战时按文件修改时间热重载，所以这里保存即生效（服务端不需要重启）。
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, isFile, BACKUP_DIR, nowStamp } from './core.js';
import { readDllMeta } from './dllmeta.js';

export const MOD_DIR_NAME = 'NoAIBots';
export const BOT_AMOUNTS = ['AsOnline', 'NoBots', 'Low', 'Medium', 'High', 'Horde'];
export const BOT_AMOUNT_LABEL = {
  AsOnline: '同在线', NoBots: '无AI', Low: '低', Medium: '中等', High: '高', Horde: '排山倒海',
};

/** 规则动作的默认值：布尔=开关，数字=合并参数（默认不改变） */
export const ACTION_DEFS = {
  // 删除类（改的是这一局下发给客户端的刷新表）
  clearScavWaves: { type: 'bool', label: '清空普通 Scav 波次', system: '旧系统', desc: '删掉地图 waves 里的全部 Scav 波次；首领 / PMC 刷新点不动。' },
  clearBossSpawns: { type: 'bool', label: '清空全部首领/PMC 刷新点', system: '首领/PMC', desc: '把 BossLocationSpawn 整个清空：首领、随从、PMC、gifter、竞技场事件都不会刷。' },
  removePmcWaves: { type: 'bool', label: '只删 PMC 波次', system: '首领/PMC', desc: '只删 pmcUSEC / pmcBEAR / pmcBot 这类 PMC 点位，首领照常。' },
  removeBossWaves: { type: 'bool', label: '只删首领波次', system: '首领/PMC', desc: '只删名字以 boss 开头的点位（含 sectantPriest 邪教徒首领），PMC 照常。' },
  removeBotNames: { type: 'names', label: '按类型删除（WildSpawnType）', system: '首领/PMC', desc: '按 BossName 精确删除，例如 pmcBot、exUsec、gifter、bossKnight。' },
  pmcSchedule: { type: 'schedule', label: '自定义刷新时间表（PMC / 首领）', system: '首领/PMC', desc: '用自定义的「时间 / 概率 / 每队人数（含队长）」替换这张图原有的 PMC 档位或某个首领的刷新点；行的类型选 PMC 就留空名称，选首领则填 bossBully / sectantPriest 等这张图原版就有的类型；整表留空 = 保持原版。' },

  // 数量 / 概率类
  scavWaveCountScale: { type: 'number', label: 'Scav 波人数倍率', system: '旧系统', def: 1, min: 0, max: 10, desc: '缩放每条 Scav 波的 slots_min / slots_max：0.5 = 人数减半，2 = 翻倍。' },
  scavWaveCountDelta: { type: 'number', label: 'Scav 波人数增减', system: '旧系统', min: -30, max: 30, desc: '在倍率之后再对每条 Scav 波加减固定人数，可为负数。' },
  pmcWaveChanceScale: { type: 'number', label: 'PMC 波概率倍率', system: '首领/PMC', def: 1, min: 0, max: 10, desc: '缩放 PMC 的进场概率（pmc.json 里的 BossChance）：0.5 = 概率减半。' },
  bossChanceScale: { type: 'number', label: '首领概率倍率', system: '首领/PMC', def: 1, min: 0, max: 10, desc: '缩放首领进场概率；原本 0% 的事件型点位不会被改坏。' },
  maxPmcWaves: { type: 'number', label: 'PMC 波次上限', system: '首领/PMC', min: 0, max: 100, desc: '最多保留多少条 PMC 波次（超出按时间截断）。' },
  maxBossSpawns: { type: 'number', label: '首领刷新点上限', system: '首领/PMC', min: 0, max: 100, desc: '最多保留多少个首领刷新点。' },
  delaySpawnsSeconds: { type: 'number', label: '开局延迟刷怪（秒）', system: '首领/PMC', min: -3600, max: 86400, desc: '把首领 / PMC 的触发时间整体后移 N 秒；Time<0（立即或随机）的条目不动。' },
  botCapScale: { type: 'number', label: '同屏 AI 上限倍率', system: '上限', def: 1, min: 0, max: 10, desc: '缩放同屏硬上限 maxBotCap：0 = 整局不刷（配合清空刷新点即完全无 AI）。' },

  // ---- 地图级刷新参数（mod 直接写进下发给客户端的 LocationBase）
  botSpawnPeriodCheck: { type: 'tuning', label: '刷新检查间隔（秒）', system: '新系统', min: 1, max: 3600, desc: '新系统每隔多少秒检查一次是否补人；海关原版 15 秒。' },
  botSpawnTimeOnMin: { type: 'tuning', label: '刷新持续下限（秒）', system: '新系统', min: 0, max: 86400, desc: '一个刷怪窗口持续多久（下限）；海关原版 260。' },
  botSpawnTimeOnMax: { type: 'tuning', label: '刷新持续上限（秒）', system: '新系统', min: 0, max: 86400, desc: '一个刷怪窗口持续多久（上限）；海关原版 320。' },
  botSpawnTimeOffMin: { type: 'tuning', label: '停歇下限（秒）', system: '新系统', min: 0, max: 86400, desc: '两个刷怪窗口之间停多久（下限）；海关原版 20。' },
  botSpawnTimeOffMax: { type: 'tuning', label: '停歇上限（秒）', system: '新系统', min: 0, max: 86400, desc: '两个刷怪窗口之间停多久（上限）；海关原版 30。' },
  botSpawnCountStep: { type: 'tuning', label: '每次刷新数量步进', system: '新系统', min: 1, max: 100, desc: '每次检查最多补多少人（步进）；海关原版 4。' },
  botStart: { type: 'tuning', label: '开局多少秒开始刷', system: '新系统', min: 0, max: 86400, desc: '开局后多少秒开始允许新系统补刷；海关原版 20。' },
  botStop: { type: 'tuning', label: '开局多少秒停止刷', system: '新系统', min: 0, max: 86400, desc: '开局后多少秒彻底停止补刷；海关原版 1500（25 分钟）。' },
  maxBotPerZone: { type: 'tuning', label: '单区域同屏上限', system: '新系统', min: 0, max: 100, desc: '同一个刷新区域内最多同时存在多少 AI；海关原版 4。' },
  nonWaveSpawnBotsLimitPerPlayer: { type: 'tuning', label: '非波次补刷/玩家上限', system: '新系统', min: 0, max: 100, desc: '每名玩家允许的「临场补刷」上限，设 0 可以堵掉新系统的临场补人。' },
  distToActivate: { type: 'tuning', label: '激活距离（米）', system: '新系统', min: 1, max: 5000, desc: '玩家进入这个距离才会激活该刷新点；海关原版 265。' },
  distToSleep: { type: 'tuning', label: '休眠距离（米）', system: '新系统', min: 1, max: 5000, desc: '玩家离开这个距离后刷新点休眠；海关原版 300。' },
  waveSlotsMin: { type: 'tuning', label: 'Scav 波人数下限覆盖', system: '旧系统', min: 0, max: 30, desc: '直接覆盖 Scav 波的人数下限（不乘倍率），可把 18 条 wave 压成每波 1~2 人。' },
  waveSlotsMax: { type: 'tuning', label: 'Scav 波人数上限覆盖', system: '旧系统', min: 0, max: 30, desc: '直接覆盖 Scav 波的人数上限（不乘倍率）。' },
  newSpawn: { type: 'tuningBool', label: '新刷新系统', system: '系统开关', desc: '是否启用新刷新系统（周期检查 + 刷怪窗口）。与新/旧可同时开。' },
  oldSpawn: { type: 'tuningBool', label: '旧刷新系统', system: '系统开关', desc: '是否启用旧刷新系统（地图 waves 波次表）。' },
  newSpawnForPlayers: { type: 'tuningBool', label: '新系统跟随玩家', system: '系统开关', desc: '玩家在场时是否也走新系统；关闭 = 只有离线 / 无头端用新系统补刷。' },
  offlineNewSpawn: { type: 'tuningBool', label: '离线局：新刷新系统', system: '系统开关', desc: '离线战局（单机 / 无头主机）是否启用新刷新系统。' },
  offlineOldSpawn: { type: 'tuningBool', label: '离线局：旧刷新系统', system: '系统开关', desc: '离线战局是否启用旧刷新系统（waves 波次表）。' },
};

/** 参数页的分组顺序与一句话说明 */
export const ACTION_GROUPS = [
  { key: '系统开关', hint: '决定这一局里哪套刷新系统在工作；两套可以同时开，也可以都关掉（只剩 mod 强制投放的内容）。' },
  { key: '旧系统', hint: '读地图 base.json 的 waves：每条 wave 有固定触发时间、点位区域和人数。SPT 4.0 的 waves 时间几乎都是 -1，等于开局一次性全部触发。' },
  { key: '新系统', hint: '周期性补刷：每隔「检查间隔」看一次，在「刷怪窗口」内尝试补人，同时受单区域上限和同屏上限约束。' },
  { key: '首领/PMC', hint: 'BossLocationSpawn 列表：首领、随从、PMC、gifter、竞技场事件都在这里；PMC 的档位来自 SPT_Data\\configs\\pmc.json。' },
  { key: '上限', hint: '同屏硬上限 maxBotCap 来自 SPT_Data\\configs\\bot.json，和单区域上限是两回事。' },
];

/** 地图级参数：多条规则命中时后面的覆盖前面的 */
export const TUNING_KEYS = Object.keys(ACTION_DEFS).filter((k) => ACTION_DEFS[k].type === 'tuning' || ACTION_DEFS[k].type === 'tuningBool');

const MAP_ALIASES = {
  factory4_day: ['工厂', '工厂白天', 'factory', 'factory4', 'factory4_day'],
  factory4_night: ['工厂夜晚', '夜factory', 'factory4_night'],
  bigmap: ['海关', 'customs', 'bigmap'],
  woods: ['森林', 'woods'],
  shoreline: ['海岸线', 'shoreline'],
  interchange: ['立交桥', 'interchange'],
  rezervbase: ['储备站', 'reserve', 'rezervbase'],
  lighthouse: ['灯塔', 'lighthouse'],
  laboratory: ['实验室', 'labs', 'lab', 'laboratory'],
  tarkovstreets: ['街区', '塔科夫街区', 'streets', 'tarkovstreets'],
  sandbox: ['沙盒', '中心区', 'groundzero', 'ground_zero', 'sandbox'],
  sandbox_high: ['沙盒高级', '中心区高级', '中心区（高级）', 'groundzero_high', 'sandbox_high'],
  labyrinth: ['迷宫', 'labyrinth'],
};

const ALL_MAP_WORDS = new Set(['*', 'any', 'all', '全部', '所有']);

/** 去掉 JSONC 的注释与尾逗号，尽量不破坏字符串内容 */
export function stripJsonc(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '"') { j++; break; }
        j++;
      }
      out += text.slice(i, j);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      out += c;
      i++;
    }
  }
  // 尾逗号（字符串外的 , 后面紧跟 } 或 ]）
  return out.replace(/,(\s*[}\]])/g, '$1');
}

export function rulesPaths(root) {
  const modDir = path.join(root, 'SPT', 'user', 'mods', MOD_DIR_NAME);
  return {
    modDir,
    config: path.join(modDir, 'config.json'),
    dll: path.join(modDir, `${MOD_DIR_NAME}.dll`),
    backups: path.join(BACKUP_DIR, 'configs'),
  };
}

/**
 * 推荐规则集：按「战局档位」一条一条来，互不重叠，管理器的“载入推荐规则”和
 * 全新安装的默认配置都用这一份。每条都带一句人话说明（description），
 * NoAIBots 读取时会忽略这个字段，只用来在界面上显示。
 */
export const RULE_CATALOG = [
  {
    name: '无AI：整局不刷任何AI',
    description: '匹配「无AI」档位。清空 scav 波次与所有刷新点（含 PMC、首领、Goon），同屏上限归零。',
    match: { botAmounts: ['NoBots'] },
    actions: { clearScavWaves: true, clearBossSpawns: true, botCapScale: 0 },
  },
  {
    name: '在线：保持原版节奏',
    description: '匹配「同在线」档位。不改任何参数，就是 SPT 原版：PMC 按 pmc.json 的时间档（30 秒起）来，scav 走原版动态刷新。',
    match: { botAmounts: ['AsOnline'] },
    actions: {},
  },
  {
    name: '低：少量AI（上限减半、概率减半）',
    description: '匹配「低」档位。同屏上限 ×0.5（海关 26→13），PMC/首领概率 ×0.5，开局延迟 60 秒再开始刷。',
    match: { botAmounts: ['Low'] },
    actions: { botCapScale: 0.5, pmcWaveChanceScale: 0.5, bossChanceScale: 0.5, delaySpawnsSeconds: 60 },
  },
  {
    name: '中：标准节奏 + 成波刷新（海关）',
    description: '匹配「中等」+ 海关。每 5 秒检查，开窗 60~90 秒成波刷，停歇 4~5 分钟；关掉新刷新系统与临场补刷，只保留 3 只/玩家的波次外补刷。其他地图不受影响。',
    match: { maps: ['bigmap'], botAmounts: ['Medium'] },
    actions: {
      botSpawnPeriodCheck: 5,
      botSpawnTimeOnMin: 60,
      botSpawnTimeOnMax: 90,
      botSpawnTimeOffMin: 240,
      botSpawnTimeOffMax: 300,
      maxBotPerZone: 4,
      nonWaveSpawnBotsLimitPerPlayer: 3,
      newSpawn: false,
      oldSpawn: true,
      offlineNewSpawn: false,
    },
  },
  {
    name: '高：更多AI（上限×1.5、波次更密）',
    description: '匹配「高」档位。同屏上限 ×1.5，scav 每波人数 ×1.5，PMC/首领概率 ×1.5，PMC 波次上限 20 条。',
    match: { botAmounts: ['High'] },
    actions: { botCapScale: 1.5, scavWaveCountScale: 1.5, pmcWaveChanceScale: 1.5, bossChanceScale: 1.5, maxPmcWaves: 20 },
  },
  {
    name: '排山倒海：最大压力',
    description: '匹配「排山倒海」档位。同屏上限 ×2，scav 每波人数 ×2，PMC/首领概率 ×2，PMC 最多 24 条、首领最多 10 个刷新点。',
    match: { botAmounts: ['Horde'] },
    actions: { botCapScale: 2, scavWaveCountScale: 2, pmcWaveChanceScale: 2, bossChanceScale: 2, maxPmcWaves: 24, maxBossSpawns: 10 },
  },
  {
    name: '客户端关闭首领：只删首领波',
    description: '任意档位，只要客户端把「首领」开关关掉就命中。只删 boss 开头的首领波，PMC 与 scav 保留。',
    match: { clientBossesDisabled: true },
    actions: { removeBossWaves: true },
  },
];

const cloneRules = (rules) => JSON.parse(JSON.stringify(rules));

export function defaultConfig() {
  return {
    enabled: true,
    mode: 'followVanilla',
    blockBotGeneration: true,
    logRemovals: true,
    rules: cloneRules(RULE_CATALOG),
  };
}

function readConfigFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(stripJsonc(raw));
  } catch {
    return null;
  }
}

const asBool = (v) => (v === true || v === false ? v : undefined);
const clampNum = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(min, Math.min(max, n));
};
const trimName = (v, i) => {
  const s = String(v == null ? '' : v).trim();
  return (s || `规则 ${i + 1}`).slice(0, 60);
};

/** 校验并补全配置，保证写进 mod 的文件永远是合法结构 */
export function normalizeConfig(input) {
  const src = input && typeof input === 'object' ? input : {};
  const cfg = { ...defaultConfig(), ...src };

  cfg.enabled = src.enabled === false ? false : true;
  cfg.mode = ['followVanilla', 'forceNoAI', 'passthrough'].includes(src.mode) ? src.mode : 'followVanilla';
  cfg.blockBotGeneration = src.blockBotGeneration === false ? false : true;
  cfg.logRemovals = src.logRemovals === false ? false : true;

  const rules = Array.isArray(src.rules) ? src.rules.slice(0, 40) : defaultConfig().rules;
  cfg.rules = rules.map((r, i) => {
    const rule = r && typeof r === 'object' ? r : {};
    const matchIn = rule.match && typeof rule.match === 'object' ? rule.match : {};
    const actionsIn = rule.actions && typeof rule.actions === 'object' ? rule.actions : {};

    const match = {};
    const maps = Array.isArray(matchIn.maps)
      ? matchIn.maps.map((m) => String(m).trim()).filter(Boolean)
      : typeof matchIn.maps === 'string' && matchIn.maps.trim() ? [matchIn.maps.trim()] : [];
    if (maps.length) match.maps = maps;

    const amounts = Array.isArray(matchIn.botAmounts)
      ? matchIn.botAmounts.map((a) => canonicalAmount(a)).filter(Boolean)
      : typeof matchIn.botAmounts === 'string' ? [canonicalAmount(matchIn.botAmounts)].filter(Boolean) : [];
    if (amounts.length) match.botAmounts = amounts;

    const bossesDisabled = asBool(matchIn.clientBossesDisabled);
    if (bossesDisabled !== undefined) match.clientBossesDisabled = bossesDisabled;

    const actions = {};
    for (const [key, def] of Object.entries(ACTION_DEFS)) {
      const v = actionsIn[key];
      if (v === undefined || v === null) continue;
      if (def.type === 'bool') {
        if (v === true) actions[key] = true;
      } else if (def.type === 'tuningBool') {
        if (v === true || v === false) actions[key] = v;
      } else if (def.type === 'names') {
        const names = Array.isArray(v) ? v : String(v).split(/[,，\s]+/);
        const clean = names.map((x) => String(x).trim()).filter(Boolean).slice(0, 40);
        if (clean.length) actions[key] = clean;
      } else if (def.type === 'schedule') {
        const rows = Array.isArray(v) ? v.slice(0, 24) : [];
        const clean = [];
        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          const time = clampNum(row.time, -1, 86400);
          if (time === undefined) continue;
          const chance = clampNum(row.chance, 0, 100);
          const escort = clampNum(row.escort, 1, 30);
          const boss = String(row.boss ?? '').trim().slice(0, 40);
          const zone = String(row.zone ?? '').trim().slice(0, 120);
          const item = {};
          if (boss) item.boss = boss;
          item.time = time;
          item.chance = chance === undefined ? 100 : chance;
          item.escort = escort === undefined ? 1 : escort;
          if (zone) item.zone = zone;
          clean.push(item);
        }
        if (clean.length) actions[key] = clean;
      } else {
        const num = clampNum(v, def.min ?? (key.endsWith('Scale') ? 0 : -10000), def.max ?? 10000);
        // 等于默认值（倍率 1）的动作不写进文件，保持配置干净
        if (num !== undefined && !(def.def !== undefined && num === def.def)) actions[key] = num;
      }
    }

    const description = typeof rule.description === 'string' ? rule.description.trim().slice(0, 240) : '';

    return {
      name: trimName(rule.name, i),
      enabled: rule.enabled === false ? false : true,
      ...(description ? { description } : {}),
      match,
      actions,
    };
  });

  return cfg;
}

export function canonicalAmount(v) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  const lower = s.toLowerCase();
  const hit = BOT_AMOUNTS.find((a) => a.toLowerCase() === lower || BOT_AMOUNT_LABEL[a] === s);
  if (hit) return hit;
  if (['*', 'any', 'all', '全部', '所有'].includes(lower)) return '*';
  return undefined;
}

function expandMaps(list) {
  const out = new Set();
  for (const raw of list || []) {
    const s = String(raw).trim();
    if (!s) continue;
    if (ALL_MAP_WORDS.has(s.toLowerCase())) return null; // null = 匹配全部地图
    const key = Object.keys(MAP_ALIASES).find((id) => id === s || MAP_ALIASES[id].some((a) => a.toLowerCase() === s.toLowerCase()));
    if (key) out.add(key);
    else out.add(s);
  }
  return out.size ? out : null;
}

/** 单条规则是否命中某次开战场景 */
export function matchRule(rule, scenario) {
  if (!rule || rule.enabled === false) return false;
  const m = rule.match || {};
  const map = String(scenario.map || '').toLowerCase();

  if (m.maps && m.maps.length) {
    const maps = expandMaps(m.maps);
    if (maps && !maps.has(map)) return false;
  }
  if (m.botAmounts && m.botAmounts.length) {
    const amount = canonicalAmount(scenario.botAmount);
    const wildcard = m.botAmounts.includes('*');
    if (!wildcard && (!amount || !m.botAmounts.includes(amount))) return false;
  }
  if (m.clientBossesDisabled !== undefined) {
    if (!!scenario.bossesDisabled !== !!m.clientBossesDisabled) return false;
  }
  return true;
}

/** 合并命中规则的参数：倍率相乘、增减相加、上限取最小、延迟取最大 */
export function mergeActions(rules) {
  const merged = {
    clearScavWaves: false,
    clearBossSpawns: false,
    removePmcWaves: false,
    removeBossWaves: false,
    removeBotNames: [],
    scavWaveCountScale: 1,
    scavWaveCountDelta: 0,
    pmcWaveChanceScale: 1,
    bossChanceScale: 1,
    maxPmcWaves: null,
    maxBossSpawns: null,
    delaySpawnsSeconds: 0,
    botCapScale: 1,
    pmcSchedule: null,
    tuning: {},
  };
  for (const rule of rules) {
    const a = rule.actions || {};
    if (a.clearScavWaves) merged.clearScavWaves = true;
    if (a.clearBossSpawns) merged.clearBossSpawns = true;
    if (a.removePmcWaves) merged.removePmcWaves = true;
    if (a.removeBossWaves) merged.removeBossWaves = true;
    if (Array.isArray(a.removeBotNames)) merged.removeBotNames.push(...a.removeBotNames);
    if (Number.isFinite(a.scavWaveCountScale)) merged.scavWaveCountScale *= a.scavWaveCountScale;
    if (Number.isFinite(a.scavWaveCountDelta)) merged.scavWaveCountDelta += a.scavWaveCountDelta;
    if (Number.isFinite(a.pmcWaveChanceScale)) merged.pmcWaveChanceScale *= a.pmcWaveChanceScale;
    if (Number.isFinite(a.bossChanceScale)) merged.bossChanceScale *= a.bossChanceScale;
    if (Number.isFinite(a.maxPmcWaves)) merged.maxPmcWaves = merged.maxPmcWaves === null ? a.maxPmcWaves : Math.min(merged.maxPmcWaves, a.maxPmcWaves);
    if (Number.isFinite(a.maxBossSpawns)) merged.maxBossSpawns = merged.maxBossSpawns === null ? a.maxBossSpawns : Math.min(merged.maxBossSpawns, a.maxBossSpawns);
    if (Number.isFinite(a.delaySpawnsSeconds)) merged.delaySpawnsSeconds = Math.max(merged.delaySpawnsSeconds, a.delaySpawnsSeconds);
    if (Number.isFinite(a.botCapScale)) merged.botCapScale *= a.botCapScale;
    if (Array.isArray(a.pmcSchedule) && a.pmcSchedule.length) merged.pmcSchedule = a.pmcSchedule;
    for (const key of TUNING_KEYS) {
      if (a[key] !== undefined && a[key] !== null) merged.tuning[key] = a[key];
    }
  }
  merged.removeBotNames = [...new Set(merged.removeBotNames)];
  return merged;
}

const isPmc = (name) => name === 'pmcUSEC' || name === 'pmcBEAR';
const isBoss = (name) => typeof name === 'string' && name.toLowerCase().startsWith('boss');

/** 读客户端启动器里配置的服务端地址，判断本机是否就是服务端（远程联机时 mod 要装在对方机器上） */
function readClientServer(root) {
  const file = path.join(root, 'SPT', 'user', 'launcher', 'config.json');
  try {
    if (!isFile(file)) return { url: null, remote: null };
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const url = data?.Server?.Url || data?.server?.url || null;
    if (!url) return { url: null, remote: null };
    const remote = !/^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/i.test(String(url).trim());
    return { url: String(url), remote };
  } catch {
    return { url: null, remote: null };
  }
}

/** 读取本机 mod 配置与安装状态 */
export function readRules(root) {
  const p = rulesPaths(root);
  const dllExists = isFile(p.dll);
  const configExists = isFile(p.config);
  const cfgRaw = configExists ? readConfigFile(p.config) : null;

  let config = null;
  let parseError = null;
  if (configExists && !cfgRaw) parseError = 'config.json 解析失败（可能有 JSON 语法错误），显示的是默认规则';
  config = normalizeConfig(cfgRaw || defaultConfig());

  const backups = listBackups(root);
  const clientServer = readClientServer(root);

  let dllVersion = null;
  if (dllExists) {
    try { dllVersion = readDllMeta(p.dll).version || null; } catch { dllVersion = null; }
  }

  return {
    installed: dllExists,
    configExists,
    parseError,
    modDir: p.modDir,
    configPath: p.config,
    dllPath: p.dll,
    dllVersion,
    dllSize: dllExists ? fs.statSync(p.dll).size : null,
    dllMtime: dllExists ? fs.statSync(p.dll).mtimeMs : null,
    configMtime: configExists ? fs.statSync(p.config).mtimeMs : null,
    clientServerUrl: clientServer.url,
    clientServerRemote: clientServer.remote,
    config,
    backups,
  };
}

// ---- 每张地图的「当前原版值」：给管理器页面显示灰字用（不是配置文件，只是参考值）
// 数据来自 <SPT 根>\SPT\SPT_Data\database\locations\<map>\base.json
const TUNING_SOURCE_KEYS = [
  'BotSpawnPeriodCheck', 'BotSpawnTimeOnMin', 'BotSpawnTimeOnMax',
  'BotSpawnTimeOffMin', 'BotSpawnTimeOffMax', 'BotSpawnCountStep',
  'BotStart', 'BotStop', 'MaxBotPerZone',
  'NewSpawn', 'OldSpawn', 'NewSpawnForPlayers', 'OfflineNewSpawn', 'OfflineOldSpawn',
];
const MODIFIER_SOURCE_KEYS = ['DistToActivate', 'DistToSleep', 'NonWaveSpawnBotsLimitPerPlayer'];
const DEFAULTS_CACHE = new Map();

/** 返回 { 地图 id: { botSpawnPeriodCheck: 15, distToActivate: 265, newSpawn: true, ... } }，按 base.json 的 mtime 缓存 */
export function mapDefaults(root) {
  const dir = path.join(root, 'SPT', 'SPT_Data', 'database', 'locations');
  const out = {};
  let ids = [];
  try {
    ids = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return out;
  }

  for (const id of ids) {
    const file = path.join(dir, id, 'base.json');
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }

    const cached = DEFAULTS_CACHE.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      out[id] = cached.values;
      continue;
    }

    let base;
    try {
      base = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      continue;
    }

    const values = {};
    for (const key of TUNING_SOURCE_KEYS) {
      const v = base[key];
      if (v !== undefined && v !== null) values[key[0].toLowerCase() + key.slice(1)] = v;
    }
    const modifier = base.BotLocationModifier || {};
    for (const key of MODIFIER_SOURCE_KEYS) {
      const v = modifier[key];
      if (v !== undefined && v !== null) values[key[0].toLowerCase() + key.slice(1)] = v;
    }

    DEFAULTS_CACHE.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, values });
    out[id] = values;
  }

  return out;
}

export function writeRules(root, input) {
  const p = rulesPaths(root);
  const config = normalizeConfig(input);
  fs.mkdirSync(p.modDir, { recursive: true });
  const existed = isFile(p.config);
  writeJson(p.config, config, { backup: existed });
  return {
    config,
    path: p.config,
    savedAt: Date.now(),
    backups: listBackups(root),
  };
}

/** 只保存一条规则（按磁盘上的当前配置替换该条），返回规范化后的整份配置 */
export function writeRule(root, index, ruleInput) {
  const p = rulesPaths(root);
  const cfgRaw = isFile(p.config) ? readConfigFile(p.config) : null;
  const base = normalizeConfig(cfgRaw || defaultConfig());
  const idx = Number(index);
  if (!Number.isInteger(idx) || idx < 0 || idx >= base.rules.length) {
    throw new Error(`规则序号 ${index} 无效（当前共 ${base.rules.length} 条，页面可能已过期，刷新后再试）`);
  }
  const rules = base.rules.slice();
  rules[idx] = ruleInput;
  const next = normalizeConfig({ ...base, rules });
  fs.mkdirSync(p.modDir, { recursive: true });
  writeJson(p.config, next, { backup: true });
  return {
    config: next,
    rule: next.rules[idx],
    index: idx,
    path: p.config,
    savedAt: Date.now(),
    backups: listBackups(root),
  };
}

/** PMC 档案：清洗用户输入（阵营百分比 / 等级区间 / 难度 / 血量 / 技能 / 每图覆盖） */
export function normalizePmcProfile(input) {
  const mapIds = ['factory4_day', 'factory4_night', 'bigmap', 'woods', 'shoreline', 'interchange', 'rezervbase', 'lighthouse', 'laboratory', 'tarkovstreets', 'sandbox', 'sandbox_high', 'labyrinth'];
  const src = input && typeof input === 'object' ? input : {};
  const num = (v, min, max) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  };
  const intOrNull = (v, min, max) => {
    const n = num(v, min, max);
    return n === null ? null : Math.round(n);
  };
  const difficulty = ['', 'easy', 'normal', 'hard', 'impossible', 'AsOnline'].includes(String(src.difficulty || ''))
    ? String(src.difficulty || '')
    : '';
  const skills = {};
  if (src.skills && typeof src.skills === 'object') {
    for (const [k, v] of Object.entries(src.skills)) {
      if (!COMMON_SKILLS.includes(k)) continue;
      const n = num(v, 0, 50);
      if (n !== null && n > 0) skills[k] = Math.round(n);
    }
  }
  const maps = {};
  if (src.maps && typeof src.maps === 'object') {
    for (const [id, m] of Object.entries(src.maps)) {
      if (!mapIds.includes(id) || !m || typeof m !== 'object') continue;
      const entry = {
        usecPercent: num(m.usecPercent, 0, 100),
        levelMode: ['relative', 'absolute', 'map'].includes(m.levelMode) ? m.levelMode : null,
        levelMin: intOrNull(m.levelMin, 1, 79),
        levelMax: intOrNull(m.levelMax, 1, 79),
        levelDeltaMin: intOrNull(m.levelDeltaMin, -79, 79),
        levelDeltaMax: intOrNull(m.levelDeltaMax, -79, 79),
        difficulty: ['', 'easy', 'normal', 'hard', 'impossible', 'AsOnline'].includes(String(m.difficulty || '')) ? String(m.difficulty || '') : '',
        healthScale: num(m.healthScale, 0.1, 5),
      };
      if (entry.levelMin !== null && entry.levelMax !== null && entry.levelMin > entry.levelMax) {
        [entry.levelMin, entry.levelMax] = [entry.levelMax, entry.levelMin];
      }
      const clean = Object.fromEntries(Object.entries(entry).filter(([, v]) => v !== null && v !== ''));
      if (Object.keys(clean).length) maps[id] = clean;
    }
  }
  const levelMin = intOrNull(src.levelMin, 1, 79);
  const levelMax = intOrNull(src.levelMax, 1, 79);
  const profile = {
    enabled: !!src.enabled,
    usecPercent: num(src.usecPercent, 0, 100),
    levelMode: ['relative', 'absolute', 'map'].includes(src.levelMode) ? src.levelMode : null,
    levelMin: levelMin !== null && levelMax !== null ? Math.min(levelMin, levelMax) : levelMin,
    levelMax: levelMin !== null && levelMax !== null ? Math.max(levelMin, levelMax) : levelMax,
    levelDeltaMin: intOrNull(src.levelDeltaMin, -79, 79),
    levelDeltaMax: intOrNull(src.levelDeltaMax, -79, 79),
    difficulty,
    healthScale: num(src.healthScale, 0.1, 5),
    skills,
    maps,
  };
  return Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== null && v !== '' && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)));
}

/** 只保存 PMC 档案，不动规则列表 */
export function writePmcProfile(root, input) {
  const p = rulesPaths(root);
  const cfgRaw = isFile(p.config) ? readConfigFile(p.config) : null;
  const base = normalizeConfig(cfgRaw || defaultConfig());
  const profile = normalizePmcProfile(input);
  const next = { ...base, pmcProfile: { ...profile, enabled: !!profile.enabled } };
  fs.mkdirSync(p.modDir, { recursive: true });
  writeJson(p.config, next, { backup: true });
  return { pmcProfile: next.pmcProfile, path: p.config, savedAt: Date.now(), backups: listBackups(root) };
}

export function listBackups(root) {
  const dir = rulesPaths(root).backups;  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => /^config\.json\..+\.bak$/.test(f));
  } catch { return []; }
  return files
    .map((name) => {
      const full = path.join(dir, name);
      let mtime = 0;
      try { mtime = fs.statSync(full).mtimeMs; } catch { /* ignore */ }
      return { name, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 30);
}

export function restoreBackup(root, name) {  const dir = rulesPaths(root).backups;
  const base = path.basename(String(name || ''));
  if (!/^config\.json\..+\.bak$/.test(base)) throw new Error('备份文件名不合法');
  const full = path.join(dir, base);
  if (!isFile(full)) throw new Error('备份不存在: ' + base);
  const cfg = readConfigFile(full);
  if (!cfg) throw new Error('备份文件不是合法 JSON');
  return { ...writeRules(root, cfg), restoredFrom: base };
}

function mapBaseFile(root, map) {
  return path.join(root, 'SPT', 'SPT_Data', 'database', 'locations', String(map || ''), 'base.json');
}

function botCaps(root) {
  const cfg = readJson(path.join(root, 'SPT', 'SPT_Data', 'configs', 'bot.json'), null) || {};
  return cfg.maxBotCap || {};
}

/**
 * 预演：用当前（未保存的）配置模拟一次开战会产生什么效果。
 * 只读地图 base.json（0.2MB 左右），不会修改任何文件。
 */
export function previewRules(root, input, scenario = {}) {
  const cfg = input ? normalizeConfig(input) : readRules(root).config;
  const map = String(scenario.map || 'bigmap');
  const botAmount = canonicalAmount(scenario.botAmount) || 'AsOnline';
  const bossesDisabled = !!scenario.bossesDisabled;

  let matched = cfg.rules.filter((r) => matchRule(r, { map, botAmount, bossesDisabled }));
  const notes = [];

  if (cfg.mode === 'passthrough') {
    matched = [];
    notes.push('mode=passthrough：所有规则都会被跳过');
  } else if (cfg.mode === 'forceNoAI') {
    matched = [{ name: 'mode=forceNoAI（强制整局无AI）', actions: { clearScavWaves: true, clearBossSpawns: true, botCapScale: 0 } }];
    notes.push('mode=forceNoAI：无论选什么档位都不刷 AI');
  }
  if (!cfg.enabled) notes.push('enabled=false：mod 整体关闭，规则不会生效');

  const merged = mergeActions(matched);

  let totalWaves = 0;
  let totalSpawns = 0;
  let pmcSpawns = 0;
  let bossSpawns = 0;
  let wavesAfter = 0;
  let spawnsAfter = 0;

  const baseFile = mapBaseFile(root, map);
  const base = isFile(baseFile) ? readJson(baseFile, null) : null;
  if (base) {
    const waves = Array.isArray(base.waves) ? base.waves : [];
    const spawns = Array.isArray(base.BossLocationSpawn) ? base.BossLocationSpawn : [];
    totalWaves = waves.length;
    totalSpawns = spawns.length;
    pmcSpawns = spawns.filter((s) => isPmc(s.BossName)).length;
    bossSpawns = spawns.filter((s) => isBoss(s.BossName)).length;

    let pmcKept = 0;
    let bossKept = 0;
    let otherKept = 0;
    for (const s of spawns) {
      const name = s.BossName;
      if (merged.clearBossSpawns) continue;
      if (merged.removePmcWaves && isPmc(name)) continue;
      if (merged.removeBossWaves && isBoss(name)) continue;
      if (merged.removeBotNames.includes(name)) continue;
      if (isPmc(name)) pmcKept++;
      else if (isBoss(name)) bossKept++;
      else otherKept++;
    }
    let kept = pmcKept + bossKept + otherKept;
    if (merged.pmcSchedule) {
      const pmcRows = merged.pmcSchedule.filter((r) => !r.boss);
      const bossRows = merged.pmcSchedule.filter((r) => r.boss);
      if (pmcRows.length) {
        notes.push(`PMC 自定义时间表：按配置生成 ${pmcRows.length} 个档位（原 ${spawns.filter((s) => isPmc(s.BossName)).length} 条 PMC 档位会被替换）`);
        kept -= pmcKept;
        pmcKept = pmcRows.length;
        kept += pmcKept;
      }
      if (bossRows.length) {
        const names = [...new Set(bossRows.map((r) => String(r.boss).toLowerCase()))];
        const label = new Map();
        for (const r of bossRows) {
          const key = String(r.boss).toLowerCase();
          if (!label.has(key)) label.set(key, String(r.boss));
        }
        const present = new Set(spawns.map((s) => String(s.BossName || '').toLowerCase()));
        const missing = names.filter((n) => !present.has(n));
        for (const name of names) {
          const original = spawns.filter((s) => String(s.BossName || '').toLowerCase() === name).length;
          if (!original) continue;
          const rows = bossRows.filter((r) => String(r.boss).toLowerCase() === name).length;
          kept += rows - original;
          if (isBoss(name)) bossKept += rows - original;
          else otherKept += rows - original;
        }
        const replaced = names.filter((n) => present.has(n)).map((n) => label.get(n));
        if (replaced.length) notes.push(`首领自定义时间表：${bossRows.length - bossRows.filter((r) => missing.includes(String(r.boss).toLowerCase())).length} 个档位（${replaced.join(' / ')}）会替换这些首领原有的刷新点`);
        if (missing.length) notes.push(`首领自定义时间表：${missing.map((n) => label.get(n)).join(' / ')} 在这张图原版没有刷新点，对应行会被 mod 跳过（不会凭空刷出来）`);
      }
    }
    if (merged.maxPmcWaves !== null) {
      const over = Math.max(0, pmcKept - merged.maxPmcWaves);
      kept -= over;
      notes.push(`PMC 波次上限 ${merged.maxPmcWaves}：删掉 ${over} 条`);
    }
    if (merged.maxBossSpawns !== null) {
      const over = Math.max(0, bossKept - merged.maxBossSpawns);
      kept -= over;
      notes.push(`首领刷新点上限 ${merged.maxBossSpawns}：删掉 ${over} 条`);
    }
    spawnsAfter = kept;
    wavesAfter = merged.clearScavWaves ? 0 : totalWaves;

    // 预演 Scav 波人数（与 mod 的算法一致：绝对覆盖 → 倍率 → 增减 → 0 人的波删掉）
    if (!merged.clearScavWaves && waves.length) {
      let beforeBots = 0;
      let afterBots = 0;
      let dropped = 0;
      const tuning = merged.tuning || {};
      for (const w of waves) {
        const min0 = Number(w.slots_min) || 0;
        const max0 = Number(w.slots_max ?? w.slots_min) || 0;
        beforeBots += (min0 + (max0 || min0)) / 2;

        if (max0 <= 0) continue; // 0 人占位波不参与缩放/覆盖
        let min = Number.isFinite(tuning.waveSlotsMin) ? tuning.waveSlotsMin : min0;
        let max = Number.isFinite(tuning.waveSlotsMax) ? tuning.waveSlotsMax : (max0 || min);
        if (max < min) [min, max] = [max, min];

        const nMin = Math.max(0, Math.min(30, Math.round(min * merged.scavWaveCountScale) + merged.scavWaveCountDelta));
        const nMax = Math.max(nMin, Math.min(30, Math.round(max * merged.scavWaveCountScale) + merged.scavWaveCountDelta));
        afterBots += (nMin + nMax) / 2;
        if (nMax <= 0 && max0 > 0) dropped++;
      }
      wavesAfter = totalWaves - dropped;
      if (Math.abs(afterBots - beforeBots) > 0.01) {
        notes.push(`Scav 波每波人数合计 ${beforeBots.toFixed(1)} → ${afterBots.toFixed(1)}（保留 ${wavesAfter}/${totalWaves} 条波）`);
      }
      if (dropped) notes.push(`人数归零被删除的 Scav 波：${dropped} 条`);
    }
  } else {
    notes.push(`地图 ${map} 没有 base.json，无法预演波次数量`);
  }

  // 地图级刷新参数提示
  const tuningNotes = [];
  const tuning = merged.tuning || {};
  if (Number.isFinite(tuning.botSpawnPeriodCheck)) tuningNotes.push(`刷新检查间隔 ${tuning.botSpawnPeriodCheck}s（原版 15s）`);
  if (Number.isFinite(tuning.botSpawnTimeOnMin) || Number.isFinite(tuning.botSpawnTimeOnMax) || Number.isFinite(tuning.botSpawnTimeOffMin) || Number.isFinite(tuning.botSpawnTimeOffMax)) {
    const on = [tuning.botSpawnTimeOnMin ?? '—', tuning.botSpawnTimeOnMax ?? '—'].join('~');
    const off = [tuning.botSpawnTimeOffMin ?? '—', tuning.botSpawnTimeOffMax ?? '—'].join('~');
    tuningNotes.push(`刷新节奏：持续 ${on}s / 停歇 ${off}s`);
  }
  if (Number.isFinite(tuning.botSpawnCountStep)) tuningNotes.push(`每次刷新数量步进 ${tuning.botSpawnCountStep}`);
  if (Number.isFinite(tuning.botStart)) tuningNotes.push(`开局 ${tuning.botStart}s 后开始刷`);
  if (Number.isFinite(tuning.botStop)) tuningNotes.push(`开局 ${tuning.botStop}s 后停止刷`);
  if (Number.isFinite(tuning.maxBotPerZone)) tuningNotes.push(`单区域同屏上限 ${tuning.maxBotPerZone}`);
  if (Number.isFinite(tuning.nonWaveSpawnBotsLimitPerPlayer)) tuningNotes.push(`非波次补刷上限/玩家 ${tuning.nonWaveSpawnBotsLimitPerPlayer}`);
  if (Number.isFinite(tuning.distToActivate)) tuningNotes.push(`激活距离 ${tuning.distToActivate}m`);
  if (Number.isFinite(tuning.distToSleep)) tuningNotes.push(`休眠距离 ${tuning.distToSleep}m`);
  if (tuning.newSpawn !== undefined) tuningNotes.push(`新刷新系统 ${tuning.newSpawn ? '开' : '关'}`);
  if (tuning.oldSpawn !== undefined) tuningNotes.push(`旧刷新系统 ${tuning.oldSpawn ? '开' : '关'}`);
  if (tuning.newSpawnForPlayers !== undefined) tuningNotes.push(`新系统跟随玩家 ${tuning.newSpawnForPlayers ? '开' : '关'}`);
  if (Number.isFinite(tuning.waveSlotsMin) || Number.isFinite(tuning.waveSlotsMax)) {
    tuningNotes.push(`Scav 波人数覆盖：${tuning.waveSlotsMin ?? '—'} ~ ${tuning.waveSlotsMax ?? '—'}`);
  }
  notes.push(...tuningNotes);

  const capBefore = botCaps(root)[map] ?? botCaps(root).default ?? null;
  const capAfter = capBefore === null ? null : Math.round(capBefore * merged.botCapScale);

  if (merged.clearBossSpawns) notes.push('clearBossSpawns：首领/PMC/Goon 刷新点全部清空');
  if (merged.removePmcWaves) notes.push(`removePmcWaves：删除 PMC 波次 ${pmcSpawns} 条`);
  if (merged.removeBossWaves) notes.push(`removeBossWaves：删除首领波次 ${bossSpawns} 条`);
  if (merged.removeBotNames.length) notes.push(`removeBotNames：额外删除 ${merged.removeBotNames.join(', ')}`);
  if (merged.delaySpawnsSeconds > 0) notes.push(`开局延迟 ${merged.delaySpawnsSeconds} 秒刷怪`);
  if (merged.scavWaveCountScale !== 1) notes.push(`Scav 波人数 ×${+merged.scavWaveCountScale.toFixed(2)}`);
  if (merged.pmcWaveChanceScale !== 1) notes.push(`PMC 波概率 ×${+merged.pmcWaveChanceScale.toFixed(2)}`);
  if (merged.bossChanceScale !== 1) notes.push(`首领概率 ×${+merged.bossChanceScale.toFixed(2)}`);

  const allGone = !!base && wavesAfter === 0 && spawnsAfter === 0 && (capAfter === 0 || capAfter === null);
  return {
    scenario: { map, botAmount, bossesDisabled },
    matched: matched.map((r) => r.name),
    notes,
    counts: { totalWaves, totalSpawns, pmcSpawns, bossSpawns, wavesAfter, spawnsAfter },
    capBefore,
    capAfter,
    botCapScale: merged.botCapScale,
    tuning: merged.tuning,
    allGone,
    config: cfg,
    at: Date.now(),
  };
}

// ---- 每张地图的「刷新时间表」原始数据：给界面画时间轴用（只读）
// waves：旧刷新系统的波次（Time<0 表示开局立即）；bosses：base.json 的 BossLocationSpawn 非 PMC 条目；
// pmc：SPT 从 configs/pmc.json 注入的 customPmcWaves；加上该图原版节奏参数与同屏上限。
const SPAWN_CACHE = new Map();

function statOf(file) {
  try {
    const s = fs.statSync(file);
    return { mtimeMs: s.mtimeMs, size: s.size };
  } catch {
    return null;
  }
}

function readJsonCached(file) {
  const stat = statOf(file);
  if (!stat) return null;
  const cached = SPAWN_CACHE.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.value;
  let value = null;
  try {
    value = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    value = null;
  }
  SPAWN_CACHE.set(file, { ...stat, value });
  return value;
}

export function spawnData(root) {
  const locDir = path.join(root, 'SPT', 'SPT_Data', 'database', 'locations');
  const pmcCfg = readJsonCached(path.join(root, 'SPT', 'SPT_Data', 'configs', 'pmc.json')) || {};
  const pmcWaves = pmcCfg.customPmcWaves || {};
  const caps = botCaps(root);
  const maps = {};

  let ids = [];
  try {
    ids = fs.readdirSync(locDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return { maps, removeExistingPmcWaves: !!pmcCfg.removeExistingPmcWaves };
  }

  for (const id of ids) {
    const base = readJsonCached(path.join(locDir, id, 'base.json'));
    if (!base) continue;

    const waves = (Array.isArray(base.waves) ? base.waves : []).map((w) => ({
      type: w.WildSpawnType || w.wildSpawnType || 'assault',
      side: w.Side || w.side || null,
      tMin: Number.isFinite(w.time_min) ? w.time_min : -1,
      tMax: Number.isFinite(w.time_max) ? w.time_max : -1,
      min: Number.isFinite(w.slots_min) ? w.slots_min : 0,
      max: Number.isFinite(w.slots_max) ? w.slots_max : 0,
    }));

    const spawns = (Array.isArray(base.BossLocationSpawn) ? base.BossLocationSpawn : []).map((b) => ({
      name: b.BossName || b.bossName || '',
      chance: Number.isFinite(b.BossChance) ? b.BossChance : 0,
      time: Number.isFinite(b.Time) ? b.Time : -1,
      delay: Number.isFinite(b.Delay) ? b.Delay : 0,
      ignoreMaxBots: !!b.IgnoreMaxBots,
      escortMin: 0,
      escortMax: 0,
    }));
    const pmc = (Array.isArray(pmcWaves[id]) ? pmcWaves[id] : []).map((b) => {
      const escort = String(b.BossEscortAmount || '')
        .split(',')
        .map((x) => parseInt(x, 10))
        .filter((n) => Number.isFinite(n));
      return {
        name: b.BossName || '',
        chance: Number.isFinite(b.BossChance) ? b.BossChance : 0,
        time: Number.isFinite(b.Time) ? b.Time : -1,
        delay: Number.isFinite(b.Delay) ? b.Delay : 0,
        ignoreMaxBots: !!b.IgnoreMaxBots,
        escortMin: escort.length ? Math.min(...escort) : 0,
        escortMax: escort.length ? Math.max(...escort) : 0,
        zone: b.BossZone || '',
      };
    });

    const modifier = base.BotLocationModifier || {};
    maps[id] = {
      waves,
      bosses: spawns.filter((s) => !isPmc(s.name)),
      pmc,
      cap: caps[id] ?? caps.default ?? null,
      defaults: {
        botStart: base.BotStart ?? null,
        botStop: base.BotStop ?? null,
        botSpawnPeriodCheck: base.BotSpawnPeriodCheck ?? null,
        botSpawnTimeOnMin: base.BotSpawnTimeOnMin ?? null,
        botSpawnTimeOnMax: base.BotSpawnTimeOnMax ?? null,
        botSpawnTimeOffMin: base.BotSpawnTimeOffMin ?? null,
        botSpawnTimeOffMax: base.BotSpawnTimeOffMax ?? null,
        botSpawnCountStep: base.BotSpawnCountStep ?? null,
        maxBotPerZone: base.MaxBotPerZone ?? null,
        nonWaveSpawnBotsLimitPerPlayer: modifier.NonWaveSpawnBotsLimitPerPlayer ?? null,
        newSpawn: base.NewSpawn ?? null,
        oldSpawn: base.OldSpawn ?? null,
        offlineNewSpawn: base.OfflineNewSpawn ?? null,
        offlineOldSpawn: base.OfflineOldSpawn ?? null,
      },
    };
  }

  return { maps, removeExistingPmcWaves: !!pmcCfg.removeExistingPmcWaves };
}

/** base.json 里除首领/PMC 之外的「事件怪」（gifter / arenaFighterEvent 等） */
function isBossEsque(name) {
  return /gifter|arena|sectant|fanatic|peacemaker|infected|zombie/i.test(String(name || ''));
}

/** EFT 的常用技能（和游戏里的 SkillTypes 枚举同名），用于 PMC 档案的技能表 */
export const COMMON_SKILLS = [
  'Endurance', 'Strength', 'Vitality', 'Health', 'StressResistance', 'Metabolism',
  'Immunity', 'Perception', 'Intellect', 'Attention', 'Charisma', 'Memory',
  'MagDrills', 'Assault', 'AimMaster', 'RecoilControl', 'CovertMovement', 'FirstAid',
];

/** PMC 相关的原版配置：pmc.json + bots/types/pmcUSEC|pmcBEAR.json 的摘要 */
export function pmcInfo(root) {
  const sptData = path.join(root, 'SPT', 'SPT_Data');
  const pmcPath = path.join(sptData, 'configs', 'pmc.json');
  const pmc = readJsonCached(pmcPath) || {};
  const types = {};

  for (const id of ['pmcUSEC', 'pmcBEAR']) {
    const t = readJsonCached(path.join(sptData, 'database', 'bots', 'types', `${id}.json`));
    if (!t) continue;
    const health = {};
    const parts = Array.isArray(t.health?.BodyParts) ? t.health.BodyParts : [];
    const body = parts[0] || {};
    for (const [part, v] of Object.entries(body || {})) {
      health[part] = { min: v?.min ?? null, max: v?.max ?? null };
    }
    const vitals = {};
    for (const key of ['Hydration', 'Energy', 'Temperature']) {
      if (t.health?.[key]) vitals[key] = { min: t.health[key].min ?? null, max: t.health[key].max ?? null };
    }
    const diff = t.difficulty || {};
    types[id] = {
      level: t.experience?.level || null,
      health,
      vitals,
      skills: t.skills?.Common && typeof t.skills.Common === 'object' ? Object.keys(t.skills.Common) : [],
      difficulties: Object.keys(diff),
      difficultyValues: Object.fromEntries(
        Object.entries(diff).map(([k, groups]) => [
          k,
          Object.fromEntries(
            Object.entries(groups || {}).map(([g, vals]) => [g, Object.keys(vals || {}).length]),
          ),
        ]),
      ),
      equipment: t.chances?.equipment || {},
      generation: Object.keys(t.generation?.items || {}),
    };
  }

  const hostilityFor = (side) => {
    const h = pmc.hostilitySettings?.[side] || {};
    return {
      enemies: (h.additionalEnemyTypes || []).filter((x) => typeof x === 'string'),
      friends: (h.additionalFriendlyTypes || []).filter((x) => typeof x === 'string'),
      chanced: (h.chancedEnemies || []).map((x) => ({ role: x?.Role || x?.role, chance: x?.EnemyChance ?? x?.enemyChance })),
    };
  };

  return {
    path: pmcPath,
    isUsec: pmc.isUsec ?? null,
    useDifficultyOverride: !!pmc.useDifficultyOverride,
    difficulty: pmc.difficulty ?? null,
    botRelativeLevelDelta: pmc.botRelativeLevelDelta || null,
    locationSpecificPmcLevelOverride: pmc.locationSpecificPmcLevelOverride || {},
    pmcType: pmc.pmcType || {},
    accountTypeWeight: pmc.accountTypeWeight || {},
    gameVersionWeight: pmc.gameVersionWeight || {},
    removeExistingPmcWaves: !!pmc.removeExistingPmcWaves,
    hostility: { usec: hostilityFor('pmcusec'), bear: hostilityFor('pmcbear') },
    types,
  };
}
