// build-exe.mjs —— 把整份管理器打成一个 Windows 单文件 exe（需要 bun）
//
// 用法：
//   node build/build-exe.mjs              # 到 dist/spt-manager.exe
//   BUN=D:\path\bun.exe node build/build-exe.mjs
//
// 做两件事：
//   1. 把 public/ 下的前端资源 base64 内联成 build/embedded-assets.js
//   2. bun build server.js --compile --outfile dist/spt-manager.exe
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const OUT_DIR = path.join(ROOT, 'dist');
const TOKEN_FILE = path.join(ROOT, 'build', 'embedded-assets.js');
const EXE = path.join(OUT_DIR, 'spt-manager.exe');

const ASSETS = ['index.html', 'app.js', 'styles.css'];

function findBun() {
  if (process.env.BUN) return process.env.BUN;
  for (const name of ['bun.exe', 'bun']) {
    const r = spawnSync(name, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) return name;
  }
  const guess = path.join(process.env.TEMP || '.', 'buncli', 'bun-windows-x64', 'bun.exe');
  if (fs.existsSync(guess)) return guess;
  throw new Error('找不到 bun.exe，请装 bun 或设置 BUN 环境变量');
}

function generateAssets() {
  const map = {};
  for (const name of ASSETS) {
    const full = path.join(PUBLIC, name);
    if (!fs.existsSync(full)) throw new Error(`缺少前端文件：${full}`);
    map[name] = fs.readFileSync(full).toString('base64');
  }
  const body = [
    '// 本文件由 build/build-exe.mjs 生成，请勿手改。',
    `export default ${JSON.stringify(map)};`,
    '',
  ].join('\n');
  fs.writeFileSync(TOKEN_FILE, body, 'utf8');
  const kb = Math.round(Buffer.byteLength(body, 'utf8') / 1024);
  console.log(`[1/2] 内联 ${ASSETS.length} 个前端文件 → ${path.relative(ROOT, TOKEN_FILE)}（${kb} KB）`);
}

function compile() {
  const bun = findBun();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const args = [
    'build', 'server.js', '--compile', '--outfile', EXE,
    '--windows-title=SPT 模组管理器',
    '--windows-description=SPT 4.x 本地模组管理器：模组安装、服务端与客户端启动、Fika 联机',
    '--windows-version=1.0.0.0',
    '--windows-copyright=MIT License',
  ];
  if (process.env.HIDE_CONSOLE === '1') args.push('--windows-hide-console');
  console.log(`[2/2] ${path.basename(bun)} ${args.join(' ')}`);
  const r = spawnSync(bun, args, { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`bun 编译失败（退出码 ${r.status}）`);
  const st = fs.statSync(EXE);
  console.log(`\n完成：${EXE}（${(st.size / 1024 / 1024).toFixed(1)} MB）`);
  console.log('双击运行即可，数据会写在 exe 同目录的 data\\ 下。');
}

generateAssets();
compile();
