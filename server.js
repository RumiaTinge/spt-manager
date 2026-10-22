// server.js — SPT 模组管理器 & 服务器启动器（零依赖 Node HTTP 服务）
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Windows 控制台默认 936(GBK)，而 Node/Bun 输出的是 UTF-8，中文会变成乱码。
// 把控制台代码页切成 65001（控制台是共享对象，子进程设置对父进程同样生效）。
if (process.platform === 'win32') {
  try { spawnSync('cmd.exe', ['/c', 'chcp 65001 >nul'], { windowsHide: true, stdio: 'ignore' }); } catch { /* 忽略 */ }
}

import {
  APP_DIR, DATA_DIR, DATA_DIR_FALLBACK, ensureDirs, readSettings, writeSettings, getSptRoot, getVersions,
  isValidSptRoot, autoDetectSptRoot, readJson, writeJson, nowStamp, humanSize,
} from './lib/core.js';
import { scanMods, toggleMod, deleteMod } from './lib/mods.js';
import { listArchive, analyzePackage, extractToTemp, installFromTemp } from './lib/archive.js';
import * as forge from './lib/forge.js';
import * as game from './lib/game.js';
import * as aiRules from './lib/aiRules.js';
import * as fika from './lib/fika.js';
import * as launch from './lib/launch.js';
import * as pack from './lib/pack.js';
import * as bundled from './lib/bundled.js';
import * as live from './lib/live.js';
import * as raidProbe from './lib/raidprobe.js';
import * as items from './lib/items.js';
import { EMBEDDED, readEmbedded, readDisk } from './lib/assets.js';
import * as serverlink from './lib/serverlink.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PORT = Number(process.env.SPT_MANAGER_PORT || 47823);
const HOST = '127.0.0.1';

