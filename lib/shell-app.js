/**
 * 手机端壳页面逻辑
 *
 * 1. shellAPI polyfill：把电脑端页面 JS 期望的 window.shellAPI 调用，
 *    通过 WebSocket 转发到主进程（壳页桥，白名单）。
 * 2. 中间对话流：接收 AI 事件（stream/think/tool/done）实时渲染。
 * 3. 侧栏抽屉：管理面板（P1+P2 页）。
 *
 * 构建时注入：API_MAP 方法→通道映射；API_NOOP 订阅方法（no-op）。
 */
(function () {
  // 全局错误显示（手机端无控制台，把错误显示出来）
  window.addEventListener('error', function (e) {
    try {
      var b = document.getElementById('m-err');
      if (!b) { b = document.createElement('div'); b.id = 'm-err'; b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#b91c1c;color:#fff;font-size:12px;padding:8px 12px;max-height:40%;overflow:auto;white-space:pre-wrap;'; document.body.appendChild(b); }
      b.textContent = '⚠ ' + (e.message || e.error || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '');
    } catch (_) {}
  });
  var API_MAP = __API_MAP__;
  var API_NOOP = __API_NOOP__;
  var NOOP_SET = {};
  API_NOOP.forEach(function (n) { NOOP_SET[n] = 1; });

  // ================= WS + shellAPI polyfill =================
  var ws = null, ready = false, pending = {}, seq = 0, retry = false;
  var $status = document.getElementById('m-status');
  function setStatus(cls) { if ($status) $status.className = 'm-status-dot ' + cls; }

  function connect() {
    if (retry) return;
    var proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    setStatus('off');
    ws = new WebSocket(proto + location.host + '/ws');
    ws.onopen = function () {
      ready = true; setStatus('on'); updateSend();
      var cur = currentTab(); if (cur && loaders[cur]) loaders[cur]();
    };
    ws.onclose = function (e) {
      ready = false;
      if (e && e.code === 4001) { retry = true; setStatus('off'); return; }
      setStatus('off');
      setTimeout(connect, 2000);
    };
    ws.onerror = function () { setStatus('off'); };
    ws.onmessage = function (e) {
      var msg; try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.type === 'shell-resp' && msg.id && pending[msg.id]) {
        var cb = pending[msg.id]; delete pending[msg.id]; cb(msg.result);
      } else {
        onEvent(msg);
      }
    };
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch (_) { return false; }
  }

  function invoke(channel, args) {
    return new Promise(function (resolve) {
      if (!ready) { resolve({ success: false, error: 'not-connected' }); return; }
      var id = 'r' + (++seq);
      pending[id] = resolve;
      ws.send(JSON.stringify({ type: 'shell-api', id: id, channel: channel, args: args }));
      setTimeout(function () { if (pending[id]) { delete pending[id]; resolve({ success: false, error: 'timeout' }); } }, 15000);
    });
  }

  var shellAPI = {};
  Object.keys(API_MAP).forEach(function (name) {
    shellAPI[name] = function (a) { return invoke(API_MAP[name], a); };
  });
  Object.keys(NOOP_SET).forEach(function (name) {
    if (!shellAPI[name]) shellAPI[name] = function () { return function () {}; };
  });
  ['reportShellSize', 'startSidebarDrag', 'endSidebarDrag', 'toggleSidebar'].forEach(function (n) {
    if (!shellAPI[n]) shellAPI[n] = function () {};
  });
  if (!shellAPI.openExternal) shellAPI.openExternal = function (url) { try { window.open(url, '_blank'); } catch (_) {} };
  window.shellAPI = shellAPI;

  // ================= 通用 =================
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function baseName(p) { if (!p) return ''; var a = String(p).replace(/[\\/]+$/, '').split(/[\\/]/); return a[a.length - 1] || p; }
  function setList(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
  function empty(id, text) { setList(id, '<div class="ck-list-empty">' + esc(text || '暂无数据') + '</div>'); }
  /** 通用列表加载：调 shellAPI[method] → 提取数组 → 渲染；出错显示原因 */
  function loadList(listId, method, pick, render, emptyText) {
    setList(listId, '<div class="ck-list-empty">加载中…</div>');
    if (!shellAPI[method]) { empty(listId, '接口不可用: ' + method); return; }
    shellAPI[method]().then(function (r) {
      if (!r) { empty(listId, '无响应'); return; }
      if (r.success === false) { empty(listId, r.error || '加载失败'); return; }
      var d = (r.data !== undefined) ? r.data : r;
      var list = pick(d);
      if (!list || !list.length) { empty(listId, emptyText || '暂无数据'); return; }
      setList(listId, list.map(render).join(''));
    }).catch(function (e) { empty(listId, '出错: ' + (e && e.message ? e.message : e)); });
  }

  // ================= tab 切换 =================
  var loaders = {};
  var TAB_TITLES = {
    workspaces: '工作区', files: '项目文件', snippets: '提示词', memories: '记忆',
    snapshots: '快照', skills: '技能', plugins: '插件', conversations: '对话',
    agents: '子代理', mcp: 'MCP', windows: '窗口', token: 'Token',
    about: '关于', feishu: '飞书', settings: '设置',
  };
  function currentTab() { var it = document.querySelector('.ck-ab-item.ck-ab-active'); return it ? it.dataset.tab : null; }
  function activate(tab) {
    document.querySelectorAll('.ck-ab-item').forEach(function (i) { i.classList.toggle('ck-ab-active', i.dataset.tab === tab); });
    document.querySelectorAll('.ck-tab').forEach(function (p) { p.classList.toggle('ck-tab-active', p.dataset.panel === tab); });
    var t = document.querySelector('.m-topbar .m-title');
    if (t) t.textContent = TAB_TITLES[tab] || 'Cuckoo';
  }
  function placeholder(tab) {
    var existing = document.querySelector('.ck-tab[data-panel="' + tab + '"]');
    if (existing) { existing.classList.add('ck-tab-active'); existing.innerHTML = '<div class="ck-list-empty" style="padding-top:60px">' + (TAB_TITLES[tab] || tab) + '：手机端暂不支持</div>'; }
  }
  var abar = document.querySelector('.ck-activitybar');
  if (abar) abar.addEventListener('click', function (e) {
    var it = e.target.closest && e.target.closest('.ck-ab-item');
    if (!it || !it.dataset.tab) return;
    var tab = it.dataset.tab;
    activate(tab);
    var f = loaders[tab];
    if (f) { try { f(); } catch (err) { console.error(err); } } else { placeholder(tab); }
  });

  // ================= 对话流 =================
  var $stream = document.getElementById('m-stream');
  var $input = document.getElementById('m-input');
  var $send = document.getElementById('m-send');
  var wrap = document.createElement('div');
  wrap.className = 'm-wrap';
  var curAi = null, curThink = null, curTurn = null, toolMap = {}, busy = false, lastAi = '';
  // 当前会话 id（null=尚未确定）。手机端据此过滤事件，避免不同对话的消息串门。
  var curSessionId = null;
  // 手机自己刚发出的用户消息（text → 时间戳），用于回显去重。
  var pendingUserTexts = {};

  function atBottom() { return $stream.scrollHeight - $stream.scrollTop - $stream.clientHeight < 80; }
  function toBottom() { $stream.scrollTop = $stream.scrollHeight; }
  function firstLine(s) { return String(s || '').split(String.fromCharCode(10))[0].slice(0, 60); }
  function sysMsg(cls, text) {
    var d = document.createElement('div'); d.className = 'm-sys' + (cls ? ' ' + cls : '');
    d.innerHTML = '<span></span>'; d.querySelector('span').textContent = text; add(d);
  }
  function userMsg(text) {
    var d = document.createElement('div'); d.className = 'm-msg user';
    var b = document.createElement('div'); b.className = 'm-bubble'; b.textContent = text;
    d.appendChild(b); add(d);
  }
  function getTurn() { if (!curTurn) curTurn = document.createElement('div'); return curTurn; }
  function ensureAi() {
    var t = getTurn();
    if (!t.__mounted) { t.className = 'm-msg ai'; add(t); t.__mounted = true; }
    if (!t.querySelector('.m-body')) {
      var p = document.createElement('div'); p.className = 'm-prefix';
      p.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/></svg><span>Cuckoo</span>';
      var b = document.createElement('div'); b.className = 'm-body';
      t.appendChild(p); t.appendChild(b); curAi = b;
    }
    return curAi;
  }
  function thinkEl() {
    var t = getTurn();
    if (!t.__mounted) { t.className = 'm-msg ai'; add(t); t.__mounted = true; }
    var w = document.createElement('div'); w.className = 'm-think open';
    var h = document.createElement('div'); h.className = 'm-think-h';
    h.innerHTML = '<svg class="m-caret" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg><span>思考中…</span>';
    var b = document.createElement('div'); b.className = 'm-think-b';
    h.onclick = function () { w.classList.toggle('open'); };
    w.appendChild(h); w.appendChild(b);
    var body = t.querySelector('.m-body');
    if (body) t.insertBefore(w, body); else t.appendChild(w);
    return { wrap: w, body: b };
  }
  function toolEl(code) {
    var t = getTurn();
    if (!t.__mounted) { t.className = 'm-msg ai'; add(t); t.__mounted = true; }
    var w = document.createElement('div'); w.className = 'm-tool run';
    var h = document.createElement('div'); h.className = 'm-tool-h';
    h.innerHTML = '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.6 5.6L4 17v3h3l5.1-5.1a4 4 0 0 0 5.6-5.6l-2.5 2.5-2.1-2.1z"/></svg><span class="m-tool-name">工具</span><span class="m-tool-arg"></span><span class="m-tool-badge">运行中</span>';
    h.querySelector('.m-tool-arg').textContent = firstLine(code);
    var b = document.createElement('div'); b.className = 'm-tool-b';
    var pre = document.createElement('pre'); pre.className = 'm-tool-pre'; pre.textContent = code || '';
    b.appendChild(pre);
    h.onclick = function () { w.classList.toggle('open'); };
    w.appendChild(h); w.appendChild(b);
    var body = t.querySelector('.m-body');
    if (body) t.insertBefore(w, body); else t.appendChild(w);
    return { wrap: w, badge: h.querySelector('.m-tool-badge'), pre: pre };
  }
  function add(el) { if (!wrap.parentNode) $stream.appendChild(wrap); wrap.appendChild(el); if (atBottom()) toBottom(); }
  function resetStream(showSys, text) {
    // 清空对话流（切换会话/新对话时）
    wrap.innerHTML = '';
    curAi = null; curThink = null; curTurn = null; toolMap = {}; lastAi = '';
    if (showSys) sysMsg('', text || '已切换会话');
  }

  function onEvent(m) {
    var t = m.type;
    // 诊断：把收到的事件类型显示在状态栏 title（长按可见）
    try { window.__lcLastEvent = t; } catch (_) {}
    // ===== 会话隔离（防串门）=====
    var evSid = (m.sessionId === undefined || m.sessionId === null) ? null : String(m.sessionId);
    if (t === 'session-changed') {
      if (evSid === null) return;
      if (curSessionId !== null && evSid === curSessionId) return; // 同会话，不重复清空
      curSessionId = evSid;
      resetStream(true, '已切换会话');
      return;
    }
    if (evSid !== null) {
      if (curSessionId === null) {
        curSessionId = evSid;                 // 首次确定当前会话
      } else if (evSid !== curSessionId) {
        // 事件属于别的会话（session-changed 可能未到达）→ 自动切换、清空
        curSessionId = evSid;
        resetStream(true, '已切换会话');
      }
    }
    if (t === 'user-message') {
      var ut = String(m.text || '');
      if (!ut) return;
      var nowMs = Date.now();
      // 手机自己刚发的（本地已显示）→ 跳过；否则是电脑发的 → 显示
      if (pendingUserTexts[ut] && nowMs - pendingUserTexts[ut] < 8000) {
        delete pendingUserTexts[ut];
        return;
      }
      userMsg(ut); toBottom();
      return;
    }
    if (t === 'stream') {
      var tk = String(m.think || '').trim();
      if (tk) { if (!curThink) curThink = thinkEl(); curThink.body.textContent = tk; }
      else if (curThink) { curThink.wrap.classList.remove('open'); }
      var b = ensureAi(); b.textContent = m.text || '';
      if (atBottom()) toBottom();
    } else if (t === 'assistant-done') {
      var dt = String(m.text || '').trim();
      if (dt) { var b2 = ensureAi(); b2.textContent = dt; lastAi = dt; }
      curAi = null; curThink = null;
    } else if (t === 'tool-start') {
      if (curThink) curThink.wrap.classList.remove('open');
      var el = toolEl(m.code || ''); if (m.code) toolMap[m.code] = el; curAi = null;
    } else if (t === 'tool-end') {
      var e2 = toolMap[m.code];
      if (e2) {
        if (m.success) { e2.wrap.className = 'm-tool ok'; e2.badge.textContent = '完成'; }
        else { e2.wrap.className = 'm-tool err'; e2.badge.textContent = '失败'; if (m.error) e2.pre.textContent = String(m.code || '') + String.fromCharCode(10, 10) + '错误：' + m.error; }
        delete toolMap[m.code];
      }
      curAi = null; curThink = null;
    } else if (t === 'task-idle') { curAi = null; curThink = null; curTurn = null; setBusy(false); }
    else if (t === 'ai-state') { setBusy(!!m.generating); }
  }

  function setBusy(on) {
    busy = on;
    if (!busy) return;
  }
  function updateSend() { if (busy) return; $send.disabled = !(ws && ws.readyState === 1) || !$input.value.trim(); }
  function grow() { $input.style.height = 'auto'; $input.style.height = Math.min($input.scrollHeight, 140) + 'px'; updateSend(); }
  function submit() {
    if (busy) { send({ type: 'stop' }); return; }
    var v = $input.value.trim(); if (!v) return;
    if (!send({ type: 'send', text: v })) { sysMsg('err', '未连接'); return; }
    pendingUserTexts[v] = Date.now();   // 标记：等回显时去重
    curTurn = null; curAi = null; curThink = null; lastAi = '';
    userMsg(v); toBottom(); $input.value = ''; grow();
  }
  if ($send) $send.onclick = submit;
  if ($input) {
    $input.addEventListener('input', grow);
    $input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  }

  // ================= 各页 loaders =================
  loaders.workspaces = function () {
    loadList('ws-list', 'listAllSessions', function (d) { return (d.sessions || []).filter(function (s) { return !s.archived && s.kind !== 'subagent'; }); }, function (s) {
      var cur = s.sessionId === window.__lcCurSession;
      return '<div class="ck-list-item" data-sid="' + esc(s.sessionId) + '" style="' + (cur ? 'background:var(--ck-primary-soft)' : '') + '">' +
        '<div style="font-size:12.5px;color:var(--ck-text)">' + esc(s.title || s.sessionId) + '</div>' +
        '<div style="font-size:11px;color:var(--ck-text-dim);margin-top:2px">' + esc(baseName(s.projectDir)) + '</div></div>';
    }, '还没有会话');
    setTimeout(function () {
      document.querySelectorAll('#ws-list .ck-list-item').forEach(function (el) {
        el.onclick = function () {
          curSessionId = el.dataset.sid;                 // 立刻切到目标会话
          resetStream(true, '正在切换会话…');            // 立即清空，避免旧会话残留
          shellAPI.navigateSession(el.dataset.sid);
        };
      });
    }, 400);
  };
  loaders.conversations = function () {
    loadList('conv-list', 'listWebSessions', function (d) { return d.sessions || []; }, function (s) {
      return '<div class="ck-list-item" data-url="' + esc(s.href) + '" style="' + (s.active ? 'background:var(--ck-primary-soft)' : '') + '">' + esc(s.title) + '</div>';
    }, '暂无会话（或当前平台不支持）');
    setTimeout(function () {
      document.querySelectorAll('#conv-list .ck-list-item').forEach(function (el) {
        el.onclick = function () { if (el.dataset.url) shellAPI.navigateWebSession(el.dataset.url); };
      });
    }, 400);
    var nb = document.getElementById('conv-new'); if (nb) nb.onclick = function () { shellAPI.newWebConversation(); };
    var rb = document.getElementById('conv-refresh'); if (rb) rb.onclick = loaders.conversations;
  };
  loaders.memories = function () {
    shellAPI.getMemoriesEnabled().then(function (r) { var cb = document.getElementById('mem-enabled'); var d = (r && r.data) || r; if (cb && d && d.success !== false) cb.checked = !!d.enabled; });
    loadList('mem-list', 'listMemories', function (d) { return d.memories || []; }, function (m) {
      return '<div class="ck-list-item" style="display:flex;gap:8px;align-items:flex-start"><div style="flex:1;min-width:0;word-break:break-word">' + esc(m.text) + '</div>' +
        '<span class="ck-btn-text" data-del="' + esc(m.id) + '" style="flex-shrink:0">删除</span></div>';
    }, '还没有记忆');
    setTimeout(function () {
      document.querySelectorAll('#mem-list [data-del]').forEach(function (el) { el.onclick = function () { shellAPI.deleteMemory(el.dataset.del).then(loaders.memories); }; });
    }, 400);
    var cb = document.getElementById('mem-enabled'); if (cb) cb.onchange = function () { shellAPI.setMemoriesEnabled(cb.checked); };
  };
  loaders.snapshots = function () {
    loadList('snap-list', 'listSnapshots', function (d) { return d.snapshots || []; }, function (s) {
      return '<div class="ck-list-item"><div style="font-size:12.5px;color:var(--ck-text)">' + esc(s.name) + '</div>' +
        '<div style="font-size:11px;color:var(--ck-text-dim);margin-top:3px">' + esc(baseName(s.projectDir)) + ' · ' + (s.fileCount || 0) + ' 个文件</div></div>';
    }, '还没有快照');
    var rb = document.getElementById('snap-refresh'); if (rb) rb.onclick = loaders.snapshots;
  };
  loaders.skills = function () {
    loadList('skills-list', 'listSkills', function (d) { return d.skills || d.list || (Array.isArray(d) ? d : []); }, function (s) {
      return '<div class="ck-list-item"><div style="font-size:12.5px;color:var(--ck-text)">' + esc(s.name) + '</div>' +
        (s.description ? '<div style="font-size:11px;color:var(--ck-text-dim);margin-top:3px">' + esc(s.description) + '</div>' : '') + '</div>';
    }, '还没有技能');
    var rb = document.getElementById('skills-refresh'); if (rb) rb.onclick = loaders.skills;
  };
  loaders.plugins = function () {
    loadList('plugin-installed', 'listInstalledPlugins', function (d) { return d.plugins || d.list || (Array.isArray(d) ? d : []); }, function (p) {
      var on = p.enabled !== false;
      return '<div class="ck-list-item" style="display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;min-width:0"><div style="font-size:12.5px;color:var(--ck-text)">' + esc(p.name || p.id) + '</div>' +
        '<div style="font-size:11px;color:var(--ck-text-dim);margin-top:2px">' + esc(p.id || '') + '</div></div>' +
        '<label class="ck-btn-text" style="flex-shrink:0"><input type="checkbox" data-toggle="' + esc(p.id) + '" ' + (on ? 'checked' : '') + '></label></div>';
    }, '还没有安装插件');
    setTimeout(function () {
      document.querySelectorAll('#plugin-installed [data-toggle]').forEach(function (el) { el.onchange = function () { shellAPI.pluginSetEnabled(el.dataset.toggle, el.checked); }; });
    }, 400);
  };
  loaders.files = function () {
    loadList('ft-list', 'listProjectTree', function (d) { return d.tree || d.files || d.list || (Array.isArray(d) ? d : []); }, function (f) {
      var name = typeof f === 'string' ? f : (f.path || f.name || '');
      return '<div class="ck-list-item" data-rel="' + esc(name) + '" style="font-family:var(--mono,monospace);font-size:11.5px">' + esc(name) + '</div>';
    }, '项目目录未初始化');
    setTimeout(function () {
      document.querySelectorAll('#ft-list .ck-list-item').forEach(function (el) {
        el.onclick = function () {
          var body = document.getElementById('ck-preview-body'); if (!body) return;
          body.innerHTML = '<div class="ck-list-empty">读取中…</div>';
          shellAPI.readProjectFile(el.dataset.rel).then(function (pr) {
            var d = (pr && pr.data) || pr; var content = (d && (d.content || d.data)) || (d && d.error ? d.error : '（空）');
            body.innerHTML = '<pre style="white-space:pre-wrap;word-break:break-word;font-family:var(--mono,monospace);font-size:11px;line-height:1.6;padding:8px">' + esc(content) + '</pre>';
          });
        };
      });
    }, 400);
    var rb = document.getElementById('ft-refresh'); if (rb) rb.onclick = loaders.files;
  };
  loaders.agents = function () {
    loadList('agent-list', 'listAgents', function (d) { return d.agents || d.list || (Array.isArray(d) ? d : []); }, function (a) {
      return '<div class="ck-list-item"><div style="font-size:12.5px;color:var(--ck-text)">' + esc(a.name) + '</div>' +
        (a.description ? '<div style="font-size:11px;color:var(--ck-text-dim);margin-top:3px">' + esc(a.description) + '</div>' : '') + '</div>';
    }, '还没有子代理');
    var rb = document.getElementById('agent-refresh'); if (rb) rb.onclick = loaders.agents;
  };
  loaders.mcp = function () {
    loadList('mcp-list', 'listMcpServers', function (d) { return d.servers || d.list || (Array.isArray(d) ? d : []); }, function (m) {
      var on = m.enabled !== false; var st = m.connected ? '已连接' : (on ? '未连接' : '已禁用');
      return '<div class="ck-list-item" style="display:flex;align-items:center;gap:8px">' +
        '<div style="flex:1;min-width:0"><div style="font-size:12.5px;color:var(--ck-text)">' + esc(m.name) + '</div>' +
        '<div style="font-size:11px;color:var(--ck-text-dim);margin-top:2px">' + esc(st) + (m.toolCount ? ' · ' + m.toolCount + ' 工具' : '') + '</div></div>' +
        '<label class="ck-btn-text" style="flex-shrink:0"><input type="checkbox" data-mcp="' + esc(m.name) + '" ' + (on ? 'checked' : '') + '></label></div>';
    }, '还没有 MCP 连接器');
    setTimeout(function () {
      document.querySelectorAll('#mcp-list [data-mcp]').forEach(function (el) { el.onchange = function () { var n = el.dataset.mcp; if (el.checked) shellAPI.enableMcpServer(n); else shellAPI.disableMcpServer(n); }; });
    }, 400);
    var rb = document.getElementById('mcp-refresh'); if (rb) rb.onclick = loaders.mcp;
  };
  loaders.windows = function () {
    loadList('win-list', 'listProfiles', function (d) { return d.profiles || d.windows || d.list || (Array.isArray(d) ? d : []); }, function (w) {
      var pid = w.profileId || w.id || '';
      return '<div class="ck-list-item" data-pid="' + esc(pid) + '"><div style="font-size:12.5px;color:var(--ck-text)">' + esc(w.providerId || w.name || pid) + '</div>' +
        '<div style="font-size:11px;color:var(--ck-text-dim);margin-top:2px">' + esc(pid) + '</div></div>';
    }, '暂无窗口');
    setTimeout(function () {
      document.querySelectorAll('#win-list .ck-list-item').forEach(function (el) { el.onclick = function () { if (el.dataset.pid) shellAPI.openProfileWindow(el.dataset.pid); }; });
    }, 400);
    var rb = document.getElementById('win-refresh'); if (rb) rb.onclick = loaders.windows;
  };
  loaders.token = function () {
    shellAPI.getSystemTotal().then(function (r) { var d = (r && r.data) || r; var el = document.getElementById('tk-system'); if (el) el.textContent = (d && (d.total || d.value)) || 0; });
    shellAPI.getAutoCompact().then(function (r) { var d = (r && r.data) || r; var s = (d && (d.data || d.settings)) || d || {}; var cb = document.getElementById('tk-auto-enabled'); if (cb) cb.checked = !!s.enabled; var th = document.getElementById('tk-auto-threshold'); if (th && s.threshold) th.value = s.threshold; });
    var cb = document.getElementById('tk-auto-enabled'); var th = document.getElementById('tk-auto-threshold'); var sv = document.getElementById('tk-auto-save');
    if (sv) sv.onclick = function () { shellAPI.saveAutoCompact({ enabled: cb ? cb.checked : false, threshold: th ? Number(th.value) : 80 }); };
    var cp = document.getElementById('tk-compact'); if (cp) cp.onclick = function () { shellAPI.triggerCompact(); };
  };
  loaders.about = function () {
    shellAPI.getAppInfo().then(function (r) { var d = (r && r.data) || r; var el = document.getElementById('about-version'); if (el) el.textContent = (d && d.version) || '—'; });
    var gh = document.getElementById('about-github'); if (gh) gh.onclick = function () { shellAPI.openExternal('https://github.com/wangyongpeng90/cuckoo-code'); };
    var cu = document.getElementById('about-check-update'); if (cu) cu.onclick = function () { shellAPI.checkUpdate().then(function (r) { var d = (r && r.data) || r; alert(d && d.version ? ('最新版本：' + d.version) : (d && d.error ? d.error : '已是最新')); }); };
  };
  loaders.settings = function () {
    var body = document.querySelector('[data-panel="settings"]'); if (!body) return;
    shellAPI.getSettings().then(function (r) {
      var d = (r && r.data) || r; var s = (d && (d.settings || d.data)) || d || {};
      body.innerHTML = '<div class="ck-card"><div class="ck-label">设置项（JSON）</div>' +
        '<textarea id="m-settings-json" style="width:100%;min-height:220px;font-family:ui-monospace,monospace;font-size:11px;padding:8px;border:1px solid var(--ck-border);border-radius:8px;background:var(--ck-surface);color:var(--ck-text)"></textarea>' +
        '<button class="ck-btn ck-btn-primary" id="m-settings-save" style="margin-top:10px">保存</button></div>';
      var ta = document.getElementById('m-settings-json'); ta.value = JSON.stringify(s, null, 2);
      document.getElementById('m-settings-save').onclick = function () { try { var obj = JSON.parse(ta.value); shellAPI.saveSettings(obj); } catch (e) { alert('JSON 格式错误：' + e.message); } };
    });
  };

  // ================= 抽屉 =================
  var $drawer = document.getElementById('m-drawer');
  var $scrim = document.getElementById('m-scrim');
  var $menu = document.getElementById('m-menu');
  if ($menu) $menu.onclick = function () {
    $drawer.classList.add('open'); $scrim.classList.add('open');
    var cur = currentTab(); if (cur && loaders[cur]) loaders[cur]();
  };
  if ($scrim) $scrim.onclick = function () { $drawer.classList.remove('open'); $scrim.classList.remove('open'); };
  var $newBtn = document.getElementById('m-new');
  if ($newBtn) $newBtn.onclick = function () { send({ type: 'new' }); };

  // ================= 启动 =================
  // 移除开机标记（脚本正常执行到这里）
  try { var boot = document.getElementById('m-boot'); if (boot) boot.remove(); } catch (_) {}
  // 隐藏没有对应页面的活动栏按钮（避免点到后空白）
  document.querySelectorAll('.ck-ab-item').forEach(function (it) {
    var tab = it.dataset.tab;
    if (!tab) return;
    if (!loaders[tab] && !document.querySelector('.ck-tab[data-panel="' + tab + '"]')) it.style.display = 'none';
  });
  // 拉一次当前会话（用于工作区高亮）
  shellAPI.listAllSessions && shellAPI.listAllSessions().then(function (r) { var d = (r && r.data) || r; if (d && d.currentSessionId) window.__lcCurSession = d.currentSessionId; });

  connect();
  var t = setInterval(function () { if (ready) { clearInterval(t); updateSend(); } }, 300);
  // 诊断：长按标题显示最近收到的事件 + 连接状态
  var $title = document.querySelector('.m-topbar .m-title');
  if ($title) {
    var pressTimer = null;
    $title.addEventListener('touchstart', function () { pressTimer = setTimeout(function () { alert('WS: ' + (ready ? '已连接' : '未连接') + '\n最近事件: ' + (window.__lcLastEvent || '（无）') + '\nAPI映射: ' + Object.keys(API_MAP).length); }, 700); });
    $title.addEventListener('touchend', function () { clearTimeout(pressTimer); });
  }
})();
