// raidprobe.js — 「战局实测」：把服务端 NoAIBots 的决策，和战局里客户端真正刷出来的 AI 对上
//
// 数据来源（两个文件都是追加写，服务端/游戏运行时也能读）：
//   1. 服务端日志  <SPT>\SPT\user\logs\spt\sptYYYYMMDD.log
//      带时间戳，记录：收到战局配置（地图/档位/首领开关）、命中规则、地图参数已调整、
//      AI 生成请求/完成（批量档案池）、AI 同时存活上限、校验陷阱修复。
//   2. 客户端日志  <客户端>\BepInEx\LogOutput.log
//      没有时间戳，但记录了：Set max bot cap（把上限改成多少）、Running old/new spawn system、
//      以及每个真正进场的 bot 的 "Updated <类型> bot <名字> to use: <类型> brain"。
//
// 注意：服务端「AI 生成完成 #N：300 只」是给客户端预生成的档案池（一次性），
// 不是同屏数量；客户端日志里的 brain 行才是真正被创建出来的 bot。
import fs from 'node:fs';
import path from 'node:path';

const SERVER_LOG_RE = /^spt.*\.log$/i;

function readTail(file, bytes = 4 * 1024 * 1024) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return '';
    const start = Math.max(0, st.size - bytes);
    const len = st.size - start;
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try {
      let off = 0;
      while (off < len) {
        const n = fs.readSync(fd, buf, off, len - off, start + off);
        if (!n) break;
        off += n;
      }
    } finally {
      fs.closeSync(fd);
    }
    let text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
    }
    return text;
  } catch {
    return '';
  }
}

function latestServerLog(root) {
  const dir = path.join(root, 'SPT', 'user', 'logs', 'spt');
  try {
    const list = fs.readdirSync(dir).filter((f) => SERVER_LOG_RE.test(f)).sort();
    if (!list.length) return null;
    return path.join(dir, list[list.length - 1]);
  } catch {
    return null;
  }
}

const timeOf = (line) => {
  const m = String(line || '').match(/^\[(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
};

/** 服务端最近一局的 NoAIBots 事件（同一局可能有 1~3 条「收到战局配置」） */
export function serverRaid(root) {
  const file = latestServerLog(root);
  if (!file) return null;
  const lines = readTail(file).split(/\r?\n/);

  const cfgIdx = [];
  lines.forEach((ln, i) => { if (ln.includes('收到战局配置')) cfgIdx.push(i); });

  let start = cfgIdx.length ? cfgIdx[cfgIdx.length - 1] : Math.max(0, lines.length - 150);
  // 往前合并同一局的配置请求（相隔 10 分钟内算同一局）
  for (let k = cfgIdx.length - 1; k > 0; k--) {
    const a = timeOf(lines[cfgIdx[k]]);
    const b = timeOf(lines[cfgIdx[k - 1]]);
    if (a && b && a - b <= 10 * 60 * 1000) start = cfgIdx[k - 1];
    else break;
  }

  const events = [];
  for (let i = start; i < lines.length; i++) {
    const m = lines[i].match(/^\[([^\]]+)\]\[(\w+)\]\[([^\]]+)\] (.*)$/);
    if (!m) continue;
    if (!/NoAIBots/.test(m[3])) continue;
    events.push({ time: m[1], level: m[2], text: m[4] });
  }
  const pick = (needle) => events.filter((e) => e.text.includes(needle));

  const configs = pick('收到战局配置');
  const rules = pick('命中规则');
  const tuning = pick('地图参数已调整');
  const requests = pick('AI 生成请求');
  const done = pick('AI 生成完成');
  const caps = pick('AI 同时存活上限');
  const nerfs = pick('校验陷阱');
  const restores = pick('已把上一局残留');

  const map = (configs[0]?.text.match(/location=([a-z0-9_]+)/) || [])[1] || null;
  const amounts = [...new Set(configs.map((c) => (c.text.match(/wavesSettings\.botAmount=(\w+)/) || [])[1]).filter(Boolean))];
  const bossesDisabled = configs.some((c) => /客户端首领开关=false/.test(c.text));
  const generated = done.reduce((sum, d) => {
    const m = d.text.match(/：(\d+)\s*只/);
    return sum + (m ? Number(m[1]) : 0);
  }, 0);

  return {
    file: path.basename(file),
    path: file,
    map,
    amounts,
    bossesDisabled,
    generated,
    batches: done.length,
    events,
    rules,
    tuning,
    requests,
    done,
    caps,
    nerfs,
    restores,
    lastTime: events.length ? events[events.length - 1].time : null,
  };
}

const botCategory = (type) => {
  const s = String(type || '').toLowerCase();
  if (s.startsWith('pmc')) return 'pmc';
  if (s.startsWith('boss')) return 'boss';
  if (s.startsWith('follower') || s.startsWith('sectant')) return 'follower';
  if (s.startsWith('assault') || s.startsWith('marksman')) return 'scav';
  return 'other';
};

/** 客户端最近一局：上限、刷新系统、真正进场的 bot 名单 */
export function clientRaid(root) {
  const file = path.join(root, 'BepInEx', 'LogOutput.log');
  const text = readTail(file, 8 * 1024 * 1024);
  if (!text) return null;
  const lines = text.split(/\r?\n/);

  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('Raid has been started')) { start = i; break; }
  }
  if (start < 0) {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].includes('Running old spawn system')) { start = Math.max(0, i - 8); break; }
    }
  }
  const raid = start >= 0 ? lines.slice(start) : lines.slice(-400);

  const empty = () => ({ scav: 0, playerScav: 0, pmc: 0, boss: 0, follower: 0, other: 0 });
  const counts = empty();
  const names = [];
  let cap = null;
  let oldWaves = null;
  let newSpawn = false;
  let oldSpawn = false;
  let raidCode = null;

  for (const ln of raid) {
    let m;
    if ((m = ln.match(/Set max bot cap for: (\S+) from: (\d+) to: (\d+)/))) {
      cap = { map: m[1], from: Number(m[2]), to: Number(m[3]) };
      continue;
    }
    if ((m = ln.match(/Running old spawn system\. Waves: (\d+)/))) { oldWaves = Number(m[1]); oldSpawn = true; continue; }
    if (ln.includes('Running new spawn system.')) { newSpawn = true; continue; }
    if ((m = ln.match(/Raid Code: (\S+)/))) { raidCode = m[1]; continue; }

    if (ln.includes('Updated player scav bot to use:')) {
      counts.playerScav += 1;
      names.push({ type: 'playerScav', name: 'player scav' });
      continue;
    }
    if ((m = ln.match(/Updated spt bot (.+?): (\S+) to use: \S+ brain/))) {
      const cat = botCategory(m[2]);
      counts[cat] += 1;
      names.push({ type: m[2], name: m[1] });
      continue;
    }
    if ((m = ln.match(/Updated (\S+) bot (.+?) to use: (\S+) brain/))) {
      const cat = botCategory(m[3]);
      counts[cat] += 1;
      names.push({ type: m[3], name: m[2] });
    }
  }

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return {
    file: path.basename(file),
    path: file,
    raidCode,
    cap,
    oldWaves,
    oldSpawn,
    newSpawn,
    counts,
    total,
    names,
  };
}