ensureDirs();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// 控制台输出同时写一份到 data\manager.log（远程排障时让对方把这个文件发过来）
const LOG_FILE = path.join(DATA_DIR, 'manager.log');
try {
  const st = fs.statSync(LOG_FILE);
  if (st.size > 2 * 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.old');
} catch { /* 第一次运行没有日志 */ }
const rawLog = console.log.bind(console);
const rawErr = console.error.bind(console);
const tee = (fn) => (...args) => {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${args.map((a) => (typeof a === 'string' ? a : String(a))).join(' ')}\n`); } catch { /* 写日志失败不影响运行 */ }
  fn(...args);
};
console.log = tee(rawLog);
console.error = tee(rawErr);
process.on('uncaughtException', (e) => { rawErr('\n未捕获的错误：', e); process.exitCode = 1; });
process.on('unhandledRejection', (e) => { rawErr('\n未处理的 Promise 拒绝：', e); process.exitCode = 1; });

// ---------------------------------------------------------------- 任务系统（长耗时操作进度轮询）
const jobs = new Map();
let jobSeq = 0;

function createJob(label) {
  const id = 'j' + (++jobSeq);
  jobs.set(id, { id, label, status: 'running', percent: 0, message: '准备中…', startedAt: Date.now(), result: null, error: null, log: [] });
  return id;
}

function jobPatch(id, patch) {
  const j = jobs.get(id);
  if (!j) return;
  Object.assign(j, patch);
  if (patch.logLine) j.log.push(patch.logLine);
  if (j.log.length > 200) j.log = j.log.slice(-200);
}

function jobDone(id, result) { jobPatch(id, { status: 'done', percent: 100, message: '完成', result, finishedAt: Date.now() }); }
function jobFail(id, err) { jobPatch(id, { status: 'error', message: String(err && err.message ? err.message : err), error: String(err && err.stack ? err.stack : err), finishedAt: Date.now() }); }

// 清理 1 小时前的任务
setInterval(() => {
  const cut = Date.now() - 3600 * 1000;
  for (const [id, j] of jobs) if ((j.finishedAt || j.startedAt) < cut) jobs.delete(id);
}, 60 * 1000).unref();

// ---------------------------------------------------------------- 工具
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendError(res, code, message, extra = {}) {
  sendJson(res, code, { ok: false, error: message, ...extra });
}

function readBody(req, limit = 200 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString('utf8')); } catch { throw new Error('请求体不是合法 JSON'); }
}

function requireRoot() {
  const root = getSptRoot();
  if (!root) throw new Error('尚未设置 SPT 安装目录');
  if (!isValidSptRoot(root)) throw new Error(`目录不像是 SPT 服务端：${root}`);
  return root;
}

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.replace(/^\/+/, ''));
  if (!rel || rel === '') rel = 'index.html';

  // 打包成 exe 后前端资源内联在二进制里
  if (EMBEDDED) {
    const name = rel.replace(/\\/g, '/');
    const buf = readEmbedded(name) || readEmbedded('index.html');
    if (!buf) return sendError(res, 404, 'not found');
    const ext = path.extname(name).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || MIME['.html'],
      'cache-control': 'no-store',
      'content-length': buf.length,
    });
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }

  const full = path.join(PUBLIC_DIR, rel);
  if (!full.startsWith(PUBLIC_DIR)) return sendError(res, 403, 'forbidden');
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) {
      // SPA 回退
      const index = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(index, (e2, buf) => {
        if (e2) return sendError(res, 404, 'not found');
        res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
        res.end(buf);
      });
      return;
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': 'no-store',
      'content-length': st.size,
    });
    fs.createReadStream(full).pipe(res);
  });
}

// ---------------------------------------------------------------- 路由表
const routes = [];
function route(method, pattern, handler) { routes.push({ method, pattern, handler }); }

// ---- 概览 / 设置
route('GET', /^\/api\/state$/, async () => {
  const settings = readSettings();
  const root = getSptRoot();
  const versions = root ? getVersions(root) : null;
  const runningInfo = game.isServerRunning();
  const running = !!(runningInfo && runningInfo.running);
  let mods = null;
  if (root && isValidSptRoot(root)) {
    try {
      const scan = scanMods(root, versions || {});
      mods = {
        server: scan.server.length,
        plugins: scan.plugins.length,
        patchers: scan.patchers.length,
        disabled: scan.disabled.server.length + scan.disabled.plugins.length,
        missing: scan.missingDeps || [],
      };
    } catch (e) { mods = { error: String(e.message) }; }
  }
  return {
    ok: true,
    settings: { sptRoot: settings.sptRoot || '', port: PORT, ...settings },
    autoRoot: getSptRoot(),
    versions,
    running,
    mods,
    paths: { app: APP_DIR, data: DATA_DIR },
  };
});

route('GET', /^\/api\/settings$/, async () => {
  const root = getSptRoot();
  return { ok: true, settings: readSettings(), sptPath: root, versions: root ? getVersions(root) : null };
});

route('POST', /^\/api\/settings$/, async (ctx) => {
  const body = await readJsonBody(ctx.req);
  const wanted = body.sptPath !== undefined ? body.sptPath : body.sptRoot;
  if (wanted !== undefined) {
    const p = String(wanted || '').trim().replace(/[\\/]+$/, '');
    if (p && !isValidSptRoot(p)) return sendError(ctx.res, 400, `目录无效（缺少 SPT\\SPT.Server.exe）：${p}`);
    writeSettings({ sptPath: p, sptPathAuto: false });
  }
  if (body.autoDetect) {
    const auto = autoDetectSptRoot();
    if (auto.root) writeSettings({ sptPath: auto.root, sptPathAuto: true });
    const root = getSptRoot();
    return { ok: true, sptPath: root, versions: root ? getVersions(root) : null };
  }
  const root = getSptRoot();
  return { ok: true, settings: readSettings(), sptPath: root, versions: root ? getVersions(root) : null };
});

// ---- 模组
route('GET', /^\/api\/mods$/, async () => {
  const root = requireRoot();
  const scan = scanMods(root, getVersions(root) || {});
  return { ok: true, ...scan, root };
});

route('POST', /^\/api\/mods\/toggle$/, async (ctx) => {
  const root = requireRoot();
  const { type, id, enabled } = await readJsonBody(ctx.req);
  const r = await toggleMod(root, type, id, !!enabled);
  return { ok: true, ...r };
});

route('POST', /^\/api\/mods\/delete$/, async (ctx) => {
  const root = requireRoot();
  const { type, id } = await readJsonBody(ctx.req);
  const r = await deleteMod(root, type, id);
  return { ok: true, ...r };
});

// 查更新：把已安装模组按 GUID 匹配到站点，再比对最新版本
route('POST', /^\/api\/mods\/updates$/, async () => {
  const root = requireRoot();
  const scan = scanMods(root, getVersions(root) || {});
  const spt = getVersions(root);
  const id = createJob('检查模组更新');
  (async () => {
    try {
      const list = [...scan.server, ...scan.plugins];
      jobPatch(id, { percent: 5, message: `匹配 ${list.length} 个模组…` });
      const matched = await forge.matchMods(list.map((m) => ({
        id: m.id, type: m.type, guid: m.guid, version: m.version, displayName: m.displayName,
      })));
      const out = [];
      const slim = (v) => (v ? {
        id: v.id, version: v.version, sptConstraint: v.sptConstraint, link: v.link,
        contentLength: v.contentLength, publishedAt: v.publishedAt, downloads: v.downloads,
      } : null);
      let i = 0;
      for (const m of matched) {
        i++;
        jobPatch(id, { percent: Math.min(95, 5 + Math.round((i / matched.length) * 60)), message: `查询版本 ${i}/${matched.length}` });
        const base = {
          id: m.id, type: m.type, guid: m.guid, version: m.version, displayName: m.displayName,
          match: m.match ? { id: m.match.id, name: m.match.name, slug: m.match.slug, detailUrl: m.match.detailUrl } : null,
        };
        if (!base.match) { out.push({ ...base, latest: null, versions: [], hasUpdate: false }); continue; }
        try {
          const versions = await forge.getVersions(base.match.id);
          const best = forge.pickVersionForSpt(versions, spt && spt.spt);
          const hasUpdate = best && m.version ? compareVer(best.version, m.version) > 0 : false;
          out.push({ ...base, latest: slim(best), versions: versions.slice(0, 12).map(slim), hasUpdate });
        } catch (e) {
          out.push({ ...base, latest: null, versions: [], hasUpdate: false, error: String(e.message) });
        }
      }
      jobDone(id, out);
    } catch (e) { jobFail(id, e); }
  })();
  return { ok: true, jobId: id };
});

function compareVer(a, b) {
  const pa = String(a).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/i, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// ---- 站点（模组市场）
route('GET', /^\/api\/forge\/thumb$/, async (ctx) => {
  const u = ctx.url.searchParams.get('u') || '';
  if (!/^https:\/\/files\.sp-mod\.com\//.test(u)) throw new Error('不支持的图片地址');
  const r = await fetch(u, {
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SPT-Manager/1.0 (+local)',
      referer: 'https://sp-mod.com/',
    },
  });
  if (!r.ok) throw new Error(`图片获取失败 (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  ctx.res.writeHead(200, {
    'content-type': r.headers.get('content-type') || 'image/png',
    'cache-control': 'public, max-age=86400',
    'content-length': buf.length,
  });
  ctx.res.end(buf);
  return undefined;
});

route('GET', /^\/api\/forge\/search$/, async (ctx) => {
  const q = ctx.url.searchParams.get('q') || '';
  const page = Number(ctx.url.searchParams.get('page') || 1);
  const list = await forge.searchMods(q, { page, limit: 24 });
  const root = getSptRoot();
  const spt = root ? getVersions(root) : null;
  const sptVersion = spt && spt.spt;
  return { ok: true, query: q, page, list, sptVersion };
});

route('GET', /^\/api\/forge\/mod\/(\d+)$/, async (ctx) => {
  const id = Number(ctx.matches[1]);
  const [mod, versions] = await Promise.all([forge.getMod(id), forge.getVersions(id)]);
  const root = getSptRoot();
  const spt = root ? getVersions(root) : null;
  const sptVersion = spt && spt.spt;
  return {
    ok: true, mod, versions, sptVersion,
    recommended: forge.pickVersionForSpt(versions, sptVersion),
  };
});

// 从站点一键安装（下载 → 分析 → 安装），全过程走任务进度
route('POST', /^\/api\/forge\/install$/, async (ctx) => {
  const root = requireRoot();
  const { modId, version, overwrite } = await readJsonBody(ctx.req);
  const id = createJob(`安装站点模组 #${modId}`);
  (async () => {
    try {
      const mod = await forge.getMod(Number(modId));
      if (!mod) throw new Error('站点上找不到该模组');
      const versions = await forge.getVersions(mod.id);
      const chosen = version ? versions.find((v) => v.version === version) : (forge.pickVersionForSpt(versions, getVersions(root).spt) || versions[0]);
      if (!chosen) throw new Error('没有可用版本');

      jobPatch(id, { percent: 5, message: `下载 ${mod.name} ${chosen.version}…` });
      const dl = await forge.downloadAndLocate(mod, chosen, (p) => {
        jobPatch(id, { percent: p.percent != null ? Math.round(5 + p.percent * 0.6) : 30, message: `下载中 ${humanSize(p.received)}${p.total ? ' / ' + humanSize(p.total) : ''}` });
      });

      jobPatch(id, { percent: 70, message: '分析压缩包结构…' });
      const entries = listArchive(dl.file);
      const analysis = analyzePackage(entries);

      jobPatch(id, { percent: 78, message: '解压到临时目录…' });
      const temp = extractToTemp(dl.file, 'market');
      try {
        jobPatch(id, { percent: 88, message: '写入游戏目录…' });
        const res = await installFromTemp(root, temp.dir, analysis, { overwrite: !!overwrite, source: `forge:${mod.id}@${chosen.version}` });
        jobDone(id, { mod, version: chosen, analysis, install: res, file: dl.file });
      } finally {
        temp.cleanup();
      }
    } catch (e) { jobFail(id, e); }
  })();
  return { ok: true, jobId: id };
});

// ---- 本地压缩包导入
route('POST', /^\/api\/import\/upload$/, async (ctx) => {
  const rawName = ctx.url.searchParams.get('name') || 'package.zip';
  const safe = rawName.replace(/[\\/:*?"<>|]/g, '_');
  const dest = path.join(UPLOAD_DIR, `${nowStamp()}_${safe}`);
  const buf = await readBody(ctx.req);
  if (!buf.length) return sendError(ctx.res, 400, '没有收到文件内容');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(dest, buf);
  return { ok: true, file: dest, name: safe, size: buf.length };
});

route('POST', /^\/api\/import\/analyze$/, async (ctx) => {
  const { file } = await readJsonBody(ctx.req);
  if (!file || !fs.existsSync(file)) return sendError(ctx.res, 400, '文件不存在');
  try {
    const entries = listArchive(file);
    const analysis = analyzePackage(entries);
    return { ok: true, file, name: path.basename(file), size: fs.statSync(file).size, entryCount: entries.length, analysis };
  } catch (e) {
    return sendError(ctx.res, 400, String(e && e.message ? e.message : e));
  }
});

route('POST', /^\/api\/import\/install$/, async (ctx) => {
  const root = requireRoot();
  const { file, selected: selectedRaw, overwrite } = await readJsonBody(ctx.req);
  if (!file || !fs.existsSync(file)) return sendError(ctx.res, 400, '文件不存在');
  let entries;
  let analysis;
  try {
    entries = listArchive(file);
    analysis = analyzePackage(entries);
  } catch (e) {
    return sendError(ctx.res, 400, String(e && e.message ? e.message : e));
  }
  if (analysis.kind === 'spt-install') return sendError(ctx.res, 400, '这是 SPT/游戏本体安装包，不能当模组安装');
  if (analysis.kind === 'unknown' || !analysis.groups.length) {
    return sendError(ctx.res, 400, (analysis.warnings[0] || '没有识别出可安装的模组目录'));
  }
  // 前端传的是分组下标；也接受 "type|name" 字符串
  const selected = Array.isArray(selectedRaw) && selectedRaw.length
    ? selectedRaw.map((v) => {
      if (typeof v === 'number' || /^\d+$/.test(String(v))) {
        const g = analysis.groups[Number(v)];
        return g ? `${g.type}|${g.name}` : null;
      }
      return String(v);
    }).filter(Boolean)
    : undefined;
  const temp = extractToTemp(file, 'import');
  try {
    const res = await installFromTemp(root, temp.dir, analysis, { overwrite: !!overwrite, source: `local:${path.basename(file)}`, selected });
    return { ok: true, analysis, install: res };
  } finally {
    temp.cleanup();
  }
});

// ---- 服务器
route('GET', /^\/api\/server\/status$/, async () => {
  const info = game.isServerRunning();
  const running = !!(info && info.running);
  let ping = null;
  if (running) ping = await game.pingServer(getSptRoot(), 1200);
  return { ok: true, running, pid: info && info.pid, byUs: !!(info && info.byUs), ping };
});

route('POST', /^\/api\/server\/start$/, async () => {
  const root = requireRoot();
  const r = game.startServer(root, {});
  return { ok: true, ...r };
});

route('POST', /^\/api\/server\/stop$/, async () => {
  const r = game.stopServer();
  return { ok: true, ...r };
});

route('GET', /^\/api\/server\/log$/, async (ctx) => {
  const n = Number(ctx.url.searchParams.get('n') || 200);
  const root = getSptRoot();
  return { ok: true, ...game.serverLog(root, n) };
});

// ---- 战局实测：服务端 NoAIBots 决策 vs 客户端真正刷出的 AI
route('GET', /^\/api\/raid\/compare$/, async () => {
  const root = requireRoot();
  return { ok: true, ...raidProbe.compare(root) };
});

// ---- 局内测试：让客户端插件就地击杀 AI（kill all/scav/pmc/boss）
route('POST', /^\/api\/raid\/kill$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const scope = ['all', 'scav', 'pmc', 'boss'].includes(body.scope) ? body.scope : 'all';
  const sent = raidProbe.sendLiveCommand(root, { action: 'kill', scope });
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: true, ...sent };
});

// ---- 局内测试：读插件回执（command-result.json）
route('GET', /^\/api\/raid\/kill\/result$/, async () => {
  const root = requireRoot();
  return { ok: true, result: raidProbe.liveCommandResult(root) };
});

// ---- 实时窗口：服务端 / 无头主机 / NoAIBots 各看各的
route('GET', /^\/api\/live\/panes$/, async (ctx) => {
  const n = Math.min(600, Math.max(40, Number(ctx.url.searchParams.get('n') || 200)));
  const root = getSptRoot();
  const settings = readSettings();
  return {
    ok: true,
    n,
    at: new Date().toISOString(),
    server: root ? live.serverPane(root, n) : null,
    headless: root ? live.headlessPanes(root, settings, n) : [],
    ai: root ? live.aiPane(root, n) : { kind: 'ai', lines: [], matched: 0 },
    quickEdit: live.quickEditEnabled(),
  };
});

route('POST', /^\/api\/live\/quickedit$/, async (ctx) => {
  const body = await readJsonBody(ctx.req);
  const want = body.enabled !== false ? false : true; // 默认动作是“关闭快速编辑”
  return { ok: true, ...live.setQuickEdit(want), enabled: want };
});

// ---- AI / 战局配置
route('GET', /^\/api\/ai$/, async () => {
  const root = requireRoot();
  return { ok: true, ...game.readAiConfig(root) };
});

route('POST', /^\/api\/ai$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const r = game.writeAiConfig(root, body);
  return { ok: true, ...r };
});

