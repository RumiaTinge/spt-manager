// live.js — 实时窗口：服务端 / 无头主机 / NoAIBots 三路日志，各走各的
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { latestSptLog, isServerRunning } from './game.js';

/** 从大文件尾部读 n 行（不把整个日志读进内存） */
export function tailFile(file, n = 200) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const maxBytes = 1024 * 1024; // 只读最后 1MB，够几百行
  const start = Math.max(0, st.size - maxBytes);
  let buf;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      buf = Buffer.alloc(Math.min(st.size, maxBytes));
      fs.readSync(fd, buf, 0, buf.length, start);
    } finally { fs.closeSync(fd); }
  } catch { return null; }
  const lines = buf.toString('utf8').split(/\r?\n/).filter((l) => l.trim());
  return { file, size: st.size, mtime: st.mtime.toISOString(), lines: lines.slice(-n) };
}

/* ------------------------------ 服务端窗口 ------------------------------ */

export function serverPane(root, n = 200) {
  const info = isServerRunning();
  const log = latestSptLog(root);
  const tail = log ? tailFile(log, n) : null;
  return {
    kind: 'server',
    title: 'SPT 服务端',
    running: !!(info && info.running),
    pid: (info && info.pid) || null,
    byUs: !!(info && info.byUs),
    file: log,
    ...(tail || { lines: [], size: 0, mtime: null }),
  };
}

/* ----------------------------- 无头主机窗口 ----------------------------- */

function headlessLogPath(dir) {
  return path.join(dir, 'BepInEx', 'LogOutput.log');
}

/** 无头目录：设置里的 + 主目录自己（单份切换）+ 主目录旁边的兄弟目录（自动发现） */
function headlessDirs(root, settings = {}) {
  const dirs = [];
  const seen = new Set();
  const push = (d) => {
    if (!d) return;
    let key;
    try { key = path.resolve(d).toLowerCase(); } catch { return; }
    if (seen.has(key)) return;
    seen.add(key);
    dirs.push(d);
  };
  (settings.headlessDirs || []).forEach(push);
  push(root);
  try {
    const parent = path.dirname(path.resolve(root));
    for (const e of fs.readdirSync(parent, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const d = path.join(parent, e.name);
      if (fs.existsSync(path.join(d, 'FikaHeadlessManager.exe'))) push(d);
    }
  } catch { /* ignore */ }
  return dirs.filter((d) => fs.existsSync(d));
}

let procCache = { at: 0, list: [] };

/** 一次 PowerShell 拿到所有无头相关进程（带路径），1.5 秒内复用 */
function headlessProcs() {
  if (Date.now() - procCache.at < 1500) return procCache.list;
  const ps = "Get-Process EscapeFromTarkov,FikaHeadlessManager,FikaHeadlessLauncher -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Id.ToString() + '|' + $_.Path } catch { } }";
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: 8000 });
  const list = [];
  for (const line of String(r.stdout || '').split(/\r?\n/)) {
    const [pid, exe] = line.split('|');
    if (!pid || !exe) continue;
    list.push({ pid: Number(pid), exe, dir: path.dirname(exe) });
  }
  procCache = { at: Date.now(), list };
  return list;
}

function procsUnder(dir, procs) {
  const key = path.resolve(dir).toLowerCase();
  return procs.filter((p) => {
    try { return path.resolve(p.dir).toLowerCase().startsWith(key); } catch { return false; }
  });
}

function stateFromTail(lines, running) {
  if (!running) {
    const tail = (lines || []).slice(-40).join('\n');
    return /Exiting\.\.\.|Native Crash Reporting/.test(tail) ? 'exited' : 'idle';
  }
  const tail = (lines || []).slice(-40).join('\n');
  if (/Connected to HeadlessWebSocket/.test(tail)) return 'connected';
  if (/Exiting\.\.\.|Native Crash Reporting/.test(tail)) return 'exited';
  return 'starting';
}

/** 这份客户端里 Fika.Headless 是不是启用状态（.disabled 不算） */
function headlessEnabled(dir) {
  return [
    path.join(dir, 'BepInEx', 'plugins', 'Fika', 'Fika.Headless.dll'),
    path.join(dir, 'BepInEx', 'plugins', 'Fika.Headless', 'Fika.Headless.dll'),
  ].some((p) => fs.existsSync(p));
}

