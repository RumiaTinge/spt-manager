// game.js — 服务端启停、AI/物资配置、存档管理
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { DATA_DIR, BACKUP_DIR, nowStamp, readJson, writeJson, readSettings, writeSettings, getVersions, humanSize } from './core.js';

export function paths(root) {
  return {
    root,
    data: path.join(root, 'SPT', 'SPT_Data'),
    configs: path.join(root, 'SPT', 'SPT_Data', 'configs'),
    database: path.join(root, 'SPT', 'SPT_Data', 'database'),
    locations: path.join(root, 'SPT', 'SPT_Data', 'database', 'locations'),
    serverExe: path.join(root, 'SPT', 'SPT.Server.exe'),
    serverDir: path.join(root, 'SPT'),
    user: path.join(root, 'SPT', 'user'),
    profiles: path.join(root, 'SPT', 'user', 'profiles'),
    logs: path.join(root, 'SPT', 'user', 'logs', 'spt'),
  };
}

const MAP_NAMES = {
  bigmap: '海关', factory4_day: '工厂（白天）', factory4_night: '工厂（夜晚）', interchange: '立交桥',
  laboratory: '实验室', labyrinth: '迷宫', lighthouse: '灯塔', rezervbase: '储备站', sandbox: '街区',
  sandbox_high: '街区（高级）', shoreline: '海岸线', tarkovstreets: '塔科夫街区', woods: '森林',
  hideout: '藏身处', develop: 'develop', privatearea: 'privatearea', suburbs: 'suburbs', terminal: 'terminal', town: 'town',
};

