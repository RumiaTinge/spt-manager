// forge.js — 与 The Forge（sp-mod.com）站点 API 交互：搜索、版本、下载
//
// 站点已从 forge.sp-tarkov.com 迁移到 sp-mod.com（旧域名 525/410），
// API 路径保持 /api/v0/...：
//   GET /api/v0/mods?query=<关键词>&page=<n>       -> { data: mod[] }
//   GET /api/v0/mod/<id>                            -> { data: mod }
//   GET /api/v0/mod/<id>/versions                   -> { data: version[] }
// 下载链接形如 https://sp-mod.com/mod/download/<id>/<slug>/<version>（307 跳到 CDN）。
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './core.js';
import { satisfies, compareVersions } from './dllmeta.js';
import { getJson, downloadFile } from './net.js';

export const FORGE_BASE = 'https://sp-mod.com';
const CACHE_FILE = path.join(DATA_DIR, 'forge-cache.json');
const CACHE_TTL_MS = 1000 * 60 * 30;

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}

function writeCache(obj) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(obj), 'utf8');
  } catch { /* ignore */ }
}

async function api(pathname, { cache = true, timeoutMs = 20000 } = {}) {
  if (!cache) return unwrap(await getJson(FORGE_BASE + pathname, { timeoutMs }));
  const c = readCache();
  const hit = c[pathname];
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

  const data = unwrap(await getJson(FORGE_BASE + pathname, { timeoutMs }));
  const all = readCache();
  all[pathname] = { at: Date.now(), data };
  const keys = Object.keys(all);
  if (keys.length > 400) {
    keys.sort((a, b) => (all[a].at || 0) - (all[b].at || 0));
    for (const k of keys.slice(0, keys.length - 400)) delete all[k];
  }
  writeCache(all);
  return data;
}

function unwrap(j) {
  if (!j) return [];
  if (j.success === false) throw new Error(j.message || '站点返回失败');
  return Object.prototype.hasOwnProperty.call(j, 'data') ? j.data : j;
}

function pickMod(m) {
  return {
    id: m.id,
    guid: m.guid,
    name: m.name,
    slug: m.slug,
    teaser: m.teaser,
    thumbnail: m.thumbnail,
    downloads: m.downloads,
    detailUrl: m.detail_url || `${FORGE_BASE}/mod/${m.id}/${m.slug}`,
    fikaCompatibility: m.fika_compatibility,
    publishedAt: m.published_at,
    updatedAt: m.updated_at,
    owner: m.owner ? { name: m.owner.name, id: m.owner.id } : null,
    categoryId: m.category_id,
  };
}

export async function searchMods(query, opts = {}) {
  // 站点真正的检索参数是 filter[name]（query/q/search 都会被忽略，返回无关列表）
  const q = new URLSearchParams();
  if (query) q.set('filter[name]', query);
  if (opts.page) q.set('page', String(opts.page));
  if (opts.limit) q.set('limit', String(opts.limit));
  const data = await api(`/api/v0/mods?${q.toString()}`, { cache: opts.cache !== false, timeoutMs: opts.timeoutMs });
  const list = Array.isArray(data) ? data : (data && data.data) || [];
  return list.map(pickMod);
}

/** 按 GUID 精确查询（站点支持 filter[guid]） */
export async function findModByGuid(guid) {
  if (!guid) return null;
  const q = new URLSearchParams({ 'filter[guid]': String(guid) });
  const data = await api(`/api/v0/mods?${q.toString()}`, { timeoutMs: 20000 });
  const list = Array.isArray(data) ? data : (data && data.data) || [];
  return list.length ? pickMod(list[0]) : null;
}

export async function getMod(id) {
  const data = await api(`/api/v0/mod/${id}`);
  return data ? pickMod(data) : null;
}

export async function getVersions(id) {
  // 站点每页 12 条、按发布时间升序，需要翻完所有页才能拿到最新版本
  const all = [];
  let lastPage = 1;
  for (let page = 1; page <= 20; page++) {
    const raw = await getJson(`${FORGE_BASE}/api/v0/mod/${id}/versions?page=${page}`, { timeoutMs: 20000 });
    if (!raw) break;
    if (raw.success === false) throw new Error(raw.message || '站点返回失败');
    const list = Array.isArray(raw.data) ? raw.data : [];
    all.push(...list);
    lastPage = (raw.meta && raw.meta.last_page) || 1;
    if (page >= lastPage || !list.length) break;
  }
  return all.map((v) => ({
    id: v.id,
    version: v.version,
    description: v.description,
    link: v.link,
    contentLength: v.content_length,
    sptConstraint: v.spt_version_constraint,
    downloads: v.downloads,
    fikaCompatibility: v.fika_compatibility,
    publishedAt: v.published_at,
  })).sort((a, b) => compareVersions(b.version, a.version));
}

/** 在版本列表里挑与当前 SPT 版本匹配的最新版 */
export function pickVersionForSpt(versions, sptVersion) {
  if (!versions || !versions.length) return null;
  if (!sptVersion) return versions[0];
  const ok = versions.filter((v) => !v.sptConstraint || satisfies(sptVersion, v.sptConstraint));
  return ok.length ? ok[0] : null;
}

/** 按 GUID / 名称匹配站点模组（给已安装模组补全站点信息、查更新） */
export async function matchMods(mods, { concurrency = 3 } = {}) {
  const out = [];
  const queue = [...mods];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const m = queue.shift();
      if (!m) return;
      const query = m.displayName || m.id;
      let candidates = [];
      try {
        candidates = await searchMods(query);
      } catch (e) {
        out.push({ id: m.id, type: m.type, guid: m.guid, version: m.version, displayName: m.displayName, match: null, error: String(e.message || e) });
        continue;
      }
      let best = null;
      if (m.guid) {
        try { best = await findModByGuid(m.guid); } catch { best = null; }
      }
      if (!best) {
        const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const nf = norm(m.displayName || m.id);
        best = candidates.find((c) => norm(c.name) === nf)
          || candidates.find((c) => norm(c.name).includes(nf) || (nf && nf.includes(norm(c.name))))
          || null;
      }
      out.push({ id: m.id, type: m.type, guid: m.guid, version: m.version, displayName: m.displayName, match: best });
    }
  });
  await Promise.all(workers);
  return out;
}

export function versionUrl(mod, version) {
  return `${FORGE_BASE}/mod/download/${mod.id}/${encodeURIComponent(mod.slug || '')}/${encodeURIComponent(version.version)}`;
}

function extFromLink(link) {
  const m = /\.(7z|zip|rar|tar\.gz|tgz)(?:$|\?)/i.exec(String(link || ''));
  return m ? '.' + m[1].toLowerCase() : '.7z';
}

export function fileNameFor(mod, version) {
  const safe = String(mod.slug || mod.id).replace(/[^a-z0-9._-]/gi, '_');
  return `${safe}-${String(version.version).replace(/[^0-9a-z._-]/gi, '_')}${extFromLink(version.link)}`;
}

export const DOWNLOAD_DIR = path.join(DATA_DIR, 'downloads');

/** 下载（已存在则直接复用），返回本地文件路径 */
export async function downloadAndLocate(mod, version, onProgress) {
  const file = path.join(DOWNLOAD_DIR, fileNameFor(mod, version));
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    return { ok: true, file, cached: true, size: fs.statSync(file).size };
  }
  const url = version.link || versionUrl(mod, version);
  const res = await downloadFile(url, file, onProgress, { referer: `${FORGE_BASE}/mod/${mod.id}/${mod.slug}` });
  return { ...res, cached: false, url };
}
