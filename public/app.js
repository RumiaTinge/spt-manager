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
  if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }
  if (state.raidTimer) { clearInterval(state.raidTimer); state.raidTimer = null; }
  if (state.clientTimer) { clearInterval(state.clientTimer); state.clientTimer = null; }
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
      live: renderLive,
      raid: renderRaid,
      fika: renderFika,
      ai: renderAi,
      params: renderAiParams,
      loot: renderLoot,
      items: renderItems,
      profiles: renderProfiles,
      settings: renderSettings,
      about: renderAbout,
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

function humanSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
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
const SEASONAL_MAP_CN = {
  bigmap: '海关', woods: '森林', shoreline: '海岸线', interchange: '立交桥',
  laboratory: '实验室', lighthouse: '灯塔', rezervbase: '储备站', factory4: '工厂',
  tarkovstreets: '塔科夫街区', sandbox: '中心区',
};
const SEASON_CN = { 0: '夏天', 1: '秋天', 2: '冬天', 3: '春天', 4: '深秋', 5: '早春' };

/** 节日 / 季节性活动卡片（seasonalevents.json） */
function seasonalCard(s) {
  const bit = (label, get, set) => {
    const inp = h('input', { type: 'checkbox', checked: !!get() });
    inp.addEventListener('change', () => set(inp.checked));
    return h('label', { class: 'switch' }, inp, label);
  };
  const numInp = (value, lo, hi, onchange, width = '64px') => {
    const inp = h('input', { class: 'input', type: 'number', min: String(lo), max: String(hi), value: String(value), style: `width:${width}` });
    inp.addEventListener('change', () => {
      const n = Number(inp.value);
      const v = Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : value;
      inp.value = String(v);
      onchange(v);
    });
    return inp;
  };
  const textInp = (value, onchange, opts = {}) => {
    const inp = h('input', { class: 'input', value: String(value ?? ''), placeholder: opts.placeholder || '', style: opts.style || '' });
    inp.addEventListener('change', () => onchange(inp.value));
    return inp;
  };
  const stateTag = (ev) => {
    const active = s.active.includes(ev.name);
    const nx = ev.next;
    const tip = nx ? (nx.kind === 'end' ? `还有 ${nx.days} 天结束（${nx.date}）` : `还有 ${nx.days} 天开始（${nx.date}）`) : '';
    return h('span', { class: `tag ${active ? 'ok' : ''}`, title: tip }, active ? `今天生效${tip ? ` · ${tip}` : ''}` : `未生效${tip ? ` · ${tip}` : ''}`);
  };

  // 通用：按值类型渲染设置项（支持一层嵌套对象，例如 zombieSettings.mapInfectionAmount）
  const renderSetting = (key, val, holder, label) => {
    if (typeof val === 'boolean') return bit(label || key, () => holder[key], (v) => { holder[key] = v; });
    if (typeof val === 'number') {
      const isInt = Number.isInteger(val);
      const inp = h('input', {
        class: 'input', type: 'number',
        step: isInt ? '1' : '0.01',
        min: '0', max: isInt ? '100' : '10',
        value: String(val), style: isInt ? 'width:90px' : 'width:110px',
      });
      inp.addEventListener('change', () => {
        const n = Number(inp.value);
        holder[key] = Number.isFinite(n) ? (isInt ? Math.max(0, Math.round(n)) : Math.max(0, n)) : val;
      });
      return inp;
    }
    if (Array.isArray(val)) {
      return textInp(val.join(', '), (v) => {
        holder[key] = v.split(',').map((x) => x.trim()).filter(Boolean);
      }, { placeholder: '逗号分隔', style: 'min-width:220px' });
    }
    if (val && typeof val === 'object') {
      const rows = Object.entries(val).map(([k, v]) => {
        const label2 = key === 'mapInfectionAmount' ? (SEASONAL_MAP_CN[k.toLowerCase()] || k) : k;
        return h('div', { class: 'field' }, h('label', {}, label2), renderSetting(k, v, val, label2));
      });
      return h('div', { class: 'seasonal-nested' }, h('div', { class: 'hint' }, key), h('div', { class: 'grid c3' }, ...rows));
    }
    return textInp(val, (v) => { holder[key] = v; });
  };

  const eventBoxes = s.events.map((ev) => {
    const top = h('div', { class: 'row', style: 'gap:10px;align-items:center;flex-wrap:wrap' },
      h('span', { class: 'tag' }, ev.type || '活动'),
      textInp(ev.name, (v) => { ev.name = v; }, { style: 'width:200px' }),
      bit('启用', () => ev.enabled, (v) => { ev.enabled = v; }),
      stateTag(ev));
    const dateRow = h('div', { class: 'row', style: 'gap:6px;align-items:center;flex-wrap:wrap' },
      h('span', { class: 'hint' }, '开始'),
      numInp(ev.startMonth, 1, 12, (v) => { ev.startMonth = v; }), h('span', {}, '月'),
      numInp(ev.startDay, 1, 31, (v) => { ev.startDay = v; }), h('span', {}, '日'),
      h('span', { class: 'hint', style: 'margin-left:10px' }, '结束'),
      numInp(ev.endMonth, 1, 12, (v) => { ev.endMonth = v; }), h('span', {}, '月'),
      numInp(ev.endDay, 1, 31, (v) => { ev.endDay = v; }), h('span', {}, '日'),
      h('span', { class: 'hint', style: 'margin-left:8px' }, '（月/日按游戏内日历判断，支持跨年）'));
    const settingsRows = Object.entries(ev.settings || {}).map(([k, v]) => {
      if (k === 'zombieSettings' && v && typeof v === 'object') {
        const inner = Object.entries(v).map(([k2, v2]) => {
          if (k2 === 'mapInfectionAmount' && v2 && typeof v2 === 'object') {
            const maps = Object.entries(v2).map(([mk, mv]) => h('div', { class: 'field' },
              h('label', {}, SEASONAL_MAP_CN[mk.toLowerCase()] || mk),
              numInp(mv, 0, 100, (n) => { v2[mk] = n; }, '90px')));
            return h('div', { style: 'grid-column:1/-1' }, h('div', { class: 'hint' }, '感染度按地图（%）'), h('div', { class: 'grid c4' }, ...maps));
          }
          return h('div', { class: 'field' }, h('label', {}, k2), renderSetting(k2, v2, v, k2));
        });
        return h('div', { style: 'grid-column:1/-1;border-top:1px dashed var(--line);padding-top:10px' },
          h('div', { class: 'hint', style: 'margin-bottom:8px' }, '僵尸 / 感染'),
          h('div', { class: 'grid c3' }, ...inner));
      }
      if (k === 'forceSeason' && typeof v === 'number') {
        const sel = h('select', { class: 'input' }, ...Object.entries(SEASON_CN).map(([k2, label]) =>
          h('option', { value: k2, selected: String(v) === k2 }, `${label}（${k2}）`)));
        sel.addEventListener('change', () => { ev.settings[k] = Number(sel.value); });
        return h('div', { class: 'field' }, h('label', {}, '强制季节'), sel);
      }
      return h('div', { class: 'field' }, h('label', {}, k), renderSetting(k, v, ev.settings, k));
    });

    return h('div', { class: 'seasonal-ev' },
      top, dateRow,
      h('div', { class: 'grid c3', style: 'margin-top:12px' }, ...settingsRows));
  });

  const saveBtn = h('button', { class: 'btn primary', onclick: async (e) => {
    e.target.disabled = true;
    try {
      const body = { enableSeasonalEventDetection: s.enableSeasonalEventDetection, events: s.events };
      const r = await POST('/api/seasonal', body);
      if (r.ok === false) { toast(r.error || '保存失败', 'err'); return; }
      toast('节日配置已保存（重启服务端后生效）', 'ok');
      await render();
    } catch (err) { toast(String(err.message || err), 'err'); }
    finally { e.target.disabled = false; }
  } }, '保存节日配置');

  const head = h('div', { class: 'card-head' },
    h('h2', {}, '节日 / 季节性活动'),
    h('span', { class: 'sub' }, s.path || 'SPT_Data\\configs\\seasonalevents.json'));

  const intro = h('div', { class: 'hint', style: 'margin-bottom:10px' },
    `服务端按「今天的月/日」判断哪个活动生效。今天 ${s.today.month} 月 ${s.today.day} 日，生效中：${s.active.length ? s.active.join('、') : '无'}。`
    + '改完需要重启服务端；只有开着的活动才会套用下面这些开关。');

  const globalRow = h('div', { class: 'row', style: 'gap:14px;align-items:center;flex-wrap:wrap' },
    bit('启用季节活动检测（enableSeasonalEventDetection）', () => s.enableSeasonalEventDetection, (v) => { s.enableSeasonalEventDetection = v; }),
    h('span', { class: 'hint' }, '关掉后服务端不会再自动套用任何节日活动（万圣节/圣诞都不生效）'),
    saveBtn);

  const info = s.info ? h('div', { class: 'hint', style: 'margin-top:12px;line-height:1.9' },
    `随附数据：首领刷新 ${s.info.eventBossSpawns.length} 组（${s.info.eventBossSpawns.join('、') || '无'}）；`
    + `装备 ${s.info.eventGear.join('、') || '无'}；战利品 ${s.info.eventLoot.join('、') || '无'}；`
    + `礼物刷新点 ${s.info.gifterMaps} 张图；圣诞容器 ${s.info.christmasContainers} 个；`
    + `Khorovod 可传送地图 ${s.info.khorovodMaps.length} 张；敌对表 ${s.info.hostilityFor.join('、') || '无'}。`
    + '（这些表本身在同一个 JSON 里，这里只读展示）') : null;

  return h('div', { class: 'card' },
    head, intro, globalRow,
    h('div', { style: 'height:14px' }),
    ...eventBoxes,
    info,
    h('div', { class: 'hint', style: 'margin-top:10px' }, '冬季下雪/季节贴图由 weather.json 的 seasonDates 控制，不在这张卡里。'));
}

async function renderServer() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('服务器'), noRootCard());
  const st = await GET('/api/server/status');
  let season = null;
  try { season = await GET('/api/seasonal'); } catch { /* 老版本后端没有这个接口 */ }
  const logBox = makeLogBox('加载日志…');

  async function loadLog() {
    try {
      const r = await GET('/api/server/log?n=260');
      logBox._follow = true;                 // 手动刷新：总是拉回最新
      logBox._badge.hidden = true;
      fillLog(logBox, r.lines, 'server', '还没有服务端日志');
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
      logBox._wrap),
    season ? h('div', { style: 'height:16px' }) : null,
    season && season.ok ? seasonalCard(season)
      : (season ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, '节日 / 季节性活动')),
        h('div', { class: 'empty' }, h('b', {}, '读取失败'), season.parseError || '没有找到 seasonalevents.json')) : null),
  );
}

// ---------------------------------------------------------------- 实时窗口
const HEADLESS_STATE_CN = {
  connected: ['已连接', 'ok'],
  starting: ['启动中', 'warn'],
  exited: ['已退出', 'bad'],
  idle: ['未运行', ''],
};

function logClass(l, mode) {
  return /error|fail|exception/i.test(l) ? 'l-err'
    : /warn/i.test(l) ? 'l-warn'
      : (mode === 'ai' ? /NoAIBots/i.test(l) : /loaded|started|listening|success|已启用/i.test(l)) ? 'l-ok' : 'l-info';
}

/**
 * 建一个日志框（连同「暂停跟随」浮层）。
 * 默认自动跟到底部；一旦用户往上滚、拖滚动条或按住划选，就停止刷新，避免
 * 每 2 秒重绘把滚动条顶回去；点浮层或自己滚回底部恢复跟随。
 */
function makeLogBox(initialText) {
  const box = h('div', { class: 'log' }, initialText || '加载中…');
  const badge = h('button', { class: 'log-follow', type: 'button', hidden: true }, '↓ 已暂停自动滚动 · 点这里回到最新');
  const wrap = h('div', { class: 'log-wrap' }, box, badge);
  box._wrap = wrap;
  box._badge = badge;
  box._follow = true;
  box._held = false;
  box._args = null;
  box._rendered = null;

  const paint = () => {
    const [arr, mode, emptyText] = box._args;
    box._rendered = arr.join('\n');
    if (!arr.length) {
      box.replaceChildren(h('div', { class: 'l-info' }, emptyText || '（暂无输出）'));
    } else {
      box.replaceChildren(...arr.map((l) => h('div', { class: logClass(l, mode) }, l)));
    }
    box.scrollTop = box.scrollHeight;
  };
  box._paint = paint;

  const resume = () => {
    box._follow = true;
    badge.hidden = true;
    if (box._args) paint();
    else box.scrollTop = box.scrollHeight;
  };
  badge.onclick = resume;

  box.addEventListener('scroll', () => {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight <= 10;
    if (atBottom) {
      if (!box._follow) resume();
    } else if (box._follow) {
      box._follow = false;
    }
  });

  // 按住鼠标（拖滚动条 / 划选文字）期间完全不重绘，松开后再按需补一次
  box.addEventListener('pointerdown', () => {
    box._held = true;
    const release = () => {
      box._held = false;
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      if (box._follow && box._args && box._rendered !== box._args[0].join('\n')) paint();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
  });

  return box;
}

function fillLog(box, lines, mode, emptyText) {
  const arr = lines || [];
  box._args = [arr, mode, emptyText];
  if (box._held) return;                       // 拖滚动条 / 划选时不动它
  if (!box._follow) {                          // 用户往上翻了：先不动，只亮「有新内容」提示
    if (box._rendered !== null && box._rendered !== arr.join('\n')) box._badge.hidden = false;
    return;
  }
  box._paint();
}

async function renderLive() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('实时窗口'), noRootCard());
  if (state.liveTimer) { clearInterval(state.liveTimer); state.liveTimer = null; }

  const auto = { on: true };
  const serverHead = h('div', { class: 'card-head' });
  const serverBox = makeLogBox('加载中…');
  const headlessBox = h('div', {});
  const aiHead = h('div', { class: 'card-head' });
  const aiBox = makeLogBox('加载中…');
  const qeTag = h('span', { class: 'tag' }, '快速编辑：读取中');
  const headlessCards = new Map();   // dir -> { card, stateTag, sub, actions, log }
  let headlessKey = '';

  const smBtn = (label, cls, fn) => h('button', { class: `btn sm ${cls}`, onclick: fn }, label);

  async function refresh() {
    let d;
    try { d = await GET('/api/live/panes?n=220', { silent: true }); } catch { return; }
    if (!d || !d.ok) return;

    const s = d.server;
    serverHead.replaceChildren(
      h('h2', {}, '服务端窗口'),
      h('span', { class: 'sub' }, s
        ? `${s.running ? '● 运行中' : '○ 未运行'}${s.pid ? ` · pid ${s.pid}` : ''} · ${s.file || '暂无日志'}`
        : '未设置 SPT 目录'),
      h('div', { class: 'spacer' }),
      smBtn('刷新', '', refresh));
    fillLog(serverBox, s && s.lines, 'server', '还没有服务端日志（启动服务端后这里会实时滚动）');

    const panes = d.headless || [];
    const key = panes.map((p) => p.dir).join('|');
    if (!panes.length) {
      headlessKey = '';
      headlessCards.clear();
      headlessBox.replaceChildren(h('div', { class: 'card', style: 'margin-top:14px' },
        h('div', { class: 'card-head' }, h('h2', {}, '无头主机窗口')),
        h('div', { class: 'empty' }, '没找到无头客户端目录：在「Fika 联机」页添加，或把无头副本放在 SPT 目录旁边（同一层）')));
    } else {
      const cards = panes.map((p) => {
        let c = headlessCards.get(p.dir);
        if (!c) {
          const stateTag = h('span', { class: 'tag', style: 'margin-left:8px' });
          const sub = h('span', { class: 'sub', style: 'margin-left:8px' });
          const actions = h('div', { class: 'spacer' });
          const log = makeLogBox('加载中…');
          const card = h('div', { class: 'card', style: 'margin-top:14px' },
            h('div', { class: 'card-head' }, h('h2', {}, `无头主机 · ${p.title}`), stateTag, sub, actions),
            log._wrap);
          c = { card, stateTag, sub, actions, log };
          headlessCards.set(p.dir, c);
        }
        c.card.querySelector('h2').textContent = `无头主机 · ${p.title}`;
        const [stateText, stateCls] = HEADLESS_STATE_CN[p.state] || ['未知', ''];
        c.stateTag.textContent = stateText;
        c.stateTag.className = `tag ${stateCls}`;
        c.stateTag.style.marginLeft = '8px';
        c.sub.textContent = `${p.dir}${p.file ? ` · ${p.file}` : ' · 没有日志'}`;
        c.actions.replaceChildren(p.running
          ? smBtn('停止', 'danger', async () => {
            try { await POST('/api/fika/headless/stop', { dir: p.dir }); toast('已停止无头主机', 'ok'); setTimeout(refresh, 800); } catch (e) { toast(String(e.message || e), 'err'); }
          })
          : smBtn('启动', 'primary', async () => {
            try { const r = await POST('/api/fika/headless/launch', { dir: p.dir }); toast(`已启动无头主机 (pid ${r.pid})`, 'ok'); setTimeout(refresh, 1200); } catch (e) { toast(String(e.message || e), 'err'); }
          }));
        fillLog(c.log, p.lines, 'headless', '（暂无输出）');
        return c.card;
      });
      for (const dir of [...headlessCards.keys()]) {
        if (!panes.some((p) => p.dir === dir)) headlessCards.delete(dir);
      }
      if (key !== headlessKey) {          // 目录集合变了才重排，避免每次刷新动 DOM（会打断拖滚动条）
        headlessBox.replaceChildren(...cards);
        headlessKey = key;
      }
    }

    const ai = d.ai || {};
    aiHead.replaceChildren(
      h('h2', {}, 'NoAIBots 窗口'),
      h('span', { class: 'sub' }, `只看 AI 相关行 · 命中 ${ai.matched || 0} 条 · ${ai.file || '暂无日志'}`),
      h('div', { class: 'spacer' }),
      smBtn('刷新', '', refresh));
    fillLog(aiBox, ai.lines, 'ai', '还没有 AI 相关日志（开一局后这里会出现 [NoAIBots] 行）');

    qeTag.textContent = d.quickEdit ? '快速编辑：开启（点窗口会卡住）' : '快速编辑：已关闭';
    qeTag.className = `tag ${d.quickEdit ? 'warn' : 'ok'}`;
  }

  await refresh();

  const autoSwitch = h('button', { class: 'btn sm primary', onclick: (e) => {
    auto.on = !auto.on;
    e.target.classList.toggle('primary', auto.on);
    e.target.textContent = auto.on ? '自动刷新：开' : '自动刷新：关';
  } }, '自动刷新：开');

  const qeBtn = smBtn('切换快速编辑', '', async () => {
    let d = null;
    try { d = await GET('/api/live/panes?n=40', { silent: true }); } catch { /* ignore */ }
    const wasOn = !!(d && d.quickEdit);
    try {
      await POST('/api/live/quickedit', { enabled: !wasOn });
      toast(wasOn ? '已关闭快速编辑：新开的控制台窗口不会再被点卡住' : '已开启快速编辑（可以鼠标选中复制）', 'ok');
      setTimeout(refresh, 300);
    } catch (e) { toast(String(e.message || e), 'err'); }
  });

  state.liveTimer = setInterval(() => {
    if (auto.on && state.page === 'live') refresh();
  }, 2000);

  return frag(
    pageHead('实时窗口', '服务端 / 无头主机 / NoAIBots 各占一个窗口，互不覆盖', [
      autoSwitch,
      h('button', { class: 'btn sm', onclick: () => refresh() }, '立即刷新'),
      h('button', { class: 'btn sm', onclick: () => setPage('server') }, '服务器页'),
    ]),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '窗口防卡住'), qeTag, h('div', { class: 'spacer' }), qeBtn),
      h('p', { class: 'hint' }, '无头主机和服务端都是独立控制台窗口。开着「快速编辑」时，鼠标只要点一下窗口，进程就会被冻住，按回车才恢复。关掉之后新开的窗口不会再有这个问题（已经开着的窗口要重开才生效）。')),
    h('div', { style: 'height:14px' }),
    h('div', { class: 'card' }, serverHead, serverBox._wrap),
    headlessBox,
    h('div', { class: 'card', style: 'margin-top:14px' }, aiHead, aiBox._wrap),
  );
}

