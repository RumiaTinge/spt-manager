// pack.js — 把已装好的模组重新打包成可分享的压缩包
//
// 产物布局与「导入模组」识别的结构一致：
//   SPT/user/mods/<name>/...       服务端模组
//   BepInEx/plugins/<name>/...     客户端插件
//   BepInEx/patchers/<file>.dll    预补丁
// 外加根目录 spt-manager-pack.json 清单（导入时被忽略，只给人看）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { DATA_DIR, nowStamp, humanSize, getVersions } from './core.js';
import { scanMods } from './mods.js';
import { findExtractor } from './archive.js';

export const EXPORT_DIR = path.join(DATA_DIR, 'exports');

const LEVEL_MAP = { store: 0, fast: 1, normal: 5, small: 7, ultra: 9 };

/** 可选打包的已装模组（只列启用的） */
export function packCandidates(root) {
  const scan = scanMods(root, getVersions(root));
  const list = [];
  const push = (m, type) => {
    if (!m.enabled) return;
    const src = type === 'patcher' ? path.join(m.folder, m.id) : m.folder;
    let size = m.size || 0;
    if (type === 'patcher' || !size) {
      try { size = type === 'patcher' ? fs.statSync(src).size : size; } catch { /* ignore */ }
    }
    list.push({
      key: `${type}|${m.id}`,
      type,
      id: m.id,
      name: m.displayName || m.id,
      version: m.version || null,
      guid: m.guid || null,
      author: m.author || null,
      size,
      dllCount: m.dllCount || 0,
      source: src,
      exists: fs.existsSync(src),
    });
  };
  scan.server.forEach((m) => push(m, 'server'));
  scan.plugins.forEach((m) => push(m, 'plugin'));
  scan.patchers.forEach((m) => push(m, 'patcher'));
  return list;
}

function sanitizeName(name, fallback) {
  const s = String(name || '').replace(/[\\/:*?"<>|\r\n\t]/g, '').trim().replace(/\.+$/, '');
  return (s || fallback).slice(0, 80);
}

function relOf(item) {
  if (item.type === 'server') return `SPT/user/mods/${item.id}`;
  if (item.type === 'plugin') return `BepInEx/plugins/${item.id}`;
  return `BepInEx/patchers/${item.id}`;
}

function dirStats(p) {
  let files = 0;
  let bytes = 0;
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) {
        files++;
        try { bytes += fs.statSync(full).size; } catch { /* ignore */ }
      }
    }
  };
  if (fs.statSync(p).isFile()) return { files: 1, bytes: fs.statSync(p).size };
  walk(p);
  return { files, bytes };
}

function run7z(args, { cwd, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const exe = findExtractor();
    if (!exe) return reject(new Error('未找到可用的打包器（需要 7-Zip / Bandizip 的 7z.exe）'));
    const child = spawn(exe, args, { cwd, windowsHide: true });
    let out = '';
    let err = '';
    const feed = (buf, isErr) => {
      const txt = buf.toString('utf8');
      if (isErr) err += txt;
      out += txt;
      if (onProgress) {
        const m = /(?:^|\s)(\d{1,3})%/.exec(txt);
        if (m) onProgress(Math.min(99, Number(m[1])));
      }
    };
    child.stdout.on('data', (b) => feed(b, false));
    child.stderr.on('data', (b) => feed(b, true));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`打包失败（7z 退出码 ${code}）${err ? '：' + err.slice(0, 300) : ''}`));
    });
  });
}

/**
 * 打包选中的模组。
 * @param {string} root SPT 根目录
 * @param {{items:Array<{type:string,id:string}>, name?:string, format?:string, level?:string}} opts
 * @param {(p:{percent:number,message:string})=>void} [onProgress]
 */
