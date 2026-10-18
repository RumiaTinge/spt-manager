// Fika 联机配置：fika.jsonc（服务端）+ com.fika.core.cfg（客户端 BepInEx 配置）+ 无头客户端探测
import fs from 'node:fs';
import path from 'node:path';
import { BACKUP_DIR, nowStamp, readJson, writeJson } from './core.js';
import { parseJsonc, setInJsonc, getInJsonc } from './jsonc.js';
import { processesUnder } from './launch.js';

const CFG_TYPE_HINT = /^#\s*Setting type:\s*(.+)$/i;
const CFG_DEF_HINT = /^#\s*Default value:\s*(.*)$/i;
const CFG_RANGE = /^#\s*Acceptable value range:\s*From\s*(.+?)\s*to\s*(.+)$/i;
const CFG_VALUES = /^#\s*Acceptable values:\s*(.+)$/i;
const CFG_MULTI = /Multiple values can be set/i;
const CFG_KEYS = /^(.+?)\s*=\s*(.*)$/;

export function fikaPaths(root) {
  return {
    serverModDir: path.join(root, 'SPT', 'user', 'mods', 'fika-server'),
    serverConfig: path.join(root, 'SPT', 'user', 'mods', 'fika-server', 'assets', 'configs', 'fika.jsonc'),
    headlessConfig: path.join(root, 'SPT', 'user', 'mods', 'fika-server', 'assets', 'configs', 'HeadlessConfig.json'),
    clientCfg: path.join(root, 'BepInEx', 'config', 'com.fika.core.cfg'),
    clientPluginDir: path.join(root, 'BepInEx', 'plugins', 'Fika'),
    pluginsDir: path.join(root, 'BepInEx', 'plugins'),
    profilesDir: path.join(root, 'SPT', 'user', 'profiles'),
  };
}

