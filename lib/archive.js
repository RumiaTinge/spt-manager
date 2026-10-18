// archive.js — 解析 mod 压缩包（zip / 7z / rar），识别包结构，并在导入时归类到正确目录
//
// SPT mod 包没有统一标准，常见结构：
//   1) SPT/user/mods/<模组名>/...            -> 服务端模组
//   2) BepInEx/plugins/<模组名>/...          -> 客户端插件
//   3) BepInEx/patchers/*.dll                -> 预加载器
//   4) 外面再套一层 "XXX-1.0.7/" 之类的目录
//   5) 直接是 <模组名>/...（模组名目录里含 dll + database/bundles/wwwroot）
// 一个包同时含服务端与客户端部分，或者含多个模组目录 → 判定为“合集”。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { copyDir, moveDir, dirSize, nowStamp, BACKUP_DIR, DATA_DIR } from './core.js';

const EXTRACTOR_CANDIDATES = [
  'C:\\Program Files\\7-Zip\\7z.exe',
  'C:\\Program Files (x86)\\7-Zip\\7z.exe',
  'C:\\Program Files\\Bandizip\\bz.exe',
  'C:\\Program Files\\WinRAR\\WinRAR.exe',
  'C:\\Windows\\System32\\tar.exe',
];

let cachedExtractor;

/** 找到可用的解包器（7z 优先，tar 作为 Windows 自带兜底） */
export function findExtractor() {
  if (cachedExtractor !== undefined) return cachedExtractor;
  for (const p of EXTRACTOR_CANDIDATES) {
    if (fs.existsSync(p)) { cachedExtractor = p; return p; }
  }
  cachedExtractor = null;
  return null;
}

function isTar(exe) {
  return /\\tar\.exe$/i.test(exe || '');
}

const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.001']);

/** 列出压缩包里的条目：{ path, size, dir } */
export function listArchive(file) {
  const exe = findExtractor();
  if (!exe) throw new Error('未找到可用的解包器（7-Zip / Bandizip / tar）');
  const ext = path.extname(String(file || '')).toLowerCase();
  if (!ARCHIVE_EXTS.has(ext)) throw new Error(`不支持的文件类型（${ext || '无扩展名'}），请选择 .zip / .7z / .rar 压缩包`);

  let entries = [];
  if (isTar(exe)) {
    const r = spawnSync(exe, ['-tf', file], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) throw new Error(`无法读取压缩包: ${decodeOut(r.stderr) || 'tar 失败'}`);
    entries = r.stdout.toString('utf8').split(/\r?\n/).filter(Boolean).map((p) => ({
      path: p.replace(/\\/g, '/'),
      size: 0,
      dir: p.endsWith('/'),
    }));
  } else {
    const r = spawnSync(exe, ['l', '-slt', '-ba', '-sccUTF-8', file], { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 });
    if (r.status !== 0) {
      const raw = decodeOut(r.stderr) || decodeOut(r.stdout);
      const hint = /Cannot open the file as archive|Is not archive/i.test(raw) ? '这个文件不是压缩包或已损坏' : raw;
      throw new Error(`无法读取压缩包: ${hint.slice(0, 300)}`);
    }
    const txt = r.stdout.toString('utf8');
    let cur = null;
    for (const line of txt.split(/\r?\n/)) {
      if (line.startsWith('Path = ')) {
        if (cur) entries.push(cur);
        cur = { path: line.slice(7).replace(/\\/g, '/'), size: 0, dir: false };
      } else if (cur && line.startsWith('Size = ')) {
        cur.size = Number(line.slice(7)) || 0;
      } else if (cur && line.startsWith('Attributes = ')) {
        if (/\bD/.test(line.slice(13))) cur.dir = true;
      }
    }
    if (cur) entries.push(cur);
  }
  return entries;
}

/** 7z 的提示信息统一转成可读文本（-sccUTF-8 之后通常是 UTF-8） */
function decodeOut(buf) {
  if (!buf) return '';
  const s = buf.toString('utf8');
  return s.replace(/\uFFFD+/g, '?').trim();
}

