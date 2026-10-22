// 客户端启动 + 存档选择 + 无头客户端进程
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';
import { spawn, execSync } from 'node:child_process';
import { BACKUP_DIR, nowStamp, readJson, writeJson } from './core.js';
import { normalizeServerUrl, rememberServer } from './serverlink.js';
import * as game from './game.js';

export function launchPaths(root) {
  return {
    gameExe: path.join(root, 'EscapeFromTarkov.exe'),
    launcherExe: path.join(root, 'SPT', 'SPT.Launcher.exe'),
    launcherConfig: path.join(root, 'SPT', 'user', 'launcher', 'config.json'),
    profilesDir: path.join(root, 'SPT', 'user', 'profiles'),
  };
}

export function readLauncherConfig(root) {
  const p = launchPaths(root);
  if (!fs.existsSync(p.launcherConfig)) {
    return { ok: false, exists: false, file: p.launcherConfig, config: null, error: '没有找到 SPT/user/launcher/config.json' };
  }
  const raw = fs.readFileSync(p.launcherConfig, 'utf8');
  let config = null;
  try { config = JSON.parse(raw); } catch { /* 下面返回错误 */ }
  if (!config) return { ok: false, exists: true, file: p.launcherConfig, config: null, error: '启动器配置解析失败' };
  return { ok: true, exists: true, file: p.launcherConfig, config };
}

/** 当前自动登录的存档名 */
export function activeProfileName(root) {
  const c = readLauncherConfig(root);
  if (!c.ok) return null;
  return (c.config.Server && c.config.Server.AutoLoginCreds && c.config.Server.AutoLoginCreds.Username) || null;
}

/** 目标服务端是不是本机 */
export function isLocalUrl(url) {
  let host = '';
  try { host = new URL(String(url || '')).hostname.toLowerCase(); } catch { return /127\.0\.0\.1|localhost/i.test(String(url || '')); }
  return host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]';
}

/** 当前连接的服务端（本机 / 远程） */
export function serverTarget(root) {
  const c = readLauncherConfig(root);
  if (!c.ok) return { ok: false, error: c.error, url: '', name: '', autoLogin: false, isLocal: true };
  const s = c.config.Server || {};
  const url = String(s.Url || '');
  return {
    ok: true,
    url,
    name: String(s.Name || ''),
    autoLogin: c.config.UseAutoLogin !== false,
    isLocal: isLocalUrl(url),
    file: c.file,
  };
}

/** 启动器认的游戏根目录：必须有 EscapeFromTarkov.exe 和 BepInEx\plugins\spt\spt-core.dll */
export function isGamePathUsable(root, gamePath) {
  if (!gamePath) return false;
  let norm;
  try { norm = path.resolve(String(gamePath)); } catch { return false; }
  if (norm === path.resolve(root)) {
    return fs.existsSync(path.join(norm, 'EscapeFromTarkov.exe'))
      && fs.existsSync(path.join(norm, 'BepInEx', 'plugins', 'spt', 'spt-core.dll'));
  }
  return fs.existsSync(path.join(norm, 'EscapeFromTarkov.exe'))
    && fs.existsSync(path.join(norm, 'BepInEx', 'plugins', 'spt', 'spt-core.dll'));
}

/**
 * 修正启动器配置里的 GamePath。
 * 注意：GamePath 必须是**游戏根目录**（EscapeFromTarkov.exe 所在层），
 * 不是 SPT 子目录；写错时启动器会报 `Core dll mismatch :: FAILED` 并且不启动游戏。
 * 返回 true 表示改过。
 */
export function ensureGamePath(root, cfg) {
  const want = `${root}${path.sep}`;
  if (isGamePathUsable(root, cfg.GamePath)) {
    if (!/[\\/]$/.test(String(cfg.GamePath))) cfg.GamePath = want;
    return false;
  }
  cfg.GamePath = want;
  return true;
}

