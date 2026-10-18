// app.js — SPT 管理器前端（原生 ES 模块，无构建步骤）
const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, props = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(9)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
};
const frag = (...children) => { const f = document.createDocumentFragment(); for (const c of children.flat(9)) if (c != null && c !== false) f.append(c instanceof Node ? c : document.createTextNode(String(c))); return f; };

// ---------------------------------------------------------------- 基础工具
async function api(method, url, body, opts = {}) {
  const init = { method, headers: {} };
  if (body instanceof Blob) { init.body = body; init.headers['content-type'] = 'application/octet-stream'; }
  else if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(url, init);
  let data = null;
  const txt = await res.text();
  try { data = txt ? JSON.parse(txt) : null; } catch { data = { error: txt }; }
  if (!res.ok || (data && data.ok === false)) {
    const msg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    if (!opts.silent) toast(msg, 'err');
    throw new Error(msg);
  }
  return data;
}
const GET = (u, o) => api('GET', u, undefined, o);
const POST = (u, b, o) => api('POST', u, b === undefined ? {} : b, o);
const DEL = (u, b, o) => api('DELETE', u, b, o);

function toast(msg, kind = 'ok', ms = 3600) {
  const t = h('div', { class: `toast ${kind}` }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateY(6px)'; t.style.transition = 'all .2s'; setTimeout(() => t.remove(), 220); }, ms);
}

function fmtSize(n) {
  if (!n && n !== 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}
const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '—');
const esc = (s) => String(s == null ? '' : s);

/** 客户端版本约束判断（与 dllmeta.satisfies 同语义：~ ^ >= <= > < =、多段空格、|| ） */
function clientSatisfies(version, range) {
  if (!range) return true;
  const text = String(range).trim();
  if (!text || /^[*x]$/i.test(text)) return true;
  const cmp = (a, b) => {
    const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
    const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
    for (let i = 0; i < 3; i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  };
  const clause = (cl) => {
    const m = /^(~>|~|\^|>=|<=|>|<|=)?\s*v?(\d+(?:\.\d+){0,2})/.exec(cl);
    if (!m) return true;
    const op = m[1] || '';
    const parts = m[2].split('.').map(Number);
    const [maj, min] = parts;
    const target = parts.concat([0, 0, 0]).slice(0, 3).join('.');
    const c = cmp(version, target);
    if (op === '~' || op === '~>') {
      const upper = parts.length <= 1 ? `${maj + 1}.0.0` : `${maj}.${min + 1}.0`;
      return c >= 0 && cmp(version, upper) < 0;
    }
    if (op === '^') {
      let upper;
      if (maj > 0 || parts.length === 1) upper = `${maj + 1}.0.0`;
      else if (parts.length === 2 || min > 0) upper = `0.${min + 1}.0`;
      else upper = `0.0.${(parts[2] || 0) + 1}`;
      return c >= 0 && cmp(version, upper) < 0;
    }
    if (op === '>') return c > 0;
    if (op === '>=') return c >= 0;
    if (op === '<') return c < 0;
    if (op === '<=') return c <= 0;
    if (op === '=') return c === 0;
    return c >= 0;
  };
  return text.replace(/,/g, ' ').split('||').some((alt) => {
    const cl = alt.trim().split(/\s+/).filter(Boolean);
    return cl.length ? cl.every(clause) : true;
  });
}

/** 轮询任务进度直到结束 */
function watchJob(jobId, onProgress) {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const { job } = await GET(`/api/jobs/${jobId}`, { silent: true });
        if (onProgress) onProgress(job);
        if (job.status === 'done') return resolve(job);
        if (job.status === 'error') return reject(new Error(job.message || '任务失败'));
        setTimeout(tick, 450);
      } catch (e) { reject(e); }
    };
    tick();
  });
}

/** 进度浮层 */
function progressDialog(title) {
  const bar = h('i', { style: 'width:0%' });
  const label = h('div', { class: 'hint', style: 'margin-top:8px' }, '准备中…');
  const mask = h('div', { class: 'modal-mask' },
    h('div', { class: 'modal', style: 'width:min(420px,100%)' },
      h('header', {}, h('div', {}, h('h2', {}, title))),
      h('div', { class: 'content' }, h('div', { class: 'progress' }, bar), label),
    ));
  document.body.append(mask);
  return {
    update(job) {
      bar.style.width = `${job.percent || 0}%`;
      label.textContent = job.message || '';
    },
    close() { mask.remove(); },
  };
}

// ---------------------------------------------------------------- 全局状态
const state = {
  page: 'dashboard',
  app: null,
  mods: null,
  updates: null,
  marketResults: null,
  marketQuery: '',
};

const ICON_REFRESH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M21 12a9 9 0 11-3-6.7"/><path d="M21 3v6h-6"/></svg>`;
const iconBtn = (label, onClick, cls = '') => h('button', { class: `btn sm ${cls}`, onclick: onClick }, label);

// ---------------------------------------------------------------- 路由
function setPage(page) {
  state.page = page;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  render();
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('.nav-item');
  if (nav) setPage(nav.dataset.page);
});

let renderSeq = 0;
async function render() {
  const main = $('#main');
  const seq = ++renderSeq;
  try {
    if (!state.app) state.app = await GET('/api/state');
    const views = {
      dashboard: renderDashboard,
      client: renderClient,
      mods: renderMods,
      import: renderImport,
      pack: renderPack,
      market: renderMarket,
      server: renderServer,
      fika: renderFika,
      ai: renderAi,
      loot: renderLoot,
      profiles: renderProfiles,
      settings: renderSettings,
    };
    const page = state.page;
    const node = await (views[page] || renderDashboard)();
    if (seq !== renderSeq) return; // 已被更晚的切换取代，丢弃这次结果
    main.replaceChildren(node);
    updateFoot();
  } catch (e) {
    if (seq !== renderSeq) return;
    main.replaceChildren(h('div', { class: 'empty' }, h('b', {}, '加载失败'), String(e.message || e)));
  }
}

function updateFoot() {
  const v = state.app && state.app.versions;
  $('#foot-version').textContent = v ? `SPT ${v.spt || '?'} · EFT ${v.tarkov || '?'}` : '未检测到 SPT 目录';
  const running = state.app && state.app.running;
  const foot = $('#foot-server');
  foot.replaceChildren(h('span', { class: `dot ${running ? 'on' : 'off'}` }), running ? '服务器运行中' : '服务器未启动');
}

function pageHead(title, sub, actions = []) {
  return h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, title), sub ? h('p', {}, sub) : null),
    h('div', { class: 'head-actions' }, actions));
}

function noRootCard() {
  return h('div', { class: 'card' },
    h('div', { class: 'empty' },
      h('b', {}, '还没有设置 SPT 安装目录'),
      h('p', {}, '请选择包含 SPT\\SPT.Server.exe 的文件夹，例如 E:\\game\\EFT\\Client.0.16.9.0.40087'),
      h('button', { class: 'btn primary', onclick: () => setPage('settings') }, '前往设置')));
}

// ---------------------------------------------------------------- 概览
async function renderDashboard() {
  const st = state.app = await GET('/api/state');
  const v = st.versions || {};
  const mods = st.mods || {};
  if (!st.autoRoot) return frag(pageHead('概览', 'SPT 模组管理器'), noRootCard());

  let profile = null;
  try { const p = await GET('/api/profiles', { silent: true }); profile = (p.list || [])[0] || null; } catch { /* ignore */ }

  const serverTag = st.running
    ? h('span', { class: 'tag ok' }, '● 运行中')
    : h('span', { class: 'tag' }, '○ 未启动');

  const stats = h('div', { class: 'grid c4' },
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, 'SPT 服务端'),
      h('div', { class: 'value' }, v.spt || '?', h('small', {}, ' / EFT ' + (v.tarkov || '?'))),
      h('div', { class: 'foot' }, serverTag)),
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, '已启用模组'),
      h('div', { class: 'value' }, String((mods.server || 0) + (mods.plugins || 0))),
      h('div', { class: 'foot' }, `服务端 ${mods.server || 0} · 客户端 ${mods.plugins || 0} · 补丁 ${mods.patchers || 0}`)),
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, '已禁用 / 引用前置'),
      h('div', { class: 'value' }, String(mods.disabled || 0), h('small', {}, `/ 引用 ${(mods.missing || []).length}`)),
      h('div', { class: 'foot' }, (mods.missing || []).length ? '有模组引用未安装的前置（可能为可选联动）' : '依赖关系正常')),
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, '当前存档'),
      h('div', { class: 'value', style: 'font-size:19px' }, profile ? profile.nickname : '无'),
      h('div', { class: 'foot' }, profile ? `等级 ${profile.level ?? '?'} · ${profile.side === 'Usec' ? 'USEC' : profile.side === 'Bear' ? 'BEAR' : profile.side || ''}` : '未找到存档')),
  );

  const quick = h('div', { class: 'grid c4' },
    quickCard('导入模组', '从压缩包安装，自动识别单模组或合集', 'import', '导入'),
    quickCard('模组市场', '连接 sp-mod.com 搜索并一键安装', 'market', '搜索'),
    quickCard('服务器', '启动 / 停止服务端并查看日志', 'server', '打开'),
    quickCard('游戏客户端', '启动客户端、切换存档与服务端', 'client', '打开'),
  );

  const missing = (mods.missing || []).slice(0, 6);
  const missingCard = missing.length ? h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, '被引用但未安装的前置'),
        h('div', { class: 'sub' }, '从 DLL 元数据推断，可能是可选联动，也可能确实缺前置；可在模组市场搜索补装')),
      h('span', { class: 'tag warn' }, String((mods.missing || []).length))),
    h('div', { class: 'list' }, ...missing.map((m) => h('div', { class: 'list-item' },
      h('div', { class: 'grow' }, h('div', { class: 't' }, m.name || m.guid || m), h('div', { class: 's' }, m.neededBy ? `被 ${m.neededBy} 引用` : '未被满足的引用')),
      h('button', {
        class: 'btn sm', onclick: () => { state.marketQuery = m.guid || m.name || ''; setPage('market'); setTimeout(() => state._marketSearch && state._marketSearch(state.marketQuery), 60); },
      }, '在市场搜索')))),
  ) : null;

  return frag(
    pageHead('概览', st.autoRoot, [iconBtn('刷新', () => { state.app = null; render(); })]),
    stats,
    h('div', { style: 'height:16px' }),
    quick,
    missingCard ? h('div', { style: 'height:16px' }) : null,
    missingCard,
  );
}

function quickCard(title, desc, page, btn) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, title)),
    h('p', { class: 'hint', style: 'margin:0 0 14px' }, desc),
    h('button', { class: 'btn primary sm', onclick: () => setPage(page) }, btn));
}