function backupFile(file, tag) {
  try {
    if (!fs.existsSync(file)) return null;
    const dir = path.join(BACKUP_DIR, 'config');
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${nowStamp()}_${tag}_${path.basename(file)}`);
    fs.copyFileSync(file, dest);
    return dest;
  } catch {
    return null;
  }
}

function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
}

/* ---------------------------------- 服务端 fika.jsonc ---------------------------------- */

export function readFikaServer(root) {
  const p = fikaPaths(root);
  if (!fs.existsSync(p.serverConfig)) {
    return { ok: false, exists: false, file: p.serverConfig, error: '没有找到 fika.jsonc（fika-server 可能没装，或还没运行过服务端）' };
  }
  const raw = fs.readFileSync(p.serverConfig, 'utf8');
  const config = parseJsonc(raw);
  if (!config) return { ok: false, exists: true, file: p.serverConfig, raw, error: 'fika.jsonc 解析失败（JSON 语法有误）' };
  return { ok: true, exists: true, file: p.serverConfig, raw, config };
}

/**
 * 批量写入 fika.jsonc。patches: [{ path: ['client','friendlyFire'], value: false }]
 * 只替换目标值，注释与排版原样保留；写入前备份，写后重新解析校验。
 */
export function updateFikaServer(root, patches) {
  const p = fikaPaths(root);
  const cur = readFikaServer(root);
  if (!cur.ok) throw new Error(cur.error || 'fika.jsonc 不可用');
  let raw = cur.raw;
  const applied = [];
  for (const it of patches || []) {
    if (!Array.isArray(it.path) || !it.path.length) continue;
    raw = setInJsonc(raw, it.path, it.value);
    applied.push(it.path.join('.'));
    // 每改一项都验证一遍，出错时能定位
    if (!parseJsonc(raw)) throw new Error(`写入后 JSON 无效：${it.path.join('.')}`);
  }
  const next = parseJsonc(raw);
  if (!next) throw new Error('写入后 JSON 无效，已放弃保存');
  const prev = cur.raw;
  if (raw === prev) return { ok: true, changed: false, applied, backup: null };
  const backup = backupFile(p.serverConfig, 'fika');
  writeAtomic(p.serverConfig, raw);
  return { ok: true, changed: true, applied, backup };
}

/* ---------------------------------- 客户端 com.fika.core.cfg ---------------------------------- */

export function readFikaClientCfg(root) {
  const p = fikaPaths(root);
  if (!fs.existsSync(p.clientCfg)) {
    return { ok: false, exists: false, file: p.clientCfg, sections: [], error: '没有找到 com.fika.core.cfg（Fika 客户端插件没装，或还没启动过游戏）' };
  }
  const raw = fs.readFileSync(p.clientCfg, 'utf8');
  const lines = raw.split(/\r?\n/);
  const sections = [];
  let cur = null;
  let desc = [];
  let meta = {};
  for (const line of lines) {
    const t = line.trim();
    if (!t) { desc = []; meta = {}; continue; }
    if (t.startsWith('#')) {
      const isDesc = t.startsWith('##');
      let m;
      if ((m = t.match(CFG_TYPE_HINT))) meta.type = m[1].trim();
      else if ((m = t.match(CFG_DEF_HINT))) meta.default = m[1].trim();
      else if ((m = t.match(CFG_RANGE))) { meta.min = m[1].trim(); meta.max = m[2].trim(); }
      else if ((m = t.match(CFG_VALUES))) meta.options = m[1].split(',').map((x) => x.trim()).filter(Boolean);
      else if (CFG_MULTI.test(t)) meta.multi = true;
      else if (isDesc) desc.push(t.replace(/^##\s?/, ''));
      continue;
    }
    if (t.startsWith('#')) continue;
    if (/^\[.*\]$/.test(t)) {
      cur = { name: t.slice(1, -1), items: [] };
      sections.push(cur);
      desc = []; meta = {};
      continue;
    }
    const m = t.match(CFG_KEYS);
    if (m) {
      const item = {
        key: m[1].trim(),
        value: m[2],
        type: meta.type || 'String',
        default: meta.default,
        desc: desc.join('\n'),
      };
      if (meta.options) item.options = meta.options;
      if (meta.multi) item.multi = true;
      if (meta.min !== undefined) { item.min = meta.min; item.max = meta.max; }
      if (!cur) { cur = { name: '', items: [] }; sections.push(cur); }
      cur.items.push(item);
      desc = []; meta = {};
    }
  }
  return { ok: true, exists: true, file: p.clientCfg, raw, sections };
}

/** 改写客户端 cfg 中的一个值（保留注释与顺序） */
export function updateFikaClientCfg(root, updates) {
  const p = fikaPaths(root);
  const cur = readFikaClientCfg(root);
  if (!cur.ok) throw new Error(cur.error || 'com.fika.core.cfg 不可用');
  const lines = cur.raw.split(/\r?\n/);
  let section = '';
  const applied = [];
  for (const up of updates || []) {
    if (up.section !== undefined) section = up.section;
  }
  // 单趟扫描，按 (section,key) 定位
  const pending = new Map();
  for (const up of updates || []) pending.set(`${up.section}\u0000${up.key}`, up.value);
  let s = '';
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (/^\[.*\]$/.test(t)) { s = t.slice(1, -1); continue; }
    const m = t.match(CFG_KEYS);
    if (!m || t.startsWith('#')) continue;
    const key = m[1].trim();
    const id = `${s}\u0000${key}`;
    if (pending.has(id)) {
      const value = pending.get(id);
      const pad = m[0].indexOf('=');
      const head = lines[i].slice(0, lines[i].indexOf('='));
      lines[i] = `${head}= ${value}`;
      applied.push(`${s}.${key}`);
      pending.delete(id);
    }
  }
  if (!applied.length) return { ok: true, changed: false, applied, missing: [...pending.keys()] };
  const eol = cur.raw.includes('\r\n') ? '\r\n' : '\n';
  const text = lines.join(eol);
  const backup = backupFile(p.clientCfg, 'fika-client');
  writeAtomic(p.clientCfg, text);
  return { ok: true, changed: true, applied, missing: [...pending.keys()], backup };
}

/* ---------------------------------- 无头客户端 ---------------------------------- */

function findExe(dir, name, depth = 2) {
  if (!dir || depth < 0 || !fs.existsSync(dir)) return null;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return path.join(dir, e.name);
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (/^(\.|node_modules|BepInEx|SPT|EFT|Logs|logs|cache|Cache)$/i.test(e.name)) continue;
    const hit = findExe(path.join(dir, e.name), name, depth - 1);
    if (hit) return hit;
  }
  return null;
}

function listDirSafe(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

/** 从无头目录的 BepInEx 日志尾巴猜它的状态：connected / starting / exited / null */export function headlessLogState(dir) {
  const log = path.join(dir, 'BepInEx', 'LogOutput.log');
  let buf;
  try {
    const st = fs.statSync(log);
    if (Date.now() - st.mtimeMs > 1000 * 60 * 60 * 6) return 'idle';
    buf = fs.readFileSync(log);
  } catch { return null; }
  const tail = buf.subarray(Math.max(0, buf.length - 12000)).toString('utf8');
  if (/Connected to HeadlessWebSocket/.test(tail)) return 'connected';
  if (/Exiting\.\.\.|Native Crash Reporting/.test(tail)) return 'exited';
  return 'starting';
}

const HEADLESS_PLUGIN_PATHS = [
  path.join('BepInEx', 'plugins', 'Fika', 'Fika.Headless.dll'),
  path.join('BepInEx', 'plugins', 'Fika.Headless', 'Fika.Headless.dll'),
];

/** 同一份客户端里 Fika.Headless 的位置与开关状态（无头主机 / 客户端 单份切换用） */
export function headlessModeState(root) {
  let pluginPath = null;
  let enabled = false;
  for (const rel of HEADLESS_PLUGIN_PATHS) {
    const p = path.join(root, rel);
    if (fs.existsSync(p)) { pluginPath = p; enabled = true; break; }
    if (fs.existsSync(`${p}.disabled`)) { pluginPath = p; enabled = false; break; }
  }
  const manager = findExe(root, 'FikaHeadlessManager.exe', 2);
  const configPath = path.join(root, 'HeadlessConfig.json');
  const config = fs.existsSync(configPath) ? readJson(configPath) : null;
  return {
    root,
    pluginPath,
    pluginEnabled: enabled,
    hasPlugin: !!pluginPath,
    manager,
    configPath,
    config,
    ready: !!(pluginPath && manager && config && config.ProfileId),
  };
}

/** 启用 / 停用 Fika.Headless 插件（改扩展名，BepInEx 就不会加载它） */
export function setHeadlessPluginEnabled(root, enabled) {
  const st = headlessModeState(root);
  if (!st.pluginPath) {
    throw new Error('这份客户端里没有 Fika.Headless.dll；先把无头组件放进 BepInEx\\plugins\\Fika');
  }
  const on = st.pluginEnabled;
  if (enabled === on) return { ok: true, changed: false, pluginPath: st.pluginPath, enabled };
  if (enabled) fs.renameSync(`${st.pluginPath}.disabled`, st.pluginPath);
  else fs.renameSync(st.pluginPath, `${st.pluginPath}.disabled`);
  return { ok: true, changed: true, pluginPath: st.pluginPath, enabled };
}

/** 把服务端生成的 HeadlessConfig.json 复制到客户端根目录（已存在就不动） */
export function ensureHeadlessConfig(root) {
  const cfgPath = path.join(root, 'HeadlessConfig.json');
  if (fs.existsSync(cfgPath)) {
    return { ok: true, created: false, configPath: cfgPath, config: readJson(cfgPath) };
  }
  const scriptsDir = path.join(root, 'SPT', 'user', 'mods', 'fika-server', 'assets', 'scripts');
  let newest = null;
  for (const d of listDirSafe(scriptsDir)) {
    if (!d.isDirectory()) continue;
    const f = path.join(scriptsDir, d.name, 'HeadlessConfig.json');
    if (!fs.existsSync(f)) continue;
    const mtime = fs.statSync(f).mtimeMs;
    if (!newest || mtime > newest.mtime) newest = { f, mtime };
  }
  if (!newest) throw new Error('没有找到服务端生成的 HeadlessConfig.json：先把 Fika 页「无头存档数量」设成 1 并重启服务端');
  fs.copyFileSync(newest.f, cfgPath);
  return { ok: true, created: true, configPath: cfgPath, source: newest.f, config: readJson(cfgPath) };
}

/** 判断某个目录像不像一个无头客户端安装（含 Fika.Headless 插件或 Manager） */
export function inspectHeadlessDir(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const manager = findExe(dir, 'FikaHeadlessManager.exe', 2) || findExe(dir, 'FikaHeadlessLauncher.exe', 2);
  const pluginDirs = [
    path.join(dir, 'BepInEx', 'plugins'),
    path.join(dir, 'BepInEx', 'dis_plugins'),
  ];
  let headlessPlugin = null;
  for (const pd of pluginDirs) {
    for (const e of listDirSafe(pd)) {
      if (!e.isDirectory()) continue;
      if (/headless/i.test(e.name)) {
        headlessPlugin = path.join(pd, e.name);
        break;
      }
      // Fika 1.x 把 Fika.Headless.dll 直接放在 plugins/Fika 下
      if (/^fika$/i.test(e.name) && fs.existsSync(path.join(pd, e.name, 'Fika.Headless.dll'))) {
        headlessPlugin = path.join(pd, e.name);
        break;
      }
    }
    if (headlessPlugin) break;
  }
  const serverExe = path.join(dir, 'SPT', 'SPT.Server.exe');
  const gameExe = path.join(dir, 'EscapeFromTarkov.exe');
  if (!manager && !headlessPlugin) return null;
  return {
    dir,
    manager,
    headlessPlugin,
    hasServer: fs.existsSync(serverExe),
    hasGame: fs.existsSync(gameExe),
    state: liveHeadlessState(dir),
  };
}

/** 结合「进程在不在」和「日志到哪一步」判断无头状态 */
export function liveHeadlessState(dir) {
  const logState = headlessLogState(dir);
  let procs = [];
  try { procs = processesUnder(dir); } catch { /* ignore */ }
  if (!procs.length) return logState === 'exited' ? 'exited' : 'idle';
  if (logState === 'connected' || logState === 'starting') return logState;
  return 'starting';
}

/** 读取设置里配置的无头目录 + 主目录附近的候选 */
export function findHeadlessInstalls(root, settings = {}) {
  const out = [];
  const seen = new Set();
  const rootKey = path.resolve(root).toLowerCase();
  const push = (d) => {
    if (!d) return;
    let key;
    try { key = path.resolve(d).toLowerCase(); } catch { return; }
    if (seen.has(key)) return;
    seen.add(key);
    const info = inspectHeadlessDir(d);
    if (info) out.push({ ...info, isLocal: key === rootKey });
  };
  (settings.headlessDirs || []).forEach(push);
  // 主安装自身：同一份客户端既当客户端又当无头主机（单份切换）
  push(root);
  return out;
}

/** fika-server 运行时可能生成的脚本 / 无头配置文件 */
export function headlessArtifacts(root) {
  const p = fikaPaths(root);
  const out = { scripts: [], configs: [] };
  const scan = (dir, depth = 2) => {
    if (!fs.existsSync(dir) || depth < 0) return;
    for (const e of listDirSafe(dir)) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) { scan(fp, depth - 1); continue; }
      if (/\.(bat|cmd|ps1)$/i.test(e.name)) out.scripts.push({ file: fp, size: fs.statSync(fp).size });
      else if (/headless.*\.json$/i.test(e.name)) out.configs.push({ file: fp, size: fs.statSync(fp).size });
    }
  };
  scan(path.dirname(p.serverConfig), 2);
  const scriptsDir = path.join(p.serverModDir, 'scripts');
  scan(scriptsDir, 2);
  return out;
}

/** headless 配置汇总（供界面展示） */
export function headlessSummary(root, settings = {}) {
  const cfg = readFikaServer(root);
  const headless = cfg.ok ? getInJsonc(cfg.config, ['headless']) : null;
  const all = findHeadlessInstalls(root, settings);
  const local = all.find((x) => x.isLocal) || null;
  return {
    config: headless || null,
    // local = 这份客户端自己就能跑无头（单份切换）；installs = 另外单独的无头副本
    local,
    installs: all.filter((x) => !x.isLocal),
    artifacts: headlessArtifacts(root),
  };
}

/* ---------------------------------- 总览 ---------------------------------- */

export function fikaStatus(root, settings = {}) {
  const p = fikaPaths(root);
  const cfg = readFikaServer(root);
  const client = readFikaClientCfg(root);
  const headless = headlessSummary(root, settings);
  const installed = fs.existsSync(p.serverModDir);
  const clientInstalled = fs.existsSync(p.clientCfg);
  const httpCfg = cfg.ok ? getInJsonc(cfg.config, ['server', 'SPT', 'http']) : null;
  const natCfg = cfg.ok ? getInJsonc(cfg.config, ['natPunchServer']) : null;
  return {
    ok: true,
    installed,
    clientInstalled,
    serverConfigFile: p.serverConfig,
    clientCfgFile: p.clientCfg,
    serverConfigExists: cfg.exists,
    clientCfgExists: client.exists,
    serverError: cfg.ok ? null : cfg.error,
    http: httpCfg,
    natPunch: natCfg,
    headless,
  };
}