/** 检查 + 就地修复启动器配置（写前备份），返回是否需要用户重启启动器 */
export function repairLauncherConfig(root) {
  const c = readLauncherConfig(root);
  if (!c.ok) return { ok: false, error: c.error, gamePath: null, fixed: false };
  const cfg = c.config;
  const before = cfg.GamePath;
  const fixed = ensureGamePath(root, cfg);
  if (fixed) {
    try {
      const dir = path.join(BACKUP_DIR, 'config');
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(c.file, path.join(dir, `${nowStamp()}_launcher_config.json`));
    } catch { /* ignore */ }
    const tmp = `${c.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, c.file);
  }
  return { ok: true, file: c.file, gamePath: cfg.GamePath, before, fixed };
}

/**
 * 设置要连接的服务端（别人开的服务器就填它的地址）。
 * url 为空时回到本机默认 https://127.0.0.1:<port>
 */
export function setServerTarget(root, { url, name, autoLogin } = {}) {
  const c = readLauncherConfig(root);
  if (!c.ok) throw new Error(c.error);

  const cfg = c.config;
  cfg.Server = cfg.Server || {};

  let target = String(url || '').trim();
  if (!target) {
    const port = (cfg.Server.SPT && cfg.Server.SPT.http && cfg.Server.SPT.http.port) || 6969;
    target = `https://127.0.0.1:${port}`;
  }
  // 用户可能只填了 IP、IP:端口、带路径的地址，统一补成 https://host:port
  const norm = normalizeServerUrl(target);
  if (!norm.ok) throw new Error(`服务端地址不对：${norm.error}（例如 https://1.2.3.4:6969）`);

  cfg.Server.Url = norm.url;
  if (name !== undefined) cfg.Server.Name = String(name || 'SPT').trim() || 'SPT';
  if (!cfg.Server.Name) cfg.Server.Name = 'SPT';
  if (autoLogin !== undefined) cfg.UseAutoLogin = !!autoLogin;
  ensureGamePath(root, cfg);

  try {
    const dir = path.join(BACKUP_DIR, 'config');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(c.file, path.join(dir, `${nowStamp()}_launcher_config.json`));
  } catch { /* 备份失败不阻断 */ }

  const tmp = `${c.file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, c.file);

  // 记进「保存过的服务端地址」，方便以后一键切换
  try { rememberServer(norm.url, norm.isLocal ? '本机服务端' : (cfg.Server.Name || '')); } catch { /* 记不住不影响主流程 */ }

  return { ok: true, ...serverTarget(root) };
}

/** 存档列表 + 当前激活项 */
export function profileList(root) {
  const active = activeProfileName(root);
  const list = game.listProfiles(root).map((p) => ({
    ...p,
    active: !!active && String(p.nickname || '').toLowerCase() === String(active).toLowerCase(),
  }));
  return { ok: true, active, list, launcherConfig: readLauncherConfig(root) };
}

/** 设为下次启动游戏时自动登入的存档 */
export function setActiveProfile(root, username) {
  const c = readLauncherConfig(root);
  if (!c.ok) throw new Error(c.error);
  const target = String(username || '').trim();
  if (!target) throw new Error('存档名不能为空');
  const profiles = game.listProfiles(root);
  const hit = profiles.find((p) => String(p.nickname || '').toLowerCase() === target.toLowerCase());
  if (!hit) throw new Error(`没有找到存档「${target}」`);

  const cfg = c.config;
  cfg.Server = cfg.Server || {};
  cfg.Server.AutoLoginCreds = cfg.Server.AutoLoginCreds || {};
  cfg.Server.AutoLoginCreds.Username = target;
  cfg.UseAutoLogin = true;
  ensureGamePath(root, cfg);
  if (!cfg.Server.Name) cfg.Server.Name = 'SPT';
  if (!cfg.Server.Url) cfg.Server.Url = 'https://127.0.0.1:6969';

  // 备份
  try {
    const dir = path.join(BACKUP_DIR, 'config');
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(c.file, path.join(dir, `${nowStamp()}_launcher_config.json`));
  } catch { /* 备份失败不阻断 */ }

  const tmp = `${c.file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, c.file);
  return { ok: true, active: target, file: c.file, profileId: hit.id || hit.file };
}