// ---------------------------------------------------------------- 战局实测
const RAID_CAT_CN = { scav: '普通 Scav', playerScav: '玩家 Scav', pmc: 'PMC', boss: '首领', follower: '首领随从', other: '其他' };

async function renderRaid() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('战局实测'), noRootCard());
  if (state.raidTimer) { clearInterval(state.raidTimer); state.raidTimer = null; }

  const auto = { on: true };
  const stamp = h('span', { class: 'sub' }, '读取中…');
  const brief = h('div', {});
  const body = h('div', {});
  const notesBox = h('div', { class: 'card', style: 'margin-top:14px' }, h('div', { class: 'card-head' }, h('h2', {}, '判读提示')), notesBoxPlaceholder());
  function notesBoxPlaceholder() { return h('p', { class: 'hint' }, '正在读日志…'); }

  const row = (k, v) => h('div', { class: 'raid-row' }, h('span', { class: 'raid-k' }, k), h('div', { class: 'raid-v' }, v));
  const localTime = (raw) => {
    const m = String(raw || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) return raw || '-';
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])).toLocaleString('zh-CN', { hour12: false });
  };

  async function refresh() {
    let d = null;
    try { d = await GET('/api/raid/compare', { silent: true }); } catch { /* ignore */ }
    if (!d || !d.ok) { stamp.textContent = '读取失败：管理器连不上'; return; }
    let probeBundle = null;
    try {
      const bd = await GET('/api/bundled', { silent: true });
      probeBundle = (bd.items || []).find((x) => x.id === 'raidprobe-client') || null;
    } catch { /* 老版本后端没有这个接口 */ }
    const s = d.server || {};
    const c = d.client || {};
    stamp.textContent = `最近一局 · 更新于 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · 每 5 秒刷新`;

    const ruleLines = (s.rules || []).length
      ? (s.rules || []).map((r) => r.text)
      : ['没有规则修改记录 → 命中的是零改动规则（原版节奏）'];
    const tuningText = (s.tuning || []).length ? (s.tuning || []).at(-1).text : '未调整（原版）';
    const capSrv = (s.caps || []).length ? (s.caps || []).at(-1).text : '未改动（原版上限）';
    const countTags = Object.entries(c.counts || {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => h('span', { class: 'tag', style: 'margin:2px 6px 2px 0' }, `${RAID_CAT_CN[k] || k} ${v}`));
    const spawnSys = [c.oldWaves != null ? `旧系统（waves ${c.oldWaves}）` : null, c.newSpawn ? '新系统' : null].filter(Boolean).join(' + ') || '还没打印（可能还在加载）';
    const capLine = c.cap ? `${c.cap.map}: ${c.cap.from} → ${c.cap.to}` : '还没收到';

    // 顶部结论
    const serverDidNothing = (s.rules || []).length === 0 && (s.caps || []).length === 0 && (s.tuning || []).length === 0;
    brief.replaceChildren(
      h('div', { class: 'card' },
        h('div', { class: 'card-head' },
          h('h2', {}, '一句话结论'),
          h('span', { class: 'sub' }, '服务端决策 ←→ 战局实际')),
        h('div', { class: 'row wrap', style: 'gap:8px' },
          h('span', { class: `tag ${serverDidNothing ? '' : 'ok'}` }, serverDidNothing ? '服务端：原版节奏（无改动）' : '服务端：按规则改过刷新表'),
          h('span', { class: 'tag' }, `地图 ${s.map || c.cap?.map || '—'}`),
          h('span', { class: 'tag' }, `档位 ${(s.amounts || []).join(' / ') || '—'}`),
          h('span', { class: 'tag' }, `同屏上限 ${c.cap ? c.cap.to : '—'}`),
          h('span', { class: 'tag ok' }, `进场 ${c.total == null ? '—' : c.total + ' 只'}`)),
        h('p', { class: 'hint', style: 'margin-top:8px' }, '同屏上限是硬上限（maxBotCap），进场人数是这局到目前为止客户端日志里真正创建出来的 bot 数（含玩家 Scav）。')));

    const live = d.live || {};
    const liveTags = Object.entries(live.byRole || {})
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => h('span', { class: 'tag', style: 'margin:2px 6px 2px 0' }, `${k} ${v}`));
    const liveBoss = (live.bots || []).filter((b) => b.boss).length;
    const liveRows = (live.bots || []).map((b) => h('div', { class: 'raid-row' },
      h('span', { class: 'raid-k' }, b.alive ? (b.boss ? '首领存活' : '存活') : '已死'),
      h('div', { class: 'raid-v' }, `${b.name || '?'} · ${b.role || '?'}${b.boss ? ' · 首领' : ''}${b.follower ? ' · 随从' : ''}${b.side ? ` · ${b.side}` : ''} · (${Math.round(b.x || 0)}, ${Math.round(b.y || 0)}, ${Math.round(b.z || 0)})`)));
    const liveCard = h('div', { class: 'card', style: 'margin-top:14px' },
      h('div', { class: 'card-head' },
        h('h2', {}, '客户端插件：此刻存活'),
        h('span', { class: 'sub' }, live.installed ? `快照 ${live.ageSec}s 前` : live.dllInstalled ? '插件已装 · 等进战局' : '插件未安装')),
      !live.installed
        ? h('p', { class: 'hint' }, live.dllInstalled
          ? '插件已就位，但还没生成快照：BepInEx 只在游戏启动时加载插件，重启游戏再进一局，这里就会列出此刻真正存在的每一只 AI（含首领与随从）。'
          : '把 RaidProbeClient.dll 放进 <客户端>\\BepInEx\\plugins\\RaidProbe\\，重启游戏后，这里会列出战局里此刻真正存在的每一只 AI（含首领与随从）。')
        : live.parseError
          ? h('p', { class: 'hint', style: 'color:var(--warn)' }, `快照解析失败：${live.parseError}`)
          : frag(
            h('div', { class: 'row wrap', style: 'gap:8px' },
              h('span', { class: `tag ${live.live ? 'ok' : ''}` }, live.live ? '插件在线' : '快照过期（可能已离开战局）'),
              h('span', { class: 'tag ok' }, `此刻存活 ${live.alive || 0} 只`),
              h('span', { class: 'tag' }, `登记 ${live.count || 0} 只`),
              h('span', { class: 'tag' }, `首领 ${liveBoss} 只`),
              h('span', { class: 'tag' }, `日志累计进场 ${c.total == null ? '—' : c.total + ' 只'}`)),
            h('p', { class: 'hint', style: 'margin:8px 0 0' }, '「此刻存活」是插件现在从 BotsController 里读到的集合；「日志累计进场」是客户端日志里这局曾经创建过的全部 bot（含已被打死/清掉的）。两个数不一样是正常的。'),
            h('div', { class: 'row wrap', style: 'gap:6px;margin:10px 0' },
              ...(liveTags.length ? liveTags : [h('span', { class: 'sub' }, '战局里还没有 AI')])),
            ...(liveRows.length
              ? liveRows
              : [h('p', { class: 'hint' }, live.live ? '插件在线但列表为空：这一局还没刷出 AI，或者已经全部清空。' : '快照太久没更新：进一局战局，插件才会开始写。')])));

    const killBtn = (label, scope, cls) => h('button', {
      class: cls || 'btn',
      onclick: async () => {
        try {
          const r = await POST('/api/raid/kill', { scope });
          toast(`已给客户端插件发「${label}」指令（${r.id}），1 秒内执行`, 'ok');
          setTimeout(refresh, 1500);
        } catch (e) {
          toast(String(e.message || e), 'bad');
        }
      },
    }, label);
    const lr = d.liveResult;
    const fileVersion = probeBundle && probeBundle.installed ? (probeBundle.installedVersion || '未知版本') : null;
    const liveVersion = live.plugin || null;
    const needInstall = !probeBundle || !probeBundle.installed || probeBundle.outdated;
    const installProbe = async (btn) => {
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = '安装中…';
      try {
        const r = await POST('/api/bundled/install', { id: 'raidprobe-client' });
        toast(`已装客户端插件 ${probeBundle ? probeBundle.version : '0.3.0'}（${r.files} 个文件）${r.backup ? '，旧版已备份' : ''}；重启游戏后生效`, 'ok', 6000);
        await refresh();
      } catch (e) {
        toast(String(e.message || e), 'bad', 6000);
        btn.disabled = false;
        btn.textContent = old;
      }
    };
    const pluginCard = h('div', { class: 'card', style: 'margin-top:14px' },
      h('div', { class: 'card-head' },
        h('h2', {}, '客户端插件：RaidProbeClient'),
        h('span', { class: 'sub' }, probeBundle ? `内置 ${probeBundle.version}` : '这份包没带')),
      h('div', { class: 'row wrap', style: 'gap:8px;margin-bottom:8px' },
        h('span', { class: `tag ${fileVersion ? 'ok' : ''}` }, `文件 ${fileVersion || '未安装'}`),
        liveVersion ? h('span', { class: `tag ${liveVersion === fileVersion ? 'ok' : 'warn'}` }, `运行中 ${liveVersion}`) : null,
        needInstall
          ? h('button', { class: 'btn sm primary', onclick: (e) => installProbe(e.target) }, probeBundle && probeBundle.installed ? '更新到内置版本' : '一键安装插件')
          : (liveVersion && fileVersion && liveVersion !== fileVersion
            ? h('span', { class: 'tag warn' }, '重启游戏后生效')
            : h('span', { class: 'tag ok' }, '已是最新'))),
      h('p', { class: 'hint', style: 'margin:0' }, '装到 <客户端>\\BepInEx\\plugins\\RaidProbe\\，覆盖前会备份到 data\\backups\\bundled。BepInEx 只在游戏启动时加载插件，装完请重启游戏；「运行中」是插件自己上报的版本，插件 0.3.0 起才支持下面的「直接杀 AI」。'));

    const killCard = h('div', { class: 'card', style: 'margin-top:14px' },
      h('div', { class: 'card-head' },
        h('h2', {}, '局内测试：直接杀 AI'),
        h('span', { class: 'sub' }, live.installed ? `客户端插件 ${live.plugin || '旧版'}` : '需要 RaidProbeClient 0.3.0')),
      h('p', { class: 'hint' }, '进战局后点下面的按钮：管理器往 BepInEx\\plugins\\RaidProbe\\command.json 写一条指令，插件 1 秒内执行，下个快照就能看到存活数变化——用来验证新系统的刷新窗口会不会补人。也可以在游戏里直接按热键 F9 全杀 / F10 杀 Scav / F11 杀 PMC+首领。'),
      h('div', { class: 'row wrap', style: 'gap:8px' },
        killBtn('杀全部 AI', 'all', 'btn primary'),
        killBtn('只杀 Scav', 'scav'),
        killBtn('只杀 PMC + 首领', 'pmc')),
      lr
        ? h('p', { class: 'hint', style: 'margin-top:10px' },
          `${lr.ageSec}s 前回执：scope=${lr.scope}，匹配 ${lr.matched} 只，击杀 ${lr.killed} 只${lr.remaining != null ? `，剩余 ${lr.remaining} 只` : ''}${lr.error ? `，错误：${lr.error}` : ''}`)
        : h('p', { class: 'hint', style: 'margin-top:10px' }, '还没有回执：进战局后点一次按钮，这里会显示插件实际杀了几只、还剩几只。'));

    body.replaceChildren(
      h('div', { class: 'grid c2' },
        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, '服务端：插件做了什么'), h('span', { class: 'sub' }, s.file || '没找到服务端日志')),
          row('地图 / 档位', `${s.map || '—'} / ${(s.amounts || []).join(', ') || '—'}${s.bossesDisabled ? ' · 客户端关首领' : ''}`),
          row('命中与动作', h('div', { class: 'raid-code' }, ruleLines.join('\n'))),
          row('地图参数', h('div', { class: 'raid-code' }, tuningText)),
          row('同屏上限', capSrv),
          row('预生成档案池', `${s.batches || 0} 批 · 共 ${s.generated || 0} 只（一次性预生成，不是同屏数量）`),
          row('生成请求', `${(s.requests || []).length} 次`),
          row('校验陷阱修复', `${(s.nerfs || []).length} 次`),
          row('最后一条 AI 日志（本地时间）', localTime(s.lastTime))),

        h('div', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', {}, '客户端：真正刷出来的'), h('span', { class: 'sub' }, c.file || '没找到客户端日志')),
          row('Raid Code', c.raidCode || '—'),
          row('上限请求', capLine),
          row('刷新系统', spawnSys),
          row('进场总数', c.total == null ? '—' : `${c.total} 只`),
          row('构成', h('div', {}, ...(countTags.length ? countTags : [h('span', { class: 'sub' }, '还没看到 bot 进场')]))),
          row('服务端上限 vs 实际', capSrv === '未改动（原版上限）' ? '原版上限生效' : '按服务端计算的下发'))),

      liveCard,
      pluginCard,
      killCard,
      notesBox);
    notesBox.replaceChildren(
      h('div', { class: 'card-head' }, h('h2', {}, '判读提示')),
      ...(d.notes || []).length
        ? (d.notes || []).map((n) => h('p', { class: 'hint', style: 'color:var(--warn)' }, '· ' + n))
        : [h('p', { class: 'hint' }, '服务端日志和客户端日志对得上：没有发现矛盾。')]);
  }

  await refresh();
  state.raidTimer = setInterval(() => {
    if (auto.on && state.page === 'raid') refresh();
  }, 5000);

  const autoSwitch = h('button', { class: 'btn sm primary', onclick: (e) => {
    auto.on = !auto.on;
    e.target.classList.toggle('primary', auto.on);
    e.target.textContent = auto.on ? '自动刷新：开' : '自动刷新：关';
  } }, '自动刷新：开');

  return frag(
    pageHead('战局实测', '服务端插件改了哪些刷新参数，和战局里实际刷出来的 AI 对起来看', [
      autoSwitch,
      h('button', { class: 'btn sm', onclick: () => refresh() }, '立即刷新'),
      h('button', { class: 'btn sm', onclick: () => setPage('live') }, '实时窗口'),
    ]),
    h('div', { class: 'row wrap', style: 'align-items:center;gap:10px;margin-bottom:12px' }, stamp),
    brief,
    h('div', { style: 'height:14px' }),
    body,
  );
}

// ---------------------------------------------------------------- AI 配置
async function renderAi() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('战局 AI'), noRootCard());
  const [data, rulesData] = await Promise.all([GET('/api/ai'), GET('/api/ai/rules').catch(() => null)]);
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
    h('div', { style: 'height:16px' }),
    renderAiRulesSection(data, rulesData),
  );
}

// ---------------------------------------------------------------- AI 规则（NoAIBots 服务器 mod）
const AMOUNT_CN = { AsOnline: '同在线', NoBots: '无AI', Low: '低', Medium: '中等', High: '高', Horde: '排山倒海' };
const AMOUNT_ORDER = ['AsOnline', 'NoBots', 'Low', 'Medium', 'High', 'Horde'];
const MODE_CN = {
  followVanilla: '跟随原版档位（推荐）',
  forceNoAI: '永远无AI（忽略档位）',
  passthrough: '不处理（等同禁用）',
};
const RAID_MAP_IDS = ['factory4_day', 'factory4_night', 'bigmap', 'woods', 'shoreline', 'interchange',
  'rezervbase', 'lighthouse', 'laboratory', 'tarkovstreets', 'sandbox', 'sandbox_high', 'labyrinth'];