/**
 * 分析包结构：把条目归类到 server / plugin / patcher 的目标目录
 * @returns {{kind:'single'|'collection'|'unknown', groups:Array<{type:string,name:string,srcRel:string,fileCount:number,size:number}>, warnings:string[]}}
 */
export function analyzePackage(entries) {
  const files = entries.filter((e) => !e.dir && e.path && !e.path.endsWith('/'));
  const warnings = [];
  const lowPaths = files.map((f) => f.path.toLowerCase());

  // 先排除“根本不是模组”的包：SPT/游戏本体安装包、启动器/工具
  const isSptInstall = lowPaths.some((p) => /(^|\/)spt\/spt_data\//.test(p) || /(^|\/)spt\/spt\.server\.exe$/.test(p) || /(^|\/)bepinex\/core\/bepinex\.core\.dll$/.test(p));
  const isGameInstall = lowPaths.some((p) => /(^|\/)escapefromtarkov\.exe$/.test(p)) || lowPaths.some((p) => /(^|\/)escapefromtarkov_data\//.test(p));
  if (isSptInstall || isGameInstall) {
    return {
      kind: 'spt-install', groups: [], modCount: 0, distinctModNames: 0,
      warnings: [isSptInstall ? '这是 SPT 本体安装包，不是模组；更新服务端请直接覆盖 SPT 目录' : '这是游戏本体安装包，不是模组，请用官方启动器更新游戏'],
    };
  }

  // 找到每个路径的关键锚点，去掉外层包装目录
  const groups = [];
  const seen = new Set();
  const pushGroup = (type, name, srcRel, count, size) => {
    const key = `${type}|${name}|${srcRel}`;
    if (seen.has(key)) return;
    seen.add(key);
    groups.push({ type, name, srcRel, fileCount: count, size });
  };

  for (const f of files) {
    const segs = f.path.split('/').filter(Boolean);
    const low = segs.map((s) => s.toLowerCase());

    // SPT/user/mods/<name>/...
    let idx = low.lastIndexOf('mods');
    if (idx >= 0 && idx >= 1 && low[idx - 1] === 'user' && idx + 1 < segs.length && segs[idx + 1]) {
      const anchorIdx = idx - 1; // user
      const rel = segs.slice(0, idx + 2).join('/');
      pushGroup('server', segs[idx + 1], rel, 0, 0);
      continue;
    }
    // BepInEx/plugins/<name>/... 或 BepInEx/plugins/<file>.dll
    idx = low.indexOf('bepinex');
    if (idx >= 0 && low[idx + 1] === 'plugins' && segs.length > idx + 2) {
      // 兼容 plugins/<name>/files 与 plugins/<file>.dll
      const rel = segs.slice(0, idx + 3).join('/');
      pushGroup('plugin', segs[idx + 2], rel, 0, 0);
      continue;
    }
    if (idx >= 0 && low[idx + 1] === 'patchers' && segs.length > idx + 2) {
      const rel = segs.slice(0, idx + 3).join('/');
      pushGroup('patcher', segs[idx + 2], rel, 0, 0);
      continue;
    }
  }

  // 统计每个分组的文件数与体积
  for (const g of groups) {
    const prefix = g.srcRel + '/';
    const inGroup = files.filter((f) => f.path === g.srcRel || f.path.startsWith(prefix));
    g.fileCount = inGroup.length;
    g.size = inGroup.reduce((s, x) => s + (x.size || 0), 0);
  }

  // 没有任何锚点：整个包就是一个模组（顶层目录名 / 包名）
  if (!groups.length) {
    const topDirs = new Set();
    for (const f of files) {
      const segs = f.path.split('/').filter(Boolean);
      if (segs.length > 1) topDirs.add(segs[0]);
    }
    const rootDll = files.some((f) => /^[^/]+\.dll$/i.test(f.path));
    if (topDirs.size === 1) {
      const name = [...topDirs][0];
      const inGroup = files.filter((f) => f.path.startsWith(name + '/'));
      const hasServer = inGroup.some((f) => /(database|wwwroot|\.dll)$/i.test(f.path));
      pushGroup(hasServer ? 'server' : 'plugin', name, name, inGroup.length, inGroup.reduce((s, x) => s + (x.size || 0), 0));
    } else if (rootDll) {
      pushGroup('plugin', files.find((f) => /\.dll$/i.test(f.path)).path.split('/').pop().replace(/\.dll$/i, ''), '', files.length, 0);
    } else if (topDirs.size > 1) {
      // 顶层多个目录 -> 视为合集，逐个目录当模组
      for (const d of topDirs) {
        const inGroup = files.filter((f) => f.path.startsWith(d + '/'));
        pushGroup(/\.dll$/i.test(JSON.stringify([...inGroup].slice(0, 0))) ? 'plugin' : 'server', d, d, inGroup.length, inGroup.reduce((s, x) => s + (x.size || 0), 0));
      }
    }
  }

  // 分类：单模组 vs 合集
  const modNames = new Set(groups.map((g) => g.name.toLowerCase()));
  let kind = 'unknown';
  if (groups.length === 1) kind = 'single';
  else if (groups.length > 1) kind = 'collection';
  else warnings.push('没有找到 SPT/user/mods 或 BepInEx/plugins 目录：可能是启动器、工具或本体安装包，不能当模组安装');

  // 单独一个 exe（启动器/管理器）也提示一下
  if (!groups.length && files.every((f) => !/\.dll$/i.test(f.path)) && files.some((f) => /\.exe$/i.test(f.path))) {
    warnings.push('包里只有 .exe，没有 DLL 或模组目录：这是独立程序，不是 SPT 模组');
  }

  const hasServerPart = groups.some((g) => g.type === 'server');
  const hasClientPart = groups.some((g) => g.type === 'plugin' || g.type === 'patcher');
  if (groups.length > 1 && hasServerPart && hasClientPart) kind = 'collection';

  return { kind, groups, warnings, modCount: groups.length, distinctModNames: modNames.size };
}

/** 解包到临时目录，返回 { dir, cleanup } */
export function extractToTemp(file, label = 'import') {
  const exe = findExtractor();
  if (!exe) throw new Error('未找到可用的解包器');
  const tempRoot = path.join(os.tmpdir(), 'spt-manager', `${label}-${nowStamp()}-${Math.random().toString(36).slice(2, 7)}`);
  fs.mkdirSync(tempRoot, { recursive: true });

  let args;
  if (isTar(exe)) args = ['-xf', file, '-C', tempRoot];
  else if (/WinRAR\.exe$/i.test(exe)) args = ['x', '-ibck', '-y', file, tempRoot + '\\'];
  else if (/bz\.exe$/i.test(exe)) args = ['x', '-y', '-o:' + tempRoot, file];
  else args = ['x', '-y', '-o' + tempRoot, file];

  const r = spawnSync(exe, args, { encoding: 'buffer', maxBuffer: 1024 * 1024 * 1024, timeout: 1000 * 60 * 30 });
  if (r.status !== 0) {
    const msg = (r.stderr?.toString('utf8') || r.stdout?.toString('utf8') || '').slice(-800);
    throw new Error(`解包失败: ${msg || 'exit ' + r.status}`);
  }
  return { dir: tempRoot, cleanup: () => { try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch { /* ignore */ } } };
}

/** 判断一个目录是否像一个服务端模组（含 dll 或 database/wwwroot/bundles） */
function looksLikeServerMod(dir) {
  try {
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    if (ents.some((e) => e.isFile() && /\.dll$/i.test(e.name))) return true;
    if (ents.some((e) => e.isDirectory() && /^(database|bundles|wwwroot|assets|src)$/i.test(e.name))) return true;
  } catch { /* ignore */ }
  return false;
}

function findAnchorRoot(baseDir, anchorSegs) {
  // 在解包目录里找到包含 anchorSegs 的深层根（支持套一层包装目录）
  let best = null;
  const walk = (d, depth) => {
    if (depth > 4) return;
    let ents = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    const names = ents.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase());
    if (names.includes(anchorSegs[0].toLowerCase())) {
      const cand = path.join(d, ...anchorSegs);
      if (fs.existsSync(cand)) best = cand;
    }
    for (const e of ents) if (e.isDirectory()) walk(path.join(d, e.name), depth + 1);
  };
  walk(baseDir, 0);
  return best;
}

const INSTALL_LOG = path.join(DATA_DIR, 'installed.json');

function readInstallLog() {
  try { return JSON.parse(fs.readFileSync(INSTALL_LOG, 'utf8')); } catch { return { entries: [] }; }
}

function writeInstallLog(obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(INSTALL_LOG, JSON.stringify(obj, null, 2), 'utf8');
}

/**
 * 把解包结果安装到 SPT 目录。
 * @param {string} root SPT 根目录
 * @param {string} tempDir extractToTemp 的结果
 * @param {object} analysis analyzePackage 的结果
 * @param {{overwrite?:boolean, source?:string, selected?:string[]}} opts
 */
export async function installFromTemp(root, tempDir, analysis, opts = {}) {
  const overwrite = opts.overwrite !== false;
  const selected = opts.selected ? new Set(opts.selected) : null;
  const installed = [];
  const backups = [];
  const stamp = nowStamp();

  for (const g of analysis.groups) {
    if (selected && !selected.has(`${g.type}|${g.name}`)) continue;

    // 找到包内实际路径
    let src = null;
    if (g.srcRel) {
      // 直接命中
      const direct = path.join(tempDir, ...g.srcRel.split('/'));
      if (fs.existsSync(direct)) src = direct;
      else {
        const segs = g.srcRel.split('/').filter(Boolean);
        // 逐级尝试去掉外层目录
        for (let i = 1; i < segs.length; i++) {
          const anchor = path.join(tempDir, ...segs.slice(i));
          if (fs.existsSync(anchor)) { src = anchor; break; }
        }
        if (!src && g.type === 'server') src = findAnchorRoot(tempDir, ['SPT', 'user', 'mods', g.name]) || null;
      }
    } else {
      const d = path.join(tempDir, g.name);
      if (fs.existsSync(d)) src = d;
    }
    if (src && fs.statSync(src).isFile()) {
      // 单文件（如 patcher dll）直接取文件
      const destDir = g.type === 'patcher' ? path.join(root, 'BepInEx', 'patchers')
        : g.type === 'plugin' ? path.join(root, 'BepInEx', 'plugins')
          : path.join(root, 'SPT', 'user', 'mods');
      fs.mkdirSync(destDir, { recursive: true });
      const destFile = path.join(destDir, path.basename(src));
      if (fs.existsSync(destFile)) {
        const b = path.join(BACKUP_DIR, 'files', `${stamp}_${path.basename(src)}`);
        fs.mkdirSync(path.dirname(b), { recursive: true });
        fs.copyFileSync(destFile, b);
        backups.push(b);
        fs.rmSync(destFile, { force: true });
      }
      fs.copyFileSync(src, destFile);
      installed.push({ type: g.type, name: path.basename(src), path: destFile });
      continue;
    }
    if (!src || !fs.existsSync(src)) {
      // srcRel 是文件级（如 BepInEx/plugins/x.dll）
      if (g.fileCount === 0 && g.type === 'plugin') continue;
      continue;
    }

    const type = g.type === 'patcher' ? 'patcher' : g.type;
    const destBase = type === 'server' ? path.join(root, 'SPT', 'user', 'mods')
      : type === 'plugin' ? path.join(root, 'BepInEx', 'plugins')
        : path.join(root, 'BepInEx', 'patchers');
    fs.mkdirSync(destBase, { recursive: true });
    const destDir = path.join(destBase, g.name);

    if (fs.existsSync(destDir)) {
      if (!overwrite) continue;
      const b = path.join(BACKUP_DIR, 'replaced', `${stamp}_${g.name}`);
      fs.mkdirSync(b, { recursive: true });
      await copyDir(destDir, b);
      fs.rmSync(destDir, { recursive: true, force: true });
      backups.push(b);
    }
    await copyDir(src, destDir);
    installed.push({ type, name: g.name, path: destDir, size: dirSize(destDir) });
  }

  // 记录安装日志
  const log = readInstallLog();
  log.entries.push({
    at: new Date().toISOString(),
    kind: analysis.kind,
    source: opts.source || null,
    installed,
    backups,
  });
  log.entries = log.entries.slice(-200);
  writeInstallLog(log);

  return { ok: true, installed, backups, kind: analysis.kind };
}

export { looksLikeServerMod, isTar, INSTALL_LOG };
