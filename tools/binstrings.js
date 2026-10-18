// 扫描二进制文件里的 UTF-16/ASCII 字符串，按关键词过滤
// 用法: node tools/binstrings.js <file> <regex> [maxLen]
import fs from 'node:fs';

const [file, pattern, maxLenArg] = process.argv.slice(2);
if (!file || !pattern) {
  console.error('用法: node tools/binstrings.js <file> <regex> [maxLen]');
  process.exit(1);
}
const maxLen = parseInt(maxLenArg, 10) || 200;
const re = new RegExp(pattern, 'i');
const buf = fs.readFileSync(file);

function collect(enc, wide) {
  const step = wide ? 2 : 1;
  const out = [];
  let start = -1;
  for (let i = 0; i < buf.length; i += step) {
    const b = buf[i];
    const ok = wide ? (b >= 0x20 && b <= 0x7e && i + 1 < buf.length && buf[i + 1] === 0) : (b >= 0x20 && b <= 0x7e);
    if (ok) { if (start < 0) start = i; }
    else {
      if (start >= 0) {
        const len = wide ? (i - start) / 2 : i - start;
        if (len >= 4 && len <= maxLen) {
          const s = buf.slice(start, wide ? i : i).toString(wide ? 'utf16le' : 'latin1');
          if (re.test(s)) out.push(s);
        }
        start = -1;
      }
    }
  }
  if (start >= 0) {
    const s = buf.slice(start).toString(wide ? 'utf16le' : 'latin1');
    if (s.length <= maxLen && re.test(s)) out.push(s);
  }
  return out;
}

const seen = new Set();
for (const [enc, wide] of [['utf16', true], ['ascii', false]]) {
  for (const s of collect(enc, wide)) {
    if (seen.has(s)) continue;
    seen.add(s);
    console.log(`[${enc}] ${s}`);
  }
}