const RULE_PRESETS = [
  { label: '无AI', rule: { name: '无AI：整局不刷任何AI', match: { botAmounts: ['NoBots'] }, actions: { clearScavWaves: true, clearBossSpawns: true, botCapScale: 0 } } },
  { label: '只清PMC', rule: { name: '只清 PMC 小队（保留 scav 和首领）', match: {}, actions: { removePmcWaves: true } } },
  { label: '只清首领', rule: { name: '只清首领波（保留 PMC 和 scav）', match: {}, actions: { removeBossWaves: true } } },
  { label: '轻松模式', rule: { name: '轻松模式：PMC 三成、首领减半、上限减半', match: {}, actions: { pmcWaveChanceScale: 0.3, bossChanceScale: 0.5, botCapScale: 0.5 } } },
  { label: '开局静默10分钟', rule: { name: '开局 10 分钟不刷 AI', match: {}, actions: { delaySpawnsSeconds: 600 } } },
  { label: '关临场补刷', rule: { name: '关掉 new spawn 的临场补刷', match: {}, actions: { nonWaveSpawnBotsLimitPerPlayer: 0 } } },
  { label: '刷慢一点', rule: { name: '刷慢一点：30 秒检查一次、单区域最多 2 只', match: {}, actions: { botSpawnPeriodCheck: 30, maxBotPerZone: 2 } } },
];