async function waitForServer(root, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (game.isServerRunning(root)) {
      const ping = await game.pingServer(root);
      if (ping && ping.ok) return true;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  return false;
}

function detachedSpawn(exe, args, cwd) {
  const child = spawn(exe, args, { cwd, detached: true, stdio: 'ignore', windowsHide: false });
  child.unref();
  return child.pid;
}

/**
 * 启动游戏客户端（走 SPT 启动器，会按 launcher/config.json 自动登录到当前存档）。
 * 只在「连的是本机服务端」且显式要求时才拉起本地服务端；连别人的服务器时不动本地服务端。
 */
export async function launchClient(root, opts = {}) {
  const p = launchPaths(root);
  if (!fs.existsSync(p.launcherExe)) throw new Error(`没有找到启动器：${p.launcherExe}`);
  if (isClientRunning(root)) throw new Error('游戏或启动器已经在运行了');

  // 启动器会先校验 <GamePath>\BepInEx\plugins\spt\spt-core.dll，路径不对就静默失败
  const repaired = repairLauncherConfig(root);
  if (!repaired.ok) throw new Error(`启动器配置有问题：${repaired.error}`);

  const target = serverTarget(root);
  const local = target.ok ? target.isLocal : true;

  let serverStarted = false;
  if (opts.ensureServer !== false && local) {
    const running = game.isServerRunning(root);
    if (!running) {
      const r = await game.startServer(root);
      if (!r.ok) throw new Error(`服务端启动失败：${r.error || '未知原因'}`);
      serverStarted = true;
    }
    const ready = await waitForServer(root, opts.waitMs || 60000);
    if (!ready) throw new Error('本地服务端 60 秒内没有就绪，请查看服务器日志');
  }

  const pid = detachedSpawn(p.launcherExe, [], path.dirname(p.launcherExe));
  return {
    ok: true,
    pid,
    serverStarted,
    target: target.ok ? target.url : null,
    targetIsLocal: local,
    activeProfile: activeProfileName(root),
    gamePathFixed: repaired.fixed,
    gamePath: repaired.gamePath,
    launcher: p.launcherExe,
  };
}

// ---- 直接启动客户端（绕过 SPT.Launcher.exe）
// SPT 服务端：请求体要 zlib-deflate，响应体也是 deflate 压缩的，自签证书要跳过校验
function inflateAuto(buf) {
  if (!buf || !buf.length) return '';
  try { return zlib.inflateSync(buf).toString('utf8'); } catch { /* 不是 deflate */ }
  try { return zlib.gunzipSync(buf).toString('utf8'); } catch { /* 不是 gzip */ }
  return buf.toString('utf8');
}

function serverPostJson(baseUrl, apiPath, payload, timeoutMs = 20000) {
  const url = new URL(apiPath, baseUrl);
  const body = zlib.deflateSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const isHttps = url.protocol === 'https:';
  const mod = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'deflate',
        'content-length': body.length,
        accept: 'application/json',
      },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: inflateAuto(Buffer.concat(chunks)).trim() }));
    });
    req.on('timeout', () => req.destroy(new Error('请求服务端超时')));
    req.on('error', (e) => reject(new Error(`连不上服务端 ${baseUrl}：${e.message}`)));
    req.write(body);
    req.end();
  });
}

function serverRequest(method, baseUrl, apiPath, payload, timeoutMs = 20000) {
  const url = new URL(apiPath, baseUrl);
  const body = payload === undefined ? null : zlib.deflateSync(Buffer.from(JSON.stringify(payload), 'utf8'));
  const isHttps = url.protocol === 'https:';
  const mod = isHttps ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request({
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method,
      rejectUnauthorized: false,
      headers: body ? {
        'content-type': 'application/json',
        'content-encoding': 'deflate',
        'content-length': body.length,
        accept: 'application/json',
      } : { accept: 'application/json' },
      timeout: timeoutMs,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: inflateAuto(Buffer.concat(chunks)).trim() }));
    });
    req.on('timeout', () => req.destroy(new Error('请求服务端超时')));
    req.on('error', (e) => reject(new Error(`连不上服务端 ${baseUrl}：${e.message}`)));
    if (body) req.write(body);
    req.end();
  });
}