route('POST', /^\/api\/ai\/boss$/, async (ctx) => {
  const root = requireRoot();
  const { map, index, patch } = await readJsonBody(ctx.req);
  const r = game.writeBossConfig(root, map, index, patch || {});
  return { ok: true, ...r };
});

// ---- AI 规则（NoAIBots 服务器 mod）
route('GET', /^\/api\/ai\/rules$/, async () => {
  const root = requireRoot();
  const bundle = bundled.bundleStatus(root).find((x) => x.id === 'noaibots') || null;
  return { ok: true, bundle, ...aiRules.readRules(root), defaults: aiRules.defaultConfig(), catalog: aiRules.RULE_CATALOG, actionDefs: aiRules.ACTION_DEFS, actionGroups: aiRules.ACTION_GROUPS, amountLabels: aiRules.BOT_AMOUNT_LABEL, mapDefaults: aiRules.mapDefaults(root), spawn: aiRules.spawnData(root), pmcInfo: aiRules.pmcInfo(root), commonSkills: aiRules.COMMON_SKILLS };
});

route('POST', /^\/api\/ai\/rules$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const r = aiRules.writeRules(root, body && body.config ? body.config : body);
  return { ok: true, ...r };
});

// 只保存一条规则：不会把其他卡片里未保存的编辑一起写进去
route('POST', /^\/api\/ai\/rules\/rule$/, async (ctx) => {
  const root = requireRoot();
  const { index, rule, total } = await readJsonBody(ctx.req);
  const r = aiRules.writeRule(root, index, rule, total);
  return { ok: true, ...r };
});

