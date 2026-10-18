// core.js — 路径探测、设置持久化、版本读取、通用文件工具
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(APP_DIR, 'data');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

export function ensureDirs() {
  for (const d of [DATA_DIR, BACKUP_DIR, path.join(BACKUP_DIR, 'mods'), path.join(BACKUP_DIR, 'profiles'), path.join(BACKUP_DIR, 'configs')]) {
    fs.mkdirSync(d, { recursive: true });
  }
}

export function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

export function writeSettings(patch) {
  ensureDirs();
  const next = { ...readSettings(), ...patch };
  const tmp = SETTINGS_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, SETTINGS_FILE);
  return next;
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };
export { isDir, isFile };

/** 验证一个目录是不是 SPT 安装根目录（含 SPT/SPT.Server.exe） */
export function isValidSptRoot(p) {
  if (!p) return false;
  try {
    return isFile(path.join(p, 'SPT', 'SPT.Server.exe'));
  } catch { return false; }
}

/** 从若干线索里自动找 SPT 根目录 */
export function autoDetectSptRoot() {
  const tried = [];
  const candidates = [];

  if (process.env.SPT_PATH) candidates.push(process.env.SPT_PATH);

  // 向上找当前工作目录的祖先
  let cur = process.cwd();
  for (let i = 0; i < 5; i++) {
    candidates.push(cur);
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  candidates.push(APP_DIR);

  // 同盘符下常见的 E:\game\EFT\* （扫描 APP_DIR 的父目录，深度 3）
  const root = path.parse(APP_DIR).root;
  const seeds = new Set([path.dirname(APP_DIR), APP_DIR, root]);
  for (const seed of seeds) {
    candidates.push(seed);
    if (isDir(seed)) {
      for (const d1 of safeList(seed)) {
        candidates.push(d1);
        if (isDir(d1)) {
          for (const d2 of safeList(d1)) candidates.push(d2);
        }
      }
    }
  }

  for (const c of candidates) {
    if (!c) continue;
    tried.push(c);
    if (isValidSptRoot(c)) return { root: c, tried };
  }
  return { root: null, tried };
}

function safeList(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch { return []; }
}

/** 当前生效的 SPT 根目录 */
export function getSptRoot() {
  const s = readSettings();
  if (s.sptPath && isValidSptRoot(s.sptPath)) return s.sptPath;
  const auto = autoDetectSptRoot();
  if (auto.root) {
    writeSettings({ sptPath: auto.root, sptPathAuto: true });
    return auto.root;
  }
  return null;
}

/** 读取版本信息 */
export function getVersions(root) {
  if (!root) return {};
  const out = { spt: null, tarkov: null, project: null };
  try {
    const core = JSON.parse(fs.readFileSync(path.join(root, 'SPT', 'SPT_Data', 'configs', 'core.json'), 'utf8'));
    out.tarkov = core.compatibleTarkovVersion || null;
    out.project = core.projectName || 'SPT';
  } catch { /* ignore */ }

  // SPT 版本：优先目录名 SPT-x.y.z-bbbbb-xxxx，其次 deps.json
  try {
    const dirs = fs.readdirSync(root);
    for (const d of dirs) {
      const m = /^SPT[-_ ](\d+\.\d+\.\d+)[-_](\d+)/i.exec(d);
      if (m) { out.spt = `${m[1]}`; out.tarkovBuild = m[2]; break; }
    }
  } catch { /* ignore */ }

  if (!out.spt) {
    try {
      const deps = JSON.parse(fs.readFileSync(path.join(root, 'SPT', 'SPT.Server.deps.json'), 'utf8'));
      const lib = deps.libraries || {};
      for (const k of Object.keys(lib)) {
        const m = /^SPTArkov\.Server\.Core\/(\d+\.\d+\.\d+)/.exec(k);
        if (m) { out.spt = m[1]; break; }
      }
    } catch { /* ignore */ }
  }
  return out;
}

export function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    if (fallback !== undefined) return fallback;
    throw new Error(`读取失败: ${file}`);
  }
}

export function writeJson(file, obj, opts = true) {
  const backup = typeof opts === 'boolean' ? opts : (opts && opts.backup !== false);
  if (backup && isFile(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const bdir = path.join(BACKUP_DIR, 'configs');
    fs.mkdirSync(bdir, { recursive: true });
    fs.copyFileSync(file, path.join(bdir, `${path.basename(file)}.${stamp}.bak`));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

export function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; } catch { /* ignore */ } }
    }
  };
  walk(dir);
  return total;
}

export async function moveDir(from, to) {
  const target = path.join(to, path.basename(from));
  fs.mkdirSync(to, { recursive: true });
  try {
    fs.renameSync(from, target);
  } catch (e) {
    // 跨盘符：复制后删除
    await copyDir(from, target);
    await fsp.rm(from, { recursive: true, force: true });
  }
  return target;
}

export async function copyDir(src, dst) {
  await fsp.cp(src, dst, { recursive: true, force: true });
}

export function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function humanSize(bytes) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}
