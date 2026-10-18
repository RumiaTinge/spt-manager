// assets.js —— 前端静态资源的读取层
//
// 开发时从 public/ 目录读文件；打包成单文件 exe 时（build/build-exe.mjs 会把
// public 下的资源 base64 内联成 build/embedded-assets.js），直接从内存里取。
import fs from 'node:fs';
import path from 'node:path';

let embedded = null;
try {
  const mod = await import('../build/embedded-assets.js');
  embedded = mod.default || null;
} catch { embedded = null; }

/** 是否是打包后的单文件 exe（资源已内联） */
export const EMBEDDED = !!embedded;

/** 内联资源的文件名列表（调试用） */
export function embeddedNames() {
  return embedded ? Object.keys(embedded) : [];
}

/** 读一个内联资源，返回 Buffer 或 null */
export function readEmbedded(name) {
  if (!embedded) return null;
  const b64 = embedded[name];
  if (!b64) return null;
  return Buffer.from(b64, 'base64');
}

/** 从磁盘读 public 下的文件（开发模式），不存在返回 null */
export function readDisk(publicDir, name) {
  const full = path.join(publicDir, name);
  if (!full.startsWith(publicDir)) return null;
  try {
    const st = fs.statSync(full);
    if (!st.isFile()) return null;
    return fs.readFileSync(full);
  } catch {
    return null;
  }
}