// ---------------------------------------------------------------- 模组管理
async function renderMods() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('模组管理'), noRootCard());
  const data = await GET('/api/mods');
  state.mods = data;
  const filter = state.modFilter || 'all';
  const q = (state.modQuery || '').toLowerCase();

  const all = [
    ...data.server.map((m) => ({ ...m, group: 'server' })),
    ...data.plugins.map((m) => ({ ...m, group: 'plugin' })),
    ...data.patchers.map((m) => ({ ...m, group: 'patcher' })),
    ...data.disabled.server.map((m) => ({ ...m, group: 'server' })),
    ...data.disabled.plugins.map((m) => ({ ...m, group: 'plugin' })),
  ];
  const filtered = all.filter((m) => {
    if (filter === 'server' && m.group !== 'server') return false;
    if (filter === 'plugin' && m.group !== 'plugin') return false;
    if (filter === 'patcher' && m.group !== 'patcher') return false;
    if (filter === 'disabled' && m.enabled) return false;
    if (q && !(`${m.displayName} ${m.guid} ${m.id} ${m.author}`.toLowerCase().includes(q))) return false;
    return true;
  });

  const counts = {
    all: all.length,
    server: all.filter((m) => m.group === 'server').length,
    plugin: all.filter((m) => m.group === 'plugin').length,
    patcher: all.filter((m) => m.group === 'patcher').length,
    disabled: all.filter((m) => !m.enabled).length,
  };

  const seg = h('div', { class: 'segmented' }, ...[
    ['all', '全部'], ['server', '服务端'], ['plugin', '客户端'], ['patcher', '补丁'], ['disabled', '已禁用'],
  ].map(([k, label]) => h('button', {
    class: filter === k ? 'active' : '',
    onclick: () => { state.modFilter = k; render(); },
  }, `${label} ${counts[k]}`)));

  const rows = filtered.map((m) => {
    const upd = state.updates && state.updates.find((u) => u.id === m.id);
    return h('tr', {},
      h('td', {},
        h('div', { style: 'font-weight:580' }, m.displayName || m.id),
        h('div', { class: 'mono', style: 'color:var(--text-faint)' }, m.guid || '—'),
        upd && upd.hasUpdate ? h('div', { style: 'margin-top:4px' }, h('span', { class: 'tag accent' }, `可更新 → ${upd.latest.version}`)) : null),
      h('td', {}, typeTag(m.group)),
      h('td', { class: 'mono' }, m.version || '—'),
      h('td', { class: 'mono', style: 'color:var(--text-dim)' }, m.sptRange || '—'),
      h('td', {}, m.author || '—'),
      h('td', {}, m.size ? fmtSize(m.size) : '—', h('div', { class: 'hint' }, `${m.dllCount || 1} 个 DLL`)),
      h('td', {}, (m.unresolvedDeps || []).length
        ? h('span', { class: 'tag info', title: `引用：${m.unresolvedDeps.join(', ')}` }, `引用 ${m.unresolvedDeps.length}`)
        : (m.enabled ? h('span', { class: 'tag ok' }, '正常') : h('span', { class: 'tag' }, '已禁用'))),
      h('td', { class: 'actions' },
        m.group !== 'patcher' ? h('button', {
          class: `btn sm ${m.enabled ? '' : 'primary'}`,
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              await POST('/api/mods/toggle', { type: m.group, id: m.id, enabled: !m.enabled });
              toast(`${m.displayName} 已${m.enabled ? '禁用' : '启用'}`, 'ok');
              render();
            } catch { e.target.disabled = false; }
          },
        }, m.enabled ? '禁用' : '启用') : null,
        m.group !== 'patcher' ? h('button', {
          class: 'btn sm danger', onclick: async () => {
            if (!confirm(`确定删除模组「${m.displayName || m.id}」？\n目录会移入 data\\backups\\mods 备份区。`)) return;
            try { await POST('/api/mods/delete', { type: m.group, id: m.id }); toast('已移入备份区', 'ok'); render(); } catch { /* toast 已提示 */ }
          },
        }, '删除') : null,
        upd && upd.match ? h('a', { class: 'btn sm', href: upd.match.detailUrl, target: '_blank', rel: 'noreferrer' }, '站点') : null),
    );
  });

  const headActions = [
    iconBtn('检查更新', async (e) => {
      const dlg = progressDialog('检查模组更新');
      try {
        const { jobId } = await POST('/api/mods/updates');
        const job = await watchJob(jobId, (j) => dlg.update(j));
        state.updates = job.result || [];
        const n = state.updates.filter((u) => u.hasUpdate).length;
        toast(n ? `发现 ${n} 个可更新模组` : '所有模组都是最新版本', n ? 'warn' : 'ok');
        render();
      } catch (err) { toast(String(err.message || err), 'err'); } finally { dlg.close(); }
    }),
    iconBtn('刷新', () => render()),
  ];

  return frag(
    pageHead('模组管理', `共 ${all.length} 个模组目录 · 数据来自 DLL 元数据与服务端日志`, headActions),
    h('div', { class: 'card' },
      h('div', { class: 'row between', style: 'margin-bottom:14px' },
        seg,
        h('input', {
          class: 'input', placeholder: '搜索名称 / GUID / 作者', style: 'max-width:260px',
          value: state.modQuery || '',
          oninput: (e) => { state.modQuery = e.target.value; const v = e.target.value; clearTimeout(state._mt); state._mt = setTimeout(() => { state.modQuery = v; render(); }, 220); },
        })),
      filtered.length
        ? h('div', { class: 'table-wrap' }, h('table', {},
          h('thead', {}, h('tr', {}, ['模组', '类型', '版本', 'SPT 约束', '作者', '大小', '状态', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...rows)))
        : h('div', { class: 'empty' }, h('b', {}, '没有匹配的模组'), '换个筛选条件试试')),
  );
}

function typeTag(group) {
  if (group === 'server') return h('span', { class: 'tag info' }, '服务端');
  if (group === 'plugin') return h('span', { class: 'tag accent' }, '客户端');
  return h('span', { class: 'tag' }, '补丁');
}

// ---------------------------------------------------------------- 导入
async function renderImport() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('导入模组'), noRootCard());

  const resultBox = h('div', { id: 'import-result' });
  const dz = h('div', { class: 'dropzone' },
    h('b', {}, '把 .zip / .7z / .rar 拖到这里'),
    h('div', {}, '或者点击选择文件 —— 会自动识别是单个模组还是合集'),
    h('input', { type: 'file', accept: '.zip,.7z,.rar,.tar,.gz', style: 'display:none', onchange: (e) => handleFile(e.target.files[0]) }));
  dz.addEventListener('click', (e) => {
    if (e.target && e.target.tagName === 'INPUT') return; // 防止 input.click() 冒泡回来造成递归
    dz.querySelector('input').click();
  });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('drag'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('drag');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  async function handleFile(file) {
    if (!file) return;
    resultBox.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'hint' }, `正在上传 ${file.name}（${fmtSize(file.size)}）…`)));
    try {
      const up = await fetch(`/api/import/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
        .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || '上传失败'); return j; });
      toast(`已上传 ${file.name}`, 'ok');
      const an = await POST('/api/import/analyze', { file: up.file });
      renderAnalysis(an, up.file);
    } catch (e) {
      toast(String(e.message || e), 'err');
      resultBox.replaceChildren();
    }
  }

  function renderAnalysis(an, file) {
    const a = an.analysis;
    const kindLabel = a.kind === 'collection' ? '合集包' : a.kind === 'single' ? '单个模组' : '无法判断';
    const kindTag = h('span', { class: `tag ${a.kind === 'collection' ? 'accent' : a.kind === 'single' ? 'ok' : 'warn'}` }, kindLabel);

    const groups = (a.groups || []).map((g, i) => {
      const cb = h('input', { type: 'checkbox', checked: true, value: String(i) });
      return h('label', { class: 'list-item', style: 'cursor:pointer' },
        cb,
        h('div', { class: 'grow' },
          h('div', { class: 't' }, g.name),
          h('div', { class: 's' }, `${g.type === 'server' ? '服务端模组' : g.type === 'plugin' ? 'BepInEx 插件' : '补丁'} · ${g.fileCount} 个文件 · ${fmtSize(g.size)}`)),
        h('span', { class: 'mono', style: 'color:var(--text-faint)' }, g.type === 'server' ? 'SPT/user/mods' : g.type === 'plugin' ? 'BepInEx/plugins' : 'BepInEx/patchers'));
    });

    const overwrite = h('input', { type: 'checkbox' });
    const installable = a.kind !== 'spt-install' && (a.groups || []).length > 0;
    const installBtn = h('button', { class: 'btn primary', onclick: async () => {
      if (!installable) return toast('这个包不能当模组安装', 'warn');
      const selected = [...resultBox.querySelectorAll('input[type=checkbox][value]')].filter((c) => c.checked).map((c) => Number(c.value));
      if (!selected.length) return toast('请至少选择一个模组', 'warn');
      installBtn.disabled = true;
      installBtn.textContent = '安装中…';
      try {
        const r = await POST('/api/import/install', { file, selected, overwrite: overwrite.checked });
        const n = (r.install.installed || []).length;
        toast(`已安装 ${n} 个模组`, 'ok');
        state.app = null;
        if (r.install.backups && r.install.backups.length) toast(`${r.install.backups.length} 个旧目录已备份`, 'warn');
        setPage('mods');
      } catch (e) {
        toast(String(e.message || e), 'err');
      } finally { installBtn.disabled = false; installBtn.textContent = installable ? '开始安装' : '不可安装'; }
    } }, installable ? '开始安装' : '不可安装');

    resultBox.replaceChildren(h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {}, h('h2', {}, an.name), h('div', { class: 'sub' }, `${fmtSize(an.size)} · ${an.entryCount} 个条目`)),
        kindTag),
      h('div', { class: 'row', style: 'margin-bottom:12px' },
        h('span', { class: 'tag' }, `识别到 ${a.modCount ?? (a.groups || []).length} 个模组`),
        (a.groups || []).slice(0, 6).map((g) => h('span', { class: 'tag' }, g.name))),
      groups.length ? h('div', { class: 'list' }, ...groups) : h('div', { class: 'empty' }, '没有识别出可安装的模组目录'),
      (a.warnings || []).length ? h('div', { style: 'margin-top:12px' }, ...a.warnings.map((w) => h('div', { class: 'tag warn', style: 'margin:4px 4px 0 0' }, w))) : null,
      h('div', { class: 'row', style: 'margin-top:16px' },
        h('label', { class: 'switch' }, overwrite, '覆盖同名模组（旧目录会先备份）'),
        h('div', { class: 'spacer' }),
        installBtn)));
  }

  // 从本机路径直接分析（大包不用上传，比如 3G+ 的合集）
  const pathInp = h('input', { class: 'input mono', placeholder: 'E:\\downloads\\WTT-ContentBackport-1.0.7.7z', style: 'flex:1;min-width:280px' });
  const pathBtn = h('button', { class: 'btn', onclick: async () => {
    const p = pathInp.value.trim().replace(/^"|"$/g, '');
    if (!p) return toast('先填压缩包路径', 'warn');
    pathBtn.disabled = true;
    pathBtn.textContent = '分析中…';
    resultBox.replaceChildren(h('div', { class: 'card' }, h('div', { class: 'hint' }, `正在读取 ${p} …`)));
    try {
      const an = await POST('/api/import/analyze', { file: p });
      renderAnalysis(an, p);
    } catch (e) {
      toast(String(e.message || e), 'err');
      resultBox.replaceChildren();
    } finally { pathBtn.disabled = false; pathBtn.textContent = '分析本机文件'; }
  } }, '分析本机文件');

  return frag(
    pageHead('导入模组', '支持单模组压缩包与模组合集，安装前自动分析目录结构'),
    h('div', { class: 'card' }, dz),
    h('div', { class: 'card', style: 'margin-top:16px' },
      h('div', { class: 'card-head' }, h('h2', {}, '从本机路径分析'),
        h('span', { class: 'sub' }, '大文件不必上传，直接读路径')),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, pathInp, pathBtn),
      h('div', { class: 'hint' }, '填压缩包的完整路径（.zip / .7z / .rar），只读取内容清单，不会修改任何文件')),
    h('div', { style: 'height:16px' }),
    resultBox,
  );
}

// ---------------------------------------------------------------- 打包导出
async function renderPack() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('打包导出'), noRootCard());

  let data;
  try {
    data = await GET('/api/pack/candidates');
  } catch (e) {
    return frag(pageHead('打包导出'), h('div', { class: 'empty' }, h('b', {}, '读取失败'), String(e.message || e)));
  }

  const cands = data.candidates || [];
  const exports = data.exports || [];
  const selected = new Set();
  const rows = [];
  const typeLabel = { server: '服务端', plugin: '客户端', patcher: '补丁' };
  const typeTagCls = { server: 'info', plugin: 'accent', patcher: 'warn' };

  const sumEl = h('span', { class: 'sub' });
  const refreshSum = () => {
    const picked = cands.filter((c) => selected.has(c.key));
    const bytes = picked.reduce((s, c) => s + (c.size || 0), 0);
    sumEl.textContent = picked.length
      ? `已选 ${picked.length} 个 · 原始体积 ${fmtSize(bytes)}`
      : `共 ${cands.length} 个模组可打包`;
  };

  const list = h('div', { class: 'list' });
  for (const type of ['server', 'plugin', 'patcher']) {
    const group = cands.filter((c) => c.type === type);
    if (!group.length) continue;
    list.append(h('div', { class: 'group-title' }, `${typeLabel[type]}（${group.length}）`));
    for (const c of group) {
      const cb = h('input', { type: 'checkbox', onchange: (e) => {
        if (e.target.checked) selected.add(c.key); else selected.delete(c.key);
        refreshSum();
      } });
      cb.dataset.key = c.key;
      rows.push(cb);
      list.append(h('label', { class: 'list-item', style: 'cursor:pointer' },
        cb,
        h('div', { class: 'grow' },
          h('div', { class: 't' }, c.name + (c.version ? ` ${c.version}` : '')),
          h('div', { class: 's' }, `${c.guid || c.id}${c.author ? ' · ' + c.author : ''} · ${fmtSize(c.size)}${c.dllCount ? ' · ' + c.dllCount + ' 个 DLL' : ''}`)),
        h('span', { class: 'tag ' + (typeTagCls[type] || '') }, typeLabel[type]),
        h('span', { class: 'mono', style: 'color:var(--text-faint);width:auto' }, type === 'server' ? 'SPT/user/mods' : type === 'plugin' ? 'BepInEx/plugins' : 'BepInEx/patchers')));
    }
  }

  const nameInp = h('input', {
    class: 'input', style: 'flex:1;min-width:260px',
    placeholder: `mods-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
  });
  const fmtSel = h('select', { class: 'input', style: 'width:140px' },
    h('option', { value: 'zip' }, 'ZIP（通用）'),
    h('option', { value: '7z' }, '7z（更小）'));
  const lvlSel = h('select', { class: 'input', style: 'width:170px' },
    h('option', { value: 'fast' }, '快速（压缩率低）'),
    h('option', { value: 'normal', selected: true }, '标准'),
    h('option', { value: 'small' }, '小体积（较慢）'));

  const startBtn = h('button', { class: 'btn primary', onclick: async () => {
    if (!selected.size) return toast('先勾选要打包的模组', 'warn');
    const items = cands.filter((c) => selected.has(c.key)).map((c) => ({ type: c.type, id: c.id }));
    startBtn.disabled = true;
    const dlg = progressDialog('正在打包');
    try {
      const { jobId } = await POST('/api/pack/create', {
        items, name: nameInp.value.trim(), format: fmtSel.value, level: lvlSel.value,
      });
      const job = await watchJob(jobId, (j) => dlg.update(j));
      dlg.close();
      const r = job.result;
      toast(`打包完成：${r.name}（${fmtSize(r.size)}）`, 'ok');
      await reloadExports();
    } catch (e) {
      dlg.close();
      toast(String(e.message || e), 'err');
    } finally {
      startBtn.disabled = false;
    }
  } }, '开始打包');

  const exportsBox = h('div', { class: 'list' });
  function renderExports() {
    exportsBox.replaceChildren();
    if (!exports.length) {
      exportsBox.append(h('div', { class: 'empty' }, '还没有导出过安装包'));
      return;
    }
    for (const f of exports) {
      exportsBox.append(h('div', { class: 'list-item' },
        h('div', { class: 'grow' },
          h('div', { class: 't mono' }, f.name),
          h('div', { class: 's' }, `${fmtSize(f.size)}${f.mtime ? ' · ' + new Date(f.mtime).toLocaleString() : ''}`)),
        h('a', { class: 'btn sm', href: `/api/pack/download?name=${encodeURIComponent(f.name)}`, download: f.name }, '下载'),
        h('button', { class: 'btn sm', onclick: async () => {
          try { await POST('/api/pack/open', { name: f.name }); toast('已在资源管理器中打开', 'ok'); } catch (e) { toast(String(e.message || e), 'err'); }
        } }, '打开目录'),
        h('button', { class: 'btn sm', onclick: async () => {
          if (!confirm(`删除 ${f.name}？`)) return;
          try {
            await POST('/api/pack/delete', { name: f.name });
            await reloadExports();
            toast('已删除', 'ok');
          } catch (e) { toast(String(e.message || e), 'err'); }
        } }, '删除')));
    }
  }
  async function reloadExports() {
    try {
      const d = await GET('/api/pack/candidates');
      exports.length = 0;
      exports.push(...(d.exports || []));
      renderExports();
    } catch { /* ignore */ }
  }
  renderExports();

  const selAll = h('button', { class: 'btn sm', onclick: () => {
    rows.forEach((cb) => { cb.checked = true; selected.add(cb.dataset.key); });
    refreshSum();
  } }, '全选');
  const selNone = h('button', { class: 'btn sm', onclick: () => {
    rows.forEach((cb) => { cb.checked = false; });
    selected.clear();
    refreshSum();
  } }, '清空');
  refreshSum();

  return frag(
    pageHead('打包导出', '把已装好的模组重新打包成 ZIP / 7z，别人用「导入模组」即可安装',
      [iconBtn('刷新', () => render().then(() => {}), '')]),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '选择要打包的模组'),
        h('div', { class: 'row', style: 'gap:8px' }, sumEl, selAll, selNone)),
      cands.length ? list : h('div', { class: 'empty' }, '还没有已启用的模组')),
    h('div', { class: 'card', style: 'margin-top:16px' },
      h('div', { class: 'card-head' }, h('h2', {}, '输出设置')),
      h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        nameInp, fmtSel, lvlSel),
      h('div', { class: 'hint' }, '包名留空会自动生成；包内会附带 spt-manager-pack.json 清单（记录模组名、版本与安装路径）')),
    h('div', { class: 'row', style: 'margin-top:16px;gap:8px' }, startBtn),
    h('div', { class: 'card', style: 'margin-top:16px' },
      h('div', { class: 'card-head' }, h('h2', {}, '已导出的包'),
        h('span', { class: 'sub mono' }, data.dir || '')),
      exportsBox),
  );
}