// 只保存 PMC 档案：不动规则列表
route('POST', /^\/api\/ai\/rules\/pmc$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const r = aiRules.writePmcProfile(root, body && body.pmcProfile ? body.pmcProfile : body);
  return { ok: true, ...r };
});

route('POST', /^\/api\/ai\/rules\/preview$/, async (ctx) => {
  const root = requireRoot();
  const { config, scenario } = await readJsonBody(ctx.req);
  const r = aiRules.previewRules(root, config, scenario || {});
  return { ok: true, ...r };
});

route('POST', /^\/api\/ai\/rules\/restore$/, async (ctx) => {
  const root = requireRoot();
  const { name } = await readJsonBody(ctx.req);
  const r = aiRules.restoreBackup(root, name);
  return { ok: true, ...r };
});

// ---- 物品效果（直接改数据库模板，改前自动备份）
route('GET', /^\/api\/items\/backups$/, async () => {
  const root = requireRoot();
  return { ok: true, list: items.listDbBackups(root) };
});

route('POST', /^\/api\/items\/restore$/, async (ctx) => {
  const root = requireRoot();
  const { name } = await readJsonBody(ctx.req);
  return { ok: true, ...items.restoreDbBackup(root, name) };
});

route('GET', /^\/api\/items$/, async (ctx) => {
  const root = requireRoot();
  const q = ctx.url.searchParams.get('q') || '';
  const limit = Number(ctx.url.searchParams.get('limit') || 40);
  return { ok: true, ...items.searchItems(root, q, limit) };
});

route('GET', /^\/api\/items\/([0-9a-zA-Z_-]+)$/, async (ctx) => {
  const root = requireRoot();
  return { ok: true, item: items.readItem(root, ctx.matches[1]) };
});

route('POST', /^\/api\/items\/([0-9a-zA-Z_-]+)$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  return { ok: true, item: items.writeItem(root, ctx.matches[1], (body && body.patch) || {}) };
});

route('GET', /^\/api\/buffs$/, async () => {
  const root = requireRoot();
  const cat = items.buffCatalog(root);
  return { ok: true, loopTime: cat.loopTime, path: cat.path, groups: cat.groups };
});

route('POST', /^\/api\/buffs\/([0-9a-zA-Z_]+)$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  return { ok: true, group: items.writeBuffGroup(root, ctx.matches[1], (body && body.entries) || []) };
});

// ---- 物资
route('GET', /^\/api\/loot$/, async () => {
  const root = requireRoot();
  return { ok: true, maps: game.lootOverview(root) };
});

