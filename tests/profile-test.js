// 新建 / 删除存档：用本地 http 桩服务端跑完整链路（含 deflate 请求体、真 JSON 响应）
import http from 'node:http';
import zlib from 'node:zlib';
import assert from 'node:assert';
import * as launch from '../lib/launch.js';

let failures = 0;
const cases = [];
async function t(name, fn) {
  try { await fn(); cases.push(`  ok   ${name}`); } catch (e) { failures++; cases.push(`  FAIL ${name}\n         ${e.message}`); }
}

const TYPES = {
  Standard: '与在线相同，基本储物空间（10×28），500,000卢布',
  'Edge Of Darkness': '更大的储物空间（10×68）',
};

const profiles = [{ username: 'Rumia', edition: 'SPT Easy start', currlvl: 16, currexp: 221758, side: 'Usec' }];
let lastRegister = null;
let lastRemove = null;

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      if (!raw.length) return resolve(null);
      const enc = String(req.headers['content-encoding'] || '');
      const text = enc === 'deflate' ? zlib.inflateSync(raw).toString('utf8') : raw.toString('utf8');
      resolve(JSON.parse(text));
    });
  });
}

const server = http.createServer(async (req, res) => {
  const send = (obj, code = 200) => {
    const body = zlib.deflateSync(Buffer.from(JSON.stringify(obj), 'utf8'));
    res.writeHead(code, { 'content-type': 'application/json', 'content-encoding': 'deflate' });
    res.end(body);
  };
  if (req.url === '/launcher/v2/types' && req.method === 'GET') return send({ Response: TYPES });
  if (req.url === '/launcher/v2/profiles' && req.method === 'GET') return send({ Response: profiles });
  if (req.url === '/launcher/v2/register' && req.method === 'POST') {
    lastRegister = await readBody(req);
    if (lastRegister.username === 'Rumia') return send({ Response: false, Profiles: profiles });
    if (!TYPES[lastRegister.edition]) return send({ Response: false, Profiles: profiles });
    profiles.push({ username: lastRegister.username, edition: lastRegister.edition, currlvl: 1, side: 'Usec' });
    return send({ Response: true, Profiles: profiles });
  }
  if (req.url === '/launcher/v2/remove' && req.method === 'POST') {
    lastRemove = await readBody(req);
    const i = profiles.findIndex((p) => p.username === lastRemove.username);
    if (i < 0) return send({ Response: false, Profiles: profiles });
    profiles.splice(i, 1);
    return send({ Response: true, Profiles: profiles });
  }
  send({}, 404);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const serverUrl = `http://127.0.0.1:${port}`;

await t('读得到版本列表（带说明）', async () => {
  const types = await launch.profileTypes('/nonexistent', { serverUrl });
  assert.equal(types.Standard.includes('500,000'), true);
  assert.equal(Object.keys(types).length, 2);
});

await t('新建存档会按服务端格式发 username/password/edition', async () => {
  const r = await launch.createProfile('/nonexistent', { username: 'tester02', edition: 'Edge Of Darkness', serverUrl });
  assert.equal(r.ok, true);
  assert.deepEqual(lastRegister, { username: 'tester02', password: '', edition: 'Edge Of Darkness' });
  assert.equal(r.profiles.some((p) => p.username === 'tester02'), true);
});

await t('同名存档会被服务端拒绝并给出原因', async () => {
  await assert.rejects(() => launch.createProfile('/nonexistent', { username: 'Rumia', edition: 'Standard', serverUrl }), /拒绝新建/);
});

await t('不存在的版本在本地就拦掉，不发请求', async () => {
  await assert.rejects(() => launch.createProfile('/nonexistent', { username: 'zzz01', edition: 'No Such Edition', serverUrl }), /没有这个版本/);
});

await t('用户名格式不对时先报错', async () => {
  await assert.rejects(() => launch.createProfile('/nonexistent', { username: 'a b', edition: 'Standard', serverUrl }), /用户名只能用/);
  await assert.rejects(() => launch.createProfile('/nonexistent', { username: ' ', edition: 'Standard', serverUrl }), /不能为空/);
});

await t('删除存档发 username 并返回剩余列表', async () => {
  const r = await launch.removeProfile('/nonexistent', { username: 'tester02', serverUrl });
  assert.equal(r.ok, true);
  assert.deepEqual(lastRemove, { username: 'tester02', password: '' });
  assert.equal(r.profiles.some((p) => p.username === 'tester02'), false);
});

await t('服务端没开时给出可读错误', async () => {
  await assert.rejects(() => launch.profileTypes('/nonexistent', { serverUrl: 'http://127.0.0.1:1' }), /连不上服务端/);
});

server.close();
console.log(cases.join('\n'));
console.log(`\n${cases.length - failures} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
