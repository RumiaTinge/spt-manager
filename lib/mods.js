// mods.js — 扫描、启停、删除已安装模组；解析依赖关系
//
// SPT 4.x 的服务端模组没有 package.json / manifest.json，元数据全部编译进 DLL。
// 三层信息源，按可靠性排序：
//   1) SPT 服务端日志（SPT\user\logs\spt\*.log）：ModValidator 会逐条打印
//      "模组：<名称> 版本<版本> (GUID: <guid> | targets SPT: <约束>) 作者：<作者> 已加载"
//      —— 这是唯一 100% 准确的来源，含作者与 SPT 版本约束。
//   2) DLL 字节扫描（lib/dllmeta.js）：GUID / 名称 / 版本 / 约束常量。
//   3) 目录名兜底。
// 插件另有 BepInEx\config\<GUID>.cfg 与 LogOutput.log 的 "Loading [名称 版本]" 表。
import fs from 'node:fs';
import path from 'node:path';
import { readDllMeta, compareVersions } from './dllmeta.js';
import { moveDir, dirSize, BACKUP_DIR, nowStamp } from './core.js';

const GUID_RE = /^[a-z][a-z0-9_]{1,40}(\.[a-z0-9_\-]{1,40}){1,5}$/i;
const FILE_SUFFIX = /\.(dll|exe|json|jsonc|xml|txt|log|cs|bundle|png|jpg|md|pdb|config|cfg|ini|asset|csv|yml|yaml|dat)$/i;
const BLACKLIST = ['system.', 'microsoft.', 'newtonsoft.', 'semanticversioning', 'mono.', 'jetbrains.', 'sptarkov.', 'bepinex.', 'harmony', 'mscorlib', 'netstandard', 'unityengine.', 'eft.', 'unity.', 'bsg.'];
const INTERNAL_GUIDS = new Set(['com.spt.core', 'com.spt.custom', 'com.spt.singleplayer', 'com.spt.debugging', 'com.bepis.bepinex.configurationmanager', 'spt.core', 'spt.custom', 'spt.singleplayer', 'spt.debugging']);
const BAD_NAMES = new Set(['server', 'client', 'core', 'main', 'plugin', 'mod']);

function isGuidToken(s, { allowKnown = null } = {}) {
  if (!s || s.length < 4 || s.length > 60) return false;
  if (FILE_SUFFIX.test(s)) return false;
  if (/\d{2,}\.\d/.test(s)) return false;
  if (allowKnown && allowKnown.has(s)) return true;
  if (!GUID_RE.test(s)) return false;
  const low = s.toLowerCase();
  if (BLACKLIST.some((p) => low.startsWith(p))) return false;
  return true;
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** 解析服务端日志得到权威元数据：guid -> {name, version, sptRange, author} */
export function readServerLogMods(root) {
  const dir = path.join(root, 'SPT', 'user', 'logs', 'spt');
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.log'))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 3)
      .map((x) => path.join(dir, x.f));
  } catch { return new Map(); }

  const map = new Map();
  const rankOf = new Map(); // guid -> 来源文件序号（0 最新）
  const add = (guid, entry, rank, weak = false) => {
    if (!guid) return;
    const prev = map.get(guid);
    const prevRank = rankOf.get(guid);
    if (weak && prev && prev.version) return; // 兜底信息不覆盖完整条目
    if (prevRank === undefined || rank <= prevRank) {
      map.set(guid, entry);
      rankOf.set(guid, rank);
    }
  };

  for (let rank = 0; rank < files.length; rank++) {
    const file = files[rank];
    let txt = '';
    try { txt = fs.readFileSync(file, 'utf8'); } catch { continue; }

    // 全格式：模组：<名称> 版本<版本> (GUID: <guid> | targets SPT: <约束>) 作者：<作者>
    const reFull = /(?:模组|Mod)[：:]\s*([^\n(]{1,80}?)\s*(?:版本|version)\s*([0-9][^\s(]*)\s*\(GUID:\s*([^|\s)]+)\s*\|\s*targets SPT:\s*([^)]+?)\)\s*(?:作者|author)[：:]\s*([^\s,]+)/gi;
    let m;
    while ((m = reFull.exec(txt)) !== null) {
      add(m[3].trim(), {
        name: m[1].trim(),
        version: m[2].trim(),
        sptRange: m[4].trim(),
        author: m[5].trim(),
        source: 'log',
      }, rank);
    }
    // 兜底：只有 GUID + 约束
    const reMin = /\(GUID:\s*([^|\s)]+)\s*\|\s*targets SPT:\s*([^)]+?)\)/g;
    while ((m = reMin.exec(txt)) !== null) {
      add(m[1].trim(), { name: null, version: null, sptRange: m[2].trim(), author: null, source: 'log-min' }, rank, true);
    }
  }
  return map;
}

