import { listArchive, analyzePackage, findExtractor } from '../lib/archive.js';

console.log('extractor:', findExtractor());
const files = process.argv.slice(2);
if (!files.length) files.push('E:\\game\\EFT\\_downloads\\WTT-CommonLib-v2.0.15.zip', 'E:\\game\\EFT\\_downloads\\MC-MXLR_1.2.0.zip');

for (const f of files) {
  console.log('\n=== ' + f + ' ===');
  const t0 = Date.now();
  const entries = listArchive(f);
  console.log(`entries: ${entries.length}  (${Date.now() - t0}ms)`);
  console.log('top-level samples:');
  const tops = new Map();
  for (const e of entries) {
    const top = e.path.split('/').slice(0, 2).join('/');
    tops.set(top, (tops.get(top) || 0) + 1);
  }
  [...tops.entries()].slice(0, 15).forEach(([k, v]) => console.log(`   ${k}  ×${v}`));
  const a = analyzePackage(entries);
  console.log('kind:', a.kind, '| modCount:', a.modCount);
  a.groups.forEach((g) => console.log(`   [${g.type}] ${g.name}  <${g.srcRel}>  files=${g.fileCount} size=${(g.size / 1048576).toFixed(1)}MB`));
  if (a.warnings.length) console.log('warnings:', a.warnings);
}
