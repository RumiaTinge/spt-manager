// net.js — 带兜底的 HTTP 工具：优先 Node 原生 fetch，失败时回落到系统 curl.exe
// 国内环境直连站点经常超时，curl 走 Schannel 更稳，且能复用系统代理设置。
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) SPT-Manager/1.0 (+local)';

let curlPath;
export function findCurl() {
  if (curlPath !== undefined) return curlPath;
  const cands = ['C:\\Windows\\System32\\curl.exe', 'C:\\Windows\\SysWOW64\\curl.exe'];
  for (const c of cands) if (fs.existsSync(c)) { curlPath = c; return c; }
  try {
    const r = spawnSync('where', ['curl.exe'], { encoding: 'utf8' });
    if (r.status === 0) {
      const p = (r.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
      if (p && fs.existsSync(p)) { curlPath = p; return p; }
    }
  } catch { /* ignore */ }
  curlPath = null;
  return null;
}

function curlGet(url, timeoutMs) {
  const curl = findCurl();
  if (!curl) throw new Error('无网络兜底工具');
  const r = spawnSync(curl, [
    '-sL', '--max-time', String(Math.max(5, Math.round(timeoutMs / 1000))), '--retry', '1',
    '-H', 'Accept: application/json', '-H', `User-Agent: ${UA}`,
    url,
  ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`curl 失败: ${(r.stderr || '').toString().slice(0, 300)}`);
  return (r.stdout || Buffer.alloc(0)).toString('utf8');
}

export async function getJson(url, { timeoutMs = 15000, headers = {} } = {}) {
  const attempt = async () => {
    const r = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': UA, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const txt = await r.text();
    return JSON.parse(txt);
  };
  try {
    return await attempt();
  } catch (e1) {
    try {
      const txt = curlGet(url, timeoutMs);
      return JSON.parse(txt);
    } catch (e2) {
      throw new Error(`${e1.message} / ${e2.message}`);
    }
  }
}

export async function getText(url, { timeoutMs = 15000 } = {}) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch {
    return curlGet(url, timeoutMs);
  }
}

/**
 * 下载文件到本地，带进度回调。先试 fetch 流式，失败则用 curl 并在 Node 侧轮询文件大小报进度。
 * @param {(p:{received:number,total:number,percent:number|null,done?:boolean})=>void} onProgress
 */
export async function downloadFile(url, destFile, onProgress, { timeoutMs = 1000 * 60 * 60, referer } = {}) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true });
  const headers = { 'user-agent': UA, accept: '*/*' };
  if (referer) headers.referer = referer;

  try {
    const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const total = Number(r.headers.get('content-length')) || 0;
    const ws = fs.createWriteStream(destFile);
    let received = 0;
    let last = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      ws.write(Buffer.from(value));
      const now = Date.now();
      if (onProgress && now - last > 300) {
        last = now;
        onProgress({ received, total, percent: total ? Math.round((received / total) * 100) : null });
      }
    }
    await new Promise((res, rej) => ws.end((e) => (e ? rej(e) : res())));
    const size = fs.statSync(destFile).size;
    if (onProgress) onProgress({ received: size, total: total || size, percent: 100, done: true });
    return { ok: true, file: destFile, size };
  } catch (e1) {
    // 回落到 curl
    const curl = findCurl();
    if (!curl) throw e1;
    try { fs.rmSync(destFile, { force: true }); } catch { /* ignore */ }
    const args = ['-L', '--fail', '--retry', '2', '--connect-timeout', '20', '-o', destFile,
      '-H', `User-Agent: ${UA}`];
    if (referer) args.push('-e', referer);
    args.push(url);
    const proc = spawn(curl, args, { stdio: 'ignore' });
    let stop = false;
    const timer = setInterval(() => {
      try {
        const size = fs.statSync(destFile).size;
        if (onProgress) onProgress({ received: size, total: 0, percent: null });
      } catch { /* not created yet */ }
    }, 500);
    const code = await new Promise((res) => proc.on('exit', res));
    stop = true;
    clearInterval(timer);
    if (code !== 0) throw new Error(`下载失败（curl exit ${code}）`);
    const size = fs.statSync(destFile).size;
    if (onProgress) onProgress({ received: size, total: size, percent: 100, done: true });
    return { ok: true, file: destFile, size, via: 'curl' };
  }
}
