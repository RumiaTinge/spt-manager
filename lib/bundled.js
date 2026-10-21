// bundled.js —— 随管理器一起发布的基础模组（Fika 客户端插件 / Fika 服务端 mod / Fika 无头主机）
//
// 资源放在 assets/bundled/ 下，打成单文件 exe 时由 build/build-exe.mjs 内联成
// build/embedded-bundled.js（相对路径 → base64），运行时优先用内联的那份。
import fs from 'node:fs';
import path from 'node:path';
import { APP_DIR, BACKUP_DIR, nowStamp } from './core.js';
import { readDllMeta, compareVersions } from './dllmeta.js';

const DIR = path.join(APP_DIR, 'assets', 'bundled');
const BACKUP = path.join(BACKUP_DIR, 'bundled');

let embedded = null;
// 只有单文件 exe（bun 编译，execPath 是 spt-manager.exe）才用内联资源；
// node 直接跑源码时读 assets/bundled 磁盘副本，方便改。
const PACKED_EXE = /^spt-manager/i.test(path.basename(process.execPath || ''));
if (PACKED_EXE) {
  try {
    const mod = await import('../build/embedded-bundled.js');
    embedded = mod.default || null;
  } catch { embedded = null; }
}

/** 是否用的是内联资源（打包后的 exe） */
export const BUNDLED_EMBEDDED = !!embedded;

/** 列出资源里的所有文件（相对 assets/bundled 的路径 + 大小） */
function sourceFiles() {
  if (embedded) {
    return Object.keys(embedded)
      .filter((k) => !k.endsWith('/'))
      .map((k) => ({ rel: k, size: Math.floor((embedded[k].length * 3) / 4) }));
  }
  const out = [];
  const walk = (rel) => {
    const full = path.join(DIR, rel);
    let st;
    try { st = fs.statSync(full); } catch { return; }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(full)) walk(rel ? `${rel}/${name}` : name);
    } else {
      out.push({ rel, size: st.size });
    }
  };
  walk('');
  return out;
}

/** 读一个资源文件，返回 Buffer 或 null */
function readSource(rel) {
  if (embedded) {
    const b64 = embedded[rel];
    return b64 ? Buffer.from(b64, 'base64') : null;
  }
  try { return fs.readFileSync(path.join(DIR, rel)); } catch { return null; }
}

/** 读取内置清单 */
export function bundleManifest() {
  const buf = readSource('manifest.json');
  if (!buf) return { version: 0, items: [] };
  try {
    const m = JSON.parse(buf.toString('utf8'));
    return { version: m.version || 1, items: Array.isArray(m.items) ? m.items : [] };
  } catch {
    return { version: 0, items: [] };
  }
}

/** 某个 item 对应的资源文件（把 targets 展开成 from→to 的逐文件映射） */
function itemFiles(item) {
  const all = sourceFiles();
  const out = [];
  for (const t of item.targets || []) {
    if (t.kind === 'file') {
      const hit = all.find((f) => f.rel === t.from);
      if (hit) out.push({ src: hit.rel, dest: t.to, size: hit.size });
      continue;
    }
    const prefix = `${t.from}/`;
    for (const f of all) {
      if (!f.rel.startsWith(prefix)) continue;
      out.push({ src: f.rel, dest: `${t.to}/${f.rel.slice(prefix.length)}`, size: f.size });
    }
  }
  return out;
}

/** 主版本探测用的文件（优先 Fika.Core.dll 这类） */
function versionProbe(root, item) {
  for (const t of item.targets || []) {
    if (t.kind === 'file') return path.join(root, t.to);
  }
  const first = itemFiles(item).find((f) => /\.dll$/i.test(f.dest));
  return first ? path.join(root, first.dest) : null;
}

/**
 * 当前客户端的安装情况。
 * 返回 [{ id, name, group, version, desc, homepage, required, files, size, installed, installedVersion, outdated }]
 */
export function bundleStatus(root) {
  const { items } = bundleManifest();
  return items.map((item) => {
    const files = itemFiles(item);
    const size = files.reduce((n, f) => n + f.size, 0);
    const probe = root ? versionProbe(root, item) : null;
    const installed = !!(probe && fs.existsSync(probe));
    let installedVersion = null;
    if (installed) {
      try {
        const meta = readDllMeta(probe);
        installedVersion = meta.version || null;
      } catch { installedVersion = null; }
    }
    const want = item.version || null;
    const outdated = !!(installed && installedVersion && want && compareVersions(installedVersion, want) < 0);
    return {
      id: item.id,
      name: item.name,
      group: item.group || '',
      version: want,
      desc: item.desc || '',
      homepage: item.homepage || '',
      required: item.required || [],
      files: files.length,
      size,
      installed,
      installedVersion,
      outdated,
    };
  });
}

/** 安装前把会被覆盖的目录/文件备份到 data/backups/bundled/<stamp>_<id> */
function backupTargets(root, item, files) {
  const stamp = `${nowStamp()}_${item.id}`;
  const destRoot = path.join(BACKUP, stamp);
  let n = 0;
  for (const t of item.targets || []) {
    const full = path.join(root, t.to);
    if (t.kind === 'dir') {
      if (!fs.existsSync(full)) continue;
      copyRecursive(full, path.join(destRoot, t.to));
      n += 1;
    } else if (fs.existsSync(full)) {
      const out = path.join(destRoot, t.to);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(full, out);
      n += 1;
    }
  }
  return n ? destRoot : null;
}

function copyRecursive(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const name of fs.readdirSync(src)) copyRecursive(path.join(src, name), path.join(dst, name));
  } else {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
}

/**
 * 把某个内置模组装进 root。
 * 返回 { ok, id, name, files, bytes, backup, target }
 */
export function installBundle(root, id) {
  if (!root) throw new Error('还没有设置 SPT 目录');
  const { items } = bundleManifest();
  const item = items.find((x) => x.id === id);
  if (!item) throw new Error(`没有这个内置模组：${id}`);
  const files = itemFiles(item);
  if (!files.length) throw new Error(`内置资源里没有 ${item.name} 的文件（打包可能漏了 assets/bundled）`);

  const backup = backupTargets(root, item, files);
  let bytes = 0;
  for (const f of files) {
    const buf = readSource(f.src);
    if (!buf) throw new Error(`读不到内置文件：${f.src}`);
    const out = path.join(root, f.dest);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    // 目标被占用时先删再写（Windows 上覆盖正在被读的 dll 会 EPERM）
    try {
      fs.writeFileSync(out, buf);
    } catch (e) {
      if (e && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES')) {
        try { fs.unlinkSync(out); } catch { /* ignore */ }
        fs.writeFileSync(out, buf);
      } else {
        throw e;
      }
    }
    bytes += buf.length;
  }
  // 被临时禁用（.disabled）的同名插件要恢复成可用，否则装了也不生效
  for (const f of files) {
    if (!/\.dll$/i.test(f.dest)) continue;
    const out = path.join(root, f.dest);
    try { if (fs.existsSync(`${out}.disabled`)) fs.unlinkSync(`${out}.disabled`); } catch { /* ignore */ }
  }
  return { ok: true, id: item.id, name: item.name, files: files.length, bytes, backup, target: root };
}