const fmtCap = (line) => {
  const m = String(line || '').match(/上限: (\d+) → (\d+)(?:（倍率 ([\d.]+)）)?/);
  return m ? { before: Number(m[1]), after: Number(m[2]), scale: m[3] ? Number(m[3]) : null } : null;
};

const LIVE_BOTS_REL = path.join('BepInEx', 'plugins', 'RaidProbe', 'live-bots.json');
const LIVE_BOTS_DLL = path.join('BepInEx', 'plugins', 'RaidProbe', 'RaidProbeClient.dll');
const LIVE_CMD_REL = path.join('BepInEx', 'plugins', 'RaidProbe', 'command.json');
const LIVE_RESULT_REL = path.join('BepInEx', 'plugins', 'RaidProbe', 'command-result.json');
const LIVE_PLUGIN_VERSION = '0.3.0';

/**
 * 往客户端插件丢一条指令（插件每 1 秒轮询 command.json，读完即删）。
 * 目前只有 kill：scope = all | scav | pmc | boss。
 */
export function sendLiveCommand(root, { action = 'kill', scope = 'all' } = {}) {
  const dir = path.join(root, path.dirname(LIVE_CMD_REL));
  const file = path.join(root, LIVE_CMD_REL);
  let dllInstalled = false;
  try { dllInstalled = fs.statSync(path.join(root, LIVE_BOTS_DLL)).isFile(); } catch { /* 没装 */ }
  if (!dllInstalled) {
    return { ok: false, error: '还没装客户端插件 RaidProbeClient（BepInEx\\plugins\\RaidProbe）', file: LIVE_CMD_REL };
  }
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const payload = { id, action, scope, at: new Date().toISOString() };
  try {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    return { ok: false, error: `写指令失败: ${e.message || e}`, file: LIVE_CMD_REL };
  }
  return { ok: true, id, action, scope, file: LIVE_CMD_REL, pluginVersion: LIVE_PLUGIN_VERSION };
}

/** 插件执行完写的回执（command-result.json）。 */
export function liveCommandResult(root) {
  const file = path.join(root, LIVE_RESULT_REL);
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return null; }
  return {
    ...raw,
    file: LIVE_RESULT_REL,
    ageSec: Math.max(0, Math.round((Date.now() - st.mtimeMs) / 1000)),
  };
}