function renderAiRulesSection(aiData, rulesData) {
  const maps = (aiData.perMap || []).filter((m) => RAID_MAP_IDS.includes(m.id));
  // 每张地图的原版刷新参数（来自服务端 base.json），用来把「不修改」显示成当前默认值
  const defaultMaps = (rulesData && rulesData.mapDefaults) || {};
  const ruleMapIds = (rule) => {
    const picked = (rule.match && rule.match.maps) || [];
    return picked.length ? picked : maps.map((m) => m.id);
  };
  /** 返回 { mixed:false, value } / { mixed:true } / null（无数据） */
  const mapDefault = (rule, key) => {
    const values = ruleMapIds(rule)
      .map((id) => defaultMaps[id] && defaultMaps[id][key])
      .filter((v) => v !== undefined && v !== null);
    if (!values.length) return null;
    const uniq = [...new Set(values.map((v) => JSON.stringify(v)))];
    return uniq.length === 1 ? { mixed: false, value: values[0] } : { mixed: true, value: null };
  };
  const boolText = (v) => (v ? '开' : '关');
  const defaultText = (rule, key) => {
    const d = mapDefault(rule, key);
    if (!d) return null;
    return d.mixed ? '各图不同' : (typeof d.value === 'boolean' ? boolText(d.value) : String(d.value));
  };
  // 还没保存过、也不是地图参数的字段：用 actionDefs 里的默认值
  const actionDef = (key) => (rulesData && rulesData.actionDefs && rulesData.actionDefs[key]) || {};

  if (!rulesData) {
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'AI 规则引擎'), h('span', { class: 'sub' }, 'NoAIBots')),
      h('div', { class: 'hint' }, '管理器没有返回规则配置接口，请确认 spt-manager 已更新到包含 lib/aiRules.js 的版本。'));
  }

  const cfg = JSON.parse(JSON.stringify(rulesData.config || rulesData.defaults || { rules: [] }));
  cfg.rules = (cfg.rules || []).map((r) => ({
    name: r.name || '',
    enabled: r.enabled !== false,
    description: r.description || '',
    match: { maps: [], botAmounts: [], ...(r.match || {}) },
    actions: { ...(r.actions || {}) },
  }));

  // 推荐规则集：按档位分条，互不重叠；后端没返回时退回旧的内置预设
  const presets = Array.isArray(rulesData.catalog) && rulesData.catalog.length
    ? rulesData.catalog.map((r) => ({ label: String(r.name).split(/[：:]/)[0].slice(0, 14), rule: r, description: r.description || '' }))
    : RULE_PRESETS;

  const listBox = h('div', { class: 'list' });
  const status = h('div', { class: 'hint' });

  const chip = (label, active, onClick, title) => {
    const b = h('button', { type: 'button', class: `tag${active ? ' accent' : ''}`, title: title || '', style: 'cursor:pointer;user-select:none' }, label);
    b.addEventListener('click', (e) => { e.preventDefault(); onClick(b); });
    return b;
  };

  const numField = (rule, key, label, step) => {
    const cur = rule.actions[key];
    const def = actionDef(key);
    const mapText = def.type === 'tuning' ? defaultText(rule, key) : null;
    const placeholder = mapText
      ? (mapText === '各图不同' ? '各图不同' : `原版 ${mapText}`)
      : (def.def !== undefined ? `默认 ${def.def}` : '不修改');
    return h('div', { class: 'field' },
      h('label', {}, label),
      h('input', {
        class: 'input', type: 'number', step: step || '0.1', placeholder,
        value: cur === undefined ? '' : String(cur),
        oninput: (e) => {
          const raw = String(e.target.value || '').trim();
          if (!raw) { delete rule.actions[key]; return; }
          const n = Number(raw);
          if (Number.isFinite(n)) rule.actions[key] = n;
        },
      }));
  };

  const boolSwitch = (label, get, set) => {
    const inp = h('input', { type: 'checkbox', checked: !!get() });
    inp.addEventListener('change', () => set(inp.checked));
    return h('label', { class: 'switch' }, inp, label);
  };

  // 三态开关：不修改 / 开 / 关（地图级参数需要能显式写 false）
  const triSelect = (rule, key, label) => {
    const cur = rule.actions[key];
    const mapText = defaultText(rule, key);
    const keepLabel = mapText ? `保持原版（${mapText}）` : '不修改';
    const sel = h('select', { class: 'input' },
      h('option', { value: '', selected: cur === undefined }, keepLabel),
      h('option', { value: 'true', selected: cur === true }, '开'),
      h('option', { value: 'false', selected: cur === false }, '关'));
    sel.addEventListener('change', () => {
      if (sel.value === '') delete rule.actions[key];
      else rule.actions[key] = sel.value === 'true';
    });
    return h('div', { class: 'field' }, h('label', {}, label), sel);
  };

  // ---- PMC 档案（全局）：阵营 / 等级区间 / 难度 / 血量 / 技能 / 每图覆盖
  const pmcInfo = (rulesData && rulesData.pmcInfo) || {};
  cfg.pmcProfile = cfg.pmcProfile || { enabled: false };
  const pmc = cfg.pmcProfile;
  pmc.skills = pmc.skills && typeof pmc.skills === 'object' ? pmc.skills : {};
  pmc.maps = pmc.maps && typeof pmc.maps === 'object' ? pmc.maps : {};

  const profStatus = h('div', { class: 'hint' });
  const pmcNum = (obj, key, label, placeholder, step) => h('div', { class: 'field' },
    h('label', {}, label),
    h('input', {
      class: 'input', type: 'number', step: step || '1', placeholder: placeholder || '',
      value: obj[key] === undefined || obj[key] === null ? '' : String(obj[key]),
      oninput: (e) => {
        const raw = String(e.target.value || '').trim();
        if (!raw) { delete obj[key]; return; }
        const n = Number(raw);
        if (Number.isFinite(n)) obj[key] = n;
      },
    }));

  const pmcEnabled = h('input', { type: 'checkbox', checked: !!pmc.enabled });
  pmcEnabled.addEventListener('change', () => { pmc.enabled = pmcEnabled.checked; });

  const difficultyOptions = [['', '原版（不动）'], ['easy', '简单 easy'], ['normal', '普通 normal'], ['hard', '困难 hard'], ['impossible', '不可能 impossible'], ['AsOnline', '跟随在线难度']];
  const diffSel = h('select', { class: 'input' },
    ...difficultyOptions.map(([v, t]) => h('option', { value: v, selected: (pmc.difficulty || '') === v }, t)));
  diffSel.addEventListener('change', () => { if (diffSel.value) pmc.difficulty = diffSel.value; else delete pmc.difficulty; });

  const modeSel = h('select', { class: 'input' },
    h('option', { value: 'relative', selected: (pmc.levelMode || 'relative') === 'relative' }, '相对玩家等级（推荐）'),
    h('option', { value: 'absolute', selected: pmc.levelMode === 'absolute' }, '固定等级区间'));
  modeSel.addEventListener('change', () => { pmc.levelMode = modeSel.value; });

  const skillGrid = h('div', { class: 'grid c4' },
    ...((rulesData && rulesData.commonSkills) || []).map((name) => h('div', { class: 'field' },
      h('label', {}, name),
      h('input', {
        class: 'input', type: 'number', min: '0', max: '50', step: '1', placeholder: '原版',
        value: pmc.skills[name] === undefined ? '' : String(pmc.skills[name]),
        oninput: (e) => {
          const raw = String(e.target.value || '').trim();
          const n = Number(raw);
          if (!raw || !Number.isFinite(n) || n <= 0) delete pmc.skills[name];
          else pmc.skills[name] = Math.min(50, Math.round(n));
        },
      }))));

  const pmcMapsBox = h('div', { style: 'margin-top:8px' });
  const mapNumField = (id, key, ph, step) => h('input', {
    class: 'input', type: 'number', step: step || '1', placeholder: ph, style: 'width:110px',
    value: pmc.maps[id][key] === undefined || pmc.maps[id][key] === null ? '' : String(pmc.maps[id][key]),
    oninput: (e) => {
      const raw = String(e.target.value || '').trim();
      const n = Number(raw);
      if (!raw || !Number.isFinite(n)) delete pmc.maps[id][key];
      else pmc.maps[id][key] = Math.round(n);
    },
  });
  const renderPmcMaps = () => {
    const rows = Object.entries(pmc.maps).map(([id, m]) => h('div', { class: 'row', style: 'gap:8px;margin-bottom:8px;align-items:center' },
      h('span', { class: 'tag accent', style: 'min-width:96px' }, MAP_CN[id] || id),
      mapNumField(id, 'levelMin', '等级下限'),
      mapNumField(id, 'levelMax', '等级上限'),
      mapNumField(id, 'usecPercent', 'USEC %'),
      h('button', { class: 'btn sm ghost', onclick: () => { delete pmc.maps[id]; renderPmcMaps(); } }, '删除')));
    pmcMapsBox.replaceChildren(
      ...(rows.length ? rows : [h('div', { class: 'hint' }, '没有按地图覆盖，全部用上面的全局设置。')]),
    );
  };
  renderPmcMaps();

  const savePmcBtn = h('button', {
    class: 'btn primary',
    onclick: async () => {
      savePmcBtn.disabled = true;
      try {
        await POST('/api/ai/rules/pmc', { pmcProfile: pmc });
        profStatus.textContent = `PMC 档案已保存 ${new Date().toLocaleTimeString()}`;
        toast('PMC 档案已保存', 'ok');
      } catch (e) {
        profStatus.textContent = `保存失败：${e.message || e}`;
        toast(`保存失败：${e.message || e}`, 'err');
      } finally {
        savePmcBtn.disabled = false;
      }
    },
  }, '保存 PMC 档案');

  const vanillaLevel = pmcInfo.locationSpecificPmcLevelOverride && Object.keys(pmcInfo.locationSpecificPmcLevelOverride).length
    ? `${Object.keys(pmcInfo.locationSpecificPmcLevelOverride).length} 张图`
    : '无';
  const faction = (() => {
    const big = pmcInfo.pmcType && pmcInfo.pmcType.pmcbear && pmcInfo.pmcType.pmcbear.bigmap;
    const usec = pmcInfo.pmcType && pmcInfo.pmcType.pmcusec && pmcInfo.pmcType.pmcusec.bigmap;
    if (!big || !usec) return '';
    const b = Number(big.pmcBEAR) || 0;
    const u = Number(usec.pmcUSEC) || 0;
    const total = b + u;
    return total ? `（海关原版：BEAR ${Math.round((b / total) * 100)}% / USEC ${Math.round((u / total) * 100)}%）` : '';
  })();

  const vanillaPmcDetails = (info) => {
    const bear = info.pmcType?.pmcbear || {};
    const usec = info.pmcType?.pmcusec || {};
    const factionRows = RAID_MAP_IDS.map((id) => {
      const b = Number(bear[id]?.pmcBEAR) || 0;
      const u = Number(usec[id]?.pmcUSEC) || 0;
      const total = b + u;
      return h('tr', {},
        h('td', {}, MAP_CN[id] || id),
        h('td', {}, total ? `${Math.round((b / total) * 100)}%` : '—'),
        h('td', {}, total ? `${Math.round((u / total) * 100)}%` : '—'));
    });
    const equip = Object.entries(info.types?.pmcUSEC?.equipment || {}).filter(([, v]) => Number(v) > 0);
    const normalDiff = Object.entries(info.types?.pmcUSEC?.difficultyValues?.normal || {})
      .map(([g, n]) => `${g} ${n}`);
    const hostilityRows = ['usec', 'bear'].map((side) => {
      const info2 = info.hostility?.[side] || {};
      const enemies = info2.enemies || [];
      return h('div', { class: 'hint', style: 'margin-top:6px' },
        `${side === 'usec' ? 'USEC' : 'BEAR'} 额外敌对：${enemies.slice(0, 14).join(' / ') || '—'}${enemies.length > 14 ? ` …（共 ${enemies.length}）` : ''}`);
    });
    return h('details', { class: 'rule-opts', style: 'margin-top:12px' },
      h('summary', { style: 'cursor:pointer;font-size:13px;font-weight:600;color:var(--text-dim)' },
        '原版数据参考（阵营权重 / 装备概率 / 生成类别 / 难度参数 / 敌对关系）'),
      h('div', { class: 'grid c2', style: 'margin-top:10px' },
        h('div', {},
          h('div', { class: 'hint', style: 'font-weight:600' }, '每图阵营权重（pmcType）'),
          h('table', { class: 'param-table', style: 'margin-top:6px' },
            h('thead', {}, h('tr', {}, h('th', {}, '地图'), h('th', {}, 'BEAR'), h('th', {}, 'USEC'))),
            h('tbody', {}, ...factionRows))),
        h('div', {},
          h('div', { class: 'hint', style: 'font-weight:600' }, '装备出现概率（pmcUSEC）'),
          h('div', { class: 'row wrap', style: 'gap:6px;margin-top:6px' },
            ...equip.map(([k, v]) => h('span', { class: 'tag' }, `${k} ${v}%`))),
          h('div', { class: 'hint', style: 'font-weight:600;margin-top:12px' }, '生成物品类别（generation.items）'),
          h('div', { class: 'row wrap', style: 'gap:6px;margin-top:6px' },
            ...(info.types?.pmcUSEC?.generation || []).map((k) => h('span', { class: 'tag' }, k))),
          h('div', { class: 'hint', style: 'font-weight:600;margin-top:12px' }, 'normal 难度参数组（项数）'),
          h('div', { class: 'hint' }, normalDiff.join(' · ') || '—'),
          h('div', { class: 'hint', style: 'font-weight:600;margin-top:12px' }, '敌对关系'),
          ...hostilityRows)));
  };

  const pmcCard = h('div', { class: 'card', style: 'margin-top:16px;background:#fbfcff' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'PMC 档案（全局）'),
      h('span', { class: 'sub' }, '阵营比例 · 等级区间 · 难度 · 血量 · 技能 · 每图覆盖')),
    h('div', { class: 'row' },
      h('label', { class: 'switch' }, pmcEnabled, '启用 PMC 档案'),
      h('div', { class: 'spacer' }),
      savePmcBtn),
    h('div', { class: 'grid c4', style: 'margin-top:10px' },
      pmcNum(pmc, 'usecPercent', `USEC 比例 %（原版 ${pmcInfo.isUsec ?? 50}）`, '', '1'),
      h('div', { class: 'field' }, h('label', {}, `难度（原版 ${pmcInfo.difficulty || 'AsOnline'}）`), diffSel),
      h('div', { class: 'field' }, h('label', {}, '等级模式'), modeSel),
      pmcNum(pmc, 'healthScale', '血量倍率（1 = 原版）', '1', '0.05')),
    h('div', { class: 'grid c4' },
      pmcNum(pmc, 'levelDeltaMin', `相对浮动下限（原版 ${pmcInfo.botRelativeLevelDelta?.min ?? '—'}）`, '-79', '1'),
      pmcNum(pmc, 'levelDeltaMax', `相对浮动上限（原版 ${pmcInfo.botRelativeLevelDelta?.max ?? '—'}）`, '79', '1'),
      pmcNum(pmc, 'levelMin', '固定等级下限（1~79）', '1', '1'),
      pmcNum(pmc, 'levelMax', '固定等级上限（1~79）', '79', '1')),
    h('div', { class: 'hint', style: 'margin-top:6px' },
      '相对模式 = 玩家等级 + 浮动（可为负）；固定区间 = 在区间里随机。技能填 0~50（对应 EFT 技能：Strength / Endurance / Vitality …），留空 = 原版。'),
    h('div', { class: 'hint', style: 'margin-top:10px;font-weight:600' }, '技能等级'),
    skillGrid,
    h('div', { class: 'row', style: 'margin-top:12px;justify-content:space-between;align-items:center' },
      h('div', { class: 'hint', style: 'font-weight:600' }, '按地图覆盖'),
      h('button', {
        class: 'btn sm ghost',
        onclick: () => {
          const id = RAID_MAP_IDS.find((x) => !pmc.maps[x]) || RAID_MAP_IDS[0];
          pmc.maps[id] = { levelMin: 1, levelMax: 30 };
          renderPmcMaps();
        },
      }, '+ 添加地图覆盖')),
    pmcMapsBox,
    profStatus,
    h('div', { class: 'hint', style: 'margin-top:10px' },
      `原版 pmc.json：USEC ${pmcInfo.isUsec ?? '—'}% · 难度 ${pmcInfo.difficulty || '—'}${pmcInfo.useDifficultyOverride ? '（覆盖已开）' : '（覆盖关闭）'} · 等级覆盖 ${vanillaLevel} · `
        + `相对等级浮动 ${pmcInfo.botRelativeLevelDelta?.min ?? '—'}~${pmcInfo.botRelativeLevelDelta?.max ?? '—'} ${faction}`),
    h('div', { class: 'hint' },
      `原版血量：${Object.entries(pmcInfo.types?.pmcUSEC?.health || {}).map(([k, v]) => `${k} ${v.min}`).join(' / ') || '—'}`),
    vanillaPmcDetails(pmcInfo));

  const advancedSection = (rule) => h('details', { style: 'margin-top:14px' },
    h('summary', { style: 'cursor:pointer;font-weight:600;font-size:13px;color:var(--text-dim)' },
      '高级：地图刷新参数（刷新间隔 / 激活距离 / 新旧刷新系统）',
      h('span', { class: 'sub', style: 'margin-left:8px' }, '灰字 = 该地图当前原版值，留空 = 保持原版')),
    h('div', { class: 'hint', style: 'margin-top:8px' },
      '这些值直接写进下发给客户端的该地图配置（LocationBase）；多条规则同时命中时，后面的覆盖前面的。'),
    h('div', { class: 'grid c4', style: 'margin-top:10px' },
      numField(rule, 'botSpawnPeriodCheck', '刷新检查间隔（秒）', '1'),
      numField(rule, 'botSpawnTimeOnMin', '刷新持续下限（秒）', '10'),
      numField(rule, 'botSpawnTimeOnMax', '刷新持续上限（秒）', '10'),
      numField(rule, 'botSpawnTimeOffMin', '停歇下限（秒）', '10'),
      numField(rule, 'botSpawnTimeOffMax', '停歇上限（秒）', '10'),
      numField(rule, 'botSpawnCountStep', '每次刷新数量步进', '1'),
      numField(rule, 'botStart', '开局开始刷（秒）', '10'),
      numField(rule, 'botStop', '开局停止刷（秒）', '60'),
      numField(rule, 'maxBotPerZone', '单区域同屏上限', '1'),
      numField(rule, 'botMax', '新系统存活上限（BotMax）', '1'),
      numField(rule, 'nonWaveSpawnBotsLimitPerPlayer', '非波次补刷/玩家上限', '1'),
      numField(rule, 'distToActivate', '激活距离（米）', '10'),
      numField(rule, 'distToSleep', '休眠距离（米）', '10'),
      numField(rule, 'waveSlotsMin', 'Scav 波人数下限覆盖', '1'),
      numField(rule, 'waveSlotsMax', 'Scav 波人数上限覆盖', '1')),
    h('div', { class: 'grid c3', style: 'margin-top:12px' },
      triSelect(rule, 'newSpawn', '新刷新系统'),
      triSelect(rule, 'oldSpawn', '旧刷新系统'),
      triSelect(rule, 'newSpawnForPlayers', '新系统跟随玩家')),
    h('div', { class: 'grid c3', style: 'margin-top:12px' },
      triSelect(rule, 'offlineNewSpawn', '离线局：新刷新系统'),
      triSelect(rule, 'offlineOldSpawn', '离线局：旧刷新系统')),
    h('div', { class: 'hint', style: 'margin-top:8px' },
      `提示：以海关原版为例，检查间隔 ${defaultMaps.bigmap?.botSpawnPeriodCheck ?? 15}s、激活 ${defaultMaps.bigmap?.distToActivate ?? 265}m、休眠 ${defaultMaps.bigmap?.distToSleep ?? 300}m、新系统存活上限 ${defaultMaps.bigmap?.botMax ?? 26}。压 scav 最有效的是「新系统存活上限（BotMax）」：设 10 就只补到 10 只；「单区域同屏上限」只作用于按区域的刷新路径，管不住成波补刷。`));

  // ---- 刷新时间轴：按「这张地图的原版数据 + 本规则」画出这局 AI 什么时候来、大概来多少
  const spawnMaps = (rulesData && rulesData.spawn && rulesData.spawn.maps) || {};
  const rulePrimaryMap = (rule) => {
    const picked = (rule.match.maps || []).filter((id) => spawnMaps[id]);
    return picked[0] || (spawnMaps.bigmap ? 'bigmap' : Object.keys(spawnMaps)[0] || null);
  };
  const mapVal = (rule, mapId, key) => (rule.actions[key] !== undefined ? rule.actions[key] : ((defaultMaps[mapId] || {})[key]));
  const fmtSec = (s) => {
    const sec = Math.max(0, Math.round(s));
    const m = Math.floor(sec / 60);
    const r = sec % 60;
    return m ? `${m}分${r ? `${r}秒` : ''}` : `${r}秒`;
  };

  function ruleTimeline(rule) {
    const mapId = rulePrimaryMap(rule);
    const data = mapId && spawnMaps[mapId];
    if (!data) return null;
    const d = data.defaults || {};
    const num = (key, fallback) => {
      const v = mapVal(rule, mapId, key);
      return Number.isFinite(v) ? v : fallback;
    };
    const bool = (key, fallback) => {
      const v = mapVal(rule, mapId, key);
      return typeof v === 'boolean' ? v : fallback;
    };

    // 客户端会把这个间隔夹到 ≥10 秒（NonWavesSpawnScenario.Update 里的 ldc.r4 10）
    const period = Math.max(10, num('botSpawnPeriodCheck', d.botSpawnPeriodCheck || 15));
    const onMin = Math.max(0, num('botSpawnTimeOnMin', d.botSpawnTimeOnMin || 0));
    const onMax = Math.max(onMin, num('botSpawnTimeOnMax', d.botSpawnTimeOnMax || onMin));
    const offMin = Math.max(0, num('botSpawnTimeOffMin', d.botSpawnTimeOffMin || 0));
    const offMax = Math.max(offMin, num('botSpawnTimeOffMax', d.botSpawnTimeOffMax || offMin));
    const start = Math.max(0, num('botStart', d.botStart || 0));
    const stop = Math.max(start, num('botStop', d.botStop || 1500));
    const step = Math.max(1, num('botSpawnCountStep', d.botSpawnCountStep || 4));
    const perZone = num('maxBotPerZone', d.maxBotPerZone || 0);
    const botMaxRaw = num('botMax', d.botMax || 0);
    const botMax = Number.isFinite(botMaxRaw) && botMaxRaw > 0 ? botMaxRaw : (d.botMax || 0);
    const capBase = data.cap;
    const capScale = rule.actions.botCapScale !== undefined ? Number(rule.actions.botCapScale) : 1;
    const cap = Number.isFinite(capBase) && Number.isFinite(capScale) ? Math.round(capBase * capScale) : capBase;
    const capText = capScale === 1 ? `${cap}` : `${capBase} → ${cap}（×${capScale}）`;
    const newOn = bool('newSpawn', d.newSpawn !== false) && bool('offlineNewSpawn', d.offlineNewSpawn !== false);
    const oldOn = bool('oldSpawn', d.oldSpawn !== false) && bool('offlineOldSpawn', d.offlineOldSpawn !== false);

    const pmcTimes = (data.pmc || []).map((p) => p.time).filter((t) => t > 0);
    const bossTimes = (data.bosses || []).map((b) => b.time).filter((t) => t > 0);
    const horizon = Math.max(1800, stop, ...pmcTimes, ...bossTimes, 60);
    const pct = (t) => `${Math.max(0, Math.min(100, (t / horizon) * 100))}%`;
    const widthPct = (a, b) => `${Math.max(0.4, ((Math.min(horizon, b) - Math.min(horizon, a)) / horizon) * 100)}%`;
    const track = (label, children, note) => h('div', { class: 'tl-row' },
      h('span', { class: 'tl-label', title: note || '' }, label),
      h('div', { class: 'tl-track' }, ...children));

    // 旧系统：SPT 4.0 的 waves 全是 time=-1，会在开局瞬间一次性全部触发
    const waves = data.waves || [];
    const minSum = waves.reduce((s, w) => s + (w.min || 0), 0);
    const maxSum = waves.reduce((s, w) => s + (w.max || 0), 0);
    const immediate = waves.filter((w) => w.tMin < 0 && w.tMax < 0);
    const timed = waves.filter((w) => !(w.tMin < 0 && w.tMax < 0));
    const oldNodes = [];
    if (!oldOn) {
      oldNodes.push(h('span', { class: 'tl-note' }, '旧系统已关闭：这局不会走 waves 波次表'));
    } else if (rule.actions.clearScavWaves) {
      oldNodes.push(h('span', { class: 'tl-note' }, '规则已清空 Scav 波次：这局没有 waves'));
    } else {
      if (immediate.length) {
        oldNodes.push(h('div', {
          class: 'tl-span tl-old tl-imm' + (cap === 0 ? ' tl-off' : ''),
          style: `left:0%;width:${Math.max(9, widthPct(0, horizon * 0.03))}%`,
          title: `开局立即触发 ${immediate.length} 条 wave（每波 ${Math.min(...immediate.map((w) => w.min))}~${Math.max(...immediate.map((w) => w.max))} 只）`,
        }, `开局整波 ×${immediate.length}`));
      }
      for (const w of timed) {
        const t0 = Math.min(w.tMin, w.tMax);
        const t1 = Math.max(w.tMin, w.tMax);
        oldNodes.push(h('div', {
          class: 'tl-span tl-old', style: `left:${pct(t0)};width:${widthPct(t0, t1 || t0 + 5)}`,
          title: `${fmtSec(t0)} ~ ${fmtSec(t1)} · ${w.type} ${w.min}~${w.max} 只`,
        }, `${w.min}~${w.max}`));
      }
      oldNodes.push(h('span', { class: 'tl-note' }, `${waves.length} 条 wave · 合计 ${minSum}~${maxSum} 只`));
    }

    // 新系统：周期性「刷怪窗口」，窗口内每 period 秒检查一次；每次检查的名额 = BotMax − 当前存活
    // （BotSpawnCountStep 不是每次数量，只在「已满员」后决定要剩几个名额才恢复刷）
    const newNodes = [];
    let winCount = 0;
    let checksPerWin = 0;
    if (!newOn) {
      newNodes.push(h('span', { class: 'tl-note' }, '新系统已关闭：只有旧系统的 waves 会刷人'));
    } else {
      const onAvg = Math.max(1, (onMin + onMax) / 2);
      const offAvg = Math.max(0, (offMin + offMax) / 2);
      checksPerWin = Math.max(1, Math.floor(onAvg / period));
      let t = start;
      while (t < stop && winCount < 80) {
        const end = Math.min(stop, t + onAvg);
        newNodes.push(h('div', {
          class: 'tl-span tl-new' + (cap === 0 ? ' tl-off' : ''), style: `left:${pct(t)};width:${widthPct(t, end)}`,
          title: `刷怪窗口 ${fmtSec(t)} ~ ${fmtSec(end)} · 每 ${period}s 检查一次 · 每次按「BotMax − 当前存活」补人`,
        }));
        winCount++;
        const next = end + offAvg;
        t = next > end ? next : end + 1;
      }
      if (!winCount) {
        newNodes.push(h('span', { class: 'tl-note' },
          `没有刷怪窗口：BotStart ${fmtSec(start)} ≥ BotStop ${fmtSec(stop)}（或停歇时间把窗口全挤掉了）`));
      } else {
        newNodes.push(h('span', { class: 'tl-note' },
          `${winCount} 个窗口 · 每窗口最多 ${checksPerWin} 次检查 · 每次补到 BotMax ${botMax || '?'}（不是固定 +${step}）`
          + `${perZone ? ` · 单区域上限 ${perZone}` : ''}${capBase !== undefined ? ` · 同屏上限 ${capText}` : ''}`));
      }
    }

    // 首领 / PMC：BossLocationSpawn 档位（PMC 来自 pmc.json 注入）
    const marks = [];
    const legend = [];
    const cleared = rule.actions.clearBossSpawns || rule.actions.removePmcWaves && rule.actions.removeBossWaves;
    if (!cleared) {
      const pmcScale = rule.actions.pmcWaveChanceScale !== undefined ? Number(rule.actions.pmcWaveChanceScale) : 1;
      const bossScale = rule.actions.bossChanceScale !== undefined ? Number(rule.actions.bossChanceScale) : 1;
      const delay = Number(rule.actions.delaySpawnsSeconds || 0);
      const late = (t) => (Number.isFinite(delay) && delay ? t + delay : t);
      const sched = Array.isArray(rule.actions.pmcSchedule) ? rule.actions.pmcSchedule : null;
      const pmcRows = sched ? sched.filter((s) => !s.boss && !s.Boss) : null;
      const bossRows = sched ? sched.filter((s) => s.boss || s.Boss) : [];
      const pmcSource = pmcRows && pmcRows.length
        ? pmcRows.map((s) => ({ time: Number(s.time) || 0, chance: Number(s.chance) || 0, escortMax: Number(s.escort) || 0 }))
        : (data.pmc || []);
      const pmcBy = new Map();
      for (const p of pmcSource) {
        const t = p.time >= 0 ? late(p.time) : 0;
        const cur = pmcBy.get(t) || { t, n: 0, chance: 0, escort: 0 };
        cur.n += 1;
        cur.chance = Math.max(cur.chance, p.chance || 0);
        cur.escort = Math.max(cur.escort, p.escortMax || 0);
        pmcBy.set(t, cur);
      }
      for (const g of [...pmcBy.values()].sort((a, b) => a.t - b.t)) {
        // 自定义时间表里的概率就是最终值（mod 在概率缩放之后套用）
        const chance = Math.round(g.chance * (pmcRows && pmcRows.length ? 1 : (Number.isFinite(pmcScale) ? pmcScale : 1)));
        if (!chance) continue;
        marks.push(h('div', {
          class: 'tl-mark tl-pmc', style: `left:${pct(g.t)}`,
          title: `${fmtSec(g.t)} · PMC ${g.n} 条点位 · 最高 ${chance}% · 每队最多 ${g.escort} 人${delay ? `（已整体延迟 ${fmtSec(delay)}）` : ''}`,
        }));
        legend.push(h('span', { class: 'tl-lg tl-lg-pmc' }, pmcRows && pmcRows.length
          ? `${fmtSec(g.t)} PMC ${chance}% ×${g.escort} 人（自定义）`
          : `${fmtSec(g.t)} PMC ${chance}%`));
      }
      const bossSeen = new Map();
      const schedBossNames = new Set(bossRows.map((s) => String(s.boss || s.Boss || '').trim().toLowerCase()));
      const bossItems = [];
      for (const b of data.bosses || []) {
        // 自定义时间表里点名过的首领：用自定义档位替代原版条目
        if (schedBossNames.has(String(b.name || '').toLowerCase())) continue;
        bossItems.push({ name: b.name, time: b.time, chance: b.chance, custom: false });
      }
      const mapBossNames = new Set((data.bosses || []).map((b) => String(b.name || '').toLowerCase()));
      for (const row of bossRows) {
        const name = String(row.boss || row.Boss || '').trim();
        const exists = mapBossNames.has(name.toLowerCase());
        bossItems.push({ name, time: Math.max(0, Number(row.time) || 0), chance: Number(row.chance) || 0, custom: true, exists });
      }
      for (const b of bossItems) {
        const raw = b.time >= 0 ? b.time : 0;
        const t = b.time >= 0 ? late(b.time) : 0;
        const chance = b.custom ? Math.round(b.chance || 0) : Math.round((b.chance || 0) * (Number.isFinite(bossScale) ? bossScale : 1));
        if (!chance) continue;
        const key = `${b.name}@${t}`;
        if (bossSeen.has(key)) continue;
        bossSeen.set(key, true);
        const missing = b.custom && b.exists === false;
        marks.push(h('div', {
          class: 'tl-mark tl-boss' + (missing ? ' tl-bad' : ''), style: `left:${pct(t)}`,
          title: missing
            ? `${fmtSec(t)} · ${b.name} ${chance}%（自定义）—— 这张图原版没有 ${b.name}，mod 会跳过这一行`
            : `${fmtSec(t)} · ${b.name} ${chance}%${b.custom ? '（自定义）' : raw <= 0 ? '（随机时间）' : ''}`,
        }));
        const label = `${String(b.name).replace(/^boss/i, '首领')} ${chance}%${b.custom ? '（自定义）' : ''}`;
        legend.push(h('span', { class: `tl-lg ${b.custom ? 'tl-lg-boss' : 'tl-lg-boss'}` + (missing ? ' tl-bad' : '') },
          missing ? `${label} ⚠ 该图没有` : label));
      }
    }
    if (!marks.length) {
      marks.push(h('span', { class: 'tl-note' }, cleared ? '规则已清空首领/PMC 刷新点' : '这张图没有首领/PMC 档位'));
    }

    return h('div', { class: 'tl' },
      h('div', { class: 'tl-head' },
        h('span', { class: 'tag accent' }, `按「${mapName(mapId)}」原版数据 + 本规则`),
        h('span', { class: 'sub' }, `0 ~ ${fmtSec(horizon)}`)),
      track(`旧系统 ${oldOn ? '开' : '关'}`, oldNodes, '旧刷新系统：地图 waves 波次表（整波投放）'),
      track(`新系统 ${newOn ? '开' : '关'}`, newNodes, '新刷新系统：周期检查 + 刷怪窗口'),
      track('首领/PMC', marks, '首领与 PMC 由 BossLocationSpawn 投放，PMC 数据来自 pmc.json'),
      legend.length ? h('div', { class: 'tl-legend' }, ...legend) : null,
      h('div', { class: 'tl-axis' },
        ...[0, 0.25, 0.5, 0.75, 1].map((f) => h('span', { style: `left:${f * 100}%` }, fmtSec(Math.round(horizon * f))))));
  }

  /** 一句话摘要：先写匹配范围，再把动作翻成人话（改动后随卡片重建） */
  const ruleBadges = (rule) => {    const out = [];
    const mapsTxt = (rule.match.maps || []).length ? rule.match.maps.map(mapName).join('、') : '全部地图';
    const amtTxt = (rule.match.botAmounts || []).length ? rule.match.botAmounts.map((x) => AMOUNT_CN[x] || x).join('、') : '全部档位';
    out.push(h('span', { class: 'tag accent' }, `${mapsTxt} · ${amtTxt}`));
    if (rule.match.clientBossesDisabled) out.push(h('span', { class: 'tag warn' }, '客户端关首领时'));
    const a = rule.actions || {};
    const tag = (text, kind) => h('span', { class: `tag${kind ? ' ' + kind : ''}` }, text);
    if (a.clearScavWaves) out.push(tag('清空 scav 波'));
    if (a.clearBossSpawns) out.push(tag('清空全部刷新点'));
    if (a.removePmcWaves) out.push(tag('删 PMC 波'));
    if (a.removeBossWaves) out.push(tag('删首领波'));
    if ((a.removeBotNames || []).length) out.push(tag(`删 ${a.removeBotNames.join('/')}`));
    if (a.botCapScale !== undefined) out.push(tag(`同屏上限 ×${a.botCapScale}`));
    if (a.scavWaveCountScale !== undefined) out.push(tag(`scav 人数 ×${a.scavWaveCountScale}`));
    if (a.scavWaveCountDelta !== undefined) out.push(tag(`scav 人数 ${a.scavWaveCountDelta >= 0 ? '+' : ''}${a.scavWaveCountDelta}`));
    if (a.pmcWaveChanceScale !== undefined) out.push(tag(`PMC 概率 ×${a.pmcWaveChanceScale}`));
    if (a.bossChanceScale !== undefined) out.push(tag(`首领概率 ×${a.bossChanceScale}`));
    if (a.maxPmcWaves !== undefined) out.push(tag(`PMC 波 ≤${a.maxPmcWaves}`));
    if (a.maxBossSpawns !== undefined) out.push(tag(`首领点 ≤${a.maxBossSpawns}`));
    if (a.delaySpawnsSeconds !== undefined) out.push(tag(`延迟 ${a.delaySpawnsSeconds}s`));
    if (a.pmcSchedule !== undefined) out.push(tag(`自定义档位 ${(a.pmcSchedule || []).length} 条`));
    if (a.oldSpawn === false) out.push(tag('关旧系统', 'warn'));
    if (a.newSpawn === false) out.push(tag('关新系统', 'warn'));
    if (a.botStop !== undefined) out.push(tag(`停止刷 ${a.botStop}s`, 'warn'));
    const defs = (rulesData && rulesData.actionDefs) || {};
    const tuning = Object.keys(defs).filter((k) => (defs[k].type === 'tuning' || defs[k].type === 'tuningBool') && a[k] !== undefined);
    if (tuning.length) out.push(tag(`地图参数 ${tuning.length} 项`));
    if (out.length === 1) out.push(tag('不改任何参数', 'ok'));
    return out;
  };

  // 记住每条规则的「详细选项」是展开还是收起（refreshList 会整体重建卡片）
  const openRules = new Set();

  function ruleCard(rule, index) {
    // 名称 / 启用 / 删除
    const nameInput = h('input', {
      class: 'input', value: rule.name, placeholder: `规则 ${index + 1}`, style: 'width:300px',
      oninput: (e) => { rule.name = e.target.value; },
    });
    const enabledSwitch = boolSwitch('启用', () => rule.enabled, (v) => { rule.enabled = v; });

    // 地图 chips
    const mapsRow = h('div', { class: 'row' });
    const renderMaps = () => {
      mapsRow.replaceChildren(
        chip('全部', (rule.match.maps || []).length === 0, () => { rule.match.maps = []; refreshList(); }, '留空 = 全部地图'),
        ...maps.map((m) => chip(m.name, (rule.match.maps || []).includes(m.id), () => {
          const set = new Set(rule.match.maps || []);
          if (set.has(m.id)) set.delete(m.id); else set.add(m.id);
          rule.match.maps = [...set];
          refreshList();
        }, m.id)),
      );
    };
    renderMaps();

    // 档位 chips
    const amountsRow = h('div', { class: 'row' });
    const renderAmounts = () => {
      amountsRow.replaceChildren(
        chip('全部档位', (rule.match.botAmounts || []).length === 0, () => { rule.match.botAmounts = []; renderAmounts(); }),
        ...AMOUNT_ORDER.map((a) => chip(AMOUNT_CN[a], (rule.match.botAmounts || []).includes(a), () => {
          const set = new Set(rule.match.botAmounts || []);
          if (set.has(a)) set.delete(a); else set.add(a);
          rule.match.botAmounts = [...set];
          renderAmounts();
        }, a)),
      );
    };
    renderAmounts();

    const bossesOnly = boolSwitch('仅当客户端关闭“首领”时', () => rule.match.clientBossesDisabled === true, (v) => {
      if (v) rule.match.clientBossesDisabled = true; else delete rule.match.clientBossesDisabled;
    });

    const removeBool = (key, label) => {
      const inp = h('input', { type: 'checkbox', checked: !!rule.actions[key] });
      inp.addEventListener('change', () => { if (inp.checked) rule.actions[key] = true; else delete rule.actions[key]; });
      return h('label', { class: 'switch' }, inp, label);
    };

    const namesInput = h('input', {
      class: 'input', placeholder: '例如 pmcBot, exUsec, gifter（逗号分隔）',
      value: (rule.actions.removeBotNames || []).join(', '),
      oninput: (e) => {
        const list = String(e.target.value || '').split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
        if (list.length) rule.actions.removeBotNames = list; else delete rule.actions.removeBotNames;
      },
    });

    // 摘要标签与时间轴：任何输入都实时重算（不用等保存）
    const badgesSlot = h('div', { class: 'row', style: 'margin-top:8px' });
    const tlSlot = h('div', {});
    const refreshDerived = () => {
      badgesSlot.replaceChildren(...ruleBadges(rule));
      const tl = ruleTimeline(rule);
      tlSlot.replaceChildren(...(tl ? [tl] : []));
    };

    // 自定义刷新时间表：PMC 行替换原版 PMC 档位，首领行替换该首领原有刷新点；留空 = 保持原版
    const pmcRowsBox = h('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    const mapBossOptions = () => {
      const picked = (rule.match.maps || []).length ? rule.match.maps : Object.keys(rulesData.spawn?.maps || {});
      const seen = new Map();
      for (const id of picked) {
        const map = rulesData.spawn?.maps?.[id];
        for (const boss of map?.bosses || []) {
          const name = String(boss?.name || '').trim();
          if (!name || seen.has(name)) continue;
          seen.set(name, mapName(id));
        }
      }
      return [...seen.entries()]
        .map(([name, label]) => ({ name, label }))
        .sort((a, b) => a.name.localeCompare(b.name));
    };
    const pmcNum = (row, key, min, max, width) => h('input', {
      class: 'input', type: 'number', min: String(min), max: String(max),
      value: String(row[key] ?? (key === 'time' ? 30 : key === 'chance' ? 100 : 2)),
      style: `width:${width}px`, oninput: (e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v)) row[key] = Math.max(min, Math.min(max, Math.round(v)));
      },
    });
    const renderPmcRows = () => {
      const list = Array.isArray(rule.actions.pmcSchedule) ? rule.actions.pmcSchedule : [];
      if (!list.length) {
        pmcRowsBox.replaceChildren(h('div', { class: 'hint' }, '没有自定义档位：PMC 和首领仍按原版时间表进场。'));
        return;
      }
      pmcRowsBox.replaceChildren(...list.map((row, i) => {
        const isBoss = !!(row.boss && String(row.boss).trim());
        const bossOpts = mapBossOptions();
        const typeSel = h('select', {
          class: 'select', style: 'width:82px',
          onchange: (e) => {
            if (e.target.value === 'boss') {
              if (!row.boss) row.boss = bossOpts[0]?.name || 'bossBully';
              if (!bossOpts.length) toast(`「${mapName(rulePrimaryMap(rule))}」这张图原版没有首领刷新点，这一行不会生效`, 'warn');
            } else {
              delete row.boss;
              delete row.zone;
            }
            renderPmcRows();
            refreshDerived();
          },
        }, h('option', { value: 'pmc' }, 'PMC'), h('option', { value: 'boss' }, '首领'));
        typeSel.value = isBoss ? 'boss' : 'pmc';
        const currentBoss = String(row.boss || '').trim();
        const knownBoss = bossOpts.some((o) => o.name === currentBoss);
        // 首领下拉 = 当前匹配地图的原版首领（换地图后 refreshList 重建卡片，选项自动跟着变）
        const bossSelect = h('select', {
          class: 'select', style: 'width:190px',
          title: '只列当前匹配地图原版就有的首领；不在列表里的名字说明这张图没有它，mod 会跳过这一行',
          onchange: (e) => {
            if (e.target.value) row.boss = e.target.value; else delete row.boss;
            refreshDerived();
          },
        },
          ...(currentBoss && !knownBoss ? [h('option', { value: currentBoss }, `${currentBoss} ⚠ 该图没有`)] : []),
          ...(bossOpts.length ? [] : [h('option', { value: currentBoss || '' }, currentBoss ? `${currentBoss} ⚠ 该图没有` : '该图没有首领')]),
          ...bossOpts.map((o) => h('option', { value: o.name }, `${o.name}（${o.label}）`)));
        bossSelect.value = currentBoss || (bossOpts[0]?.name || '');
        if (isBoss && !currentBoss && bossOpts.length) row.boss = bossOpts[0].name;
        const zoneInput = h('input', {
          class: 'input', value: String(row.zone || ''), placeholder: '区域，可留空',
          style: 'width:118px', oninput: (e) => {
            const v = e.target.value.trim();
            if (v) row.zone = v; else delete row.zone;
          },
        });
        return h('div', { class: 'row', style: 'gap:6px;align-items:center' },
          h('span', { class: 'sub', style: 'width:28px' }, `#${i + 1}`),
          typeSel,
          isBoss ? bossSelect : null,
          pmcNum(row, 'time', 0, 86400, 92),
          h('span', { class: 'sub' }, '秒'),
          pmcNum(row, 'chance', 0, 100, 74),
          h('span', { class: 'sub' }, '%'),
          pmcNum(row, 'escort', 1, 30, 64),
          h('span', { class: 'sub', title: '填 1 = 只有队长（首领）本人，没有随从；填 3 = 队长 + 2 个随从' }, '人/队(含队长)'),
          isBoss ? zoneInput : null,
          h('button', {
            class: 'btn sm danger', onclick: () => {
              rule.actions.pmcSchedule = list.filter((x) => x !== row);
              if (!rule.actions.pmcSchedule.length) delete rule.actions.pmcSchedule;
              renderPmcRows();
              refreshDerived();
            },
          }, '删除'));
      }));
    };
    renderPmcRows();

    const saveThisBtn = h('button', {
      class: 'btn sm primary', onclick: async (e) => {
        e.target.disabled = true;
        try {
          const saved = await POST('/api/ai/rules/rule', { index, total: cfg.rules.length, rule: JSON.parse(JSON.stringify(rule)) });
          if (saved && saved.config && Array.isArray(saved.config.rules)) {
            const savedRule = saved.rule || (saved.appended ? saved.config.rules[saved.config.rules.length - 1] : saved.config.rules[index]);
            if (savedRule) {
              // 追加保存时本地列表里已经有这条（只是还没落盘），按返回的序号覆盖而不是 push，避免出现重复卡片
              if (Number.isInteger(saved.index) && saved.index >= 0 && saved.index < cfg.rules.length) {
                cfg.rules[saved.index] = savedRule;
              } else {
                cfg.rules.push(savedRule);
              }
            }
          }
          const label = saved && saved.appended ? `规则 ${(saved.index ?? cfg.rules.length - 1) + 1} 已追加保存` : `规则 ${index + 1} 已单独保存`;
          status.textContent = `${label} ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · 下一局开战自动生效`;
          toast(saved && saved.appended ? '新规则已追加保存' : '规则已保存（其他规则未改动）', 'ok');
          if (saved && saved.appended) refreshList();
          try { const fresh = await GET('/api/ai/rules'); fillBackups(fresh.backups); } catch { /* 忽略 */ }
        } catch (err) { toast(String(err.message || err), 'err'); }
        finally { e.target.disabled = false; }
      },
    }, '保存这条');

    const card = h('div', { class: 'card', style: 'background:#fbfcff' },
      h('div', { class: 'card-head' },
        h('div', { class: 'row' }, h('span', { class: 'tag' }, `规则 ${index + 1}`), nameInput),
        h('div', { class: 'row' }, enabledSwitch, saveThisBtn,
          h('button', {
            class: 'btn sm danger', onclick: () => { cfg.rules.splice(index, 1); refreshList(); },
          }, '删除'))),
      badgesSlot,
      h('input', {
        class: 'input', value: rule.description || '', placeholder: '一句话说明这条规则（可选，仅用于界面显示）',
        style: 'width:100%;margin-top:8px',
        oninput: (e) => { rule.description = e.target.value; },
      }),
      tlSlot,
      h('details', {
        class: 'rule-opts',
        open: openRules.has(index) || undefined,
        ontoggle: (e) => {
          if (e.target.open) openRules.add(index); else openRules.delete(index);
        },
      },
        h('summary', {}, '详细选项：匹配地图 · 战局档位 · 动作开关 · 数值 · 高级地图参数'),
        h('div', { class: 'grid c2' },
          h('div', { class: 'field' }, h('label', {}, '匹配地图（留空 = 全部）'), mapsRow,
            h('div', { class: 'hint' }, '只对勾选的地图生效；例如选“实验室”后其他图不受影响')),
          h('div', { class: 'field' }, h('label', {}, '匹配战局档位'), amountsRow,
            h('div', { class: 'hint' }, '即开战前“AI 数量”下拉框的选项；无AI = NoBots'))),
        h('div', { style: 'margin-top:12px' }, bossesOnly),
        h('div', { class: 'grid c4', style: 'margin-top:14px' },
          removeBool('clearScavWaves', '清空普通 Scav 波次'),
          removeBool('clearBossSpawns', '清空全部刷新点'),
          removeBool('removePmcWaves', '只删 PMC 波次'),
          removeBool('removeBossWaves', '只删首领波次')),
        h('div', { class: 'grid c4', style: 'margin-top:12px' },
          numField(rule, 'scavWaveCountScale', 'Scav 波人数倍率'),
          numField(rule, 'scavWaveCountDelta', 'Scav 波人数增减', '1'),
          numField(rule, 'pmcWaveChanceScale', 'PMC 波概率倍率'),
          numField(rule, 'bossChanceScale', '首领概率倍率'),
          numField(rule, 'maxPmcWaves', 'PMC 波次上限', '1'),
          numField(rule, 'maxBossSpawns', '首领刷新点上限', '1'),
          numField(rule, 'delaySpawnsSeconds', '开局延迟刷怪（秒）', '10'),
          numField(rule, 'botCapScale', '同屏 AI 上限倍率')),
        h('div', { class: 'field', style: 'margin-top:12px' }, h('label', {}, '按类型删除（WildSpawnType）'), namesInput,
          h('div', { class: 'hint' }, '常用值：pmcUSEC / pmcBEAR / pmcBot / exUsec / gifter / bossKnight（可留空）')),
        h('div', { class: 'field', style: 'margin-top:14px' },
          h('label', {}, '自定义刷新时间表（PMC / 首领；留空 = 跟随原版时间表）'),
          pmcRowsBox,
          h('div', { class: 'row', style: 'margin-top:6px' },
            h('button', {
              class: 'btn sm', onclick: () => {
                const list = Array.isArray(rule.actions.pmcSchedule) ? rule.actions.pmcSchedule : (rule.actions.pmcSchedule = []);
                list.push({ time: 30 + list.length * 300, chance: 100, escort: 1 });
                renderPmcRows();
                refreshDerived();
              },
            }, '+ 添加 PMC 档位'),
            h('button', {
              class: 'btn sm', onclick: () => {
                const opts = mapBossOptions();
                if (!opts.length) {
                  toast(`「${mapName(rulePrimaryMap(rule))}」这张图原版没有首领刷新点，加不了首领行`, 'warn');
                  return;
                }
                const list = Array.isArray(rule.actions.pmcSchedule) ? rule.actions.pmcSchedule : (rule.actions.pmcSchedule = []);
                list.push({ boss: opts[0].name, time: 300 + list.length * 300, chance: 100, escort: 1 });
                renderPmcRows();
                refreshDerived();
              },
            }, '+ 添加首领档位'),
            h('span', { class: 'hint' }, '时间单位秒；PMC 行替换原版 PMC 档位，首领行替换该首领原有刷新点（最多 24 行）；首领下拉只列当前匹配地图原版有的首领；「人/队」含队长：填 1 = 只有首领本人、没有随从，填 3 = 首领 + 2 个随从（随从类型取该图原版模板，如 followerBully）'))),
        advancedSection(rule),
      ),
    );
    card.addEventListener('input', refreshDerived);
    card.addEventListener('change', refreshDerived);
    refreshDerived();
    return card;
  }

  const refreshList = () => listBox.replaceChildren(...cfg.rules.map((r, i) => ruleCard(r, i)));

  const saveBtn = h('button', {
    class: 'btn primary', onclick: async (e) => {
      e.target.disabled = true;
      try {
        await POST('/api/ai/rules', { config: cfg });
        status.textContent = `已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })} · 下一局开战自动生效（服务端无需重启）`;
        toast('AI 规则已保存，旧配置已备份', 'ok');
        try { const fresh = await GET('/api/ai/rules'); fillBackups(fresh.backups); } catch { /* 忽略 */ }
      } catch (err) { toast(String(err.message || err), 'err'); }
      finally { e.target.disabled = false; }
    },
  }, '保存规则');

  const resetBtn = h('button', {
    class: 'btn sm', onclick: () => {
      if (!confirm('载入默认规则？当前未保存的修改会丢失')) return;
      const d = JSON.parse(JSON.stringify(rulesData.defaults || { rules: [] }));
      Object.keys(cfg).forEach((k) => delete cfg[k]);
      Object.assign(cfg, d);
      cfg.rules = (cfg.rules || []).map((r) => ({ enabled: true, ...r, description: r.description || '', match: { ...(r.match || {}) }, actions: { ...(r.actions || {}) } }));
      refreshList();
      toast('已载入默认规则（点“保存规则”后生效）', 'warn');
    },
  }, '载入默认');

  // 用推荐规则集整体替换（按档位分条，互不重叠）；只改编辑器，点保存才写文件
  const catalogBtn = h('button', {
    class: 'btn sm', onclick: () => {
      if (!confirm('用推荐规则集替换当前全部规则？当前未保存的修改会丢失，点“保存规则”后才生效。')) return;
      const src = (Array.isArray(rulesData.catalog) && rulesData.catalog.length) ? rulesData.catalog : ((rulesData.defaults && rulesData.defaults.rules) || []);
      cfg.rules = JSON.parse(JSON.stringify(src)).map((r) => ({ enabled: true, ...r, description: r.description || '', match: { ...(r.match || {}) }, actions: { ...(r.actions || {}) } }));
      refreshList();
      toast('已载入推荐规则集（点“保存规则”后生效）', 'ok');
    },
  }, '载入推荐规则');

  // ---- 预演
  const testMap = h('select', { class: 'input' }, ...maps.map((m) => h('option', { value: m.id }, `${m.name}（${m.id}）`)));
  const testAmount = h('select', { class: 'input' }, ...AMOUNT_ORDER.map((a) => h('option', { value: a, selected: a === 'NoBots' }, `${AMOUNT_CN[a]}（${a}）`)));
  const testBosses = h('input', { type: 'checkbox' });
  const testOut = h('div', { style: 'display:none;margin-top:14px' });

  const renderPreview = (r) => {
    const c = r.counts || {};
    const line = (k, v) => h('tr', {}, h('td', { style: 'color:var(--text-faint)' }, k), h('td', { style: 'font-weight:600' }, String(v)));
    const matched = (r.matched || []).length
      ? h('div', {}, h('div', { class: 'hint', style: 'margin-bottom:4px' }, '命中规则'), ...r.matched.map((n) => h('div', {}, `· ${n}`)))
      : h('div', { class: 'hint' }, '没有任何规则命中，这局与原版一致');
    return [
      h('div', { class: 'row', style: 'margin-bottom:8px' },
        h('span', { class: `tag ${r.allGone ? 'ok' : 'warn'}` }, r.allGone ? '这局完全无 AI' : '这局仍有 AI'),
        h('span', { class: 'sub' }, `地图 ${r.scenario.map} · 档位 ${AMOUNT_CN[r.scenario.botAmount] || r.scenario.botAmount} · 首领开关 ${r.scenario.bossesDisabled ? '关' : '开'}`)),
      h('div', { class: 'table-wrap' }, h('table', {}, h('tbody', {},
        line('普通 Scav 波次', `${c.totalWaves ?? '—'} → ${c.wavesAfter ?? '—'}`),
        line('首领/PMC 刷新点', `${c.totalSpawns ?? '—'} → ${c.spawnsAfter ?? '—'}`),
        line('其中 PMC / 首领', `${c.pmcSpawns ?? '—'} / ${c.bossSpawns ?? '—'}`),
        line('同屏 AI 上限', r.capBefore === null ? '—' : `${r.capBefore} → ${r.capAfter}（×${r.botCapScale}）`),
      ))),
      h('div', { style: 'margin-top:10px' }, ...(r.notes || []).map((n) => h('div', { class: 'hint' }, `· ${n}`))),
      h('div', { style: 'margin-top:10px' }, matched),
    ];
  };

  const testBtn = h('button', {
    class: 'btn', onclick: async (e) => {
      e.target.disabled = true;
      try {
        const r = await POST('/api/ai/rules/preview', {
          config: cfg,
          scenario: { map: testMap.value, botAmount: testAmount.value, bossesDisabled: testBosses.checked },
        });
        testOut.style.display = '';
        testOut.replaceChildren(...renderPreview(r));
      } catch (err) { toast(String(err.message || err), 'err'); }
      finally { e.target.disabled = false; }
    },
  }, '预演这局');

  // ---- 备份
  const backupSelect = h('select', { class: 'input', style: 'min-width:300px' });
  const fillBackups = (list) => {
    backupSelect.replaceChildren(
      h('option', { value: '' }, (list || []).length ? '选择要还原的备份…' : '暂无备份'),
      ...(list || []).map((b) => h('option', { value: b.name }, `${fmtTime(b.mtime)} · ${b.name.slice(0, 34)}`)),
    );
  };
  fillBackups(rulesData.backups);
  const restoreBtn = h('button', {
    class: 'btn sm', onclick: async () => {
      if (!backupSelect.value) return toast('先选择一个备份', 'warn');
      if (!confirm('还原该备份？当前配置会先自动备份')) return;
      try {
        await POST('/api/ai/rules/restore', { name: backupSelect.value });
        toast('已还原，规则已热重载', 'ok');
        setPage('ai');
      } catch (err) { toast(String(err.message || err), 'err'); }
    },
  }, '还原');

  const modeSelect = h('select', { class: 'input' },
    ...Object.entries(MODE_CN).map(([v, label]) => h('option', { value: v, selected: (cfg.mode || 'followVanilla') === v }, label)));
  modeSelect.addEventListener('change', () => { cfg.mode = modeSelect.value; });

  const enabledSwitch = boolSwitch('规则引擎总开关', () => cfg.enabled !== false, (v) => { cfg.enabled = v; });
  const genSwitch = boolSwitch('彻底禁止 Bot 生成接口', () => cfg.blockBotGeneration !== false, (v) => { cfg.blockBotGeneration = v; });
  const logSwitch = boolSwitch('记录删除日志', () => cfg.logRemovals !== false, (v) => { cfg.logRemovals = v; });

  const installed = !!rulesData.installed;

  // 随管理器一起发布的内置安装包（不需要另外下载 NoAIBots）
  const bundle = rulesData.bundle || null;
  let bundleRow = null;
  if (bundle && bundle.version) {
    const btn = h('button', { class: 'btn sm primary', style: 'flex-shrink:0' },
      bundle.installed ? (bundle.outdated ? `更新到 v${bundle.version}` : '重新安装内置版本') : `安装内置 v${bundle.version}`);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const old = btn.textContent;
      btn.textContent = '安装中…';
      let stopped = false;
      try {
        const st = await GET('/api/server/status', { silent: true });
        if (st && st.running) {
          if (!confirm(`更新 NoAIBots 需要重启 SPT 服务端（会结束当前战局）。\n\n现在停服安装吗？`)) {
            btn.disabled = false;
            btn.textContent = old;
            return;
          }
          await POST('/api/server/stop');
          stopped = true;
        }
        const r = await POST('/api/bundled/install', { id: 'noaibots' });
        toast(`已装内置 NoAIBots v${bundle.version}（${r.files} 个文件${r.backup ? '，旧文件已备份' : ''}），config.json 里的规则保留`, 'ok', 6000);
        if (stopped) {
          await POST('/api/server/start');
          toast('服务端已重新启动，下一局生效', 'ok', 4000);
        }
        await render();
      } catch (e) {
        toast(String((e && e.message) || e), 'err', 6000);
        btn.disabled = false;
        btn.textContent = old;
      }
    });
    const tag = bundle.installed
      ? (bundle.outdated
        ? h('span', { class: 'tag warn' }, `已装 ${bundle.installedVersion || '旧版'}，内置 ${bundle.version}`)
        : h('span', { class: 'tag ok' }, `内置包已安装 v${bundle.version}`))
      : h('span', { class: 'tag' }, `内置包 v${bundle.version} 未安装`);
    bundleRow = h('div', { class: 'row', style: 'margin-top:10px;align-items:center;gap:10px' },
      h('div', { style: 'flex:1;min-width:240px' },
        h('div', {}, h('b', {}, '内置安装包'), ' ', tag),
        h('div', { class: 'hint', style: 'margin:2px 0 0' },
          `随管理器一起发布：点一下就能装/更新 NoAIBots.dll+README（${bundle.files} 个文件 · ${humanSize(bundle.size)}），不会覆盖你的 config.json 规则。`)),
      btn);
  }

  refreshList();

  return h('div', { class: 'card', style: 'margin-top:16px' },
    h('div', { class: 'card-head' },
      h('h2', {}, 'AI 规则引擎（NoAIBots）'),
      h('div', { class: 'row' },
        installed ? h('span', { class: 'tag ok' }, 'mod 已安装') : h('span', { class: 'tag warn' }, 'mod 未安装'),
        h('span', { class: 'sub' }, `config.json ${rulesData.configMtime ? '更新于 ' + fmtTime(rulesData.configMtime) : '尚未创建'}`))),
    h('div', { class: 'hint' }, '规则在每局开战时由服务端执行：保存后无需重启服务端，下一局自动生效（mod 按文件时间热重载）。'),
    h('div', { class: 'hint mono', style: 'margin-top:4px;word-break:break-all' }, rulesData.configPath || ''),
    bundleRow,
    rulesData.parseError ? h('div', { class: 'hint', style: 'color:var(--warn);margin-top:6px' }, rulesData.parseError) : null,
    rulesData.clientServerRemote ? h('div', { class: 'hint', style: 'color:var(--warn);margin-top:6px' },
      `当前客户端连的是远程服务端 ${rulesData.clientServerUrl}：本页只改本机这份配置，真正生效要让服务端那台机器装同一个 mod 并改那里的 config.json。`,
      h('span', { class: 'tag warn', style: 'margin-left:6px' }, '远程联机')) : null,
    !installed ? h('div', { class: 'hint', style: 'color:var(--warn);margin-top:6px' },
      `没有检测到 ${rulesData.dllPath}。规则可以先编辑保存，但要真正生效需要把 NoAIBots.dll 放进服务端 user\\mods\\NoAIBots\\（远程服务端则复制到那台机器）。`) : null,
    h('div', { class: 'grid c2', style: 'margin-top:14px' },
      h('div', { class: 'field' }, h('label', {}, '生效模式'), modeSelect),
      h('div', { class: 'field' }, h('label', {}, '开关'), h('div', { class: 'row' }, enabledSwitch, genSwitch, logSwitch),
        h('div', { class: 'hint' }, '“彻底禁止 Bot 生成接口”作为最后一道保险，规则命中无AI局时直接返回空生成结果'))),
    h('div', { class: 'row', style: 'margin-top:16px' },
      h('button', { class: 'btn sm', onclick: () => { cfg.rules.push({ name: `规则 ${cfg.rules.length + 1}`, enabled: true, match: { maps: [], botAmounts: [] }, actions: {} }); refreshList(); } }, '+ 空白规则'),
      ...presets.map((p) => h('button', {
        class: 'btn sm ghost', onclick: () => {
          cfg.rules.push({ enabled: true, description: p.description || '', ...JSON.parse(JSON.stringify(p.rule)) });
          refreshList();
          toast(`已添加「${p.label}」规则，记得点保存`, 'ok');
        },
        title: p.description || '',
      }, `+ ${p.label}`)),
      h('div', { class: 'spacer' }), catalogBtn, resetBtn, saveBtn),
    status,
    h('div', { style: 'height:6px' }),
    pmcCard,
    listBox,
    h('div', { class: 'card', style: 'margin-top:16px;background:#fbfcff' },
      h('div', { class: 'card-head' }, h('h2', {}, '预演'), h('span', { class: 'sub' }, '不写文件，只按当前配置模拟')),
      h('div', { class: 'grid c4' },
        h('div', { class: 'field' }, h('label', {}, '地图'), testMap),
        h('div', { class: 'field' }, h('label', {}, '战局档位'), testAmount),
        h('div', { class: 'field' }, h('label', {}, '模拟客户端关闭首领'), h('label', { class: 'switch' }, testBosses, '已关闭')),
        h('div', { class: 'field' }, h('label', {}, ' '), testBtn)),
      testOut),
    h('div', { class: 'card', style: 'margin-top:16px;background:#fbfcff' },
      h('div', { class: 'card-head' }, h('h2', {}, '配置备份'), h('span', { class: 'sub' }, '每次保存自动备份到 data/backups/configs')),
      h('div', { class: 'row' }, backupSelect, restoreBtn)),
  );
}