// ---------------------------------------------------------------- 模组市场
async function renderMarket() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('模组市场'), noRootCard());

  const input = h('input', {
    class: 'input', placeholder: '搜索模组名称，例如 marlin / fika / SVM', value: state.marketQuery || '',
    onkeydown: (e) => { if (e.key === 'Enter') doSearch(e.target.value); },
  });
  const results = h('div', { id: 'market-results' });

  async function doSearch(q) {
    state.marketQuery = q;
    results.replaceChildren(h('div', { class: 'empty' }, h('b', {}, '搜索中…')));
    try {
      const r = await GET(`/api/forge/search?q=${encodeURIComponent(q)}`);
      state.marketResults = r.list;
      results.replaceChildren(r.list.length
        ? h('div', { class: 'market-grid' }, ...r.list.map((m) => marketCard(m, r.sptVersion)))
        : h('div', { class: 'empty' }, h('b', {}, '没有找到相关模组'), '试试英文关键词或缩短搜索词'));
    } catch (e) {
      results.replaceChildren(h('div', { class: 'empty' }, h('b', {}, '搜索失败'), String(e.message || e)));
    }
  }
  state._marketSearch = doSearch;

  if (!state.marketResults) {
    results.replaceChildren(h('div', { class: 'empty' },
      h('b', {}, '输入关键词开始搜索'),
      h('div', {}, '数据来自 The Forge（sp-mod.com），安装时会自动下载并解包'),
      h('div', { class: 'row', style: 'justify-content:center;margin-top:12px' },
        ...['marlin', 'fika', 'SVM', 'dynamic maps'].map((k) => h('button', { class: 'btn sm', onclick: () => { input.value = k; doSearch(k); } }, k)))));
  } else {
    results.replaceChildren(h('div', { class: 'market-grid' }, ...state.marketResults.map((m) => marketCard(m, state.app.versions?.spt))));
  }

  return frag(
    pageHead('模组市场', '连接 The Forge —— 搜索、查看版本并一键安装'),
    h('div', { class: 'card' },
      h('div', { class: 'row' },
        input,
        h('button', { class: 'btn primary', onclick: () => doSearch(input.value) }, '搜索'))),
    h('div', { style: 'height:16px' }),
    results,
  );
}

function marketCard(m, sptVersion) {
  const thumbUrl = m.thumbnail ? `/api/forge/thumb?u=${encodeURIComponent(m.thumbnail)}` : null;
  return h('div', { class: 'market-card' },
    h('div', { class: 'thumb', style: thumbUrl ? `background-image:url('${thumbUrl}')` : '' }),
    h('div', { class: 'body' },
      h('h3', {}, m.name),
      h('div', { class: 'teaser' }, m.teaser || '（无简介）'),
      h('div', { class: 'meta' },
        h('span', {}, `↓ ${Number(m.downloads || 0).toLocaleString('zh-CN')}`),
        m.fikaCompatibility ? h('span', { class: 'tag ok' }, 'Fika') : null,
        m.owner ? h('span', {}, m.owner.name) : null),
      h('div', { class: 'row', style: 'margin-top:auto;padding-top:8px' },
        h('button', { class: 'btn primary sm', onclick: () => openMarketDetail(m, sptVersion) }, '查看 / 安装'),
        h('a', { class: 'btn sm ghost', href: m.detailUrl, target: '_blank', rel: 'noreferrer' }, '站点'))),
  );
}