/** 已安装插件 GUID 集合（BepInEx 会为每个插件生成 <GUID>.cfg） */
export function readKnownPluginGuids(root) {
  const set = new Set();
  const dir = path.join(root, 'BepInEx', 'config');
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.cfg')) continue;
      const guid = f.slice(0, -4);
      if (isGuidToken(guid, { allowKnown: null }) || /^[0-9a-z][0-9a-z._\-]{3,60}$/i.test(guid)) set.add(guid);
    }
  } catch { /* ignore */ }
  return set;
}

/** 从 BepInEx 日志读取插件显示名与版本（权威） */
export function readPluginLogNames(root) {
  const map = new Map(); // 归一化名 -> {name, version}
  try {
    const txt = fs.readFileSync(path.join(root, 'BepInEx', 'LogOutput.log'), 'utf8');
    const re = /Loading \[(.+?) ([0-9][^\]]*)\]/g;
    let m;
    while ((m = re.exec(txt)) !== null) {
      map.set(norm(m[1]), { name: m[1], version: m[2] });
    }
  } catch { /* ignore */ }
  return map;
}

/** 过滤 DLL 字符串堆里混进来的类型名/类名，避免把 HollywoodGraphics.Plugin 当成作者 */
function saneAuthor(v, modName) {
  if (!v || typeof v !== 'string') return null;
  const a = v.trim();
  if (!a || a.length > 24) return null;
  if (a.includes('.')) return null;
  if (modName && a.toLowerCase() === String(modName).toLowerCase()) return null;
  if (/^(plugin|patch|patcher|loader|harmony|core|module|implementation|main|init)$/i.test(a)) return null;
  const caps = (a.match(/[A-Z]/g) || []).length;
  if (caps >= 3 && !/\s/.test(a) && !a.includes('_')) return null;
  return a;
}

function listDlls(dir, depth = 2) {  const out = [];
  const walk = (d, lvl) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (lvl > 0) walk(p, lvl - 1);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.dll')) {
        out.push(p);
      }
    }
  };
  walk(dir, depth);
  return out;
}

/** 最长公共子串长度（用于把 GUID 与文件夹名做相似度评分） */
function lcsLen(a, b) {
  if (!a || !b) return 0;
  let best = 0;
  const prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      if (a[i - 1] === b[j - 1]) {
        prev[j] = diag + 1;
        if (prev[j] > best) best = prev[j];
      } else prev[j] = 0;
      diag = tmp;
    }
  }
  return best;
}

/** 在候选里挑出“属于自己”的 GUID */
function pickOwnGuid({ guids16, guids8, knownGuids, folderName, logMap }) {
  const nf = norm(folderName);
  const known = [...knownGuids];
  const scored = [];
  const push = (g, bonus, from) => {
    if (!g || !nf) return;
    const score = lcsLen(norm(g), nf);
    scored.push({ g, from, score, weight: score * 100 + bonus });
  };
  for (const g of known) push(g, 50, 'known');
  for (const g of guids16) push(g, 20, 'utf16');
  for (const g of guids8) push(g, 5, 'utf8');
  scored.sort((a, b) => b.weight - a.weight);
  const best = scored[0];
  if (best && (best.score >= 4 || (best.from === 'known' && known.length === 1))) return best.g;

  // 服务端日志：GUID 或名称与文件夹名相关
  let bestLog = null;
  for (const [guid, entry] of logMap) {
    const s = Math.max(lcsLen(norm(guid), nf), lcsLen(norm(entry.name), nf));
    if (s >= 4 && (!bestLog || s > bestLog.s)) bestLog = { guid, s };
  }
  if (bestLog) return bestLog.guid;

  return guids16[0] || guids8[0] || null;
}

