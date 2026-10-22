// serverlink-test.js — 服务端地址补全 / 地址簿 / Fika 在线玩家解析
import assert from 'node:assert/strict';
import { normalizeServerUrl, parsePresence, parseProfiles, activityCn } from '../lib/serverlink.js';

let pass = 0;
function ok(name, fn) {
  try { fn(); pass += 1; console.log('  ok   ' + name); }
  catch (e) { console.log('  FAIL ' + name + ' :: ' + e.message); process.exitCode = 1; }
}

console.log('normalizeServerUrl');
ok('只填 IP', () => assert.equal(normalizeServerUrl('172.19.163.2').url, 'https://172.19.163.2:6969'));
ok('IP:端口', () => assert.equal(normalizeServerUrl('172.19.163.2:7000').url, 'https://172.19.163.2:7000'));
ok('带协议和尾斜杠', () => assert.equal(normalizeServerUrl('https://1.2.3.4:6969/').url, 'https://1.2.3.4:6969'));
ok('http 协议保留', () => assert.equal(normalizeServerUrl('http://host').url, 'http://host:6969'));
ok('域名 + 路径只留 origin', () => assert.equal(normalizeServerUrl('https://spt.example.com:6969/api/x').url, 'https://spt.example.com:6969'));
ok('本机 127.0.0.1', () => assert.equal(normalizeServerUrl('127.0.0.1:6969').isLocal, true));
ok('localhost 算本机', () => assert.equal(normalizeServerUrl('localhost').isLocal, true));
ok('IPv6 加方括号', () => assert.equal(normalizeServerUrl('[::1]:6969').url, 'https://[::1]:6969'));
ok('空地址报错', () => assert.equal(normalizeServerUrl('   ').ok, false));
ok('非 http 协议报错', () => assert.equal(normalizeServerUrl('ftp://x:1').ok, false));
ok('端口越界报错', () => assert.equal(normalizeServerUrl('https://x:99999').ok, false));
ok('去掉引号空格', () => assert.equal(normalizeServerUrl(' "1.2.3.4:6969" ').url, 'https://1.2.3.4:6969'));

console.log('parsePresence');
ok('空数组', () => assert.deepEqual(parsePresence([]), []));
ok('非数组返回空', () => assert.deepEqual(parsePresence({ nope: 1 }), []));
ok('nickname 字段', () => {
  const [p] = parsePresence([{ nickname: 'Ghost', activity: 'InRaid', raidCode: 'ABC123' }]);
  assert.equal(p.nickname, 'Ghost');
  assert.equal(p.activity, 'InRaid');
  assert.equal(p.raidCode, 'ABC123');
  assert.equal(p.level, null);
  assert.equal(p.headless, false);
});
ok('PascalCase / 别名', () => {
  const [p] = parsePresence([{ Nickname: 'Killa', Level: 42, Headless: true }]);
  assert.equal(p.nickname, 'Killa');
  assert.equal(p.level, 42);
  assert.equal(p.headless, true);
});
ok('playerName / name 兜底', () => {
  assert.equal(parsePresence([{ playerName: 'A' }])[0].nickname, 'A');
  assert.equal(parsePresence([{ name: 'B' }])[0].nickname, 'B');
});
ok('没有说话名字给占位', () => assert.equal(parsePresence([{ nickname: '  ' }])[0].nickname, '（未命名）'));
ok('presence / players 包裹也能解析', () => {
  assert.equal(parsePresence({ presence: [{ nickname: 'X' }] })[0].nickname, 'X');
  assert.equal(parsePresence({ players: [{ nickname: 'Y' }] })[0].nickname, 'Y');
});
ok('坏条目跳过', () => assert.equal(parsePresence([null, 'x', { nickname: 'Z' }]).length, 1));

console.log('activityCn');
ok('InRaid → 对局中', () => assert.equal(activityCn('InRaid'), '对局中'));
ok('Menu → 大厅', () => assert.equal(activityCn('Menu'), '大厅'));
ok('Matching → 匹配中', () => assert.equal(activityCn('Matching'), '匹配中'));
ok('空串保持空', () => assert.equal(activityCn(''), ''));
ok('未知值原样', () => assert.equal(activityCn('Whatever'), 'Whatever'));

console.log('parseProfiles');
ok('服务端数组：用户名/昵称/等级/阵营/版本', () => {
  const p = parseProfiles([{ username: 'Rumia', nickname: 'Rumia', side: 'Usec', currlvl: 16, edition: 'SPT Easy start', profileId: 'abc', sptData: { version: '4.0.13 (40087)' } }]);
  assert.equal(p.length, 1);
  assert.equal(p[0].username, 'Rumia');
  assert.equal(p[0].level, 16);
  assert.equal(p[0].side, 'Usec');
  assert.equal(p[0].sptVersion, '4.0.13 (40087)');
});
ok('v2 的 {Response:[...]} 包裹也能解析', () => assert.equal(parseProfiles({ Response: [{ username: 'A' }] })[0].username, 'A'));
ok('{profiles:[...]} 也能解析', () => assert.equal(parseProfiles({ profiles: [{ username: 'B' }] })[0].username, 'B'));
ok('没有用户名的条目跳过', () => assert.equal(parseProfiles([null, {}, { nickname: 'X' }]).length, 0));
ok('同账号去重', () => assert.equal(parseProfiles([{ username: 'A' }, { username: 'A' }]).length, 1));
ok('按用户名排序', () => assert.deepEqual(parseProfiles([{ username: 'b' }, { username: 'a' }]).map((x) => x.username), ['a', 'b']));
ok('没有昵称时用用户名', () => assert.equal(parseProfiles([{ username: 'C' }])[0].nickname, 'C'));

console.log(`\n${pass} passed`);