const MAP_CN = {
  bigmap: '海关', factory4_day: '工厂（白天）', factory4_night: '工厂（夜晚）', interchange: '立交桥',
  laboratory: '实验室', lighthouse: '灯塔', rezervbase: '储备站', sandbox: '中心区',
  sandbox_high: '中心区（高级）', shoreline: '海岸线', tarkovstreets: '塔科夫街区', woods: '森林',
  labyrinth: '迷宫',
};
const mapName = (id) => MAP_CN[id] || id;

// ---------------------------------------------------------------- 物资
// ---------------------------------------------------------------- AI 参数说明
async function renderAiParams() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('AI 参数'), noRootCard());
  const d = await GET('/api/ai/rules').catch(() => null);
  if (!d || !d.ok) return frag(pageHead('AI 参数'), h('div', { class: 'empty' }, '读取 NoAIBots 配置失败，请先在「设置」里指定 SPT 目录'));

  const defs = d.actionDefs || {};
  const groups = (d.actionGroups && d.actionGroups.length) ? d.actionGroups : [{ key: '其他', hint: '' }];
  const cfg = d.config || {};
  const rules = cfg.rules || [];
  const mapDefaults = d.mapDefaults || {};
  const spawnMapsData = (d.spawn && d.spawn.maps) || {};
  const mapIds = Object.keys(spawnMapsData).length ? Object.keys(spawnMapsData) : Object.keys(mapDefaults);
  const MODE_TEXT = { followVanilla: '跟随原版档位', forceNoAI: '强制无 AI', passthrough: '直通（不改任何东西）' };
  const TYPE_TEXT = { bool: '开关', names: '类型列表', number: '数值（全局）', tuning: '数值 · 地图级', tuningBool: '开关 · 地图级', schedule: '时间表 · 每规则' };

  const usedBy = (key) => rules
    .map((r, i) => (r.actions && r.actions[key] !== undefined ? i + 1 : null))
    .filter((x) => x !== null);

  const typeCn = (t) => TYPE_TEXT[t] || t || '—';

  const paramRow = (key) => {
    const def = defs[key] || {};
    const used = usedBy(key);
    const defText = def.def !== undefined
      ? String(def.def)
      : ((def.type === 'tuning' || def.type === 'tuningBool') ? '各图不同（见下方原版值）' : '—');
    return h('tr', {},
      h('td', { class: 'param-key' }, key),
      h('td', { style: 'font-weight:550' }, def.label || key),
      h('td', { class: 'param-system' }, typeCn(def.type)),
      h('td', { style: 'white-space:nowrap' }, defText),
      h('td', {}, def.desc || ''),
      h('td', { style: 'white-space:nowrap' }, used.length
        ? used.map((i) => `规则 ${i}`).join('、')
        : h('span', { style: 'color:var(--text-faint)' }, '未使用')));
  };

  const groupCards = groups.map((g) => {
    const keys = Object.keys(defs).filter((k) => (defs[k].system || '其他') === g.key);
    if (!keys.length) return null;
    return h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {},
        h('h2', {}, g.key),
        g.hint ? h('p', { class: 'sub', style: 'margin-top:2px' }, g.hint) : null)),
      h('div', { style: 'overflow-x:auto' },
        h('table', { class: 'param-table' },
          h('thead', {}, h('tr', {}, ...['参数名', '中文名', '类型', '默认值', '说明', '当前被哪条规则使用'].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...keys.map(paramRow)))));
  }).filter(Boolean);

  const gv = (v, on, off) => (v === false ? off : on);
  const globalRows = [
    ['enabled', '规则引擎总开关', '关掉后 mod 完全不看规则，等于没装这个 mod', gv(cfg.enabled, '开启', '关闭')],
    ['mode', '生效模式', '跟随原版档位 = 只按档位匹配；强制无 AI = 一律清空；直通 = 不改任何东西', MODE_TEXT[cfg.mode] || cfg.mode || '—'],
    ['blockBotGeneration', '彻底禁止 Bot 生成接口', '最后一道保险：认为这一局不该有 AI 时，直接返回空的生成结果', gv(cfg.blockBotGeneration, '开启', '关闭')],
    ['repairValidationNerf', '修复 SPT 校验陷阱', 'SPT 校验失败时会把同屏上限全部改成 7，这里自动还原成原版值', gv(cfg.repairValidationNerf, '开启', '关闭')],
    ['logRemovals', '记录删除日志', '在服务端日志里写下每条规则的命中、删除了多少条波次、上限缩放结果', gv(cfg.logRemovals, '开启', '关闭')],
  ];
  const globalCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', {},
      h('h2', {}, 'mod 全局开关'),
      h('p', { class: 'sub', style: 'margin-top:2px' }, '写在 SPT\\user\\mods\\NoAIBots\\config.json，改完保存到文件即刻生效（下一局开始前自动重载）'))),
    h('div', { style: 'overflow-x:auto' },
      h('table', { class: 'param-table' },
        h('thead', {}, h('tr', {}, ...['字段', '含义', '说明', '当前值'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...globalRows.map(([k, label, desc, val]) => h('tr', {},
          h('td', { class: 'param-key' }, k),
          h('td', { style: 'font-weight:550;white-space:nowrap' }, label),
          h('td', {}, desc),
          h('td', { style: 'white-space:nowrap' }, val)))))));

  // 原版值参考（按地图切换）
  const DEF_ROWS = [
    ['botSpawnPeriodCheck', '刷新检查间隔（秒）'],
    ['botSpawnTimeOnMin', '刷新持续下限（秒）'],
    ['botSpawnTimeOnMax', '刷新持续上限（秒）'],
    ['botSpawnTimeOffMin', '停歇下限（秒）'],
    ['botSpawnTimeOffMax', '停歇上限（秒）'],
    ['botSpawnCountStep', '每次刷新数量步进'],
    ['botStart', '开局多少秒开始刷'],
    ['botStop', '开局多少秒停止刷'],
    ['maxBotPerZone', '单区域同屏上限'],
    ['botMax', '新系统存活上限（BotMax）'],
    ['nonWaveSpawnBotsLimitPerPlayer', '非波次补刷/玩家上限'],
    ['distToActivate', '激活距离（米）'],
    ['distToSleep', '休眠距离（米）'],
    ['newSpawn', '新刷新系统'],
    ['oldSpawn', '旧刷新系统'],
    ['newSpawnForPlayers', '新系统跟随玩家'],
    ['offlineNewSpawn', '离线局：新刷新系统'],
    ['offlineOldSpawn', '离线局：旧刷新系统'],
  ];
  const mapSelect = h('select', { class: 'input', style: 'max-width:280px' },
    ...mapIds.map((id) => h('option', { value: id }, mapName(id))));
  const defBody = h('div', {});
  const renderDefs = () => {
    const id = mapSelect.value || mapIds[0];
    const m = mapDefaults[id] || {};
    const sp = spawnMapsData[id] || {};
    const fmt = (v) => (v === undefined || v === null ? '—' : (typeof v === 'boolean' ? (v ? '开' : '关') : String(v)));
    const rows = DEF_ROWS.map(([k, label]) => h('tr', {},
      h('td', { class: 'param-key' }, k),
      h('td', {}, label),
      h('td', { style: 'font-weight:550' }, fmt(m[k]))));
    const summary = h('p', { class: 'sub', style: 'margin:0 0 8px' },
      `这张图的刷新点：wave ${(sp.waves || []).length} 条 · 首领 ${(sp.bosses || []).length} 个 · PMC 档位 ${(sp.pmc || []).length} 条 · 同屏上限 ${sp.cap === undefined ? '—' : sp.cap}`);
    defBody.replaceChildren(summary, h('div', { style: 'overflow-x:auto' },
      h('table', { class: 'param-table' },
        h('thead', {}, h('tr', {}, ...['字段', '含义', '原版值'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...rows))));
  };
  mapSelect.addEventListener('change', renderDefs);
  renderDefs();

  const defCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, '地图原版刷新参数'), h('p', { class: 'sub', style: 'margin-top:2px' }, '来自 SPT_Data\\database\\locations\\<地图>\\base.json；规则里留空的参数就是用它')),
      mapSelect),
    defBody);

  return frag(
    pageHead('AI 参数', 'NoAIBots 能改的每一项配置：全局开关、每张图的原版值、以及每条规则动作的含义', [
      h('button', { class: 'btn', onclick: () => setPage('ai') }, '去「战局 AI」配置规则'),
    ]),
    globalCard,
    h('div', { class: 'hint', style: 'margin:14px 2px 6px' },
      `当前共 ${rules.length} 条规则。下面的「地图级」参数在规则里留空/未设置 = 保持这张图原版值；多条规则同时命中时，后面的覆盖前面的。`),
    ...groupCards,
    defCard);
}