export function mapList(root) {
  const p = paths(root);
  let dirs = [];
  try {
    dirs = fs.readdirSync(p.locations, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { /* ignore */ }
  return dirs.map((d) => ({ id: d, name: MAP_NAMES[d] || d, cn: !!MAP_NAMES[d] }));
}

// ---------------------------------------------------------------- 服务端进程
let serverProc = null;
let serverPid = null;
const SERVER_STATE = path.join(DATA_DIR, 'server-state.json');

export function isServerRunning() {
  // 1) 本进程启动的子进程
  if (serverProc && serverProc.exitCode === null) return { running: true, pid: serverProc.pid, byUs: true };
  // 2) 状态文件里记录的 pid 还活着吗
  try {
    const st = readJson(SERVER_STATE, null);
    if (st && st.pid) {
      const r = spawnSync('tasklist', ['/FI', `PID eq ${st.pid}`, '/NH'], { encoding: 'utf8' });
      if (/SPT\.Server\.exe/i.test(r.stdout || '')) return { running: true, pid: st.pid, byUs: true };
    }
  } catch { /* ignore */ }
  // 3) 别处启动的
  try {
    const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq SPT.Server.exe', '/NH'], { encoding: 'utf8' });
    const m = /SPT\.Server\.exe\s+(\d+)/i.exec(r.stdout || '');
    if (m) return { running: true, pid: Number(m[1]), byUs: false };
  } catch { /* ignore */ }
  return { running: false, pid: null, byUs: false };
}

/** SPT 自己的服务端日志目录（SPT\user\logs\spt\sptYYYYMMDD.log） */
export function latestSptLog(root) {
  const dir = path.join(root, 'SPT', 'user', 'logs', 'spt');
  let files = [];
  try {
    files = fs.readdirSync(dir)
      .filter((f) => /^spt\d{8}\.log$/i.test(f))
      .map((f) => ({ f, full: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
  } catch { return null; }
  return files.length ? files[0].full : null;
}

/**
 * 启动 SPT 服务端。
 * 注意：SPT.Server.exe 启动时会调用 GetConsoleMode，stdout 被重定向到管道/文件时直接抛异常退出，
 * 所以必须用 cmd 的 start 给它开一个真实控制台，日志则改从 SPT 自己的日志文件读取。
 */
export function startServer(root, opts = {}) {
  const p = paths(root);
  if (!fs.existsSync(p.serverExe)) throw new Error(`找不到服务端: ${p.serverExe}`);
  const cur = isServerRunning();
  if (cur.running) return { ok: true, already: true, pid: cur.pid };

  const bootLog = path.join(DATA_DIR, 'server.log');
  fs.mkdirSync(path.dirname(bootLog), { recursive: true });
  fs.writeFileSync(bootLog, `[${new Date().toLocaleString('zh-CN')}] 启动 ${p.serverExe}\n`, 'utf8');

  // SPT.Server.exe 启动时调用 GetConsoleMode，stdout 被接到管道/文件会抛 "Unable to get console mode" 直接退出，
  // 所以用 cmd 的 start 给它一个独立控制台，日志改从 SPT 自己的日志文件读取。
  const child = spawn('cmd.exe', ['/c', 'start', '', '/D', p.serverDir, p.serverExe], {
    cwd: p.serverDir,
    windowsHide: false,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  serverProc = null;
  serverPid = null;
  try { fs.rmSync(SERVER_STATE, { force: true }); } catch { /* ignore */ }

  // 等最多 8 秒确认进程真的起来了（SPT 启动早期崩溃时会立刻退出）
  const deadline = Date.now() + 8000;
  let detected = null;
  while (Date.now() < deadline) {
    const now = isServerRunning();
    if (now.running) { detected = now; break; }
    spawnSync('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Milliseconds 400'], { windowsHide: true });
  }

  const sptLog = latestSptLog(root);
  if (!detected) {
    let tail = '';
    try {
      const txt = sptLog ? fs.readFileSync(sptLog, 'utf8') : '';
      tail = txt.split(/\r?\n/).slice(-25).join('\n');
    } catch { /* ignore */ }
    return {
      ok: false,
      error: '服务端进程没有保持运行（启动失败）',
      logFile: bootLog,
      sptLog,
      tail,
    };
  }

  serverPid = detected.pid;
  fs.writeFileSync(SERVER_STATE, JSON.stringify({ pid: detected.pid, at: new Date().toISOString() }), 'utf8');
  return { ok: true, pid: detected.pid, logFile: bootLog, sptLog };
}

export function stopServer() {
  const cur = isServerRunning();
  if (!cur.running) return { ok: true, already: true };
  const pid = cur.pid;
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
  try { fs.rmSync(SERVER_STATE, { force: true }); } catch { /* ignore */ }
  if (serverProc && serverProc.pid === pid) serverProc = null;
  return { ok: true, stopped: pid };
}

export function serverLog(root, n = 200) {
  const bootLog = path.join(DATA_DIR, 'server.log');
  // 优先 SPT 自己的日志（有完整的控制台输出），没有再看引导日志
  const files = [];
  const sptLog = root ? latestSptLog(root) : null;
  if (sptLog) files.push(sptLog);
  files.push(bootLog);
  for (const file of files) {
    try {
      const txt = fs.readFileSync(file, 'utf8');
      const lines = txt.split(/\r?\n/).filter((l) => l.trim());
      return { lines: lines.slice(-n), size: txt.length, file, text: lines.slice(-n).join('\n') };
    } catch { /* try next */ }
  }
  return { lines: [], size: 0, file: bootLog, text: '' };
}

/** 服务端监听端口（SPT_Data\server.json 的 port，默认 6969） */
export function serverPort(root) {
  const srv = readJson(path.join(root, 'SPT', 'SPT_Data', 'server.json'), null);
  const p = srv && Number(srv.port);
  return p > 0 ? p : 6969;
}

/** 服务端 HTTP 是否已就绪（SPT 4.x 的 6969 是 HTTPS，这里做 TCP 连通性探测） */
export async function pingServer(root, timeoutMs = 1200) {
  const port = root ? serverPort(root) : 6969;
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const sock = net.connect({ host: '127.0.0.1', port });
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => { sock.destroy(); finish({ ok: true, status: 1, port }); });
    sock.once('timeout', () => { sock.destroy(); finish({ ok: false, status: 0, port, error: 'timeout' }); });
    sock.once('error', (e) => { sock.destroy(); finish({ ok: false, status: 0, port, error: String(e.code || e.message) }); });
  });
}

export async function pingUrl(url, timeoutMs = 1500) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, error: String(e.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- AI 配置
export function readAiConfig(root) {
  const p = paths(root);
  const bot = readJson(path.join(p.configs, 'bot.json'), null) || {};
  const pmc = readJson(path.join(p.configs, 'pmc.json'), null) || {};

  const perMap = mapList(root).map((m) => ({
    ...m,
    maxBotCap: bot.maxBotCap ? bot.maxBotCap[m.id] : undefined,
    hasLoot: fs.existsSync(path.join(p.locations, m.id, 'looseLoot.json')),
  }));

  const bosses = [];
  for (const m of mapList(root)) {
    const baseFile = path.join(p.locations, m.id, 'base.json');
    if (!fs.existsSync(baseFile)) continue;
    const base = readJson(baseFile, null);
    if (!base || !Array.isArray(base.BossLocationSpawn)) continue;
    bosses.push({
      map: m.id, mapName: m.name,
      entries: base.BossLocationSpawn.map((b, i) => ({
        index: i,
        bossName: b.BossName,
        chance: b.BossChance,
        forceSpawn: !!b.ForceSpawn,
        escorts: b.BossEscortAmount,
        escortType: b.BossEscortType,
        spawnMode: b.SpawnMode,
        zone: b.BossZone,
        difficulty: b.BossDifficult,
      })),
    });
  }

  return {
    bot: {
      maxBotCap: bot.maxBotCap || null,
      goonSpawnSystem: bot.goonSpawnSystem || null,
      weeklyBoss: bot.weeklyBoss || null,
      replaceScavWith: bot.replaceScavWith || null,
      bosses: bot.bosses || null,
    },
    pmc: {
      isUsec: pmc.isUsec ?? null,
      customPmcWaves: pmc.customPmcWaves ? true : false,
      maxBotCap: pmc.maxBotCap || null,
      locationSpecificPmcLevelOverride: pmc.locationSpecificPmcLevelOverride || null,
    },
    perMap,
    bosses,
  };
}

export function writeAiConfig(root, { maxBotCap, goonSpawnChance, replaceScavWith }) {
  const p = paths(root);
  const file = path.join(p.configs, 'bot.json');
  const bot = readJson(file, null);
  if (!bot) throw new Error('读取 bot.json 失败');
  if (!bot.maxBotCap) bot.maxBotCap = {};
  if (maxBotCap && typeof maxBotCap === 'object') {
    for (const [k, v] of Object.entries(maxBotCap)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) bot.maxBotCap[k] = Math.round(n);
    }
  }
  if (goonSpawnChance !== undefined && goonSpawnChance !== null) {
    if (!bot.goonSpawnSystem) bot.goonSpawnSystem = {};
    const n = Number(goonSpawnChance);
    if (Number.isFinite(n)) bot.goonSpawnSystem.spawnChance = Math.max(0, Math.min(100, Math.round(n)));
  }
  if (replaceScavWith) bot.replaceScavWith = String(replaceScavWith);
  writeJson(file, bot, { backup: true });
  return { ok: true, file };
}

export function writeBossConfig(root, map, index, patch) {
  const p = paths(root);
  const file = path.join(p.locations, map, 'base.json');
  const base = readJson(file, null);
  if (!base || !Array.isArray(base.BossLocationSpawn)) throw new Error(`读取 ${map}/base.json 失败`);
  const b = base.BossLocationSpawn[index];
  if (!b) throw new Error('首领条目不存在');
  if (patch.chance !== undefined) {
    const n = Number(patch.chance);
    if (!Number.isFinite(n)) throw new Error('概率必须是数字');
    b.BossChance = Math.max(0, Math.min(100, Math.round(n)));
  }
  if (patch.forceSpawn !== undefined) b.ForceSpawn = !!patch.forceSpawn;
  writeJson(file, base, { backup: true });
  return { ok: true, boss: b };
}

// ---------------------------------------------------------------- 物资
const SPAWNCOUNT_RE = /"spawnpointCount"\s*:\s*\{[^}]*\}/;

/** 只读文件头部若干 KB 拿到 spawnpointCount，避免解析上百 MB 的 looseLoot.json */
function readLooseCount(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4096);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    const head = buf.subarray(0, n).toString('utf8');
    const m = /"spawnpointCount"\s*:\s*\{\s*"mean"\s*:\s*([0-9.eE+-]+)\s*,\s*"std"\s*:\s*([0-9.eE+-]+)/.exec(head);
    if (m) return { mean: Number(m[1]), std: Number(m[2]) };
  } catch { /* ignore */ }
  return null;
}

export function lootOverview(root) {
  const p = paths(root);
  const maps = mapList(root).filter((m) => fs.existsSync(path.join(p.locations, m.id, 'looseLoot.json')));
  const out = [];
  for (const m of maps) {
    const looseFile = path.join(p.locations, m.id, 'looseLoot.json');
    const staticFile = path.join(p.locations, m.id, 'staticLoot.json');
    const loose = readLooseCount(looseFile);
    let staticSum = 0;
    let staticContainers = 0;
    let staticError = null;
    try {
      const st = readJson(staticFile, null);
      if (st && typeof st === 'object') {
        for (const v of Object.values(st)) {
          if (!v || !Array.isArray(v.itemcountDistribution)) continue;
          staticContainers++;
          for (const d of v.itemcountDistribution) staticSum += Number(d.count) || 0;
        }
      }
    } catch (e) { staticError = String(e.message || e); }
    out.push({
      map: m.id, name: m.name,
      looseMean: loose ? loose.mean : null,
      looseStd: loose ? loose.std : null,
      looseSize: safeSize(looseFile),
      staticSum, staticContainers, staticSize: safeSize(staticFile), staticError,
    });
  }
  return out;
}

function safeSize(f) {
  try { return fs.statSync(f).size; } catch { return 0; }
}

/**
 * 物资倍率：把 looseLoot.spawnpointCount 的 mean/std 与 staticLoot.itemcountDistribution[].count 统一乘以 factor。
 * 只做文本级替换（looseLoot 巨大，避免整体解析）。
 */
export function applyLootMultiplier(root, maps, factor, opts = {}) {
  const p = paths(root);
  const f = Number(factor);
  if (!Number.isFinite(f) || f <= 0) throw new Error('倍率必须是正数');
  const stamp = nowStamp();
  const backupDir = path.join(BACKUP_DIR, 'loot', stamp);
  fs.mkdirSync(backupDir, { recursive: true });

  const report = [];
  const selected = maps && maps.length ? maps : mapList(root).map((m) => m.id);
  const emit = typeof opts.onProgress === 'function' ? opts.onProgress : null;

  let doneCount = 0;
  for (const map of selected) {
    const emitHere = (message) => {
      if (emit) {
        emit({
          map,
          done: doneCount,
          total: selected.length,
          percent: Math.round((doneCount / Math.max(1, selected.length)) * 100),
          message: `${map}：${message}（${doneCount + 1}/${selected.length}）`,
        });
      }
    };
    emitHere('处理中');
    const looseFile = path.join(p.locations, map, 'looseLoot.json');
    const staticFile = path.join(p.locations, map, 'staticLoot.json');
    const item = { map, changes: [] };

    if (fs.existsSync(looseFile) && !!readLooseCount(looseFile)) {
      const backup = path.join(backupDir, map, 'looseLoot.json');
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(looseFile, backup);
      const fd = fs.openSync(looseFile, 'r');
      const buf = Buffer.alloc(4096);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      fs.closeSync(fd);
      const head = buf.subarray(0, n).toString('utf8');
      const m = /("spawnpointCount"\s*:\s*\{\s*"mean"\s*:\s*)([0-9.eE+-]+)(\s*,\s*"std"\s*:\s*)([0-9.eE+-]+)/.exec(head);
      if (m) {
        const newHead = head.replace(
          /("spawnpointCount"\s*:\s*\{\s*"mean"\s*:\s*)([0-9.eE+-]+)(\s*,\s*"std"\s*:\s*)([0-9.eE+-]+)/,
          (_all, a, mean, b, std) => `${a}${Number(mean) * f}${b}${Number(std) * f}`,
        );
        const rest = fs.readFileSync(looseFile); // 整体读入再写，避免半截文件
        const replaced = Buffer.concat([Buffer.from(newHead, 'utf8'), rest.subarray(n)]);
        const tmp = looseFile + '.tmp';
        fs.writeFileSync(tmp, replaced);
        fs.renameSync(tmp, looseFile);
        item.changes.push({ file: 'looseLoot.json', from: { mean: Number(m[2]), std: Number(m[4]) }, factor: f });
      }
    }

    if (fs.existsSync(staticFile)) {
      const backup = path.join(backupDir, map, 'staticLoot.json');
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.copyFileSync(staticFile, backup);
      const st = readJson(staticFile, null);
      let changed = 0;
      if (st && typeof st === 'object') {
        for (const v of Object.values(st)) {
          if (!v || !Array.isArray(v.itemcountDistribution)) continue;
          for (const d of v.itemcountDistribution) {
            if (Number.isFinite(Number(d.count))) {
              d.count = Math.round(Number(d.count) * f);
              changed++;
            }
          }
        }
      }
      if (changed) {
        writeJson(staticFile, st, { backup: false });
        item.changes.push({ file: 'staticLoot.json', distributions: changed, factor: f });
      }
    }

    report.push(item);
    doneCount++;
    if (emit) {
      emit({ map, done: doneCount, total: selected.length, percent: Math.round((doneCount / Math.max(1, selected.length)) * 100), message: `${map} 完成（${doneCount}/${selected.length}）` });
    }
  }

  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({ at: new Date().toISOString(), factor: f, maps: selected }, null, 2), 'utf8');
  return { ok: true, factor: f, backupDir, report };
}

/** 列出物资备份，供还原用 */
export function listLootBackups() {
  const base = path.join(BACKUP_DIR, 'loot');
  let dirs = [];
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
  return dirs.map((d) => {
    const full = path.join(base, d);
    const manifest = readJson(path.join(full, 'manifest.json'), null);
    return { name: d, dir: full, manifest, mtime: safeStat(full).mtime };
  }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

/** 还原一次物资备份（把备份里的 looseLoot/staticLoot 拷回去） */
export function restoreLootBackup(root, dbName) {
  const base = path.join(BACKUP_DIR, 'loot');
  const src = path.join(base, dbName);
  if (!fs.existsSync(src)) throw new Error('备份不存在');
  const p = paths(root);
  const restored = [];
  for (const map of fs.readdirSync(src, { withFileTypes: true })) {
    if (!map.isDirectory()) continue;
    for (const f of ['looseLoot.json', 'staticLoot.json']) {
      const from = path.join(src, map.name, f);
      if (!fs.existsSync(from)) continue;
      const to = path.join(p.locations, map.name, f);
      if (!fs.existsSync(to)) continue;
      const keep = path.join(BACKUP_DIR, 'loot', `${nowStamp()}_pre-restore_${map.name}_${f}`);
      fs.mkdirSync(path.dirname(keep), { recursive: true });
      fs.copyFileSync(to, keep);
      fs.copyFileSync(from, to);
      restored.push(`${map.name}/${f}`);
    }
  }
  return { ok: true, restored };
}

// ---------------------------------------------------------------- 存档
export function listProfiles(root) {
  const p = paths(root);
  let files = [];
  try {
    files = fs.readdirSync(p.profiles).filter((f) => f.toLowerCase().endsWith('.json'));
  } catch { return []; }
  return files.map((f) => {
    const full = path.join(p.profiles, f);
    const st = safeStat(full);
    const j = readJson(full, null);
    const info = (j && (j.characters?.pmc?.Info || j.info)) || {};
    return {
      file: f,
      id: f.replace(/\.json$/i, ''),
      nickname: info.Nickname || info.username || '(未知)',
      side: info.Side || null,
      level: info.Level ?? null,
      experience: info.Experience ?? null,
      edition: info.GameVersion || null,
      size: st.size,
      mtime: st.mtime,
      backupCount: countBackups(f.replace(/\.json$/i, '')),
    };
  }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

function safeStat(f) {
  try { const s = fs.statSync(f); return { size: s.size, mtime: s.mtimeMs }; } catch { return { size: 0, mtime: 0 }; }
}

const PROFILE_BACKUP_DIR = () => path.join(BACKUP_DIR, 'profiles');

function countBackups(id) {
  try {
    return fs.readdirSync(PROFILE_BACKUP_DIR()).filter((d) => d.includes(id)).length;
  } catch { return 0; }
}

export function backupProfile(root, id) {
  const p = paths(root);
  const src = path.join(p.profiles, `${id}.json`);
  if (!fs.existsSync(src)) throw new Error('存档不存在');
  const stamp = nowStamp();
  const dir = path.join(PROFILE_BACKUP_DIR(), `${stamp}_${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${id}.json`);
  fs.copyFileSync(src, dest);
  return { ok: true, backup: dest, stamp };
}

export function listProfileBackups(root) {
  let dirs = [];
  try {
    dirs = fs.readdirSync(PROFILE_BACKUP_DIR(), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
  return dirs.map((d) => {
    const full = path.join(PROFILE_BACKUP_DIR(), d);
    const files = (() => { try { return fs.readdirSync(full); } catch { return []; } })();
    const json = files.find((f) => f.endsWith('.json'));
    const js = json ? readJson(path.join(full, json), null) : null;
    const info = (js && (js.characters?.pmc?.Info || js.info)) || {};
    return {
      name: d, dir: full, file: json || null,
      nickname: info.Nickname || null, level: info.Level ?? null,
      size: json ? safeSize(path.join(full, json)) : 0,
      mtime: safeStat(full).mtime,
    };
  }).sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

export function restoreProfile(root, backupName) {
  const dir = path.join(PROFILE_BACKUP_DIR(), backupName);
  if (!fs.existsSync(dir)) throw new Error('备份不存在');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (!files.length) throw new Error('备份中没有存档文件');
  const p = paths(root);
  fs.mkdirSync(p.profiles, { recursive: true });
  const restored = [];
  for (const f of files) {
    // 还原前先把现状再备份一次
    const cur = path.join(p.profiles, f);
    if (fs.existsSync(cur)) {
      const keep = path.join(PROFILE_BACKUP_DIR(), `${nowStamp()}_pre-restore_${f}`);
      fs.copyFileSync(cur, keep);
    }
    fs.copyFileSync(path.join(dir, f), cur);
    restored.push(f);
  }
  return { ok: true, restored };
}

export function deleteProfileBackup(backupName) {
  const dir = path.join(PROFILE_BACKUP_DIR(), backupName);
  if (!fs.existsSync(dir)) throw new Error('备份不存在');
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok: true };
}

export function profileDetail(root, id) {
  const p = paths(root);
  const j = readJson(path.join(p.profiles, `${id}.json`), null);
  if (!j) throw new Error('存档不存在');
  const info = j.characters?.pmc?.Info || j.info || {};
  const scav = j.characters?.scav?.Info || {};
  return {
    id,
    nickname: info.Nickname || null,
    side: info.Side || null,
    level: info.Level ?? null,
    experience: info.Experience ?? null,
    edition: info.GameVersion || null,
    scavName: scav.Nickname || null,
    aid: info.aid || j.info?.aid || null,
    money: j.characters?.pmc?.Inventory?.items?.filter?.((x) => x._tpl === '5449016a4bdc2d6f028b456f').length ?? null,
    size: safeSize(path.join(p.profiles, `${id}.json`)),
  };
}

// ---------------------------------------------------------------- 综合摘要
export function gameSummary(root) {
  const p = paths(root);
  const v = getVersions(root);
  const profiles = listProfiles(root);
  const maps = mapList(root);
  return {
    root,
    serverExe: p.serverExe,
    serverExists: fs.existsSync(p.serverExe),
    versions: v,
    profiles,
    maps,
    serverState: isServerRunning(),
    settings: readSettings(),
  };
}

export { readSettings, writeSettings, humanSize, MAP_NAMES };