/**
 * 客户端插件「SPT Raid Probe」写出来的实时存活 AI 快照。
 * 插件每 2 秒把 BotsClass 里的 BotOwner 写进 live-bots.json：
 * 名字、WildSpawnType、阵营、是否存活、坐标。
 * 这是唯一能拿到「此刻战局里真正存在的 AI」的渠道（客户端日志只有进场时的 brain 行）。
 */
export function clientLiveBots(root) {
  const file = path.join(root, LIVE_BOTS_REL);
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    let dllInstalled = false;
    try { dllInstalled = fs.statSync(path.join(root, LIVE_BOTS_DLL)).isFile(); } catch { /* 没装 */ }
    return { installed: false, dllInstalled, file: LIVE_BOTS_REL };
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return { installed: true, file: LIVE_BOTS_REL, parseError: String(e.message || e) };
  }
  const ageSec = Math.max(0, Math.round((Date.now() - st.mtimeMs) / 1000));
  const bots = Array.isArray(raw.bots) ? raw.bots : [];
  const byRole = {};
  for (const b of bots) byRole[b.role || '?'] = (byRole[b.role || '?'] || 0) + 1;
  return {
    installed: true,
    file: LIVE_BOTS_REL,
    plugin: raw.plugin || null,
    killedTotal: Number.isFinite(raw.killedTotal) ? raw.killedTotal : 0,
    at: raw.at || null,
    ageSec,
    live: ageSec <= 15,
    count: Number.isFinite(raw.count) ? raw.count : bots.length,
    alive: Number.isFinite(raw.alive) ? raw.alive : bots.filter((b) => b.alive).length,
    byRole,
    bots: bots.slice(0, 200),
    truncated: bots.length > 200,
  };
}

/** 服务端决策 vs 客户端实际：拼成可直接渲染的一组数 */
export function compare(root) {
  const server = serverRaid(root);
  const client = clientRaid(root);
  const live = clientLiveBots(root);
  const notes = [];
  if (!server) notes.push('没找到服务端日志（SPT\\user\\logs\\spt\\spt*.log）');
  if (!client) notes.push('没找到客户端日志（<客户端>\\BepInEx\\LogOutput.log）');
  if (!live.installed && live.dllInstalled) {
    notes.push('客户端插件 RaidProbeClient 已放好，但还没有快照：BepInEx 只在游戏启动时加载插件，重启游戏再进一局战局即可。');
  } else if (!live.installed) {
    notes.push('没装客户端插件 RaidProbeClient（BepInEx\\plugins\\RaidProbe），拿不到「此刻存活」的 AI 列表');
  }

  if (server && client) {
    if (server.rules.length === 0 && server.caps.length === 0 && server.tuning.length === 0) {
      notes.push('服务端这局没有任何“规则修改/上限”日志：命中的规则都是零改动（例如「在线：保持原版节奏」），即原版刷新。');
    }
    if (server.map && client.cap && server.map !== client.cap.map) {
      notes.push(`服务端这局是 ${server.map}，客户端日志里最后一次上限请求是 ${client.cap.map}`);
    }
    if (server.caps.length) {
      const s = fmtCap(server.caps[server.caps.length - 1].text);
      if (s && client.cap && s.after !== client.cap.to) {
        notes.push(`服务端算出的上限是 ${s.after}，客户端实际拿到 ${client.cap.to}（可能还没重新拉取配置）`);
      }
    }
    if (server.generated && client.total === 0) {
      notes.push('服务端已生成档案池，但客户端日志里还没有 bot 进场（读档/加载中或还在读日志）');
    }
    if (!client.oldSpawn && !client.newSpawn) notes.push('客户端还没打印刷新系统信息（可能刚进图）');
  }

  if (live.installed && Array.isArray(live.bots) && live.bots.length) {
    const unknown = live.bots.filter((b) => !b.role || b.role === '?').length;
    if (unknown) {
      notes.push(`客户端插件有 ${unknown} 只没取到类型/名字：旧版插件（0.1.0）的反射路径不对，替换成 0.3.0 并重启游戏即可`);
    }
    if (!live.plugin || live.plugin !== LIVE_PLUGIN_VERSION) {
      notes.push(`客户端插件是 ${live.plugin || '0.1.0/0.2.0（没写版本号）'}，管理器要 0.3.0 才能发「杀 AI」指令（退出游戏后覆盖 dll 再进）`);
    }
    if (client && client.total != null && live.count > 0 && live.count !== client.total) {
      notes.push(`口径差别：插件「此刻存活」${live.count} 只 ≠ 日志「累计进场」${client.total} 只——前者是现在还在战局里的，后者是这局曾经创建过的（含已被打死/清掉的）`);
    }
  }

  return {
    at: new Date().toISOString(),
    server,
    client,
    live,
    liveResult: liveCommandResult(root),
    notes,
  };
}