// ---------------------------------------------------------------- 物资刷新
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

// ---------------------------------------------------------------- 关于
const BUNDLE_GROUP_ORDER = ['联机', 'AI', '实测', '基础', '其它'];

async function renderAbout() {
  const st = state.app = await GET('/api/state');
  const root = st.settings.sptRoot || st.autoRoot || '';
  let bundled = { items: [], embedded: false };
  try { bundled = await GET('/api/bundled'); } catch { /* 老版本后端没有这个接口 */ }
  state.app = st;

  const install = async (btn, item) => {
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = '安装中…';
    try {
      const r = await POST('/api/bundled/install', { id: item.id });
      toast(`已装 ${item.name}（${r.files} 个文件）${r.backup ? '，旧文件已备份' : ''}`, 'ok', 5000);
      state.mods = null;
      state.app = null;
      await render();
    } catch (err) {
      toast(String(err.message || err), 'err', 6000);
      btn.disabled = false;
      btn.textContent = old;
    }
  };

  const itemCard = (it) => {
    const status = it.installed
      ? (it.outdated ? h('span', { class: 'tag warn' }, `已装 ${it.installedVersion || '旧版'}`) : h('span', { class: 'tag ok' }, '已安装'))
      : h('span', { class: 'tag' }, '未安装');
    const btn = h('button', { class: 'btn sm primary', onclick: (e) => install(e.target, it) },
      it.installed ? (it.outdated ? '更新到内置版本' : '重新安装') : '一键安装');
    return h('div', { class: 'bundle-row' },
      h('div', {}, h('b', {}, it.name), ' ',
        h('span', { class: 'sub' }, `v${it.version}`), status,
        h('div', { class: 'hint', style: 'margin-top:4px;margin-bottom:0' }, it.desc),
        h('div', { class: 'hint', style: 'margin-top:2px;margin-bottom:0;opacity:.75' },
          `${it.files} 个文件 · ${humanSize(it.size)}`,
          it.homepage ? [' · ', h('a', { href: it.homepage, target: '_blank', rel: 'noreferrer' }, 'mod 主页')] : null)),
      h('div', { style: 'display:flex;gap:8px;flex-shrink:0' }, btn));
  };

  const groups = {};
  for (const it of bundled.items || []) {
    const g = it.group || '其它';
    (groups[g] = groups[g] || []).push(it);
  }
  const groupNodes = BUNDLE_GROUP_ORDER.concat(Object.keys(groups).filter((g) => !BUNDLE_GROUP_ORDER.includes(g)))
    .filter((g) => groups[g] && groups[g].length)
    .map((g) => h('div', { style: 'margin-top:14px' },
      h('div', { class: 'group-title' }, g),
      ...groups[g].map(itemCard)));

  const bundleCard = bundled.items && bundled.items.length
    ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '内置基础模组'),
        h('span', { class: 'sub' }, bundled.embedded ? '已打包进 exe，可离线一键安装' : '随包提供')),
      h('p', { class: 'hint', style: 'margin-top:0' },
        '装进当前客户端目录，覆盖前会备份到 data\\backups\\bundled。新客户端第一次用，按「联机」这一组从下往上装：Fika 客户端插件 → Fika 服务端 mod → 无头主机（可选）。装完重启服务端和客户端生效。'),
      ...groupNodes)
    : h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '内置基础模组'), h('span', { class: 'sub' }, '这份包没带')),
      h('p', { class: 'hint', style: 'margin-top:0' }, '源码运行时需要把资源放在 assets\\bundled\\ 下；打包成 exe 时会自动内联。'));

  const v = st.versions || {};
  let ai = null;
  try { ai = await GET('/api/ai/rules'); } catch { /* 老后端 / 未设置目录时忽略 */ }
  const aiRulesCount = (ai?.config?.rules || []).length;
  const aiRulesEnabled = (ai?.config?.rules || []).filter((r) => r.enabled !== false).length;
  const aiCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'NoAIBots（AI 规则引擎）'),
      h('span', { class: 'sub' }, ai?.installed ? `v${ai.dllVersion || '未知'}` : '未安装')),
    h('p', { class: 'hint', style: 'margin-top:0' },
      '本项目配套的本地服务端 mod：接管 SPT 每局下发的刷新表，让原版「无AI / 低 / 中 / 高 / 排山倒海」真正生效；可按地图/档位改波次、人数、同屏上限、地图刷新参数，支持 PMC 档案（阵营比例、等级、难度、血量、技能）和自定义时间表（PMC / 首领），并修掉 SPT 校验失败时把 AI 上限压成 7 的坑。配置热重载，保存后下一局开战即生效。'),
    h('dl', { class: 'kv' },
      h('dt', {}, '安装状态'), h('dd', {}, ai?.installed
        ? `已安装 · ${humanSize(ai.dllSize || 0)} · 更新于 ${fmtTime(ai.dllMtime)}`
        : '未安装（把 NoAIBots.dll 放进 SPT\\user\\mods\\NoAIBots\\NoAIBots.dll）'),
      h('dt', {}, '规则'), h('dd', {}, ai ? `${aiRulesCount} 条（启用 ${aiRulesEnabled} 条）` : '读取失败'),
      h('dt', {}, 'PMC 档案'), h('dd', {}, ai?.config?.pmcProfile?.enabled
        ? h('span', { class: 'tag ok' }, '已启用')
        : '未启用（全局开关在「战局 AI」页顶部）'),
      h('dt', {}, '配置文件'), h('dd', { class: 'mono' }, ai?.configPath || '—')),
    h('div', { class: 'row', style: 'margin-top:10px' },
      h('button', { class: 'btn sm', onclick: () => setPage('ai') }, '去「战局 AI」配规则'),
      h('button', { class: 'btn sm', onclick: () => setPage('params') }, '看「AI 参数」说明'),
      h('button', { class: 'btn sm', onclick: () => setPage('raid') }, '去「战局实测」对照')));
  return frag(
    pageHead('关于', '版本信息与内置模组安装'),
    bundleCard,
    h('div', { style: 'height:16px' }),
    aiCard,
    h('div', { style: 'height:16px' }),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '版本信息')),
      h('dl', { class: 'kv' },
        h('dt', {}, '管理器'), h('dd', {}, '1.0.3'),
        h('dt', {}, 'SPT'), h('dd', {}, v.spt || '未知'),
        h('dt', {}, 'Tarkov'), h('dd', {}, v.tarkov || '未知'),
        h('dt', {}, '运行方式'), h('dd', {}, bundled.embedded ? '单文件 exe（内置资源）' : '源码（node server.js）'),
        h('dt', {}, '客户端目录'), h('dd', {}, root || '未设置'),
        h('dt', {}, '数据目录'), h('dd', {}, st.paths.data))),
    h('div', { style: 'height:16px' }),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '关于本项目'), h('span', { class: 'sub' }, 'MIT License')),
      h('p', { class: 'hint', style: 'margin-top:0' },
        'SPT 4.x 的本地网页管理器：装模组、开服务端、起客户端、配 Fika 联机与无头主机，一个页面搞定。零依赖，Node 内置 HTTP 服务 + 原生前端。'),
      h('div', { class: 'row' },
        h('a', { class: 'btn sm', href: 'https://github.com/RumiaTinge/spt-manager', target: '_blank', rel: 'noreferrer' }, 'GitHub'),
        h('a', { class: 'btn sm', href: 'https://sp-mod.com', target: '_blank', rel: 'noreferrer' }, 'The Forge'),
        h('a', { class: 'btn sm', href: 'https://wiki.project-fika.com', target: '_blank', rel: 'noreferrer' }, 'Fika Wiki'))),
  );
}// ---------------------------------------------------------------- Fika 联机
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
      : (f.serverExists
        ? h('div', { class: 'empty' }, h('b', {}, 'fika.jsonc 读不出来'), h('p', {}, f.serverError || '文件存在但解析失败，可能里面有语法错误或编码不对'),
          h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => setPage('about') }, '去「关于」重装内置 Fika')))
        : h('div', { class: 'empty' },
          h('b', {}, '这份客户端还没有 fika.jsonc'),
          h('p', {}, '新客户端第一次用就是这样：fika-server 没装，或装好后还没跑过服务端。'),
          h('p', { class: 'hint' }, '装 Fika 服务端 mod → 启动一次服务端，配置会自动生成。'),
          h('div', { class: 'row' },
            h('button', { class: 'btn sm primary', onclick: () => setPage('about') }, '去「关于」一键装 Fika'),
            h('button', { class: 'btn sm', onclick: () => setPage('server') }, '去启动服务端')))));

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
  const serversInfo = await GET('/api/servers').catch(() => ({ history: [] }));
  // 在线玩家不阻塞页面：先按「还没查询」渲染，卡片挂上去之后再异步拉
  const presenceInfo = null;
  let serverHistory = serversInfo.history || [];
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
      h('div', { class: 'foot', id: 'stat-profile-foot' }, `${profilesList.length} 个本地存档 · ${tgt.autoLogin === false ? '启动器手填账号' : '自动登录'}`)),
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, '本地服务端'),
      h('div', { class: 'value', style: 'font-size:20px' }, l.serverRunning ? '运行中' : '未启动'),
      h('div', { class: 'foot' }, '独立开关在「服务器」页')),
    h('div', { class: 'stat' },
      h('div', { class: 'label' }, '在线玩家'),
      h('div', { class: 'value', id: 'stat-players', style: 'font-size:20px' },
        presenceInfo && presenceInfo.ok ? `${presenceInfo.count || 0} 人` : '—'),
      h('div', { class: 'foot', id: 'stat-players-foot', style: 'word-break:break-all' },
        presenceInfo && presenceInfo.ok ? (presenceInfo.isLocal ? '本机服务端' : '远程服务端') : '服务端没响应')),
  );

  const SIDE_CN = { Usec: 'USEC', Bear: 'BEAR', Savage: 'SCAV', Pmc: 'PMC' };
  // 存档列表：默认本地 SPT/user/profiles；连远程服时可以「读取服务端存档」再选
  const profSource = { url: '', count: 0, at: null };
  const profLabel = (p) => {
    const nick = p.nickname && p.nickname !== p.username ? `（${p.nickname}）` : '';
    return `${p.username}${nick}${p.level != null ? ` · ${p.level} 级` : ''}${p.side ? ` · ${SIDE_CN[p.side] || p.side}` : ''}`;
  };
  const profSelect = h('select', { class: 'input', id: 'profile-select' }, ...profilesList.map((p) =>
    h('option', { value: p.nickname, selected: p.active }, `${p.nickname}${p.level != null ? `（${p.level} 级）` : ''}`)));
  const rebuildProfOptions = (list, { activeName, fromServer } = {}) => {
    const cur = String(activeName || profSelect.value || '').trim();
    const opts = list.map((p) => h('option', { value: p.username, selected: p.username === cur }, profLabel(p)));
    profSelect.replaceChildren(...(opts.length ? opts : [h('option', { value: '' }, '（没有存档）')]));
    if (cur && !list.some((p) => p.username === cur)) {
      profSelect.appendChild(h('option', { value: cur, selected: true }, `${cur}（服务端没有这个账号）`));
    }
    if (cur) profSelect.value = cur;
    if (fromServer) {
      profSource.url = fromServer.url || '';
      profSource.count = list.length;
      profSource.at = fromServer.at || null;
    }
  };
  const modeSel = h('select', { class: 'input', id: 'server-mode' },
    h('option', { value: 'local', selected: tgt.isLocal }, '本机服务端（自己开服）'),
    h('option', { value: 'remote', selected: !tgt.isLocal }, '远程服务器（别人开的）'));
  const urlInp = h('input', { class: 'input', id: 'server-url', value: tgt.url || 'https://127.0.0.1:6969' });
  const autoLoginCb = h('input', { type: 'checkbox', checked: tgt.autoLogin !== false });
  const autoServer = h('input', { type: 'checkbox', checked: false });
  const autoServerField = h('div', { class: 'field' }, h('label', {}, '启动前自动拉起本地服务端'),
    h('label', { class: 'switch' }, autoServer, '自动'),
    h('div', { class: 'hint' }, '只在「本机服务端」模式下有意义；连远程服务器时不会动本地服务端'));
  const modeHint = h('div', { class: 'hint', style: 'margin-top:2px' }, '');
  const profHint = h('div', { class: 'hint', style: 'margin-top:4px' }, '');
  const syncProf = () => {
    const name = profSelect.value;
    const src = profSource.url
      ? ` · 来自服务端 ${profSource.url}（${profSource.count} 个）`
      : ` · 本地 ${profilesList.length} 个存档`;
    profHint.textContent = name ? `账号：${name} · 密码留空（SPT 只认用户名，不校验密码）${src}` : '还没有存档';
  };
  profSelect.addEventListener('change', syncProf);

  // 读取「对方服务端」的存档列表（GET /launcher/profiles），同步到下面这个下拉框
  let profSeq = 0;
  const loadServerProfiles = async ({ quiet } = {}) => {
    const seq = ++profSeq;
    const modeEl = document.getElementById('server-mode');
    const urlEl = document.getElementById('server-url');
    const mode = modeEl ? modeEl.value : modeSel.value;
    const raw = urlEl ? urlEl.value.trim() : urlInp.value.trim();
    const q = mode === 'remote' && raw ? `?url=${encodeURIComponent(raw)}` : '';
    try {
      const r = await GET(`/api/servers/profiles${q}`);
      if (seq !== profSeq) return r; // 已经有更新的一次请求，丢掉这次的结果
      if (!r.ok) {
        profHint.textContent = `读取服务端存档失败：${r.error || '未知错误'}${r.hint ? `（${r.hint}）` : ''}`;
        if (!quiet) toast(`读取服务端存档失败：${r.error || '未知错误'}`, 'err');
        return r;
      }
      rebuildProfOptions(r.profiles, { activeName: l.active, fromServer: r });
      syncProf();
      const foot = document.getElementById('stat-profile-foot');
      if (foot) foot.textContent = `${r.count} 个服务端存档 · ${r.isLocal ? '本机服务端' : '远程服务端'}`;
      if (!quiet) toast(`已同步服务端存档 ${r.count} 个（${r.url}）`, 'ok');
      return r;
    } catch (err) {
      if (seq === profSeq) profHint.textContent = `读取服务端存档失败：${String(err.message || err)}`;
      if (!quiet && seq === profSeq) toast(String(err.message || err), 'err');
      return { ok: false, error: String(err.message || err) };
    }
  };

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
    if (!local) setTimeout(() => { if (document.getElementById('server-mode')) loadServerProfiles({ quiet: true }); }, 300);
  }
  modeSel.addEventListener('change', syncMode);
  syncMode();
  syncProf();

  // ---------------------------------------------------------------- 服务端地址补全 + 地址簿
  const normUrl = (s) => {
    let raw = String(s == null ? '' : s).trim().replace(/^["'<\s]+|["'>\s]+$/g, '');
    if (!raw) return { ok: false, error: '地址不能为空' };
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
    let u;
    try { u = new URL(raw); } catch { return { ok: false, error: '地址不合法' }; }
    const scheme = String(u.protocol).replace(/:$/, '').toLowerCase();
    if (!/^https?$/.test(scheme)) return { ok: false, error: '只支持 http / https' };
    if (!u.hostname) return { ok: false, error: '缺少主机名' };
    const port = Number(u.port || 6969);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: '端口不合法' };
    const host = u.hostname.includes(':') ? `[${u.hostname.replace(/^\[|\]$/g, '')}]` : u.hostname;
    return { ok: true, url: `${scheme}://${host}:${port}` };
  };
  const normHint = h('div', { class: 'hint', style: 'margin-top:2px' }, '');
  const syncNorm = () => {
    if (modeSel.value === 'local') { normHint.textContent = ''; normHint.style.color = ''; return; }
    const v = urlInp.value.trim();
    if (!v) { normHint.textContent = '只填 IP 也行：会自动补成 https://IP:6969'; normHint.style.color = ''; return; }
    const r = normUrl(v);
    normHint.textContent = r.ok ? `将保存为 ${r.url}` : `⚠ ${r.error}（例如 https://1.2.3.4:6969）`;
    normHint.style.color = r.ok ? '' : '#c0392b';
  };
  urlInp.addEventListener('input', syncNorm);
  urlInp.addEventListener('blur', syncNorm);
  modeSel.addEventListener('change', () => syncNorm());
  if (modeSel.value === 'remote') syncNorm();

  const histSel = h('select', { class: 'input', style: 'margin-top:8px' },
    h('option', { value: '' }, serverHistory.length ? `从保存过的地址里选（${serverHistory.length} 个）` : '还没有保存过的地址'),
    ...serverHistory.map((x) => h('option', { value: x.url },
      `${x.name ? `${x.name} · ` : ''}${x.url}${x.lastUsedAt ? ` · ${String(x.lastUsedAt).slice(5, 16).replace('T', ' ')}` : ''}`)));
  const histUse = h('button', { class: 'btn sm', onclick: () => {
    const v = histSel.value;
    if (!v) { toast('先从下拉里选一个地址', 'warn'); return; }
    modeSel.value = 'remote';
    syncMode();
    urlInp.value = v;
    syncNorm();
    toast('已填入地址，点「保存连接设置」生效', 'ok');
  } }, '用这个');
  const histDel = h('button', { class: 'btn sm', onclick: async () => {
    const v = histSel.value;
    if (!v) { toast('先从下拉里选一个地址', 'warn'); return; }
    try {
      const r = await POST('/api/servers/forget', { url: v });
      serverHistory = r.history || [];
      toast('已从地址簿删除', 'ok');
      await render();
    } catch (err) { toast(String(err.message || err), 'err'); }
  } }, '删除');
  const historyField = h('div', { class: 'field', style: 'grid-column:1/-1' },
    h('label', {}, '保存过的服务端地址'),
    histSel,
    h('div', { class: 'row', style: 'margin-top:8px;gap:8px;flex-wrap:wrap' }, histUse, histDel),
    h('div', { class: 'hint' }, '每次保存连接设置都会记进地址簿，之后一键切换（最多保留 15 条）'));

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
      h('div', { class: 'field' }, h('label', {}, '服务端地址 Server.Url'), urlInp, normHint,
        h('div', { class: 'hint' }, '本机模式自动用 127.0.0.1；远程模式填对方 IP 即可，保存时会补成 https://IP:6969'))),
    h('div', { style: 'margin-top:12px' }, historyField),
    h('div', { class: 'grid c2', style: 'margin-top:12px' },
      h('div', { class: 'field' }, h('label', {}, '要载入的存档'),
        profSelect,
        h('div', { class: 'row', style: 'margin-top:6px;flex-wrap:wrap;gap:8px' },
          h('button', { class: 'btn sm', onclick: async (e) => { e.target.disabled = true; try { await loadServerProfiles(); } finally { e.target.disabled = false; } } }, '读取服务端存档'),
          h('span', { class: 'hint', style: 'margin-top:0' }, '连远程服时先把对方服上的存档读过来再选')),
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

  // 进页面时如果当前目标是远程服，就把对方服的存档列表拉过来（失败只写提示，不弹窗）
  if (!tgt.isLocal) setTimeout(() => { if (document.getElementById('server-mode')) loadServerProfiles({ quiet: true }); }, 600);

  // ---------------------------------------------------------------- 在线玩家（Fika presence）
  const ACTIVITY_CN = (a) => {
    const s = String(a || '').toLowerCase();
    if (!s) return '';
    if (s.includes('raid')) return '对局中';
    if (s.includes('menu') || s.includes('hub')) return '大厅';
    if (s.includes('match')) return '匹配中';
    if (s.includes('hideout')) return '藏身处';
    return a;
  };
  const paintPlayers = (r) => {
    // 用 id 取节点：页面重渲染后定时器仍能画到「当前」那张卡上
    const sub = document.getElementById('players-sub');
    const empty = document.getElementById('players-empty');
    const listBox = document.getElementById('players-list');
    if (!sub || !empty || !listBox) return;
    const list = (r && r.players) || [];
    const ok = !!(r && r.ok);
    sub.textContent = ok
      ? `${list.length} 人在线 · ${r.url}${r.isLocal ? '（本机）' : ''}`
      : (r && r.error ? `查询失败：${r.error}` : '还没有查询');
    // 顶部统计卡也要跟着刷新
    const stat = document.getElementById('stat-players');
    const statFoot = document.getElementById('stat-players-foot');
    if (stat) stat.textContent = ok ? `${list.length} 人` : '—';
    if (statFoot) statFoot.textContent = ok ? (r.isLocal ? '本机服务端' : '远程服务端') : (r && r.error ? '服务端没响应' : '还没查询');
    empty.textContent = ok && !list.length
      ? '当前没有玩家在线。这个数字来自 Fika 的 /fika/presence/get：只统计连上这台服务端、并且装了 Fika 的玩家。'
      : (r && r.hint ? r.hint : '');
    listBox.replaceChildren(...(list.length ? list.map((p) => {
      const bits = [ACTIVITY_CN(p.activity), p.raidCode ? `对局 ${p.raidCode}` : ''].filter(Boolean).join(' · ');
      return h('div', { class: 'list-row' },
        h('div', { style: 'min-width:0' },
          h('div', { style: 'font-weight:550' }, `${p.nickname}${p.level != null ? `（${p.level} 级）` : ''}${p.headless ? ' · 无头主机' : ''}`),
          h('div', { class: 'hint', style: 'word-break:break-all' }, bits || '在线')),
        h('div', { class: 'actions' }, h('span', { class: 'tag' }, '在线')));
    }) : []));
  };
  const refreshPlayers = async () => {
    try {
      const modeEl = document.getElementById('server-mode');
      const urlEl = document.getElementById('server-url');
      const mode = modeEl ? modeEl.value : modeSel.value;
      const raw = urlEl ? urlEl.value.trim() : urlInp.value.trim();
      const q = mode === 'remote' && raw ? `?url=${encodeURIComponent(raw)}` : '';
      paintPlayers(await GET(`/api/servers/presence${q}`));
    } catch { /* 查询失败保持上一次结果 */ }
  };

  const playersCard = h('div', { class: 'card', id: 'players-card', style: 'margin-top:16px' },
    h('div', { class: 'card-head' }, h('h2', {}, '在线玩家'), h('span', { class: 'sub', id: 'players-sub' }, ''),
      h('button', { class: 'btn sm', onclick: async () => { await refreshPlayers(); toast('已刷新在线玩家', 'ok'); } }, '刷新')),
    h('div', { class: 'hint', id: 'players-empty', style: 'margin-top:0' }, ''),
    h('div', { class: 'list', id: 'players-list' }));
  paintPlayers(presenceInfo);
  setTimeout(() => { if (document.getElementById('players-card')) refreshPlayers(); }, 80);
  if (state.clientTimer) clearInterval(state.clientTimer);
  state.clientTimer = setInterval(() => { if (state.page === 'client') refreshPlayers(); }, 5000);

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
    playersCard,
    modeCard,
    mainCard,
    sideCard,
  );
}