route('POST', /^\/api\/loot\/apply$/, async (ctx) => {
  const root = requireRoot();
  const { maps, factor } = await readJsonBody(ctx.req);
  const f = Number(factor);
  if (!(f > 0 && f <= 10)) return sendError(ctx.res, 400, '倍率需在 0~10 之间');
  const id = createJob(`物资倍率 ×${f}`);
  (async () => {
    try {
      jobPatch(id, { percent: 5, message: '读取地图列表…' });
      const r = await game.applyLootMultiplier(root, maps && maps.length ? maps : undefined, f, {
        onProgress: (p) => jobPatch(id, { percent: Math.min(98, p.percent || 0), message: p.message || '' }),
      });
      jobDone(id, r);
    } catch (e) { jobFail(id, e); }
  })();
  return { ok: true, jobId: id };
});

route('GET', /^\/api\/loot\/backups$/, async () => ({ ok: true, list: game.listLootBackups().map((b) => ({ name: b.name, mtime: b.mtime, manifest: b.manifest })) }));

route('POST', /^\/api\/loot\/restore$/, async (ctx) => {
  const root = requireRoot();
  const { name } = await readJsonBody(ctx.req);
  const r = game.restoreLootBackup(root, name);
  return { ok: true, ...r };
});

// ---- 存档
route('GET', /^\/api\/profiles$/, async () => {
  const root = requireRoot();
  const list = game.listProfiles(root);
  // 服务端在跑就顺带补上在线信息（等级、版本），读不到不算错
  try {
    const online = await launch.serverProfiles(root);
    const byName = new Map(online.map((p) => [String(p.username || '').toLowerCase(), p]));
    for (const p of list) {
      const o = byName.get(String(p.nickname || '').toLowerCase());
      if (!o) continue;
      p.edition = p.edition || o.edition;
      p.level = o.currlvl ?? p.level;
      p.experience = o.currexp ?? p.experience;
      p.side = o.side || p.side;
      p.online = true;
    }
  } catch { /* 服务端没开就只显示文件信息 */ }
  return { ok: true, list, backups: game.listProfileBackups(root) };
});

route('POST', /^\/api\/profiles\/backup$/, async (ctx) => {
  const root = requireRoot();
  const { id } = await readJsonBody(ctx.req);
  const r = game.backupProfile(root, id);
  return { ok: true, ...r };
});

route('POST', /^\/api\/profiles\/restore$/, async (ctx) => {
  const root = requireRoot();
  const { name } = await readJsonBody(ctx.req);
  const r = game.restoreProfile(root, name);
  return { ok: true, ...r };
});

route('POST', /^\/api\/profiles\/delete$/, async (ctx) => {
  const { name } = await readJsonBody(ctx.req);
  const r = game.deleteProfileBackup(name);
  return { ok: true, ...r };
});

// 在服务端新建 / 删除存档（走 SPT 启动器 API；要求服务端在跑）
route('GET', /^\/api\/profiles\/types$/, async () => {
  const root = requireRoot();
  const types = await launch.profileTypes(root);
  return { ok: true, types };
});

route('POST', /^\/api\/profiles\/create$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const r = await launch.createProfile(root, { username: body.username, password: body.password, edition: body.edition });
  return { ok: true, ...r };
});

route('POST', /^\/api\/profiles\/remove$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const r = await launch.removeProfile(root, { username: body.username });
  return { ok: true, ...r };
});

// ---- 内置基础模组（关于页）
route('GET', /^\/api\/bundled$/, async () => {
  const root = getSptRoot();
  return { ok: true, embedded: bundled.BUNDLED_EMBEDDED, items: bundled.bundleStatus(root) };
});

route('POST', /^\/api\/bundled\/install$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const r = bundled.installBundle(root, String(body.id || ''));
  return { ...r, items: bundled.bundleStatus(root) };
});

// ---- Fika 联机
route('GET', /^\/api\/fika$/, async () => {
  const root = requireRoot();
  const settings = readSettings();
  const status = fika.fikaStatus(root, settings);
  const server = fika.readFikaServer(root);
  const client = fika.readFikaClientCfg(root);
  return {
    ok: true,
    status,
    serverConfig: server.ok ? server.config : null,
    serverExists: !!server.exists,
    serverError: server.ok ? null : server.error,
    serverFile: fika.fikaPaths(root).serverConfig,
    clientFile: fika.fikaPaths(root).clientCfg,
    clientSections: client.sections || [],
    clientError: client.ok ? null : client.error,
    headlessDirs: settings.headlessDirs || [],
  };
});

route('POST', /^\/api\/fika\/server$/, async (ctx) => {
  const root = requireRoot();
  const { patches } = await readJsonBody(ctx.req);
  if (!Array.isArray(patches) || !patches.length) throw new Error('没有需要修改的配置项');
  const r = fika.updateFikaServer(root, patches);
  return { ok: true, ...r };
});

route('POST', /^\/api\/fika\/client$/, async (ctx) => {
  const root = requireRoot();
  const { updates } = await readJsonBody(ctx.req);
  if (!Array.isArray(updates) || !updates.length) throw new Error('没有需要修改的配置项');
  const r = fika.updateFikaClientCfg(root, updates);
  return { ok: true, ...r };
});

// 无头配置：一次性写入 headless.* 各字段
route('POST', /^\/api\/fika\/headless$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const patches = [];
  if (body.amount !== undefined) patches.push({ path: ['headless', 'profiles', 'amount'], value: Math.max(0, Math.round(Number(body.amount) || 0)) });
  if (body.aliases !== undefined) patches.push({ path: ['headless', 'profiles', 'aliases'], value: body.aliases || {} });
  if (body.generate !== undefined) patches.push({ path: ['headless', 'scripts', 'generate'], value: !!body.generate });
  if (body.forceIp !== undefined) patches.push({ path: ['headless', 'scripts', 'forceIp'], value: String(body.forceIp || '') });
  if (body.setLevel !== undefined) patches.push({ path: ['headless', 'setLevelToAverageOfLobby'], value: !!body.setLevel });
  if (body.restartAfter !== undefined) patches.push({ path: ['headless', 'restartAfterAmountOfRaids'], value: Math.max(0, Math.round(Number(body.restartAfter) || 0)) });
  if (!patches.length) throw new Error('没有需要修改的无头配置');
  const r = fika.updateFikaServer(root, patches);
  return { ok: true, ...r };
});

