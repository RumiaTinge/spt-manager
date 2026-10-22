// serverlink.js — 连接远端/本机 SPT 服务端的小工具
// 1) 把用户随手输入的地址补成固定格式（协议、端口、去尾斜杠）
// 2) 查询 Fika 的在线玩家（GET /fika/presence/get）
//
// SPT 的 Kestrel 会用 deflate 压缩响应（不是 gzip），所以这里自己解压；
// 证书是自签的，需要 rejectUnauthorized:false。
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';
import { readSettings, writeSettings } from './core.js';

export const DEFAULT_PORT = 6969;
export const MAX_HISTORY = 15;

/** 保存过的服务端地址（最近用的在前） */
export function historyList() {
  const list = readSettings().serverHistory;
  if (!Array.isArray(list)) return [];
  return list
    .filter((x) => x && typeof x.url === 'string' && x.url)
    .map((x) => ({ url: x.url, name: String(x.name || ''), lastUsedAt: x.lastUsedAt || null, uses: Number(x.uses) || 0 }))
    .sort((a, b) => String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')))
    .slice(0, MAX_HISTORY);
}

/** 记住一个地址（同 url 去重，只保留最近 MAX_HISTORY 条） */
export function rememberServer(url, name = '') {
  const n = normalizeServerUrl(url);
  if (!n.ok) return historyList();
  const at = new Date().toISOString();
  const list = historyList().filter((x) => x.url !== n.url);
  const prev = historyList().find((x) => x.url === n.url);
  list.unshift({ url: n.url, name: String(name || prev?.name || '').trim(), lastUsedAt: at, uses: (prev?.uses || 0) + 1 });
  const next = list.slice(0, MAX_HISTORY);
  writeSettings({ serverHistory: next });
  return next;
}

/** 从历史里删掉一个地址 */
export function forgetServer(url) {
  const n = normalizeServerUrl(url);
  const target = n.ok ? n.url : String(url || '').trim();
  const next = historyList().filter((x) => x.url !== target);
  writeSettings({ serverHistory: next });
  return next;
}

/** 用户输入 → {ok,url,scheme,host,port,isLocal,error} */
export function normalizeServerUrl(input, { defaultPort = DEFAULT_PORT } = {}) {
  let raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false, error: '地址不能为空' };
  raw = raw.replace(/^["'<\s]+|["'>\s]+$/g, '');
  if (!raw) return { ok: false, error: '地址不能为空' };

  // 只有域名/IP 或 域名:端口 时补 https://
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let u;
  try { u = new URL(raw); } catch { return { ok: false, error: `地址不合法：${input}` }; }
  const scheme = String(u.protocol).replace(/:$/, '').toLowerCase();
  if (!/^https?$/.test(scheme)) return { ok: false, error: '只支持 http / https' };
  if (!u.hostname) return { ok: false, error: `地址里没有主机名：${input}` };

  let port = Number(u.port || defaultPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: `端口不合法：${u.port}` };
  }

  const host = u.hostname.includes(':') ? `[${u.hostname.replace(/^\[|\]$/g, '')}]` : u.hostname;
  const url = `${scheme}://${host}:${port}`;
  const isLocal = /^(127\.0\.0\.1|localhost|\[::1\]|::1)$/i.test(host);
  return { ok: true, url, scheme, host: u.hostname.replace(/^\[|\]$/g, ''), port, isLocal };
}

/** 从「对方服务器」返回的 presence 数组里抽出我们关心的字段 */
export function parsePresence(data) {
  const arr = Array.isArray(data) ? data
    : Array.isArray(data && data.presence) ? data.presence
      : Array.isArray(data && data.players) ? data.players
        : [];
  const players = [];
  for (const p of arr) {
    if (!p || typeof p !== 'object') continue;
    const nickname = String(p.nickname || p.Nickname || p.playerName || p.username || p.name || '').trim();
    const activity = String(p.activity || p.Activity || p.status || '').trim();
    const raidCode = String(p.raidCode || p.RaidCode || '').trim();
    const level = Number(p.level ?? p.Level);
    const isHeadless = !!(p.headless ?? p.Headless ?? p.isHeadless);
    players.push({
      nickname: nickname || '（未命名）',
      activity,
      raidCode,
      level: Number.isFinite(level) ? level : null,
      headless: isHeadless,
      raw: p,
    });
  }
  return players;
}

/** 低层请求：支持自签证书 + deflate/gzip 解压 */
export function requestJson(baseUrl, pathname, { method = 'GET', body = null, timeoutMs = 6000, headers = {} } = {}) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(baseUrl); } catch { resolve({ ok: false, error: `地址不合法：${baseUrl}` }); return; }
    const lib = u.protocol === 'http:' ? http : https;
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = lib.request({
      protocol: u.protocol,
      hostname: u.hostname.replace(/^\[|\]$/g, ''),
      port: u.port || DEFAULT_PORT,
      path: pathname,
      method,
      rejectUnauthorized: false,
      timeout: timeoutMs,
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let buf = Buffer.concat(chunks);
        const enc = String(res.headers['content-encoding'] || '').toLowerCase();
        try {
          if (buf.length >= 2 && buf[0] === 0x78) buf = zlib.inflateSync(buf);
          else if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
          else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
        } catch { /* 解压失败就按原样当文本 */ }
        const text = buf.toString('utf8');
        if (res.statusCode >= 400) {
          resolve({ ok: false, status: res.statusCode, error: `HTTP ${res.statusCode}`, text });
          return;
        }
        try { resolve({ ok: true, status: res.statusCode, data: JSON.parse(text) }); }
        catch { resolve({ ok: false, status: res.statusCode, error: '返回的不是 JSON', text: text.slice(0, 300) }); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: `请求超时（${timeoutMs}ms）` }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    if (payload) req.write(payload);
    req.end();
  });
}

/** 查询某台服务端的在线玩家（Fika 的 /fika/presence/get） */
export async function fetchPresence(serverUrl, { timeoutMs = 6000 } = {}) {
  const n = normalizeServerUrl(serverUrl);
  if (!n.ok) return { ok: false, url: String(serverUrl || ''), error: n.error };
  const r = await requestJson(n.url, '/fika/presence/get', { timeoutMs });
  if (!r.ok) {
    return {
      ok: false, url: n.url, isLocal: n.isLocal, error: r.error,
      hint: /HTTP 404/.test(String(r.error)) ? '对方没装 Fika 服务端（没有 /fika/presence/get）' : undefined,
      at: new Date().toISOString(),
    };
  }
  const players = parsePresence(r.data);
  return { ok: true, url: n.url, isLocal: n.isLocal, count: players.length, players, at: new Date().toISOString() };
}

/** Fika 在线状态里的 activity 常见值翻成中文 */
export function activityCn(a) {
  const s = String(a || '').toLowerCase();
  if (!s) return '';
  if (s.includes('raid')) return '对局中';
  if (s.includes('menu') || s.includes('hub')) return '大厅';
  if (s.includes('matching') || s.includes('queue')) return '匹配中';
  if (s.includes('hideout')) return '藏身处';
  return a;
}
