// dllmeta.js — 从编译好的 .NET DLL 里提取 SPT / BepInEx 模组元数据
// 原理：C# 里 ModMetadata 的 GUID / 名称 / 版本 / SPT 约束都是字符串常量，
// 在程序集的 #US 字符串堆里以 UTF-16LE 存储。扫描字符串即可得到可靠信息，
// 无需完整解析 .NET metadata 表。
import fs from 'node:fs';

const BLACKLIST_PREFIX = [
  'system.', 'microsoft.', 'newtonsoft.', 'semanticversioning', 'mono.', 'jetbrains.',
  'sptarkov.', 'harmony', 'bepinex.', 'ilspy', 'mscorlib', 'netstandard',
];

const FILE_SUFFIX = /\.(dll|exe|json|jsonc|xml|txt|log|cs|bundle|png|jpg|md|pdb|config|cfg|ini|asset|csv|yml|yaml|licence|license|assets|dat)$/i;

// GUID 形状：首段≥2字符，其余段≥2字符且都含字母；排除程序集版本号等二进制噪音
const GUID_RE = /^[a-z][a-z0-9_]{1,40}(\.[a-z0-9_\-]{1,40}){1,4}$/;
const SEMVER_RE = /^(~|\^|>=|<=|>|<|=)?\s?(\d+\.\d+\.\d+)(-[a-zA-Z0-9.]+)?$/;
const SEMVER_HASH_RE = /^(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\+[0-9a-f]{6,}$/i;
const CODE_WORDS = new Set(['get', 'set', 'add', 'remove', 'value', 'item', 'items', 'this', 'list', 'dictionary', 'collection', 'numerator', 'builder', 'factory', 'extension', 'options', 'reader', 'writer']);

// 名称字段常见噪音（日志/报错文本被误认为模组名）
const NAME_NOISE = /[[\]{}<>|\\]|detected|disconnected|failed|error|not found|loading|because|success|warning|invalid|missing/i;

function decodeStrings(buf) {
  const text16 = buf.toString('utf16le');
  const text8 = buf.toString('latin1');

  const re = /[\x20-\x7E]{4,}|[\u4e00-\u9fa5]{2,}/g;
  const out16 = [];
  let m;
  while ((m = re.exec(text16)) !== null) out16.push(m[0]);

  re.lastIndex = 0;
  const out8 = [];
  while ((m = re.exec(text8)) !== null) out8.push(m[0]);

  return { out16, out8 };
}

const set = new Set();
function unique(arr) {
  const s = new Set(arr);
  return [...s];
}

function isGuidLike(s) {
  if (!s || s.length > 60 || s.length < 5) return false;
  if (!GUID_RE.test(s)) return false;
  if (FILE_SUFFIX.test(s)) return false;
  if (/\d{2,}\.\d/.test(s)) return false;           // 4.0.30319 之类
  const segs = s.split('.');
  for (const seg of segs) {
    if (seg.length < 2) return false;
    if (!/[a-z]/.test(seg)) return false;           // 每段都要有字母
    if (seg.endsWith('_') || seg.startsWith('_')) return false;
    if (CODE_WORDS.has(seg)) return false;
    if (/^(get|set)_/.test(seg)) return false;
  }
  const low = s.toLowerCase();
  if (BLACKLIST_PREFIX.some((p) => low.startsWith(p))) return false;
  return true;
}

function nameCandidate(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length < 2 || t.length > 48) return false;
  if (FILE_SUFFIX.test(t)) return false;
  if (SEMVER_RE.test(t)) return false;
  if (GUID_RE.test(t)) return false;
  if (/[\\/]/.test(t)) return false;
  if (/^(get_|set_|<|>)/.test(t)) return false;
  if (NAME_NOISE.test(t)) return false;
  if (!/[A-Za-z\u4e00-\u9fa5]/.test(t)) return false;
  return true;
}

/**
 * @param {string} file
 * @param {{maxBytes?:number}} [opts]
 */