async function openMarketDetail(m, sptVersion) {
  const mask = h('div', { class: 'modal-mask' });
  const close = () => mask.remove();
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  const content = h('div', { class: 'content' }, h('div', { class: 'hint' }, '读取版本列表…'));
  const footer = h('footer', {}, h('button', { class: 'btn', onclick: close }, '关闭'));
  mask.append(h('div', { class: 'modal' },
    h('header', {}, h('div', { style: 'flex:1' }, h('h2', {}, m.name), h('p', {}, `GUID: ${m.guid || '—'} · ${m.owner ? m.owner.name : ''}`))),
    content, footer));
  document.body.append(mask);

  try {
    const d = await GET(`/api/forge/mod/${m.id}`);
    const recommended = d.recommended;
    const rows = (d.versions || []).map((v) => {
      const isRec = recommended && v.version === recommended.version;
      const compatible = !v.sptConstraint || !sptVersion || clientSatisfies(sptVersion, v.sptConstraint);
      const btn = h('button', { class: 'btn sm primary', onclick: async (e) => {
        e.target.disabled = true;
        const dlg = progressDialog(`安装 ${m.name} ${v.version}`);
        try {
          const { jobId } = await POST('/api/forge/install', { modId: m.id, version: v.version });
          const job = await watchJob(jobId, (j) => dlg.update(j));
          const res = job.result;
          toast(`已安装 ${res.mod.name} ${res.version.version}（${(res.install.installed || []).length} 个模组目录）`, 'ok');
          close();
          state.app = null;
          setPage('mods');
        } catch (err) {
          toast(String(err.message || err), 'err');
          e.target.disabled = false;
        } finally { dlg.close(); }
      } }, '安装');
      return h('tr', {},
        h('td', { style: 'font-weight:600' }, v.version, isRec ? h('span', { class: 'tag ok', style: 'margin-left:6px' }, '推荐') : null),
        h('td', {}, h('span', { class: `tag ${compatible ? 'ok' : 'warn'}` }, v.sptConstraint || '任意')),
        h('td', {}, fmtSize(v.contentLength)),
        h('td', {}, fmtTime(v.publishedAt ? Date.parse(v.publishedAt) : null)),
        h('td', { class: 'actions' }, btn));
    });

    content.replaceChildren(
      h('p', { style: 'margin-top:0;color:var(--text-dim)' }, m.teaser || '（无简介）'),
      h('div', { class: 'row', style: 'margin-bottom:12px' },
        h('span', { class: 'tag' }, `当前 SPT: ${sptVersion || '未知'}`),
        recommended ? h('span', { class: 'tag ok' }, `推荐版本 ${recommended.version}`) : h('span', { class: 'tag warn' }, '没有匹配当前 SPT 的版本')),
      rows.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['版本', 'SPT 约束', '大小', '发布时间', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...rows))) : h('div', { class: 'empty' }, '没有可用版本'),
    );
  } catch (e) {
    content.replaceChildren(h('div', { class: 'empty' }, h('b', {}, '读取失败'), String(e.message || e)));
  }
}

// ---------------------------------------------------------------- 服务器
async function renderServer() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('服务器'), noRootCard());
  const st = await GET('/api/server/status');
  const logBox = h('div', { class: 'log', id: 'logbox' }, '加载日志…');

  async function loadLog() {
    try {
      const r = await GET('/api/server/log?n=260');
      logBox.replaceChildren(...(r.lines || []).map((l) => {
        const cls = /error|fail|exception/i.test(l) ? 'l-err' : /warn/i.test(l) ? 'l-warn' : /loaded|started|listening|success/i.test(l) ? 'l-ok' : 'l-info';
        return h('div', { class: cls }, l);
      }));
      logBox.scrollTop = logBox.scrollHeight;
    } catch { /* ignore */ }
  }
  loadLog();

  const statusTag = st.running ? h('span', { class: 'tag ok' }, '● 运行中') : h('span', { class: 'tag' }, '○ 未启动');

  const startBtn = h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const r = await POST('/api/server/start');
      toast(r.ok === false ? (r.error || '启动失败') : '服务端已启动', r.ok === false ? 'err' : 'ok');
      state.app = null;
      setTimeout(() => render(), 1200);
    } catch (err) { toast(String(err.message || err), 'err'); e.target.disabled = false; }
  } }, '启动服务端');

  const stopBtn = h('button', { class: 'btn danger', onclick: async () => {
    if (!confirm('确定要停止服务器吗？')) return;
    try { await POST('/api/server/stop'); toast('已发送停止命令', 'ok'); state.app = null; setTimeout(() => render(), 900); } catch (e) { toast(String(e.message || e), 'err'); }
  } }, '停止服务端');

  return frag(
    pageHead('服务器', '启动 / 停止 SPT 服务端，查看实时日志', [
      h('button', { class: 'btn sm', onclick: loadLog }, '刷新日志'),
    ]),
    h('div', { class: 'grid c3' },
      h('div', { class: 'stat' },
        h('div', { class: 'label' }, '运行状态'),
        h('div', { class: 'value', style: 'font-size:19px' }, st.running ? '运行中' : '未启动'),
        h('div', { class: 'foot' }, statusTag, st.ping ? h('span', { class: 'tag ok', style: 'margin-left:6px' }, 'Ping 正常') : null)),
      h('div', { class: 'stat' },
        h('div', { class: 'label' }, '服务地址'),
        h('div', { class: 'value', style: 'font-size:17px' }, '127.0.0.1:6969'),
        h('div', { class: 'foot' }, '启动后在游戏内启动器填写该地址')),
      h('div', { class: 'stat' },
        h('div', { class: 'label' }, '快捷操作'),
        h('div', { class: 'row', style: 'margin-top:8px' }, st.running ? stopBtn : startBtn))),
    h('div', { style: 'height:16px' }),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '服务端日志'), h('span', { class: 'sub' }, 'data/server.log')),
      logBox),
  );
}

// ---------------------------------------------------------------- AI 配置
async function renderAi() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('战局 AI'), noRootCard());
  const data = await GET('/api/ai');
  const bot = data.bot || {};
  const caps = bot.maxBotCap || {};

  const capInputs = Object.entries(caps).map(([k, v]) => h('div', { class: 'field' },
    h('label', {}, mapName(k)),
    h('input', { class: 'input', type: 'number', min: '0', max: '80', value: String(v), dataset: { cap: k } })));

  const goonChance = bot.goonSpawnSystem && bot.goonSpawnSystem.spawnChance;
  const goonInput = h('input', { class: 'input', type: 'number', min: '0', max: '100', value: String(goonChance ?? 35) });
  const scavSelect = h('select', { class: 'input' },
    ...['assault', 'marksman', 'cursedassault', 'pmcbot', 'exusec', 'bossknight'].map((o) =>
      h('option', { value: o, selected: (bot.replaceScavWith || '') === o }, o)));

  const saveBtn = h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const patch = { maxBotCap: {}, goonSpawnChance: Number(goonInput.value), replaceScavWith: scavSelect.value };
      document.querySelectorAll('input[data-cap]').forEach((inp) => { patch.maxBotCap[inp.dataset.cap] = Number(inp.value); });
      await POST('/api/ai', patch);
      toast('AI 配置已保存（原文件已备份）', 'ok');
    } catch (err) { toast(String(err.message || err), 'err'); }
    finally { e.target.disabled = false; }
  } }, '保存 AI 配置');

  // 首领表
  const bossCards = (data.bosses || []).filter((b) => (b.entries || []).length).map((b) => {
    const rows = b.entries.map((en) => {
      const chance = h('input', { class: 'input', type: 'number', min: '0', max: '100', value: String(en.chance ?? 0), style: 'width:88px' });
      const force = h('input', { type: 'checkbox', checked: !!en.forceSpawn });
      return h('tr', {},
        h('td', { style: 'font-weight:550' }, en.bossName),
        h('td', { class: 'mono', style: 'color:var(--text-faint)' }, en.escortType ? `护卫 ${en.escorts || 0}` : '—'),
        h('td', {}, en.spawnMode ? en.spawnMode.join('/') : '—'),
        h('td', {}, chance),
        h('td', {}, h('label', { class: 'switch' }, force, '强制')),
        h('td', { class: 'actions' }, h('button', {
          class: 'btn sm', onclick: async (e2) => {
            e2.target.disabled = true;
            try {
              await POST('/api/ai/boss', { map: b.map, index: en.index, patch: { chance: Number(chance.value), forceSpawn: force.checked } });
              toast(`${en.bossName} 已更新`, 'ok');
            } catch (err) { toast(String(err.message || err), 'err'); }
            finally { e2.target.disabled = false; }
          },
        }, '保存')));
    });
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, `${b.mapName || b.map}`), h('span', { class: 'sub' }, b.map)),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['首领', '护卫', '模式', '刷新概率 %', '强制刷新', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...rows))));
  });

  return frag(
    pageHead('战局 AI', '调节每张地图的 Bot 上限、首领刷新概率与 Goon 小队'),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '基础设置'), h('span', { class: 'sub' }, 'SPT_Data/configs/bot.json')),
      h('div', { class: 'grid c2' },
        h('div', { class: 'field' }, h('label', {}, 'Goon 小队刷新概率 %'), goonInput,
          h('div', { class: 'hint' }, 'Knight / Big Pipe / Birdeye 的出现概率')),
        h('div', { class: 'field' }, h('label', {}, 'Scav 替换为'), scavSelect,
          h('div', { class: 'hint' }, '默认 assault，改成 pmcbot 会明显变强'))),
      h('div', { style: 'margin-top:16px' },
        h('div', { class: 'card-head' }, h('h2', { style: 'font-size:13.5px' }, '每张地图 Bot 上限（maxBotCap）')),
        h('div', { class: 'grid c4' }, ...capInputs)),
      h('div', { class: 'row', style: 'margin-top:16px' }, h('div', { class: 'spacer' }), saveBtn)),
    h('div', { style: 'height:16px' }),
    h('div', { class: 'list' }, ...bossCards),
  );
}

const MAP_CN = {
  bigmap: '海关', factory4_day: '工厂（白天）', factory4_night: '工厂（夜晚）', interchange: '立交桥',
  laboratory: '实验室', lighthouse: '灯塔', rezervbase: '储备站', sandbox: '沙盒（中心区）',
  sandbox_high: '沙盒（高难度）', shoreline: '海岸线', tarkovstreets: '塔科夫街区', woods: '森林',
  labyrinth: '迷宫',
};
const mapName = (id) => MAP_CN[id] || id;