route('GET', /^\/api\/fika\/headless$/, async () => {
  const root = requireRoot();
  const settings = readSettings();
  return { ok: true, ...fika.headlessSummary(root, settings) };
});

route('POST', /^\/api\/fika\/headless\/dirs$/, async (ctx) => {
  const { dirs } = await readJsonBody(ctx.req);
  const list = (dirs || []).map((d) => String(d || '').trim()).filter(Boolean);
  writeSettings({ headlessDirs: list });
  return { ok: true, headlessDirs: list };
});

route('POST', /^\/api\/fika\/headless\/launch$/, async (ctx) => {
  const { dir } = await readJsonBody(ctx.req);
  const r = launch.launchHeadless(dir);
  return { ok: true, ...r };
});

route('POST', /^\/api\/fika\/headless\/stop$/, async (ctx) => {
  const { dir } = await readJsonBody(ctx.req);
  const r = launch.stopHeadless(dir);
  return { ok: true, ...r };
});

// 一键切换：客户端模式 / 无头主机模式（同一份客户端即可，不用复制第二份）
route('POST', /^\/api\/client\/mode$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const mode = body.mode === 'host' ? 'host' : 'solo';
  const username = body.username ? String(body.username) : undefined;
  const settings = readSettings();
  const summary = fika.headlessSummary(root, settings);
  const separate = summary.installs[0] || null;
  const installDir = separate ? separate.dir : root;
  const singleCopy = !separate;
  const id = createJob(mode === 'host' ? '切到无头主机' : '切到客户端');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  (async () => {
    const steps = [];
    try {
      if (mode === 'host') {
        // 同一份目录只能跑一个：先停掉正在玩的客户端
      if (singleCopy) {
        // 同一份目录只能跑一个：不管现在跑的是客户端还是旧的无头，先清干净
        jobPatch(id, { percent: 5, message: '停掉正在跑的客户端 / 旧无头…' });
        const r = launch.stopHeadless(root);
        steps.push(r.count ? `已停止 ${r.count} 个进程` : '当前没有在跑的客户端');
      } else if (launch.isClientRunning(root)) {
        jobPatch(id, { percent: 5, message: '停止正在运行的客户端…' });
        const r = launch.stopHeadless(root);
        steps.push(`已停止客户端进程 ${r.count} 个`);
      }

        jobPatch(id, { percent: 12, message: '确认本地服务端…' });
        const st0 = game.isServerRunning(root);
        if (!(st0 && st0.running)) {
          const s = await game.startServer(root);
          if (!s.ok) throw new Error(`本地服务端启动失败：${s.error || '未知原因'}`);
          steps.push('已拉起本地服务端');
          let up = false;
          for (let i = 0; i < 45; i += 1) {
            await sleep(2000);
            jobPatch(id, { percent: 12 + Math.min(18, i), message: `等待服务端就绪…（${(i + 1) * 2}s）` });
            const p = await game.pingServer(root, 1500);
            if (p && p.ok) { up = true; break; }
          }
          if (!up) throw new Error('本地服务端 90 秒内没有就绪，去「服务器」页看日志');
          steps.push('服务端已就绪');
        } else {
          steps.push('服务端已在运行');
        }

        if (singleCopy) {
          jobPatch(id, { percent: 34, message: '启用 Fika.Headless 插件…' });
          const st = fika.headlessModeState(root);
          if (!st.hasPlugin) throw new Error('这份客户端里没有 Fika.Headless.dll：把无头组件放进 BepInEx\\plugins\\Fika 再来切换');
          if (!st.manager) throw new Error('这份客户端根目录没有 FikaHeadlessManager.exe：把无头管理器放进客户端根目录');
          const r = fika.setHeadlessPluginEnabled(root, true);
          steps.push(r.changed ? '已启用 Fika.Headless' : 'Fika.Headless 本来就是启用的');
          const cfg = fika.ensureHeadlessConfig(root);
          steps.push(cfg.created ? '已复制 HeadlessConfig.json 到客户端根目录' : 'HeadlessConfig.json 已就绪');
        }

        jobPatch(id, { percent: 45, message: '启动无头主机…' });
        if (fika.liveHeadlessState(installDir) === 'connected') {
          steps.push('无头主机已连接，跳过启动');
        } else {
          const l = launch.launchHeadless(installDir);
          steps.push(`已启动无头主机 pid ${l.pid}`);
          let connected = false;
          for (let i = 0; i < 45; i += 1) {
            await sleep(2000);
            jobPatch(id, { percent: 45 + Math.min(45, Math.round(((i + 1) / 45) * 45)), message: `等待无头连接服务端…（${(i + 1) * 2}s）` });
            if (fika.liveHeadlessState(installDir) === 'connected') { connected = true; break; }
          }
          if (!connected) throw new Error('无头主机 90 秒内没有连上服务端，去 Fika 页看它的 BepInEx 日志');
          steps.push('无头主机已连接服务端');
        }
        jobDone(id, { mode, steps, dir: installDir });
        return;
      }

      // 客户端模式：先停掉无头（同一份目录时连客户端进程一起清）
      jobPatch(id, { percent: 8, message: '停止无头主机…' });
      const dirs = [...new Set([...summary.installs.map((x) => x.dir), root])].filter(Boolean);
      for (const d of dirs) {
        const r = launch.stopHeadless(d);
        if (r.count) steps.push(`已停止 ${r.count} 个进程（${d}）`);
      }
      if (fika.headlessModeState(root).pluginEnabled) {
        fika.setHeadlessPluginEnabled(root, false);
        steps.push('已停用 Fika.Headless（客户端模式不会加载它）');
      }
      jobPatch(id, { percent: 45, message: '启动游戏客户端…' });
      if (launch.isClientRunning(root)) steps.push('客户端已经在运行，跳过');
      else {
        const r = await launch.launchGameDirect(root, { username, ensureServer: true });
        steps.push(`已启动客户端 pid ${r.pid}（账号 ${r.username}）`);
      }
      jobDone(id, { mode, steps });
    } catch (err) {
      jobFail(id, err);
    }
  })();

  return { ok: true, jobId: id };
});