function buildModEntry({ dir, type, enabled, knownGuids, logNames, logMap }) {
  const folderName = path.basename(dir);
  const dlls = listDlls(dir);
  const metas = dlls.map((dll) => readDllMeta(dll));

  const serverMeta = metas.find((m) => m.isServerMod);
  const pluginMeta = metas.find((m) => m.isPlugin);
  const patcherMeta = metas.find((m) => m.isPatcher);
  const primary = type === 'server' ? (serverMeta || metas[0]) : (pluginMeta || metas[0]);

  const guids16 = [];
  const guids8 = [];
  for (const m of metas) {
    for (const g of m.guids16 || []) if (isGuidToken(g)) guids16.push(g);
    for (const g of m.guids8 || []) if (isGuidToken(g, { allowKnown: knownGuids })) guids8.push(g);
  }
  const uniq = (a) => [...new Set(a)];

  // 服务端模组用“元数据堆 + 服务端日志”判定；插件用“特性 blob + BepInEx cfg/日志”判定
  const isServerType = type === 'server';
  const ownGuid = pickOwnGuid({
    guids16: uniq(guids16),
    guids8: isServerType ? [] : uniq(guids8),
    knownGuids: isServerType ? new Set() : knownGuids,
    folderName,
    logMap,
  });

  // 日志元数据（最权威）
  const logEntry = (ownGuid && logMap.get(ownGuid)) || null;
  const nf = norm(folderName);
  const logByName = logNames.get(nf)
    || [...logNames.entries()].find(([k]) => k && nf && (k.includes(nf) || nf.includes(k)))?.[1]
    || null;

  // 依赖：DLL 里出现的其它 GUID
  //   hard = 元数据堆（UTF-16）里的 GUID —— 真实声明的前置
  //   soft = 特性/blob 堆（UTF-8）里的 GUID —— 可能是可选的联动支持
  const ownNorm = norm(ownGuid);
  const mkDep = (list) => uniq(list).filter((g) => {
    if (g === ownGuid) return false;
    const ng = norm(g);
    if (ownNorm && (ng.includes(ownNorm) || ownNorm.includes(ng))) return false;
    if (INTERNAL_GUIDS.has(g)) return false;
    const knownHere = knownGuids.has(g);
    return knownHere || g.split('.').length >= 3;
  });
  const dedupeSub = (list) => list.filter((g, i) => {
    const ng = norm(g);
    return !list.some((h, j) => j !== i && norm(h).includes(ng) && norm(h) !== ng);
  });
  const hardDeps = dedupeSub(mkDep(guids16));
  const softDeps = dedupeSub(mkDep(guids8)).filter((g) => !hardDeps.some((h) => norm(h).includes(norm(g))));
  const deps = uniq([...hardDeps, ...softDeps]);
  const unresolvedDeps = hardDeps.filter((g) => !knownGuids.has(g));

  // 名称/版本：服务端模组以服务端日志为准；插件以 BepInEx 日志为准
  let name = null;
  let version = null;
  let sptRange = null;
  let author = null;
  if (type === 'server') {
    if (logEntry && logEntry.name && !BAD_NAMES.has(logEntry.name.toLowerCase())) name = logEntry.name;
    name = name || (primary && primary.name) || folderName;
    version = (logEntry && logEntry.version) || (primary && primary.version) || null;
    sptRange = (logEntry && logEntry.sptRange) || (primary && primary.sptRange) || null;
    author = saneAuthor((logEntry && logEntry.author) || (primary && primary.author), name);
  } else {
    if (logByName && logByName.name) name = logByName.name;
    if (!name && primary && primary.name) name = primary.name;
    // 与已装插件共享 GUID 的服务端库，避免把服务端名当成插件名
    if (!name && logEntry && logEntry.name && !BAD_NAMES.has(logEntry.name.toLowerCase())) name = logEntry.name;
    name = name || folderName;
    version = (logByName && logByName.version) || (primary && primary.version) || null;
    // BepInEx 日志可能是旧版本游戏跑出来的（插件刚被替换过），DLL 元数据更新则取 DLL
    if (logByName && logByName.version && primary && primary.version) {
      try {
        if (compareVersions(primary.version, logByName.version) > 0) version = primary.version;
      } catch { /* ignore */ }
    }
    sptRange = (primary && primary.sptRange) || null;
    // 插件的 BepInPlugin 特性里没有作者字段，DLL 字符串堆里猜出来的多半是日志文案，宁可不显示
    author = null;
  }

  let size = 0;
  try { size = dirSize(dir); } catch { /* ignore */ }
  let mtime = null;
  try { mtime = fs.statSync(dir).mtimeMs; } catch { /* ignore */ }

  return {
    id: folderName,
    type,
    enabled,
    folder: dir,
    displayName: name,
    author,
    version,
    sptRange,
    license: (primary && primary.license) || null,
    guid: ownGuid,
    deps,
    hardDeps,
    softDeps,
    unresolvedDeps,
    hasClientPart: type === 'server' && !!pluginMeta,
    dllCount: dlls.length,
    size,
    mtime,
    isBundleMod: fs.existsSync(path.join(dir, 'bundles.json')) || fs.existsSync(path.join(dir, 'bundles')),
    source: logEntry ? 'log' : (primary && primary.guids16 && primary.guids16.length ? 'dll' : 'folder'),
  };
}