export function readDllMeta(file, opts = {}) {
  const maxBytes = opts.maxBytes || 64 * 1024 * 1024;
  let buf;
  try {
    const st = fs.statSync(file);
    if (st.size > maxBytes) return { file, error: 'too-large', guids: [] };
    buf = fs.readFileSync(file);
  } catch (e) {
    return { file, error: String(e.message || e), guids: [] };
  }

  const { out16, out8 } = decodeStrings(buf);
  const all = unique([...out16, ...out8]);

  const meta = {
    file,
    assembly: file.replace(/\\/g, '/').split('/').pop().replace(/\.dll$/i, ''),
    isServerMod: all.some((s) => s.includes('AbstractModMetadata')) || out16.includes('IOnLoad'),
    isPlugin: out8.includes('BepInPlugin') || out8.includes('BaseUnityPlugin') || out8.includes('BepInEx.Bootstrap'),
    isPatcher: out8.includes('BasePatcher'),
    isBundleMod: false,
    guids: [],
    sptRange: null,
    version: null,
    name: null,
    author: null,
    license: null,
  };

  // GUID 候选：UTF-16 堆（模组元数据）+ UTF-8 堆（BepInEx 特性参数）
  const guid16 = [];
  for (let i = 0; i < out16.length; i++) {
    if (isGuidLike(out16[i])) guid16.push({ s: out16[i], i });
  }
  const guid8 = unique(out8.filter(isGuidLike));
  meta.guids16 = unique(guid16.map((g) => g.s)).slice(0, 12);
  meta.guids8 = guid8.slice(0, 12);
  meta.guids = unique([...meta.guids16, ...meta.guids8]).slice(0, 16);

  // SPT 版本约束 / 模组版本
  const ranges = [];
  const versions = [];
  for (const s of all) {
    const m = SEMVER_RE.exec(s);
    if (m) {
      if (m[1]) ranges.push(s.replace(/\s+/g, ''));
      else versions.push(m[2]);
      continue;
    }
    const h = SEMVER_HASH_RE.exec(s);
    if (h) versions.push(h[1]);
  }
  if (ranges.length) meta.sptRange = ranges[0];
  const info = out16.map((s) => SEMVER_HASH_RE.exec(s)).find(Boolean);
  if (info) meta.version = info[1];
  else if (versions.length) {
    const counts = new Map();
    for (const v of versions) counts.set(v, (counts.get(v) || 0) + 1);
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || cmpVer(b[0], a[0]));
    meta.version = sorted[0] ? sorted[0][0] : null;
  }

  // 名称：GUID 之后的第一个“像标题”的字符串
  if (guid16.length) {
    const start = guid16[0].i;
    for (let j = start + 1; j < Math.min(start + 16, out16.length); j++) {
      const cand = out16[j];
      if (nameCandidate(cand)) {
        meta.name = cand.trim();
        for (let k = j + 1; k < Math.min(j + 5, out16.length); k++) {
          const a = out16[k];
          if (nameCandidate(a) && /^[A-Za-z0-9_\- .]{2,40}$/.test(a)) {
            meta.author = a.trim();
            break;
          }
        }
        break;
      }
    }
  }

  // 许可证
  for (const s of out16) {
    if (/^(MIT|GPL-?[23]\.?0?|Apache-?2\.?0?|BSD-?[23]|LGPL|CC-BY|Unlicense|MPL-?2\.0)$/i.test(s.trim())) {
      meta.license = s.trim();
      break;
    }
  }

  meta.hasBepInDependency = meta.isPlugin;
  meta.stringCount = all.length;
  return meta;
}

function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** 比较语义化版本，返回 -1/0/1 */
export function compareVersions(a, b) {
  return cmpVer(a, b);
}

/** 判断版本 v 是否满足 SPT 约束（支持 ~ ^ >= <= > < =、多段空格与 || 组合） */
export function satisfies(v, range) {
  if (!range) return true;
  const text = String(range).trim();
  if (!text || /^[*x]$/i.test(text)) return true;
  // 逗号当空格处理；|| 表示任意一组满足即可
  return text.replace(/,/g, ' ').split('||').some((alt) => {
    const clauses = alt.trim().split(/\s+/).filter(Boolean);
    if (!clauses.length) return true;
    return clauses.every((clause) => matchClause(v, clause));
  });
}

const CLAUSE_RE = /^(~>|~|\^|>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2})(?:\.(?:[*x]|\d+))*$/i;

function matchClause(v, clause) {
  const m = CLAUSE_RE.exec(clause.trim());
  if (!m) return true; // 无法解析的约束一律放行
  const op = m[1] || '';
  const target = m[2];
  const tParts = target.split('.').map(Number);
  const normalized = tParts.concat([0, 0, 0]).slice(0, 3).join('.');
  const c = compareVersions(v, normalized);
  const [maj, min] = tParts;

  switch (op) {
    case '~':
    case '~>': {
      if (c < 0) return false;
      // ~4 => >=4.0.0 <5.0.0 ; ~4.0 => >=4.0.0 <4.1.0 ; ~4.0.2 => >=4.0.2 <4.1.0
      const upper = tParts.length <= 1 ? `${maj + 1}.0.0` : `${maj}.${min + 1}.0`;
      return compareVersions(v, upper) < 0;
    }
    case '^': {
      if (c < 0) return false;
      let upper;
      if (maj > 0 || tParts.length === 1) upper = `${maj + 1}.0.0`;
      else if (tParts.length === 2 || min > 0) upper = `0.${min + 1}.0`;
      else upper = `0.0.${(tParts[2] || 0) + 1}`;
      return compareVersions(v, upper) < 0;
    }
    case '>': return c > 0;
    case '>=': return c >= 0;
    case '<': return c < 0;
    case '<=': return c <= 0;
    case '=': return c === 0;
    default: return c >= 0; // 裸版本视为 >=
  }
}