/** 每个无头目录一个窗口，标出哪个在跑、日志到哪一步 */
export function headlessPanes(root, settings = {}, n = 200) {
  const procs = headlessProcs();
  const explicit = new Set((settings.headlessDirs || []).map((d) => {
    try { return path.resolve(d).toLowerCase(); } catch { return String(d).toLowerCase(); }
  }));
  const panes = headlessDirs(root, settings)
    .map((dir) => {
      const under = procsUnder(dir, procs);
      const managerProc = under.find((p) => /FikaHeadless(Manager|Launcher)\.exe$/i.test(p.exe));
      const tarkovProc = under.find((p) => /EscapeFromTarkov\.exe$/i.test(p.exe));
      const enabled = headlessEnabled(dir);
      let key = dir.toLowerCase();
      try { key = path.resolve(dir).toLowerCase(); } catch { /* ignore */ }
      // 无头窗口只列真的能当无头的目录：插件启用、或用户在设置里显式加过
      if (!enabled && !explicit.has(key)) return null;
      const running = !!(managerProc || (enabled && tarkovProc));
      const file = headlessLogPath(dir);
      const tail = tailFile(file, n);
      return {
        kind: 'headless',
        title: path.basename(dir),
        dir,
        state: stateFromTail(tail && tail.lines, running),
        running,
        pluginEnabled: enabled,
        pid: managerProc ? managerProc.pid : (running && tarkovProc ? tarkovProc.pid : null),
        file,
        ...(tail || { lines: [], size: 0, mtime: null }),
      };
    })
    .filter(Boolean);
  panes.sort((a, b) => {
    const rank = (p) => (p.running ? 0 : p.mtime ? 1 : 2);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return String(b.mtime || '').localeCompare(String(a.mtime || ''));
  });
  return panes;
}

/* ----------------------------- NoAIBots 窗口 ---------------------------- */

const AI_LINE = /NoAIBots|AI 同时存活上限|bot最高限制|maxCap|BossLocationSpawn|战局配置|botAmount|校验陷阱|Validation failed/i;

/** 服务端日志里跟 AI / NoAIBots 有关的行，单独拎出来 */
export function aiPane(root, n = 200) {
  const log = latestSptLog(root);
  if (!log) return { kind: 'ai', lines: [], size: 0, file: null, mtime: null, matched: 0 };
  const tail = tailFile(log, 4000);
  if (!tail) return { kind: 'ai', lines: [], size: 0, file: log, mtime: null, matched: 0 };
  const hits = tail.lines.filter((l) => AI_LINE.test(l));
  return {
    kind: 'ai',
    lines: hits.slice(-n),
    matched: hits.length,
    size: tail.size,
    mtime: tail.mtime,
    file: log,
  };
}

/* --------------------------- 控制台快速编辑 ---------------------------- */

const REG_PATH = 'HKCU\\Console';

/** 读 HKCU\Console\QuickEdit（没设过 = 默认开启） */
export function quickEditEnabled() {
  const r = spawnSync('reg.exe', ['query', REG_PATH, '/v', 'QuickEdit'], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) return true;
  const m = /QuickEdit\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(r.stdout || '');
  return m ? parseInt(m[1], 16) !== 0 : true;
}

/**
 * 关闭 / 开启「快速编辑模式」。
 * 开着的时候，只要在控制台窗口里点一下鼠标，进程的输出就会被冻住，按回车才恢复 —— 无头主机窗口卡住就是这个。
 */
export function setQuickEdit(enabled) {
  const value = enabled ? '1' : '0';
  const r = spawnSync('reg.exe', ['add', REG_PATH, '/v', 'QuickEdit', '/t', 'REG_DWORD', '/d', value, '/f'], {
    encoding: 'utf8', windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`写入注册表失败: ${(r.stderr || r.stdout || '').trim()}`);
  return { ok: true, enabled: !!enabled };
}

/** 启动时兜底：开着就关掉，返回是否改动过 */
export function ensureQuickEditOff() {
  try {
    if (!quickEditEnabled()) return { changed: false, enabled: false };
    setQuickEdit(false);
    return { changed: true, enabled: false };
  } catch {
    return { changed: false, enabled: true, error: true };
  }
}
