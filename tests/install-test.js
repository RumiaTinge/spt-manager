import fs from 'node:fs';
import path from 'node:path';
import { listArchive, analyzePackage, extractToTemp, installFromTemp } from '../lib/archive.js';

const root = process.argv[2] || 'E:\\game\\EFT\\_testroot';
const zip = process.argv[3] || 'E:\\game\\EFT\\_downloads\\WTT-CommonLib-v2.0.15.zip';

fs.mkdirSync(path.join(root, 'SPT', 'user', 'mods'), { recursive: true });
fs.mkdirSync(path.join(root, 'BepInEx', 'plugins'), { recursive: true });
fs.mkdirSync(path.join(root, 'BepInEx', 'patchers'), { recursive: true });

const entries = listArchive(zip);
const analysis = analyzePackage(entries);
console.log('analysis:', analysis.kind, analysis.groups.map((g) => `${g.type}:${g.name}`).join(', '));

const ex = extractToTemp(zip, 'test');
try {
  const res = await installFromTemp(root, ex.dir, analysis, { source: zip, overwrite: true });
  console.log('installed:', JSON.stringify(res, null, 2));
  const walk = (d, depth = 0) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      console.log('  '.repeat(depth) + e.name + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory() && depth < 3) walk(path.join(d, e.name), depth + 1);
    }
  };
  walk(root);
} finally {
  ex.cleanup();
}