route('POST', /^\/api\/fika\/open$/, async (ctx) => {
  const root = requireRoot();
  const { kind } = await readJsonBody(ctx.req);
  const p = fika.fikaPaths(root);
  const map = {
    serverConfig: path.dirname(p.serverConfig),
    clientCfg: path.dirname(p.clientCfg),
    plugins: p.pluginsDir,
    profiles: p.profilesDir,
  };
  const dir = map[String(kind || '')];
  if (!dir) throw new Error('未知目录');
  return { ok: true, ...launch.openDir(dir) };
});

// ---- 客户端启动 / 存档选择
route('GET', /^\/api\/launch$/, async () => {
  const root = requireRoot();
  const info = launch.profileList(root);
  const p = launch.launchPaths(root);
  const lc = launch.readLauncherConfig(root);
  const gamePath = lc.ok ? lc.config.GamePath : null;
  return {
    ok: true,
    ...info,
    target: launch.serverTarget(root),
    clientRunning: launch.isClientRunning(root),
    serverRunning: !!(game.isServerRunning(root) || {}).running,
    gameExe: p.gameExe,
    launcherExe: p.launcherExe,
    gameExeExists: fs.existsSync(p.gameExe),
    launcherExists: fs.existsSync(p.launcherExe),
    launcherGamePath: gamePath || null,
    launcherGamePathOk: launch.isGamePathUsable(root, gamePath),
  };
});

// 修启动器 GamePath（写错会导致「Core dll mismatch」并且游戏不启动）
route('POST', /^\/api\/launch\/repair$/, async () => {
  const root = requireRoot();
  const r = launch.repairLauncherConfig(root);
  if (!r.ok) throw new Error(r.error);
  return { ok: true, ...r };
});

// 连接哪个服务端：本机 or 别人开的（写入 launcher config 的 Server.Url）
route('POST', /^\/api\/launch\/target$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const r = launch.setServerTarget(root, { url: body.url, name: body.name, autoLogin: body.autoLogin });
  return { ok: true, ...r };
});

// ---- 服务端地址簿 + 在线玩家（Fika presence）
route('GET', /^\/api\/servers$/, async () => {
  const root = getSptRoot();
  const port = root ? Number(readJson(path.join(root, 'SPT', 'SPT_Data', 'configs', 'http.json'), {}).port || 6969) || 6969 : 6969;
  const target = root ? launch.serverTarget(root) : null;
  return {
    ok: true,
    localDefault: `https://127.0.0.1:${port}`,
    target: target && target.ok ? target : null,
    history: serverlink.historyList(),
  };
});

route('POST', /^\/api\/servers\/forget$/, async (ctx) => {
  const body = await readJsonBody(ctx.req);
  return { ok: true, history: serverlink.forgetServer(body.url) };
});

// 在线玩家：默认查当前连接目标（本机/远程），也可以 ?url= 指定别的服务端
route('GET', /^\/api\/servers\/presence$/, async (ctx) => {
  const root = getSptRoot();
  const port = root ? Number(readJson(path.join(root, 'SPT', 'SPT_Data', 'configs', 'http.json'), {}).port || 6969) || 6969 : 6969;
  let url = ctx.url.searchParams.get('url') || '';
  if (!url) {
    const t = root ? launch.serverTarget(root) : null;
    url = t && t.ok && t.url ? t.url : `https://127.0.0.1:${port}`;
  }
  const r = await serverlink.fetchPresence(url);
  return { ok: r.ok, ...r };
});

route('POST', /^\/api\/launch\/profile$/, async (ctx) => {
  const root = requireRoot();
  const { username } = await readJsonBody(ctx.req);
  const r = launch.setActiveProfile(root, username);
  return { ok: true, ...r };
});

route('POST', /^\/api\/launch\/client$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const r = await launch.launchClient(root, { ensureServer: body.ensureServer !== false });
  return { ok: true, ...r };
});

// 直接启动游戏本体（不走启动器）：先按存档名登录服务端拿 profileId，再拉起 EscapeFromTarkov.exe
route('POST', /^\/api\/launch\/direct$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  const r = await launch.launchGameDirect(root, { username: body.username, ensureServer: !!body.ensureServer });
  return { ok: true, ...r };
});

route('POST', /^\/api\/launch\/open$/, async (ctx) => {
  const root = requireRoot();
  const { kind } = await readJsonBody(ctx.req);
  const p = launch.launchPaths(root);
  const dir = kind === 'launcher' ? path.dirname(p.launcherExe) : root;
  return { ok: true, ...launch.openDir(dir) };
});

// ---- 打包导出
route('GET', /^\/api\/pack\/candidates$/, async (ctx) => {
  const root = requireRoot();
  return { ok: true, dir: pack.EXPORT_DIR, candidates: pack.packCandidates(root), exports: pack.listPacks() };
});

route('POST', /^\/api\/pack\/create$/, async (ctx) => {
  const root = requireRoot();
  const body = await readJsonBody(ctx.req);
  if (!Array.isArray(body.items) || !body.items.length) throw new Error('至少选择一个模组');
  const id = createJob('打包模组');
  (async () => {
    try {
      jobPatch(id, { percent: 2, message: '准备中…' });
      const result = await pack.createPack(root, {
        items: body.items, name: body.name, format: body.format, level: body.level,
      }, (p) => jobPatch(id, { percent: p.percent, message: p.message }));
      jobDone(id, result);
    } catch (e) {
      jobFail(id, e);
    }
  })();
  return { ok: true, jobId: id };
});