export function scanMods(root, versions = {}) {
  const knownGuids = readKnownPluginGuids(root);
  const logNames = readPluginLogNames(root);
  const logMap = readServerLogMods(root);

  const result = {
    server: [], plugins: [], patchers: [],
    disabled: { server: [], plugins: [] },
    knownGuids: [...knownGuids],
    logMods: [...logMap.entries()].map(([guid, e]) => ({ guid, ...e })),
  };

  const serverDir = path.join(root, 'SPT', 'user', 'mods');
  const serverDis = path.join(root, 'SPT', 'user', 'dis_mods');
  const pluginDir = path.join(root, 'BepInEx', 'plugins');
  const pluginDis = path.join(root, 'BepInEx', 'dis_plugins');
  const patcherDir = path.join(root, 'BepInEx', 'patchers');

  const readDirs = (dir, type, enabled, sink) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      // BepInEx\plugins 下的核心目录不作为模组展示
      if (type === 'plugin' && ['spt', 'plugins', 'Managed'].includes(e.name)) continue;
      try {
        sink.push(buildModEntry({ dir: path.join(dir, e.name), type, enabled, knownGuids, logNames, logMap }));
      } catch { /* 单个失败不影响整体 */ }
    }
  };

  readDirs(serverDir, 'server', true, result.server);
  readDirs(serverDis, 'server', false, result.disabled.server);
  readDirs(pluginDir, 'plugin', true, result.plugins);
  readDirs(pluginDis, 'plugin', false, result.disabled.plugins);

  // patchers：松散 dll
  try {
    for (const e of fs.readdirSync(patcherDir, { withFileTypes: true })) {
      if (e.isFile() && e.name.toLowerCase().endsWith('.dll')) {
        const m = readDllMeta(path.join(patcherDir, e.name));
        result.patchers.push({
          id: e.name, type: 'patcher', enabled: true, folder: patcherDir,
          displayName: m.name || e.name, version: m.version || null,
          guid: (m.guids16 && m.guids16[0]) || null,
          deps: [], unresolvedDeps: [], sptRange: m.sptRange || null, author: m.author || null,
          size: 0, mtime: null, license: m.license || null, dllCount: 1, isBundleMod: false,
        });
      }
    }
  } catch { /* ignore */ }

  // 全量已知 GUID
  const known = new Set(knownGuids);
  for (const m of [...result.server, ...result.plugins, ...result.patchers, ...result.disabled.server, ...result.disabled.plugins]) {
    if (m.guid) known.add(m.guid);
  }
  result.allGuids = [...known];

  // 缺失前置
  const missingMap = new Map();
  for (const m of [...result.server, ...result.plugins]) {
    for (const g of m.unresolvedDeps) {
      if (!missingMap.has(g)) missingMap.set(g, { guid: g, requiredBy: [] });
      missingMap.get(g).requiredBy.push(m.displayName);
    }
  }
  result.missingDeps = [...missingMap.values()];

  // SPT 版本兼容
  if (versions && versions.spt) {
    for (const m of [...result.server, ...result.plugins]) {
      m.sptCompatible = m.sptRange ? null : null;
    }
  }

  const key = (a, b) => String(a.displayName).localeCompare(String(b.displayName), 'zh-CN');
  result.server.sort(key);
  result.plugins.sort(key);
  result.disabled.server.sort(key);
  result.disabled.plugins.sort(key);

  return result;
}

async function moveMeta(root, type, id, enabled) {
  const base = type === 'server'
    ? path.join(root, 'SPT', 'user', 'mods')
    : path.join(root, 'BepInEx', 'plugins');
  const dis = type === 'server'
    ? path.join(root, 'SPT', 'user', 'dis_mods')
    : path.join(root, 'BepInEx', 'dis_plugins');
  const from = enabled ? path.join(dis, id) : path.join(base, id);
  if (!fs.existsSync(from)) throw new Error(`找不到模组目录: ${from}`);
  const dest = await moveDir(from, enabled ? base : dis);
  return { ok: true, movedTo: dest, enabled };
}

export async function toggleMod(root, type, id, enabled) {
  return moveMeta(root, type, id, enabled);
}

export async function setModEnabled(root, type, id, enabled) {
  return moveMeta(root, type, id, enabled);
}

export async function deleteMod(root, type, id) {
  const base = path.join(root, type === 'server' ? 'SPT\\user\\mods' : 'BepInEx\\plugins');
  const dis = path.join(root, type === 'server' ? 'SPT\\user\\dis_mods' : 'BepInEx\\dis_plugins');
  let from = path.join(base, id);
  if (!fs.existsSync(from)) from = path.join(dis, id);
  if (!fs.existsSync(from)) throw new Error('模组不存在');
  const trash = path.join(BACKUP_DIR, 'mods', `${nowStamp()}_${id}`);
  fs.mkdirSync(trash, { recursive: true });
  const dest = await moveDir(from, trash);
  return { ok: true, trash: dest };
}

export { compareVersions };