// ---------------------------------------------------------------- 物资
async function renderLoot() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('物资刷新'), noRootCard());
  const [loot, backs] = await Promise.all([GET('/api/loot'), GET('/api/loot/backups')]);
  const maps = loot.maps || [];
  const selected = new Set(state.lootSelected || maps.map((m) => m.map));
  state.lootSelected = [...selected];
  const factor = h('input', { class: 'input', type: 'number', min: '0.1', max: '10', step: '0.1', value: String(state.lootFactor || 3), style: 'width:110px' });

  const applyBtn = h('button', { class: 'btn primary', onclick: async (e) => {
    const f = Number(factor.value);
    if (!(f > 0 && f <= 10)) return toast('倍率需在 0.1 ~ 10 之间', 'warn');
    const sel = [...selected];
    if (!sel.length) return toast('请至少选择一张地图', 'warn');
    if (state.lootFactorApplied) {
      if (!confirm('注意：本工具是"乘"而不是"设"，重复运行会叠加倍率。仍要继续吗？')) return;
    }
    e.target.disabled = true;
    const dlg = progressDialog(`应用物资倍率 ×${f}`);
    try {
      const { jobId } = await POST('/api/loot/apply', { maps: sel, factor: f });
      const job = await watchJob(jobId, (j) => dlg.update(j));
      toast(`已处理 ${sel.length} 张地图，备份在 ${job.result.backupDir}`, 'ok');
      state.lootFactorApplied = true;
      render();
    } catch (err) { toast(String(err.message || err), 'err'); }
    finally { dlg.close(); e.target.disabled = false; }
  } }, '应用倍率');

  const rowFor = (m) => {
    const cb = h('input', { type: 'checkbox', checked: selected.has(m.map), onchange: (e) => {
      if (e.target.checked) selected.add(m.map); else selected.delete(m.map);
      state.lootSelected = [...selected];
    } });
    return h('tr', {},
      h('td', {}, cb),
      h('td', { style: 'font-weight:550' }, m.name, h('div', { class: 'mono', style: 'color:var(--text-faint)' }, m.map)),
      h('td', { class: 'mono' }, m.looseMean != null ? m.looseMean.toFixed(1) : '—'),
      h('td', { class: 'mono', style: 'color:var(--text-dim)' }, m.looseStd != null ? m.looseStd.toFixed(1) : '—'),
      h('td', { class: 'mono' }, String(m.staticSum ?? '—')),
      h('td', { class: 'mono', style: 'color:var(--text-dim)' }, String(m.staticContainers ?? '—')),
      h('td', {}, fmtSize(m.looseSize + (m.staticSize || 0))));
  };

  const backups = (backs.list || []).slice(0, 8);

  return frag(
    pageHead('物资刷新', '调整散落物资刷新点与容器内物品数量（改动前自动备份）'),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {}, h('h2', {}, '全局倍率'), h('div', { class: 'sub' }, '同时作用于 looseLoot.spawnpointCount 与 staticLoot.itemcountDistribution')),
        h('div', { class: 'row' }, h('span', { class: 'hint' }, '倍率'), factor, applyBtn)),
      h('div', { class: 'row', style: 'margin-bottom:12px' },
        h('button', { class: 'btn sm', onclick: () => { state.lootSelected = maps.map((m) => m.map); render(); } }, '全选'),
        h('button', { class: 'btn sm', onclick: () => { state.lootSelected = []; render(); } }, '全不选'),
        h('span', { class: 'hint' }, `已选 ${selected.size} / ${maps.length} 张地图`)),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['', '地图', '散落刷新点均值', '标准差', '容器物品数合计', '容器数', '文件大小'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...maps.map(rowFor))))),
    h('div', { style: 'height:16px' }),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '物资备份'), h('span', { class: 'sub' }, `${(backs.list || []).length} 个备份`)),
      backups.length ? h('div', { class: 'list' }, ...backups.map((b) => h('div', { class: 'list-item' },
        h('div', { class: 'grow' },
          h('div', { class: 't' }, b.name),
          h('div', { class: 's' }, `${b.manifest ? `倍率 ×${b.manifest.factor} · ${(b.manifest.maps || []).length} 张图` : ''} · ${fmtTime(b.mtime)}`)),
        h('button', {
          class: 'btn sm', onclick: async () => {
            if (!confirm(`还原备份 ${b.name}？当前文件会先另存一份。`)) return;
            try { await POST('/api/loot/restore', { name: b.name }); toast('已还原', 'ok'); render(); } catch (e) { toast(String(e.message || e), 'err'); }
          },
        }, '还原'))))
        : h('div', { class: 'empty' }, h('b', {}, '还没有备份'), '第一次应用倍率时会自动创建')),
  );
}

// ---------------------------------------------------------------- 存档
async function renderProfiles() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('存档管理'), noRootCard());
  const data = await GET('/api/profiles');
  const list = data.list || [];
  const backups = data.backups || [];

  const profileCards = list.map((p) => h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, p.nickname), h('div', { class: 'sub' }, p.id)),
      h('span', { class: 'tag accent' }, p.side === 'Usec' ? 'USEC' : p.side === 'Bear' ? 'BEAR' : p.side || '—')),
    h('dl', { class: 'kv' },
      h('dt', {}, '等级'), h('dd', {}, String(p.level ?? '—')),
      h('dt', {}, '经验'), h('dd', {}, Number(p.experience || 0).toLocaleString('zh-CN')),
      h('dt', {}, '版本'), h('dd', {}, p.edition || '—'),
      h('dt', {}, '文件大小'), h('dd', {}, fmtSize(p.size)),
      h('dt', {}, '最后修改'), h('dd', {}, fmtTime(p.mtime)),
      h('dt', {}, '备份数量'), h('dd', {}, String(p.backupCount ?? 0))),
    h('div', { class: 'row', style: 'margin-top:14px' },
      h('button', {
        class: 'btn primary sm', onclick: async (e) => {
          e.target.disabled = true;
          try { const r = await POST('/api/profiles/backup', { id: p.id }); toast(`已备份到 ${r.backup}`, 'ok'); render(); }
          catch (err) { toast(String(err.message || err), 'err'); }
          finally { e.target.disabled = false; }
        },
      }, '立即备份'),
      h('button', {
        class: 'btn danger sm', onclick: async () => {
          if (!confirm(`删除存档 ${p.nickname}？\n角色和进度会一起从服务端删掉，不可恢复（需要先启动服务端）。`)) return;
          try { const r = await POST('/api/profiles/remove', { username: p.nickname }); toast(`已删除存档 ${r.username}`, 'ok'); render(); }
          catch (err) { toast(String(err.message || err), 'err'); }
        },
      }, '删除存档'))));

  // 新建存档：版本列表来自服务端 /launcher/v2/types（和 SPT 启动器的「注册」同一份）
  let types = {};
  let typesErr = '';
  try { types = (await GET('/api/profiles/types')).types || {}; } catch (err) { typesErr = String(err.message || err); }
  const typeKeys = Object.keys(types);
  const nameInp = h('input', { class: 'input', placeholder: '新角色名（字母/数字/下划线，2–24 位）' });
  const editionSel = h('select', { class: 'input' }, ...typeKeys.map((k) =>
    h('option', { value: k, title: types[k] }, k)));
  const editionHint = h('div', { class: 'hint' }, typeKeys.length ? (types[editionSel.value] || '') : (typesErr || '读不到版本列表'));
  editionSel.addEventListener('change', () => { editionHint.textContent = types[editionSel.value] || ''; });
  const createBtn = h('button', {
    class: 'btn primary', onclick: async (e) => {
      const username = nameInp.value.trim();
      if (!username) { toast('先填角色名', 'err'); return; }
      e.target.disabled = true;
      try {
        const r = await POST('/api/profiles/create', { username, edition: editionSel.value });
        toast(`已创建存档 ${r.username}（${r.edition}）`, 'ok');
        nameInp.value = '';
        render();
      } catch (err) { toast(String(err.message || err), 'err'); }
      finally { e.target.disabled = false; }
    },
  }, '创建存档');

  const createCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, '新建存档'),
      h('span', { class: 'sub' }, '走服务端 /launcher/v2/register，和 SPT 启动器的「注册」是同一套')),
    h('div', { class: 'row' },
      h('div', { class: 'field', style: 'flex:1;min-width:220px' }, h('label', {}, '角色名'), nameInp),
      h('div', { class: 'field', style: 'flex:1;min-width:220px' }, h('label', {}, '版本（初始化档）'), editionSel, editionHint)),
    h('div', { class: 'row', style: 'margin-top:12px' }, createBtn),
    h('div', { class: 'hint', style: 'margin-top:8px' },
      typeKeys.length ? '需要服务端在运行；同名存档不能重复创建。版本决定初始卢布、装备和商店声望。' : '服务端没开时读不到版本列表，先到「服务器」页启动。'));

  const backupRows = backups.map((b) => h('tr', {},
    h('td', { class: 'mono' }, b.name),
    h('td', {}, b.nickname || '—'),
    h('td', { class: 'mono' }, String(b.level ?? '—')),
    h('td', {}, fmtSize(b.size)),
    h('td', {}, fmtTime(b.mtime)),
    h('td', { class: 'actions' },
      h('button', {
        class: 'btn sm primary', onclick: async () => {
          if (!confirm(`还原备份 ${b.name}？当前存档会先自动备份。`)) return;
          try { const r = await POST('/api/profiles/restore', { name: b.name }); toast(`已还原 ${(r.restored || []).join(', ')}`, 'ok'); render(); } catch (e) { toast(String(e.message || e), 'err'); }
        },
      }, '还原'),
      h('button', {
        class: 'btn sm danger', onclick: async () => {
          if (!confirm(`删除备份 ${b.name}？`)) return;
          try { await POST('/api/profiles/delete', { name: b.name }); toast('已删除', 'ok'); render(); } catch (e) { toast(String(e.message || e), 'err'); }
        },
      }, '删除'))));

  return frag(
    pageHead('存档管理', '新建存档 / 备份 / 还原（服务端在跑才能新建或删除）'),
    h('div', { class: 'grid c2' }, ...profileCards),
    h('div', { style: 'height:16px' }),
    createCard,
    h('div', { style: 'height:16px' }),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '备份列表'), h('span', { class: 'sub' }, `${backups.length} 个`)),
      backups.length ? h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['备份', '角色', '等级', '大小', '时间', ''].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...backupRows))) : h('div', { class: 'empty' }, h('b', {}, '还没有备份'), '点击「立即备份」创建第一份')),
  );
}

// ---------------------------------------------------------------- 设置
async function renderSettings() {
  const st = state.app || await GET('/api/state');
  const rootInput = h('input', { class: 'input', value: st.settings.sptRoot || st.autoRoot || '', placeholder: 'E:\\game\\EFT\\Client.0.16.9.0.40087' });
  const saveBtn = h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      await POST('/api/settings', { sptRoot: rootInput.value.trim() });
      toast('已保存', 'ok');
      state.app = null;
      state.mods = null;
      state.updates = null;
      await render();
    } catch (err) { toast(String(err.message || err), 'err'); }
    finally { e.target.disabled = false; }
  } }, '保存并检测');

  const detectBtn = h('button', { class: 'btn', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const r = await POST('/api/settings', { sptRoot: '', autoDetect: true });
      if (r.sptRoot) { await render(); toast(`检测到：${r.sptRoot}`, 'ok'); }
      else toast('没有自动找到 SPT 目录，请手动选择', 'warn');
    } catch (err) { toast(String(err.message || err), 'err'); }
    finally { e.target.disabled = false; }
  } }, '自动检测');

  const info = st.versions ? h('dl', { class: 'kv' },
    h('dt', {}, 'SPT 版本'), h('dd', {}, st.versions.spt || '未知'),
    h('dt', {}, 'Tarkov'), h('dd', {}, st.versions.tarkov || '未知'),
    h('dt', {}, '服务端'), h('dd', {}, st.autoRoot ? `${st.autoRoot}\\SPT\\SPT.Server.exe` : '未检测'),
    h('dt', {}, '数据目录'), h('dd', {}, st.paths.data)) : null;

  return frag(
    pageHead('设置', 'SPT 安装目录与运行信息'),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'SPT 安装目录'), h('span', { class: 'sub' }, '必须包含 SPT\\SPT.Server.exe')),
      h('div', { class: 'row' }, rootInput, detectBtn, saveBtn),
      h('div', { class: 'hint', style: 'margin-top:10px' },
        '提示：也可以设置环境变量 SPT_PATH，或把本程序放在游戏目录内启动，会自动识别。')),
    h('div', { style: 'height:16px' }),
    info ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, '运行信息')), info) : null,
    h('div', { style: 'height:16px' }),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '关于'), h('span', { class: 'sub' }, 'v1.0.0')),
      h('p', { class: 'hint', style: 'margin-top:0' },
        '零依赖本地工具：Node 内置 HTTP 服务 + 原生前端。模组元数据通过扫描 DLL 与服务端日志获得；模组市场数据来自 The Forge（sp-mod.com）。',
      ),
      h('div', { class: 'row' },
        h('a', { class: 'btn sm', href: 'https://sp-mod.com', target: '_blank', rel: 'noreferrer' }, '打开 The Forge'),
        h('a', { class: 'btn sm', href: 'https://github.com/WelcomeToThursday/Tarkov-1.0-Backport', target: '_blank', rel: 'noreferrer' }, 'WTT 内容回溯'))),
  );
}