// ---------------------------------------------------------------- 物品效果
const ITEM_KIND_CN = { med: '医疗 / 兴奋剂', food: '食物 / 饮料' };

function itemListRow(it, onPick) {
  return h('div', { class: 'list-item', style: 'cursor:pointer', onclick: () => onPick(it.id) },
    h('div', { class: 'grow' },
      h('div', { class: 't' }, it.cn || it.name),
      h('div', { class: 's' }, `${it.name} · ${it.id}`)),
    h('span', { class: 'tag' }, ITEM_KIND_CN[it.kind] || it.kind));
}

function itemFieldRow(f, edits) {
  let input;
  if (f.type === 'select') {
    input = h('select', { class: 'input', onchange: (e) => { edits[f.key] = e.target.value; } },
      ...(f.options || ['']).map((o) => h('option', { value: o, selected: String(o) === String(f.value) }, o === '' ? '（不挂 Buff）' : o)));
  } else {
    input = h('input', {
      class: 'input', type: 'number', min: String(f.min), max: String(f.max), step: String(f.step), value: String(f.value),
      oninput: (e) => { edits[f.key] = e.target.value; },
    });
  }
  return h('div', { class: 'field' }, h('label', {}, f.label), input);
}

function itemDetailCard(item) {
  const edits = {};
  const saveBtn = h('button', { class: 'btn primary' }, '保存修改');
  saveBtn.addEventListener('click', async () => {
    if (!Object.keys(edits).length) return toast('还没有改动', 'warn');
    saveBtn.disabled = true;
    try {
      const r = await POST(`/api/items/${encodeURIComponent(item.id)}`, { patch: edits });
      toast(`已保存 ${r.item.cn || r.item.name}，重启服务端后生效`, 'ok');
      const card = saveBtn.closest('.card');
      if (card && card.parentNode) card.parentNode.replaceChild(itemDetailCard(r.item), card);
    } catch (err) { toast(String(err.message || err), 'err'); }
    finally { saveBtn.disabled = false; }
  });

  const groups = item.groups.map((g) => h('div', { style: 'margin-bottom:14px' },
    h('h3', { style: 'font-size:13px;margin:0 0 8px;color:var(--text-dim)' }, g.title),
    h('div', { class: 'grid c3' }, ...g.fields.map((f) => itemFieldRow(f, edits)))));

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {},
        h('h2', {}, item.cn || item.name),
        h('div', { class: 'sub' }, `${item.name} · ${item.id}`)),
      h('span', { class: 'tag accent' }, ITEM_KIND_CN[item.kind] || '物品')),
    groups.length ? groups : h('div', { class: 'empty' }, h('b', {}, '这个物品没有可改的数值')),
    h('div', { class: 'row', style: 'margin-top:4px' }, saveBtn,
      h('span', { class: 'hint' }, '保存后重启 SPT 服务端生效，客户端也要重开')));
}