export async function createPack(root, opts = {}, onProgress = null) {
  const items = Array.isArray(opts.items) ? opts.items : [];
  if (!items.length) throw new Error('至少选择一个模组');
  const format = opts.format === '7z' ? '7z' : 'zip';
  const mx = LEVEL_MAP[opts.level] != null ? LEVEL_MAP[opts.level] : LEVEL_MAP.normal;

  const available = new Map(packCandidates(root).map((c) => [c.key, c]));
  const picked = [];
  for (const it of items) {
    const key = `${it.type}|${it.id}`;
    const c = available.get(key);
    if (!c) throw new Error(`找不到已启用的模组：${key}`);
    if (!c.exists) throw new Error(`模组目录不存在：${c.source}`);
    picked.push(c);
  }

  fs.mkdirSync(EXPORT_DIR, { recursive: true });
  const base = sanitizeName(opts.name, `mods-${nowStamp()}`);
  let outFile = path.join(EXPORT_DIR, `${base}.${format}`);
  let n = 1;
  while (fs.existsSync(outFile)) outFile = path.join(EXPORT_DIR, `${base} (${n++}).${format}`);

  // 统计体积，用于进度估算
  const totals = { files: 0, bytes: 0 };
  const emit = (percent, message) => onProgress && onProgress({ percent: Math.max(0, Math.min(99, Math.round(percent))), message });
  emit(1, '统计文件…');
  for (const c of picked) {
    const st = dirStats(c.source);
    totals.files += st.files;
    totals.bytes += st.bytes;
  }

  const manifest = {
    tool: 'SPT 模组管理器',
    kind: 'mod-pack',
    createdAt: new Date().toISOString(),
    name: path.basename(outFile, `.${format}`),
    sptVersion: (getVersions(root) || {}).spt || null,
    mods: picked.map((c) => ({
      type: c.type,
      id: c.id,
      name: c.name,
      version: c.version,
      guid: c.guid,
      author: c.author,
      path: relOf(c),
    })),
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spt-pack-'));
  const manifestFile = path.join(tmpDir, 'spt-manager-pack.json');
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');

  try {
    emit(3, `打包 ${picked.length} 个模组（${humanSize(totals.bytes)}）…`);
    const args = ['a', `-t${format}`, `-mx=${mx}`, '-bsp1', '-y', outFile, ...picked.map(relOf)];
    await run7z(args, {
      cwd: root,
      onProgress: (p) => emit(3 + p * 0.94, `压缩中 ${p}%`),
    });

    // 追加清单到包根目录
    await run7z(['a', `-t${format}`, '-y', outFile, 'spt-manager-pack.json'], { cwd: tmpDir });

    const size = fs.statSync(outFile).size;
    emit(100, '完成');
    return {
      ok: true,
      file: outFile,
      name: path.basename(outFile),
      size,
      format,
      files: totals.files,
      bytes: totals.bytes,
      mods: picked.map((c) => ({ type: c.type, id: c.id, name: c.name, version: c.version })),
    };
  } catch (e) {
    try { fs.rmSync(outFile, { force: true }); } catch { /* ignore */ }
    throw e;
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** 列出已经导出的包 */
export function listPacks() {
  let ents = [];
  try { ents = fs.readdirSync(EXPORT_DIR, { withFileTypes: true }); } catch { return []; }
  return ents
    .filter((e) => e.isFile() && /\.(zip|7z)$/i.test(e.name))
    .map((e) => {
      const full = path.join(EXPORT_DIR, e.name);
      let size = 0;
      let mtime = null;
      try { const st = fs.statSync(full); size = st.size; mtime = st.mtimeMs; } catch { /* ignore */ }
      return { name: e.name, file: full, size, mtime };
    })
    .sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
}

export function exportFile(name) {
  const base = path.basename(String(name || ''));
  if (!/\.(zip|7z)$/i.test(base)) throw new Error('只支持下载 .zip / .7z');
  const full = path.join(EXPORT_DIR, base);
  if (!fs.existsSync(full)) throw new Error('文件不存在：' + base);
  return full;
}

export function deletePack(name) {
  const full = exportFile(name);
  fs.rmSync(full, { force: true });
  return { ok: true, name: path.basename(full) };
}