// ---------------------------------------------------------------- Fika 联机
const FIKA_SERVER_DESC = {
  'client.useBtr': '是否刷新 BTR 装甲车',
  'client.friendlyFire': '是否开启队友伤害',
  'client.dynamicVExfils': '载具撤离点是否随人数动态变化',
  'client.allowFreeCam': '存活时是否允许自由视角',
  'client.allowSpectateFreeCam': '观战时是否允许自由移动视角',
  'client.blacklistedItems': '禁止玩家互相寄送的物品模板 ID',
  'client.forceSaveOnDeath': '死亡时强制保存背包（防 ALT+F4 回档）',
  'client.mods.required': '服务端强制要求的模组列表（GUID 或名称）',
  'client.mods.optional': '允许连接的可选模组列表',
  'client.useInertia': '是否启用惯性（关闭等于无甲状态）',
  'client.sharedQuestProgression': '是否共享任务进度（含共享经验）',
  'client.canEditRaidSettings': '客户端是否可修改战局设置',
  'client.enableTransits': '是否启用地图间过境',
  'client.anyoneCanStartRaid': '是否任何人都能点「开始战局」',
  'client.allowNamePlates': '是否允许玩家显示名牌',
  'client.randomLabyrinthSpawns': '迷宫地图是否随机出生点',
  'client.pmcFoundInRaid': 'AI PMC 的装备是否带「战局中获得」标记',
  'client.allowSpectateBots': '观战时是否可观察 Bot',
  'client.instantLoad': '弹匣是否瞬间装满',
  'client.fastLoad': '弹匣是否每 tick 装 5 发',
  'client.reviveConfig.enabled': '是否启用倒地救人系统',
  'client.reviveConfig.headshotKills': '爆头是否必定击杀',
  'client.reviveConfig.grenadesKills': '爆炸是否必定击杀',
  'client.reviveConfig.allowLooting': '是否允许搜刮倒地玩家',
  'client.reviveConfig.maxRevives': '每名玩家最大救人次数（0 = 无限）',
  'client.reviveConfig.bleedoutTime': '倒地后流血致死时间（秒）',
  'client.reviveConfig.reviveTime': '救人所需时间（秒）',
  'server.SPT.http.ip': '服务端监听地址（0.0.0.0 = 所有网卡）',
  'server.SPT.http.port': '服务端端口，默认 6969',
  'server.SPT.http.backendIp': '下发给客户端的连接地址',
  'server.SPT.http.backendPort': '下发给客户端的连接端口',
  'server.SPT.disableSPTChatBots': '是否关闭 SPT 聊天机器人',
  'server.webhook.enabled': '是否启用 Discord Webhook 通知',
  'server.webhook.url': 'Webhook 地址',
  'server.allowItemSending': '是否允许玩家互相寄送物品',
  'server.itemSendingStorageTime': '寄送物品的邮件保留天数',
  'server.sentItemsLoseFIR': '寄送物品是否失去「战局中获得」标记',
  'server.launcherListAllProfiles': '启动器是否列出全部存档',
  'server.sessionTimeout': '战局无响应判定超时（分钟）',
  'server.showDevProfile': '是否显示开发者存档',
  'server.showNonStandardProfile': '是否显示非标准存档',
  'server.adminIds': '可使用 Mr Fika 管理机器人的存档 ID',
  'server.apiKey': 'Fika API 访问密钥',
  'natPunchServer.enable': '是否启用 NAT 打洞',
  'natPunchServer.port': 'NAT 打洞端口，默认 6790',
  'headless.profiles.amount': '要生成 / 使用的无头存档数量',
  'headless.profiles.aliases': '无头存档别名：{存档 UID: 显示名称}',
  'headless.scripts.generate': '是否生成无头客户端启动脚本',
  'headless.scripts.forceIp': '无头客户端连接服务端使用的 URL',
  'headless.setLevelToAverageOfLobby': '无头主持时 Bot 等级取大厅平均值',
  'headless.restartAfterAmountOfRaids': '无头主持多少局后重启（0 = 不重启）',
  'background.enable': '是否启用自定义启动器背景',
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function flattenLeaves(obj, prefix = []) {
  const out = [];
  for (const [k, v] of Object.entries(obj || {})) {
    const p = [...prefix, k];
    if (isPlainObject(v)) out.push(...flattenLeaves(v, p));
    else out.push({ path: p, value: v });
  }
  return out;
}

/** fika.jsonc 的一个叶子字段 → 表单控件 */
function fikaServerField(entry, edits) {
  const { path: pathArr, value } = entry;
  const keyPath = pathArr.join('.');
  const desc = FIKA_SERVER_DESC[keyPath] || '';
  const label = pathArr.slice(1).length ? pathArr.slice(1).join(' · ') : pathArr[0];
  let node;
  let read;
  if (typeof value === 'boolean') {
    const cb = h('input', { type: 'checkbox', checked: value });
    node = h('label', { class: 'switch' }, cb, value ? '开启' : '关闭');
    cb.addEventListener('change', () => { node.lastChild.textContent = cb.checked ? '开启' : '关闭'; });
    read = () => cb.checked;
  } else if (typeof value === 'number') {
    const inp = h('input', { class: 'input', type: 'number', step: 'any', value: String(value) });
    node = inp;
    read = () => Number(inp.value);
  } else {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    const jsonLike = typeof value !== 'string' || keyPath.endsWith('aliases') || keyPath.endsWith('adminIds') || keyPath.endsWith('blacklistedItems');
    const long = text.length > 44 || jsonLike;
    const inp = h(long ? 'textarea' : 'input', { class: long ? 'input mono' : 'input', rows: long ? 3 : undefined, value: text });
    if (!long) inp.value = text;
    node = inp;
    read = () => {
      if (!long) return inp.value;
      if (!jsonLike) return inp.value;            // 长字符串（如 avatarUrl）按原样保存
      const v = inp.value.trim();
      if (!v) return Array.isArray(value) ? [] : inp.value;
      try { return JSON.parse(v); } catch { throw new Error(`${keyPath} 不是合法 JSON`); }
    };
  }
  edits.push({ path: pathArr, original: value, read, keyPath });
  return h('div', { class: 'field' },
    h('label', { title: desc || keyPath }, label),
    node,
    desc ? h('div', { class: 'hint' }, desc) : null);
}

function fikaClientField(item, sectionName, edits) {
  const type = String(item.type || 'String');
  const t = type.toLowerCase();
  const raw = String(item.value ?? '');
  const desc = (item.desc || '').replace(/\n+/g, ' ');
  let node;
  let read;
  if (t === 'boolean') {
    const cb = h('input', { type: 'checkbox', checked: /^true$/i.test(raw) });
    node = h('label', { class: 'switch' }, cb, /^true$/i.test(raw) ? '开启' : '关闭');
    cb.addEventListener('change', () => { node.lastChild.textContent = cb.checked ? '开启' : '关闭'; });
    read = () => (cb.checked ? 'true' : 'false');
  } else if (t === 'int32' && Array.isArray(item.options) && item.options.length) {
    const sel = h('select', { class: 'input' }, ...item.options.map((o) =>
      h('option', { value: o, selected: String(item.options.indexOf(o)) === raw }, o)));
    node = sel;
    read = () => sel.value;
  } else if (t === 'int32' || t === 'single' || t === 'double') {
    const inp = h('input', {
      class: 'input', type: 'number', step: t === 'int32' ? '1' : 'any',
      min: item.min, max: item.max, value: raw,
    });
    node = inp;
    read = () => (t === 'int32' ? String(Math.round(Number(inp.value))) : String(Number(inp.value)));
  } else {
    const inp = h('input', { class: 'input', value: raw });
    node = inp;
    read = () => inp.value;
  }
  edits.push({ section: sectionName, key: item.key, original: raw, read });
  return h('div', { class: 'field' },
    h('label', { title: desc || item.key }, item.key),
    node,
    desc ? h('div', { class: 'hint', style: 'max-width:340px' }, desc.length > 150 ? desc.slice(0, 150) + '…' : desc) : null);
}

async function renderFika() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('Fika 联机'), noRootCard());
  const [f] = await Promise.all([GET('/api/fika')]);
  const st = f.status || {};
  const serverCfg = f.serverConfig || {};
  const clientSections = f.clientSections || [];

  // 状态卡
  const statusCard = h('div', { class: 'grid c4' },
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, 'Fika 服务端'),
      h('div', { class: 'value', style: 'font-size:20px' }, st.installed ? '已安装' : '未安装'),
      h('div', { class: 'foot' }, st.serverConfigExists ? 'fika.jsonc 已生成' : '先运行一次服务端生成配置')),
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, 'Fika 客户端'),
      h('div', { class: 'value', style: 'font-size:20px' }, st.clientInstalled ? '已安装' : '未安装'),
      h('div', { class: 'foot' }, st.clientCfgExists ? `${clientSections.reduce((n, s) => n + s.items.length, 0)} 项可调配置` : '启动过游戏后生成配置')),
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, '无头主机'),
      h('div', { class: 'value', style: 'font-size:20px' }, String((st.headless && st.headless.installs || []).length)),
      h('div', { class: 'foot' }, (serverCfg.headless && serverCfg.headless.profiles && serverCfg.headless.profiles.amount) ? `生成 ${serverCfg.headless.profiles.amount} 个无头存档` : '未配置无头存档数量')),
  );

  // 服务端配置（fika.jsonc）
  const serverEdits = [];
  const serverGroups = Object.entries(serverCfg).map(([group, val]) => {
    const leaves = isPlainObject(val) ? flattenLeaves(val, [group]) : [{ path: [group], value: val }];
    return h('div', { class: 'card', style: 'margin-top:12px' },
      h('div', { class: 'card-head' },
        h('h2', { style: 'font-size:14px' }, group),
        h('span', { class: 'sub' }, `${leaves.length} 项`)),
      h('div', { class: 'fika-fields' }, ...leaves.map((e) => fikaServerField(e, serverEdits))));
  });

  const saveServer = h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const patches = serverEdits.filter((x) => !deepEqual(x.read(), x.original)).map((x) => ({ path: x.path, value: x.read() }));
      if (!patches.length) { toast('没有改动', 'warn'); return; }
      const r = await POST('/api/fika/server', { patches });
      toast(`已保存 ${patches.length} 项（原文件已备份），需重启服务端生效`, 'ok');
      if (r.backup) console.info('backup:', r.backup);
      await render();
    } catch (err) { toast(String(err.message || err), 'err'); }
    finally { e.target.disabled = false; }
  } }, '保存服务端配置');

  const serverCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('h2', {}, '服务端配置 fika.jsonc'),
      h('span', { class: 'sub' }, f.serverFile || '')),
    f.serverConfig ? frag(...serverGroups, h('div', { class: 'row', style: 'margin-top:14px' }, h('div', { class: 'spacer' }), saveServer))
      : h('div', { class: 'empty' }, h('b', {}, '没有找到 fika.jsonc'), h('p', {}, f.serverError || '先启动一次服务端，Fika 会自动生成配置')));

  // 客户端配置（com.fika.core.cfg）
  const clientEdits = [];
  const clientCards = clientSections.map((sec) => h('details', { class: 'acc' },
    h('summary', {}, h('b', {}, sec.name || '（未命名段）'), h('span', { class: 'sub' }, `${sec.items.length} 项`)),
    h('div', { class: 'fika-fields', style: 'margin-top:12px' }, ...sec.items.map((it) => fikaClientField(it, sec.name, clientEdits)))));
  const saveClient = h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const updates = clientEdits.filter((x) => x.read() !== x.original).map((x) => ({ section: x.section, key: x.key, value: x.read() }));
      if (!updates.length) { toast('没有改动', 'warn'); return; }
      await POST('/api/fika/client', { updates });
      toast(`已写入 ${updates.length} 项（注释与格式保留），重启游戏生效`, 'ok');
    } catch (err) { toast(String(err.message || err), 'err'); }
    finally { e.target.disabled = false; }
  } }, '保存客户端配置');

  const clientCard = h('div', { class: 'card', style: 'margin-top:16px' },
    h('div', { class: 'card-head' },
      h('h2', {}, '客户端配置 com.fika.core.cfg'),
      h('span', { class: 'sub' }, f.clientFile || '')),
    f.clientError ? h('div', { class: 'empty' }, h('b', {}, '没有找到 com.fika.core.cfg'), h('p', {}, f.clientError))
      : frag(...clientCards, h('div', { class: 'row', style: 'margin-top:14px' }, h('div', { class: 'spacer' }), saveClient)));

  // 无头主机
  const hl = serverCfg.headless || {};
  const profiles = hl.profiles || {};
  const scripts = hl.scripts || {};
  const amountInp = h('input', { class: 'input', type: 'number', min: '0', max: '8', value: String(profiles.amount ?? 0) });
  const aliasesInp = h('textarea', { class: 'input mono', rows: 3, placeholder: '{"68eac997dc053e6f...": "Headless-1"}' });
  aliasesInp.value = JSON.stringify(profiles.aliases || {}, null, 2);
  const forceInp = h('input', { class: 'input', value: String(scripts.forceIp || 'https://127.0.0.1:6969') });
  const genCb = h('input', { type: 'checkbox', checked: scripts.generate !== false });
  const lvlCb = h('input', { type: 'checkbox', checked: hl.setLevelToAverageOfLobby !== false });
  const restartInp = h('input', { class: 'input', type: 'number', min: '0', max: '50', value: String(hl.restartAfterAmountOfRaids ?? 0) });

  const saveHeadless = h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      let aliases = {};
      const rawA = aliasesInp.value.trim();
      if (rawA) {
        try { aliases = JSON.parse(rawA); } catch { throw new Error('别名字段不是合法 JSON'); }
      }
      await POST('/api/fika/headless', {
        amount: Number(amountInp.value), aliases,
        generate: genCb.checked, forceIp: forceInp.value.trim(),
        setLevel: lvlCb.checked, restartAfter: Number(restartInp.value),
      });
      toast('无头配置已保存（重启服务端生效）', 'ok');
      await render();
    } catch (err) { toast(String(err.message || err), 'err'); }
    finally { e.target.disabled = false; }
  } }, '保存无头配置');

  const installs = (st.headless && st.headless.installs) || [];
  const stateTagText = { connected: '已连接服务端', starting: '启动中', exited: '上次异常退出', idle: '未运行', null: '' };
  const installRows = installs.map((ins) => h('div', { class: 'list-row' },
    h('div', { style: 'min-width:0' },
      h('div', { style: 'font-weight:550;word-break:break-all' },
        ins.dir,
        stateTagText[String(ins.state)] ? h('span', {
          class: 'tag',
          style: `margin-left:8px;${ins.state === 'connected' ? 'background:#e4f6ea;color:#1a7f45' : ins.state === 'exited' ? 'background:#fde8e8;color:#b42318' : ''}`,
        }, stateTagText[String(ins.state)]) : null),
      h('div', { class: 'hint' },
        [ins.manager ? '✓ Manager' : '✗ Manager', ins.headlessPlugin ? '✓ Headless 插件' : '✗ Headless 插件',
          ins.hasServer ? '✓ 含 SPT' : '✗ 无 SPT', ins.hasGame ? '✓ 含游戏本体' : '✗ 无游戏本体'].join('　'))),
    h('div', { class: 'actions' },
      ins.manager ? h('button', { class: 'btn sm primary', onclick: async (e) => {
        e.target.disabled = true;
        try { const r = await POST('/api/fika/headless/launch', { dir: ins.dir }); toast(`已启动无头客户端 (pid ${r.pid})`, 'ok'); }
        catch (err) { toast(String(err.message || err), 'err'); }
        finally { e.target.disabled = false; }
      } }, '启动') : null,
      h('button', { class: 'btn sm', onclick: async () => {
        try { await POST('/api/fika/open', { kind: 'serverConfig' }); } catch (err) { toast(String(err.message || err), 'err'); }
      } }, '打开配置目录'))));

  const dirList = installs.map((i) => i.dir);
  const addDirBtn = h('button', { class: 'btn', onclick: async () => {
    const dir = prompt('无头客户端安装目录（包含 FikaHeadlessManager.exe）');
    if (!dir) return;
    try {
      await POST('/api/fika/headless/dirs', { dirs: [...dirList, dir.trim()] });
      toast('已添加目录', 'ok');
      await render();
    } catch (err) { toast(String(err.message || err), 'err'); }
  } }, '添加无头目录');

  const headlessCard = h('div', { class: 'card', style: 'margin-top:16px' },
    h('div', { class: 'card-head' }, h('h2', {}, '无头主机（Headless Host）'),
      h('span', { class: 'sub' }, 'fika.jsonc → headless')),
    h('div', { class: 'grid c2' },
      h('div', { class: 'field' }, h('label', {}, '无头存档数量 amount'), amountInp,
        h('div', { class: 'hint' }, '0 = 关闭；生成的无头存档会在「Host Raid」里可选')),
      h('div', { class: 'field' }, h('label', {}, '重启阈值 restartAfterAmountOfRaids'), restartInp,
        h('div', { class: 'hint' }, '主持 N 局后自动重启无头客户端，0 = 不重启')),
      h('div', { class: 'field' }, h('label', {}, '服务端地址 forceIp'), forceInp,
        h('div', { class: 'hint' }, '无头客户端连接后端用的 URL，本机默认 https://127.0.0.1:6969')),
      h('div', { class: 'field' }, h('label', {}, '生成启动脚本 scripts.generate'),
        h('label', { class: 'switch' }, genCb, '生成'),
        h('div', { class: 'hint' }, '让 Fika 生成无头用的 .bat / 配置')),
      h('div', { class: 'field' }, h('label', {}, 'Bot 等级取大厅平均 setLevelToAverageOfLobby'),
        h('label', { class: 'switch' }, lvlCb, '启用')),
      h('div', { class: 'field' }, h('label', {}, '存档别名 aliases'), aliasesInp,
        h('div', { class: 'hint' }, 'JSON：{"无头存档UID": "显示名称"}')),
    ),
    h('div', { class: 'row', style: 'margin-top:14px' }, addDirBtn, h('div', { class: 'spacer' }), saveHeadless),
    installs.length
      ? h('div', { class: 'list', style: 'margin-top:12px' }, ...installRows)
      : h('div', { class: 'empty', style: 'margin-top:12px' },
          h('b', {}, '还没有识别到无头客户端安装'),
          h('p', {}, '先用 Fika-Installer 的 Advanced → Install Fika Headless 建一份副本，然后在这里添加它的目录')));

  return frag(
    pageHead('Fika 联机', '服务端 fika.jsonc / 客户端 com.fika.core.cfg / 无头主机', [
      h('button', { class: 'btn', onclick: async () => {
        try { await POST('/api/fika/open', { kind: 'serverConfig' }); } catch (err) { toast(String(err.message || err), 'err'); }
      } }, '打开配置目录'),
      h('a', { class: 'btn', href: 'https://wiki.project-fika.com/advanced-features/headless-client', target: '_blank', rel: 'noreferrer' }, '官方文档'),
    ]),
    statusCard,
    h('div', { style: 'height:16px' }),
    serverCard,
    clientCard,
    headlessCard,
  );
}