async function buffEditorCard() {
  const data = await GET('/api/buffs');
  const groups = data.groups || [];
  let current = groups.find((g) => g.entries.length) || null;
  const tableBox = h('div', {});
  const edits = new Map();

  const num = (value, onChange, step = '1', width = '90px') =>
    h('input', { class: 'input', type: 'number', step, value: String(value ?? 0), style: `width:${width}`, oninput: (e) => onChange(e.target.value) });

  const draw = () => {
    edits.clear();
    if (!current) { tableBox.replaceChildren(h('div', { class: 'empty' }, '没有 Buff 组')); return; }
    const rows = current.entries.map((e, i) => {
      const row = { ...e };
      edits.set(i, row);
      return h('tr', {},
        h('td', {}, h('input', { class: 'input', value: e.BuffType || '', style: 'width:170px', oninput: (ev) => { row.BuffType = ev.target.value; } })),
        h('td', {}, num(e.Chance, (v) => { row.Chance = v; }, '0.05', '70px')),
        h('td', {}, num(e.Delay, (v) => { row.Delay = v; }, '1', '70px')),
        h('td', {}, num(e.Duration, (v) => { row.Duration = v; }, '1', '80px')),
        h('td', {}, num(e.Value, (v) => { row.Value = v; }, '1', '70px')),
        h('td', {}, h('input', { class: 'input', value: e.SkillName || '', style: 'width:130px', oninput: (ev) => { row.SkillName = ev.target.value; } })),
        h('td', { class: 'mono', style: 'color:var(--text-faint)' }, e.AbsoluteValue === false ? '×' : '√'));
    });
    tableBox.replaceChildren(
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['BuffType', '触发概率', '延迟（秒）', '持续（秒）', '数值', '技能', '绝对值'].map((t) => h('th', {}, t)))),
        h('tbody', {}, ...rows))),
      h('div', { class: 'hint', style: 'margin-top:8px' }, '这一组是服务端下发的效果定义，物品通过 StimulatorBuffs 指向它。'));
  };

  const sel = h('select', { class: 'input', style: 'max-width:320px', onchange: (ev) => {
    current = groups.find((g) => g.id === ev.target.value) || null;
    draw();
  } }, ...groups.map((g) => h('option', { value: g.id, selected: !!current && g.id === current.id }, `${g.id}（${g.entries.length} 条）`)));

  const saveBtn = h('button', { class: 'btn primary' }, '保存这一组');
  saveBtn.addEventListener('click', async () => {
    if (!current) return;
    saveBtn.disabled = true;
    try {
      const entries = [...edits.entries()].sort((a, b) => a[0] - b[0]).map(([, row]) => row);
      await POST(`/api/buffs/${encodeURIComponent(current.id)}`, { entries });
      current = (await GET('/api/buffs')).groups.find((g) => g.id === current.id) || current;
      toast(`已保存 ${current.id}，重启服务端后生效`, 'ok');
      draw();
    } catch (err) { toast(String(err.message || err), 'err'); }
    finally { saveBtn.disabled = false; }
  });

  draw();
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, '兴奋剂 / 食物 Buff 组'), h('div', { class: 'sub' }, `共 ${groups.length} 组 · 每 ${data.loopTime ?? '?'} 秒结算一次`)),
      h('div', { class: 'row' }, sel, saveBtn)),
    tableBox);
}

async function renderItems() {
  if (!state.app || !state.app.autoRoot) return frag(pageHead('物品效果'), noRootCard());

  const initial = await GET('/api/items?limit=60');
  const resultBox = h('div', { class: 'list', style: 'max-height:320px;overflow:auto;padding-right:4px' });
  const countEl = h('span', { class: 'hint' });
  const detailBox = h('div', {}, h('div', { class: 'empty' }, h('b', {}, '先在上面选一个物品'), '选中后就能改治疗量、使用时间、能量水分、Buff 组'));

  const pick = async (id) => {
    detailBox.replaceChildren(h('div', { class: 'empty' }, '读取中…'));
    try {
      const r = await GET(`/api/items/${encodeURIComponent(id)}`);
      detailBox.replaceChildren(itemDetailCard(r.item));
      detailBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      detailBox.replaceChildren(h('div', { class: 'empty' }, h('b', {}, '读取失败'), String(e.message || e)));
    }
  };

  const fill = (list) => resultBox.replaceChildren(...(list.length
    ? list.map((it) => itemListRow(it, pick))
    : [h('div', { class: 'empty' }, h('b', {}, '没有匹配的物品'), '只能改数据库里带 medUseTime / foodUseTime 的物品')]));

  countEl.textContent = `共 ${initial.total} 个可改数值的物品`;
  fill(initial.items);

  const input = h('input', {
    class: 'input', style: 'flex:1', placeholder: '搜中文名 / 英文名 / 模板 ID，例如 Salewa、急救包、544fb45d…',
    value: state.itemsQuery || '',
  });
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      state.itemsQuery = input.value;
      try {
        const r = await GET(`/api/items?limit=60&q=${encodeURIComponent(input.value)}`);
        countEl.textContent = `匹配 ${r.total} 个`;
        fill(r.items);
      } catch (e) { toast(String(e.message || e), 'err'); }
    }, 200);
  });

  const backs = await GET('/api/items/backups');
  const backupList = (backs.list || []).slice(0, 6);

  return frag(
    pageHead('物品效果', '直接改服务端数据库里的物品数值与兴奋剂 Buff（改动前自动备份，重启服务端生效）'),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '查找物品'), countEl),
      h('div', { class: 'row', style: 'margin-bottom:10px' }, input),
      resultBox),
    h('div', { style: 'height:16px' }),
    detailBox,
    h('div', { style: 'height:16px' }),
    await buffEditorCard(),
    h('div', { style: 'height:16px' }),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, '数据库备份'), h('span', { class: 'sub' }, `最近 ${backupList.length} 个`)),
      backupList.length ? h('div', { class: 'list' }, ...backupList.map((b) => h('div', { class: 'list-item' },
        h('div', { class: 'grow' },
          h('div', { class: 't' }, b.name),
          h('div', { class: 's' }, `${fmtSize(b.size)} · ${fmtTime(b.mtime)}`)),
        h('button', { class: 'btn sm', onclick: async (ev) => {
          if (!confirm(`还原备份 ${b.name}？\n当前文件会先另存一份备份。`)) return;
          ev.target.disabled = true;
          try { await POST('/api/items/restore', { name: b.name }); toast('已还原，重启服务端后生效', 'ok'); render(); }
          catch (e) { toast(String(e.message || e), 'err'); }
          finally { ev.target.disabled = false; }
        } }, '还原')))) : h('div', { class: 'empty' }, h('b', {}, '还没有备份'), '第一次保存时会自动生成')),
    h('div', { class: 'hint', style: 'margin-top:10px' },
      '提示：数据库只在服务端启动时读一次，改完必须重启 SPT 服务端；客户端也要重开才拿得到新模板。数值、能量水分、兴奋剂 Buff 都能改，动画/音效在客户端程序里，改不了。'));

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