function serverBase(root, serverUrl) {
  const target = serverTarget(root);
  const base = String(serverUrl || (target.ok ? target.url : '') || '').replace(/\/+$/, '');
  if (!base) throw new Error('没有配置服务端地址，先在「服务端地址」里填一个');
  return base;
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

/** SPT 启动器里的「版本」（存档模板）：Standard / Left Behind / … 带中文说明 */
export async function profileTypes(root, { serverUrl } = {}) {
  const base = serverBase(root, serverUrl);
  const r = await serverRequest('GET', base, '/launcher/v2/types');
  if (r.status !== 200) throw new Error(`读取存档版本失败（HTTP ${r.status}）`);
  const json = parseJson(r.text, {});
  return json.Response || json || {};
}

/** 服务端在线存档列表（带等级 / 版本，用于补全本地文件扫描结果） */
export async function serverProfiles(root, { serverUrl } = {}) {
  const base = serverBase(root, serverUrl);
  const r = await serverRequest('GET', base, '/launcher/v2/profiles');
  if (r.status !== 200) throw new Error(`读取在线存档失败（HTTP ${r.status}）`);
  const json = parseJson(r.text, {});
  return Array.isArray(json.Response) ? json.Response : [];
}

/** 在服务端新建存档（= SPT 启动器的「注册」） */
export async function createProfile(root, { username, password = '', edition = 'Standard', serverUrl } = {}) {
  const base = serverBase(root, serverUrl);
  const name = String(username || '').trim();
  if (!name) throw new Error('用户名不能为空');
  if (!/^[\w.-]{2,24}$/.test(name)) throw new Error('用户名只能用字母、数字、下划线、点或短横线，2–24 位');
  const types = await profileTypes(root, { serverUrl: base }).catch(() => ({}));
  if (Object.keys(types).length && !types[edition]) throw new Error(`没有这个版本：${edition}`);
  const r = await serverRequest('POST', base, '/launcher/v2/register', { username: name, password, edition });
  if (r.status !== 200) throw new Error(`新建失败（HTTP ${r.status}）${r.text ? `：${r.text.slice(0, 200)}` : ''}`);
  const json = parseJson(r.text, {});
  if (json.Response !== true) throw new Error(`服务端拒绝新建：${name}（可能同名存档已存在）`);
  return { ok: true, username: name, edition, profiles: json.Profiles || [] };
}

/** 删除服务端存档（谨慎） */
export async function removeProfile(root, { username, serverUrl } = {}) {
  const base = serverBase(root, serverUrl);
  const name = String(username || '').trim();
  if (!name) throw new Error('用户名不能为空');
  const r = await serverRequest('POST', base, '/launcher/v2/remove', { username: name, password: '' });
  if (r.status !== 200) throw new Error(`删除失败（HTTP ${r.status}）${r.text ? `：${r.text.slice(0, 200)}` : ''}`);
  const json = parseJson(r.text, {});
  if (json.Response !== true) throw new Error(`服务端拒绝删除：${name}`);
  return { ok: true, username: name, profiles: json.Profiles || [] };
}

/** 用存档名向 SPT 服务端换 profileId（游戏启动参数里的 token） */
export async function serverLogin(root, { username, serverUrl } = {}) {
  const target = serverTarget(root);
  const base = String(serverUrl || (target.ok ? target.url : '') || '').replace(/\/+$/, '');
  if (!base) throw new Error('没有配置服务端地址，先在「服务端地址」里填一个');
  const user = String(username || activeProfileName(root) || '').trim();
  if (!user) throw new Error('没有可用的账号名，先在「要载入的存档」里选一个存档');
  const r = await serverPostJson(base, '/launcher/profile/login', { username: user, password: '' });
  if (r.status !== 200) throw new Error(`服务端登录失败（HTTP ${r.status}）：${r.text || '无响应内容'}`);
  const token = String(r.text || '').replace(/^"|"$/g, '').trim();
  if (!token || /^(invalid|error|fail)/i.test(token)) throw new Error(`服务端没有返回有效存档 ID：${token || '(空)'}`);
  return { token, username: user, server: base };
}

/**
 * 直接启动游戏本体：先用存档名登录服务端拿 profileId，再带
 * `-token=<profileId> -config={"BackendUrl":…,"Version":"live"}` 起 EscapeFromTarkov.exe。
 * 不经过 SPT.Launcher.exe。
 */
export async function launchGameDirect(root, opts = {}) {
  const p = launchPaths(root);
  if (!fs.existsSync(p.gameExe)) throw new Error(`没有找到游戏本体：${p.gameExe}`);
  if (!fs.existsSync(path.join(root, 'BepInEx', 'plugins', 'spt', 'spt-core.dll'))) {
    throw new Error('客户端里没有 BepInEx\\plugins\\spt\\spt-core.dll，这不是装好 SPT 的客户端');
  }
  if (isClientRunning(root)) throw new Error('游戏或启动器已经在运行了');

  const target = serverTarget(root);
  const base0 = String(opts.serverUrl || (target.ok ? target.url : '') || '').replace(/\/+$/, '');

  // 连本机服务端但还没开 → 先拉起来（连远程服务器时不动本地服务端）
  const st = game.isServerRunning(root);
  const serverUp = !!(st && st.running);
  if (opts.ensureServer && base0 && isLocalUrl(base0) && !serverUp) {
    const started = await game.startServer(root);
    if (!started.ok) throw new Error(`本地服务端启动失败：${started.error || '未知原因'}`);
    if (!(await waitForServer(root, opts.waitMs || 90000))) throw new Error('本地服务端 90 秒内没有就绪，请看「服务器」页日志');
  }

  const info = await serverLogin(root, { username: opts.username, serverUrl: base0 });
  const config = JSON.stringify({ BackendUrl: info.server, Version: 'live' });
  const args = [`-token=${info.token}`, `-config=${config}`];
  const pid = detachedSpawn(p.gameExe, args, root);
  return {
    ok: true,
    pid,
    username: info.username,
    server: info.server,
    tokenHint: `${info.token.slice(0, 8)}…`,
    gameExe: p.gameExe,
  };
}

/** 启动无头客户端（FikaHeadlessManager.exe；允许嵌套一层子目录） */export function launchHeadless(dir, exeHint) {
  if (!dir || !fs.existsSync(dir)) throw new Error('无头客户端目录不存在');
  const candidates = ['FikaHeadlessManager.exe', 'FikaHeadlessLauncher.exe'];
  let exe = null;
  if (exeHint && fs.existsSync(exeHint)) exe = exeHint;
  if (!exe) {
    for (const c of candidates) {
      const direct = path.join(dir, c);
      if (fs.existsSync(direct)) { exe = direct; break; }
    }
  }
  if (!exe) {
    for (const c of candidates) {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { /* ignore */ }
      for (const e of entries) {
        if (!e.isDirectory() || /^(\.|BepInEx|SPT|EFT|Logs|logs|cache|Cache|node_modules)$/i.test(e.name)) continue;
        const f = path.join(dir, e.name, c);
        if (fs.existsSync(f)) { exe = f; break; }
      }
      if (exe) break;
    }
  }
  if (!exe) throw new Error(`在 ${dir} 里没有找到 FikaHeadlessManager.exe`);
  // FikaHeadlessManager 需要真实控制台：没有控制台时它卡在 Console.ReadKey（打印
  // "Press 'g' ... or wait 3 seconds" 之后就不动了），所以用 cmd start 起一个隐藏的控制台
  let pid;
  if (/^FikaHeadlessManager\.exe$/i.test(path.basename(exe))) {
    const child = spawn('cmd.exe', ['/c', 'start', '""', '/MIN', '/D', path.dirname(exe), path.basename(exe)], {
      detached: true, stdio: 'ignore', windowsHide: true,
    });
    child.unref();
    pid = child.pid;
  } else {
    pid = detachedSpawn(exe, [], path.dirname(exe));
  }
  return { ok: true, pid, exe };
}

/** 列出运行在某个目录下的游戏 / 管理器进程（按 exe 完整路径前缀判断） */
export function processesUnder(dir) {
  const base = path.resolve(dir).toLowerCase();
  const ps = 'Get-Process EscapeFromTarkov,FikaHeadlessManager -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Id.ToString() + \'|\' + $_.Path } catch { } }';
  let out;
  try {
    out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  } catch { return []; }
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((line) => {
    const i = line.indexOf('|');
    return { pid: Number(line.slice(0, i)), exe: line.slice(i + 1) };
  }).filter((p) => p.pid > 0 && p.exe && path.resolve(p.exe).toLowerCase().startsWith(base));
}

/** 停掉某个无头目录下的所有进程（管理器 + 那份 EscapeFromTarkov.exe） */
export function stopHeadless(dir) {
  if (!dir) throw new Error('没有指定无头目录');
  // 先杀管理器再杀游戏，否则管理器会把游戏再拉起来
  const list = processesUnder(dir).sort((a, b) => {
    const am = /FikaHeadless(Manager|Launcher)\.exe$/i.test(a.exe) ? 0 : 1;
    const bm = /FikaHeadless(Manager|Launcher)\.exe$/i.test(b.exe) ? 0 : 1;
    return am - bm;
  });
  const killed = [];
  for (const p of list) {
    try {
      execSync(`taskkill /F /T /PID ${p.pid}`, { windowsHide: true, stdio: 'ignore', timeout: 15000 });
      killed.push(p.pid);
    } catch { /* 已经退出或没权限，继续 */ }
  }
  return { ok: true, dir, killed, count: killed.length, found: list.length };
}

/** 在资源管理器里打开目录 */
export function openDir(dir) {
  if (!dir || !fs.existsSync(dir)) throw new Error('目录不存在');
  spawn('explorer.exe', [dir], { detached: true, stdio: 'ignore' }).unref();
  return { ok: true, dir };
}

/** 列出所有 EscapeFromTarkov.exe 的完整路径（拿不到路径时返回 null） */
function gameProcessPaths() {
  const ps = 'Get-Process EscapeFromTarkov -ErrorAction SilentlyContinue | ForEach-Object { try { $_.Path } catch { } }';
  try {
    const out = execSync(`powershell -NoProfile -Command "${ps}"`, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
    return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * 主客户端 / 启动器是否在运行。
 * 只认 `root` 目录下的 EscapeFromTarkov.exe —— 无头客户端（另一份副本）不算。
 */
export function isClientRunning(root) {
  const base = root ? path.resolve(root).toLowerCase() : '';
  const paths = gameProcessPaths();
  if (paths && paths.length) {
    if (!base) return true;
    if (paths.some((p) => path.resolve(p).toLowerCase().startsWith(base))) return true;
  }
  // 拿不到路径（权限等）时退回按进程名判断；指定了 root 就再看启动器
  if (!paths) {
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq EscapeFromTarkov.exe" /NH', { encoding: 'utf8', windowsHide: true });
      if (/EscapeFromTarkov\.exe/i.test(out)) return true;
    } catch { /* ignore */ }
  }
  if (base) {
    try {
      const out2 = execSync('tasklist /FI "IMAGENAME eq SPT.Launcher.exe" /NH', { encoding: 'utf8', windowsHide: true });
      // 启动器只有一个，只要开着就认为占用（避免重复拉起）
      return /SPT\.Launcher\.exe/i.test(out2);
    } catch { return false; }
  }
  return false;
}
