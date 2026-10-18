// JSONC（带注释的 JSON）读写：解析时容忍注释与尾逗号，写入时只替换目标值、保留原有注释与排版。
// 只用于 fika.jsonc 这类小配置文件。

/** 去掉 // 与 /* *\/ 注释（保留字符串内容） */
export function stripComments(raw) {
  let out = '';
  let i = 0;
  let inStr = false;
  let quote = '';
  while (i < raw.length) {
    const c = raw[i];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < raw.length) { out += raw[i + 1]; i += 2; continue; }
      if (c === quote) inStr = false;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; quote = c; out += c; i++; continue; }
    if (c === '/' && raw[i + 1] === '/') {
      while (i < raw.length && raw[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && raw[i + 1] === '*') {
      i += 2;
      while (i < raw.length && !(raw[i] === '*' && raw[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** 去掉尾逗号，让 JSON.parse 能用 */
export function stripTrailingCommas(text) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\' && i + 1 < text.length) { out += text[i + 1]; i++; continue; }
      if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return out;
}

/** 解析 JSONC，失败返回 fallback */
export function parseJsonc(raw, fallback = null) {
  try {
    return JSON.parse(stripTrailingCommas(stripComments(raw)));
  } catch {
    return fallback;
  }
}

/** 找到 from 位置之后、同一层的第一个 "key" 的冒号位置；找不到返回 -1 */
function findKey(raw, start, end, key) {
  let depth = 0;
  let inStr = false;
  let i = start;
  const target = JSON.stringify(key);
  while (i < end) {
    const c = raw[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === '"') inStr = false;
      i++;
      continue;
    }
    if (c === '"') {
      if (depth === 0 && raw.startsWith(target, i)) {
        // 确认后面（跳过空白）是冒号
        let j = i + target.length;
        while (j < end && /\s/.test(raw[j])) j++;
        if (raw[j] === ':') return j;
      }
      inStr = true;
      i++;
      continue;
    }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') {
      if (depth === 0) return -1; // 出了当前对象
      depth--;
    }
    i++;
  }
  return -1;
}

/** 从 valueStart 起找该值的结束位置（不含），返回 [start,end) */
function valueSpan(raw, valueStart, end) {
  let i = valueStart;
  while (i < end && /\s/.test(raw[i])) i++;
  const start = i;
  const c = raw[i];
  if (c === '"' || c === "'") {
    const q = c;
    i++;
    while (i < end) {
      if (raw[i] === '\\') { i += 2; continue; }
      if (raw[i] === q) { i++; break; }
      i++;
    }
    return [start, i];
  }
  if (c === '{' || c === '[') {
    const open = c;
    const close = c === '{' ? '}' : ']';
    let depth = 0;
    let inStr = false;
    while (i < end) {
      const ch = raw[i];
      if (inStr) {
        if (ch === '\\') { i += 2; continue; }
        if (ch === '"') inStr = false;
        i++;
        continue;
      }
      if (ch === '"') { inStr = true; i++; continue; }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) { i++; break; }
      }
      i++;
    }
    return [start, i];
  }
  // 标量：一直到 , } ] 或注释
  while (i < end) {
    const ch = raw[i];
    if (ch === ',' || ch === '}' || ch === ']') break;
    if (ch === '/' && (raw[i + 1] === '/' || raw[i + 1] === '*')) break;
    i++;
  }
  // 回退尾部空白
  let e = i;
  while (e > start && /\s/.test(raw[e - 1])) e--;
  return [start, e];
}

/**
 * 在 JSONC 文本里按路径替换一个值，保留注释和排版。
 * path 例：['client','friendlyFire']、['headless','profiles','amount']
 * 返回替换后的文本；路径不存在时抛错。
 */
export function setInJsonc(raw, path, value, opts = {}) {
  const indent = opts.indent ?? 2;
  let from = 0;
  while (from < raw.length && /\s/.test(raw[from])) from++;
  if (raw[from] === '{') from++;
  let to = raw.length;
  for (let k = 0; k < path.length; k++) {
    const colon = findKey(raw, from, to, path[k]);
    if (colon < 0) throw new Error(`找不到配置项 ${path.slice(0, k + 1).join('.')}`);
    const [vs, ve] = valueSpan(raw, colon + 1, to);
    if (k === path.length - 1) {
      const lineStart = raw.lastIndexOf('\n', vs) + 1;
      const indentStr = (raw.slice(lineStart, vs).match(/^[ \t]*/) || [''])[0];
      const json = formatValue(value, indentStr, indent);
      return raw.slice(0, vs) + json + raw.slice(ve);
    }
    // 还有下一层：当前值必须是对象，进入它内部继续找
    if (raw[vs] !== '{') throw new Error(`配置项 ${path.slice(0, k + 1).join('.')} 不是对象`);
    from = vs + 1;
    to = ve - 1;
  }
  return raw;
}

/** 读取路径上的值（不存在返回 undefined） */
export function getInJsonc(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

/** 按原缩进格式化一个值：短的数组/对象压成一行，长的换行并对齐 */
function formatValue(value, indentStr, step) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const compact = JSON.stringify(value);
  if (indentStr.length + compact.length <= 88) return compact;
  const pretty = JSON.stringify(value, null, step);
  return pretty.replace(/\n/g, '\n' + indentStr);
}