route('POST', /^\/api\/pack\/delete$/, async (ctx) => {
  const { name } = await readJsonBody(ctx.req);
  return { ok: true, ...pack.deletePack(name) };
});

route('GET', /^\/api\/pack\/download$/, async (ctx) => {
  const name = ctx.url.searchParams.get('name');
  const file = pack.exportFile(name);
  const stat = fs.statSync(file);
  const base = path.basename(file);
  const ascii = base.replace(/[^\x20-\x7e]/g, '_');
  ctx.res.writeHead(200, {
    'content-type': /\.7z$/i.test(base) ? 'application/x-7z-compressed' : 'application/zip',
    'content-length': stat.size,
    'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(base)}`,
    'cache-control': 'no-store',
  });
  fs.createReadStream(file).pipe(ctx.res);
  ctx.res.on('close', () => { try { ctx.res.destroy(); } catch { /* ignore */ } });
  return undefined;
});

route('POST', /^\/api\/pack\/open$/, async (ctx) => {
  const { name } = await readJsonBody(ctx.req);
  const file = pack.exportFile(name);
  return { ok: true, ...launch.openDir(path.dirname(file)) };
});

// ---- 任务
route('GET', /^\/api\/jobs\/([\w]+)$/, async (ctx) => {
  const j = jobs.get(ctx.matches[1]);
  if (!j) return sendError(ctx.res, 404, '任务不存在');
  return { ok: true, job: j };
});

// ---------------------------------------------------------------- 启动
const PACKED_RUNTIME = import.meta.url.includes('%7EBUN') || import.meta.url.includes('$bunfs');

function openBrowser(port) {
  if (process.env.SPT_MANAGER_NO_OPEN === '1') return;
  try {
    spawn('cmd.exe', ['/c', 'start', '', `http://${HOST}:${port}`], { windowsHide: true, detached: true, stdio: 'ignore' }).unref();
  } catch { /* 打开浏览器失败不影响服务 */ }
}

/** 这个端口上是不是已经有一个管理器在跑 */
function managerAt(port, timeout = 800) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port, path: '/api/state', timeout }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { if (body.length < 4096) body += d; });
      res.on('end', () => {
        try {
          const j = JSON.parse(body);
          resolve(!!(j && j.ok && j.settings));
        } catch { resolve(false); }
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

const handler = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const entry = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!entry) return sendError(res, 404, `未知接口 ${req.method} ${url.pathname}`);
      const m = entry.pattern.exec(url.pathname);
      const ctx = { req, res, url, matches: m };
      const out = await entry.handler(ctx);
      if (out !== undefined && !res.writableEnded) sendJson(res, 200, out);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendError(res, 405, 'method not allowed');
    serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!res.writableEnded) sendError(res, 500, String(e && e.message ? e.message : e));
  }
};

let server = null;

function banner(root, port) {
  const line = '='.repeat(52);
  console.log(line);
  console.log('  SPT 模组管理器 & 服务器启动器');
  console.log(`  地址：http://${HOST}:${port}`);
  console.log(`  SPT 目录：${root || '（未设置，请在界面里选择）'}`);
  console.log(`  数据目录：${DATA_DIR}${DATA_DIR_FALLBACK ? '（exe 目录不可写，已放到用户目录）' : ''}`);
  if (PACKED_RUNTIME) console.log('  关闭这个窗口 = 退出管理器');
  console.log(line);
}

/** 端口是不是空的（能绑定就算空） */
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, HOST);
  });
}

/** 先问系统要一个能用的端口，再建服务（不复用失败的 server 对象，避免监听状态残留） */
async function pickPort(start, tries) {
  for (let i = 0; i < tries; i++) {
    const port = start + i;
    if (await portFree(port)) return port;
    console.log(`端口 ${port} 被别的程序占用了，试 ${port + 1}…`);
  }
  return null;
}

function listenOn(port) {
  return new Promise((resolve, reject) => {
    server = http.createServer(handler);
    server.once('error', reject);
    server.once('listening', () => resolve(server.address().port));
    server.listen(port, HOST);
  });
}

async function fail(err) {
  console.error(`\n启动失败：${err && err.message ? err.message : err}`);
  console.error(`日志文件：${path.join(DATA_DIR, 'manager.log')}`);
  if (PACKED_RUNTIME) {
    console.error('按回车键关闭窗口…');
    try {
      process.stdin.resume();
      await new Promise((r) => process.stdin.once('data', r));
    } catch { /* 忽略 */ }
  }
  process.exit(1);
}

const requested = Number(process.env.SPT_MANAGER_PORT || 0) || PORT;

// 默认端口上已经开着管理器 → 直接把浏览器指过去，别报错
const existing = await managerAt(requested);
if (existing) {
  console.log(`管理器已经在 http://${HOST}:${requested} 运行，直接打开它。`);
  console.log('要再开一个，可以设置环境变量 SPT_MANAGER_PORT=其他端口。');
  openBrowser(requested);
  setTimeout(() => process.exit(0), 800);
} else {
  const port = await pickPort(requested, 20);
  if (!port) {
    await fail(new Error(`端口 ${requested}–${requested + 19} 都被占用了，可以设置环境变量 SPT_MANAGER_PORT 换个端口`));
  } else {
    try {
      const actual = await listenOn(port);
      if (actual !== requested) console.log(`（默认端口 ${requested} 被占用，已改用 ${actual}）`);
      banner(getSptRoot(), actual);
      // 无头 / 服务端窗口只要被鼠标点一下就会冻住（快速编辑模式），新开的控制台默认关掉它
      const qe = live.ensureQuickEditOff();
      if (qe.changed) console.log('  已关闭控制台「快速编辑」：误点无头 / 服务端窗口不会再卡住（重新打开的窗口生效）');
      openBrowser(actual);
    } catch (e) {
      await fail(e);
    }
  }
}

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