// ---------------------------------------------------------------- 游戏客户端
async function renderClient() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('游戏客户端'), noRootCard());
  const l = await GET('/api/launch');
  const hl = await GET('/api/fika/headless').catch(() => ({ installs: [] }));
  const profilesList = l.list || [];
  const tgt = l.target || { url: '', name: '', autoLogin: true, isLocal: true };

  const stats = h('div', { class: 'grid c4' },
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, '客户端'),
      h('div', { class: 'value', style: 'font-size:20px' }, l.clientRunning ? '游戏中' : '未启动'),
      h('div', { class: 'foot' }, l.gameExeExists && l.launcherExists ? '启动器与游戏本体就绪' : '没找到启动器或游戏本体')),
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, '连接目标'),
      h('div', { class: 'value', style: 'font-size:16px;word-break:break-all' }, tgt.isLocal ? '本机服务端' : '远程服务器'),
      h('div', { class: 'foot', style: 'word-break:break-all' }, tgt.url || '未设置')),
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, '要载入的存档'),
      h('div', { class: 'value', style: 'font-size:20px' }, l.active || '未设置'),
      h('div', { class: 'foot' }, `${profilesList.length} 个本地存档 · ${tgt.autoLogin === false ? '启动器手填账号' : '自动登录'}`)),
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, '本地服务端'),
      h('div', { class: 'value', style: 'font-size:20px' }, l.serverRunning ? '运行中' : '未启动'),
      h('div', { class: 'foot' }, '独立开关在「服务器」页')),
  );

  const profSelect = h('select', { class: 'input' }, ...profilesList.map((p) =>
    h('option', { value: p.nickname, selected: p.active }, `${p.nickname}${p.level != null ? `（${p.level} 级）` : ''}`)));
  const modeSel = h('select', { class: 'input' },
    h('option', { value: 'local', selected: tgt.isLocal }, '本机服务端（自己开服）'),
    h('option', { value: 'remote', selected: !tgt.isLocal }, '远程服务器（别人开的）'));
  const urlInp = h('input', { class: 'input', value: tgt.url || 'https://127.0.0.1:6969' });
  const autoLoginCb = h('input', { type: 'checkbox', checked: tgt.autoLogin !== false });
  const autoServer = h('input', { type: 'checkbox', checked: false });
  const autoServerField = h('div', { class: 'field' }, h('label', {}, '启动前自动拉起本地服务端'),
    h('label', { class: 'switch' }, autoServer, '自动'),
    h('div', { class: 'hint' }, '只在「本机服务端」模式下有意义；连远程服务器时不会动本地服务端'));
  const modeHint = h('div', { class: 'hint', style: 'margin-top:2px' }, '');
  const profHint = h('div', { class: 'hint', style: 'margin-top:4px' }, '');
  const syncProf = () => {
    const name = profSelect.value;
    profHint.textContent = name ? `账号：${name} · 密码留空（SPT 只认用户名，不校验密码）` : '还没有本地存档';
  };
  profSelect.addEventListener('change', syncProf);

  function syncMode() {
    const local = modeSel.value === 'local';
    urlInp.disabled = local;
    urlInp.placeholder = local ? 'https://127.0.0.1:6969' : 'https://对方IP:6969';
    if (local) {
      urlInp.value = 'https://127.0.0.1:6969';
    } else if (!urlInp.value || /127\.0\.0\.1|localhost/i.test(urlInp.value)) {
      urlInp.value = '';
    }
    autoServer.checked = local ? autoServer.checked : false;
    autoServer.disabled = !local;
    autoServerField.style.opacity = local ? '1' : '.55';
    modeHint.textContent = local
      ? '本机模式：服务端和客户端都在本机，直接用本地存档即可。'
      : '远程模式：要用对方服务器上的账号，本地存档不会出现在对方服里；建议关掉「启动器自动登录」手动输密码。';
  }
  modeSel.addEventListener('change', syncMode);
  syncMode();
  syncProf();

  // ---------------------------------------------------------------- 启动方式：客户端 / 无头主机
  const headlessList = hl.installs || [];
  const localHl = hl.local || null; // 这份客户端自己能不能当无头主机（单份切换）
  const headlessSrc = headlessList.length ? headlessList[0] : localHl;
  const headlessState = headlessSrc ? String(headlessSrc.state || '') : '';
  const headlessText = ({
    connected: '已连接服务端',
    starting: '启动中',
    exited: '上次异常退出',
    idle: '未运行',
  })[headlessState] || (headlessSrc ? '未运行' : '未装无头组件');

  // 当前模式以「Fika.Headless.dll 有没有启用」为准（持久标记），localStorage 只当兜底
  const pluginOn = !!(localHl && localHl.pluginEnabled);
  let launchMode = localHl ? (pluginOn ? 'host' : 'solo')
    : (localStorage.getItem('spt.launchMode') === 'host' ? 'host' : 'solo');
  const modeDesc = h('div', { class: 'hint', style: 'margin-top:10px;margin-bottom:0' }, '');
  const modeBtns = {};

  const runMode = async (btn) => {
    if (btn) btn.disabled = true;
    const dlg = progressDialog(launchMode === 'host' ? '切到无头主机' : '切到客户端模式');
    try {
      const { jobId } = await POST('/api/client/mode', { mode: launchMode, username: profSelect.value });
      const job = await watchJob(jobId, (j) => dlg.update(j));
      dlg.close();
      const steps = (job.result && job.result.steps) || [];
      toast(`${launchMode === 'host' ? '无头主机已就绪' : '已启动客户端'}${steps.length ? '：' + steps[steps.length - 1] : ''}`, 'ok');
      await render();
    } catch (err) {
      dlg.close();
      toast(String(err.message || err), 'err');
    } finally { if (btn) btn.disabled = false; }
  };

  const primaryBtn = h('button', { class: 'btn primary', onclick: (e) => runMode(e.target) }, '');

  const singleCopy = !headlessList.length;
  const setMode = (m) => {
    launchMode = m === 'host' ? 'host' : 'solo';
    localStorage.setItem('spt.launchMode', launchMode);
    for (const [k, b] of Object.entries(modeBtns)) b.className = `btn sm ${k === launchMode ? 'primary' : ''}`;
    primaryBtn.textContent = launchMode === 'host' ? '切到无头主机模式' : '切到客户端模式';
    modeDesc.textContent = launchMode === 'host'
      ? (singleCopy
        ? `用这一份客户端跑无头主机：会先停掉正在玩的客户端（同一份只能跑一个），启用 Fika.Headless 并拉起管理器，连上后就能让别人加入；切回客户端模式会自动停掉无头。无头状态：${headlessText}`
        : `先确认本地服务端 → 拉起无头主机并等它连上（最长 90s）→ 再启动你的客户端；已经在跑的那一步会自动跳过。无头状态：${headlessText}`)
      : `停掉无头主机（如果有）、停用 Fika.Headless，然后直接启动这一份客户端。无头状态：${headlessText}`;
  };

  modeBtns.solo = h('button', { class: 'btn sm', onclick: () => setMode('solo') }, '客户端模式（玩单机）');
  modeBtns.host = h('button', { class: 'btn sm', onclick: () => setMode('host') }, singleCopy ? '无头主机模式（同一份客户端）' : '无头房主（无头 + 客户端）');

  const modeCard = h('div', { class: 'card', style: 'margin-top:16px' },
    h('div', { class: 'card-head' }, h('h2', {}, '启动方式'),
      h('span', { class: 'sub' }, `无头：${headlessText}`)),
    h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, modeBtns.solo, modeBtns.host),
    modeDesc);
  setMode(launchMode);

  const mainCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, '连接服务端 / 启动游戏'),
      h('span', { class: 'sub' }, `当前目标：${tgt.url || '未设置'}`)),
    h('div', { class: 'grid c2' },
      h('div', { class: 'field' }, h('label', {}, '连接哪个服务端'), modeSel,
        h('div', { class: 'hint' }, '连别人的服务器就选远程，地址填对方给的 https://IP:6969')),
      h('div', { class: 'field' }, h('label', {}, '服务端地址 Server.Url'), urlInp,
        h('div', { class: 'hint' }, '本机模式自动用 127.0.0.1；远程模式手填对方地址（要带端口）'))),
    h('div', { class: 'grid c2', style: 'margin-top:12px' },
      h('div', { class: 'field' }, h('label', {}, '要载入的存档'),
        profSelect,
        profHint,
        h('div', { class: 'hint' }, '写入 SPT/user/launcher/config.json 的 AutoLoginCreds；远程服务器要用对方服上的账号')),
      h('div', { class: 'field' }, h('label', {}, '启动器自动登录'),
        h('label', { class: 'switch' }, autoLoginCb, '启用'),
        h('div', { class: 'hint' }, '关掉后启动器会停在登录界面，自己填账号密码'))),
    h('div', { class: 'grid c2', style: 'margin-top:12px' },
      autoServerField,
      h('div', { class: 'field' }, h('label', {}, '本机服务端状态'),
        h('div', { class: 'hint', style: 'margin-top:0' }, l.serverRunning ? '● 本地 SPT.Server 正在运行' : '○ 本地 SPT.Server 未启动（到「服务器」页单独开关）'))),
    modeHint,
    h('div', { class: 'row', style: 'margin-top:14px;flex-wrap:wrap;gap:8px' },
      h('button', { class: 'btn', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const body = {
            url: modeSel.value === 'local' ? '' : urlInp.value.trim(),
            autoLogin: autoLoginCb.checked,
          };
          if (modeSel.value === 'local') body.name = 'SPT';
          const r = await POST('/api/launch/target', body);
          toast(r.isLocal ? '已切回本机服务端' : `已指向远程服务端：${r.url}`, 'ok');
          await render();
        } catch (err) { toast(String(err.message || err), 'err'); }
        finally { e.target.disabled = false; }
      } }, '保存连接设置'),
      h('button', { class: 'btn', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await POST('/api/launch/profile', { username: profSelect.value });
          toast(`下次启动将载入存档：${r.active}`, 'ok');
          await render();
        } catch (err) { toast(String(err.message || err), 'err'); }
        finally { e.target.disabled = false; }
      } }, '应用存档'),
      primaryBtn,
      h('button', { class: 'btn', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const local = modeSel.value === 'local';
          const r = await POST('/api/launch/client', { ensureServer: local && autoServer.checked });
          toast(`已打开启动器（pid ${r.pid}）${r.serverStarted ? '，本地服务端已拉起' : ''} · 目标 ${r.target || '默认'}`, 'ok');
        } catch (err) { toast(String(err.message || err), 'err'); }
        finally { e.target.disabled = false; }
      } }, '用启动器'),
      h('button', { class: 'btn', onclick: async () => {
        try { await POST('/api/launch/open', { kind: 'root' }); } catch (err) { toast(String(err.message || err), 'err'); }
      } }, '打开游戏目录')));

  const linkRow = (title, sub, btnLabel, onClick) => h('div', { class: 'list-row' },
    h('div', { style: 'min-width:0' },
      h('div', { style: 'font-weight:550' }, title),
      h('div', { class: 'hint', style: 'word-break:break-all' }, sub)),
    h('div', { class: 'actions' }, h('button', { class: 'btn sm', onclick: onClick }, btnLabel)));

  const sideCard = h('div', { class: 'card', style: 'margin-top:16px' },
    h('div', { class: 'card-head' }, h('h2', {}, '客户端相关')),
    h('div', { class: 'list' },
      linkRow('客户端 Fika 配置', 'BepInEx\\config\\com.fika.core.cfg，改完重启游戏生效', '打开目录', async () => {
        try { await POST('/api/fika/open', { kind: 'clientCfg' }); } catch (err) { toast(String(err.message || err), 'err'); }
      }),
      linkRow('客户端插件', 'BepInEx\\plugins 下的 .dll；启用/停用请到「模组管理」', '去模组管理', () => setPage('mods')),
      linkRow('SPT 启动器', l.launcherExe || '', '打开目录', async () => {
        try { await POST('/api/launch/open', { kind: 'launcher' }); } catch (err) { toast(String(err.message || err), 'err'); }
      }),
      linkRow('游戏本体', l.gameExe || '', '打开目录', async () => {
        try { await POST('/api/launch/open', { kind: 'root' }); } catch (err) { toast(String(err.message || err), 'err'); }
      })));

  const gamePathWarn = l.launcherGamePathOk === false ? h('div', { class: 'card', style: 'margin-top:16px;border-color:#f0c36d' },
    h('div', { class: 'card-head' }, h('h2', {}, '启动器游戏路径不对'),
      h('span', { class: 'sub' }, '点了「开始游戏」没反应 / 日志里 Core dll mismatch 就是这个')),
    h('div', { class: 'hint', style: 'margin-top:0' },
      `启动器现在认的游戏目录是 ${l.launcherGamePath || '（空）'}，它要在里面找 BepInEx\\plugins\\spt\\spt-core.dll，找不到就不启动游戏。`),
    h('div', { class: 'hint' }, '正确值应该是游戏根目录（EscapeFromTarkov.exe 所在的那一层）。'),
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn primary', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const r = await POST('/api/launch/repair', {});
          toast(r.fixed ? '已修正启动器 GamePath，重启启动器后再点「开始游戏」' : 'GamePath 本来就是对的', r.fixed ? 'ok' : '');
          await render();
        } catch (err) { toast(String(err.message || err), 'err'); }
        finally { e.target.disabled = false; }
      } }, '一键修复'),
      h('button', { class: 'btn', onclick: async () => {
        try { await POST('/api/launch/open', { kind: 'launcher' }); } catch (err) { toast(String(err.message || err), 'err'); }
      } }, '打开启动器目录'))) : null;

  return frag(
    pageHead('游戏客户端', '启动客户端、切换存档、连接本机或远程服务端', [
      h('button', { class: 'btn', onclick: async () => {
        try { await POST('/api/launch/open', { kind: 'root' }); } catch (err) { toast(String(err.message || err), 'err'); }
      } }, '打开游戏目录'),
      h('button', { class: 'btn', onclick: () => setPage('fika') }, 'Fika 配置'),
    ]),
    stats,
    gamePathWarn,
    h('div', { style: 'height:16px' }),
    modeCard,
    mainCard,
    sideCard,
  );
}

// ---------------------------------------------------------------- 启动
(async () => {
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === 'dashboard'));
  await render();
  // 每 30 秒刷新侧栏状态
  setInterval(async () => {
    try {
      const st = await GET('/api/state', { silent: true });
      state.app = st;
      updateFoot();
    } catch { /* ignore */ }
  }, 30000);
})();
