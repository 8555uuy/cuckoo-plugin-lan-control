/**
 * 手机端壳页面逻辑
 *
 * 1. shellAPI polyfill：把电脑端页面 JS 期望的 window.shellAPI 调用，
 *    通过 WebSocket 转发到主进程（壳页桥，白名单）。
 * 2. 活动栏 tab 切换 + 各页加载（P1：工作区/对话/记忆/快照/技能/插件/设置）。
 *
 * 构建时注入：API_MAP 方法→通道映射；API_NOOP 订阅方法（no-op）。
 */
(function () {
  // 全局错误显示（手机端无控制台，把错误显示出来）
  window.addEventListener('error', function (e) {
    var b = document.getElementById('m-err');
    if (!b) { b = document.createElement('div'); b.id = 'm-err'; b.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#b91c1c;color:#fff;font-size:12px;padding:8px 12px;max-height:40%;overflow:auto;white-space:pre-wrap;'; document.body.appendChild(b); }
    b.textContent = '⚠ ' + (e.message || e.error || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || '');
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
        var cb = pending[msg.id]; delete pending[msg.id];
        cb(msg.result);
      } else {
        onEvent(msg);   // AI 事件 → 对话流
      }
    };
  }

  /** 调用一个白名单 IPC（走壳页桥） */
  function invoke(channel, args) {
    return new Promise(function (resolve) {
      if (!ready) { resolve({ success: false, error: 'not-connected' }); return; }
      var id = 'r' + (++seq);
      pending[id] = resolve;
      ws.send(JSON.stringify({ type: 'shell-api', id: id, channel: channel, args: args }));
      setTimeout(function () { if (pending[id]) { delete pending[id]; resolve({ success: false, error: 'timeout' }); } }, 15000);
    });
  }

  // shellAPI polyfill：名称 → 通道
  var shellAPI = {};
  Object.keys(API_MAP).forEach(function (name) {
    shellAPI[name] = function (a) { return invoke(API_MAP[name], a); };
  });
  // 订阅类：no-op（返回一个空函数，让调用方不炸）
  NOOP_SET && Object.keys(NOOP_SET).forEach(function (name) {
    if (!shellAPI[name]) shellAPI[name] = function () { return function () {}; };
  });
  // 少数壳页逻辑直接用的同步方法：兜底 no-op
  ['reportShellSize', 'startSidebarDrag', 'endSidebarDrag', 'toggleSidebar'].forEach(function (n) {
    if (!shellAPI[n]) shellAPI[n] = function () {};
  });
  if (!shellAPI.openExternal) shellAPI.openExternal = function (url) { try { window.open(url, '_blank'); } catch (_) {} };
  window.shellAPI = shellAPI;

  // ================= tab 切换 =================
  var loaders = {};
  var TAB_TITLES = {
    workspaces: '工作区', files: '项目文件', snippets: '提示词', memories: '记忆',
    snapshots: '快照', skills: '技能', plugins: '插件', conversations: '对话',
    agents: '子代理', mcp: 'MCP', windows: '窗口', token: 'Token',
    about: '关于', feishu: '飞书', settings: '设置',
  };
  function currentTab() {
    var it = document.querySelector('.ck-ab-item.ck-ab-active');
    return it ? it.dataset.tab : null;
  }
  function activate(tab) {
    document.querySelectorAll('.ck-ab-item').forEach(function (i) {
      i.classList.toggle('ck-ab-active', i.dataset.tab === tab);
    });
    document.querySelectorAll('.ck-tab').forEach(function (p) {
      p.classList.toggle('ck-tab-active', p.dataset.panel === tab);
    });
    var t = document.querySelector('.m-topbar .m-title');
    if (t) t.textContent = TAB_TITLES[tab] || 'Cuckoo';
  }
  var abar = document.querySelector('.ck-activitybar');
  if (abar) abar.addEventListener('click', function (e) {
    var it = e.target.closest && e.target.closest('.ck-ab-item');
    if (!it || !it.dataset.tab) return;
    var tab = it.dataset.tab;
    activate(tab);
    var f = loaders[tab];
    if (f) { try { f(); } catch (err) { console.error(err); } }
    else { placeholder(tab); }
  });
  function placeholder(tab) {
    // 不支持的页：面板 body 里显示提示
    var body = document.querySelector('.ck-panel-body');
    if (!body) return;
    body.innerHTML = '<div class="ck-tab ck-tab-active" data-panel="' + tab + '"><div class="ck-list-empty" style="padding-top:60px">' +
      (TAB_TITLES[tab] || tab) + '：手机端暂不支持</div></div>';
  }

  // ================= 通用 =================
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function baseName(p) { if (!p) return ''; var a = String(p).replace(/[\\/]+$/, '').split(/[\\/]/); return a[a.length - 1] || p; }
  function setList(id, html) { var el = document.getElementById(id); if (el) el.innerHTML = html; }
  function empty(id, text) { setList(id, '<div class="ck-list-empty">' + esc(text || '暂无数据') + '</div>'); }

  // ================= 工作区 =================
  loaders.workspaces = function () {
    setList('ws-list', '<div class="ck-list-empty">加载中…</div>');
    shellAPI.listAllSessions().then(function (r) {
      if (!r || !r.success) { empty('ws-list', '加载失败'); return; }
      var sessions = (r.sessions || []).filter(function (s) { return !s.archived && s.kind !== 'subagent'; });
      if (!sessions.length) { empty('ws-list', '还没有会话'); return; }
      // 按项目目录分组
      var groups = {};
      sessions.forEach(function (s) { (groups[s.projectDir] = groups[s.projectDir] || []).push(s); });
      var html = '';
      Object.keys(groups).forEach(function (dir) {
        var list = groups[dir].sort(function (a, b) { return (Date.parse(b.updatedAt || 0) || 0) - (Date.parse(a.updatedAt || 0) || 0); });
        html += '<div class="ck-set-group-title" style="padding:8px 2px 4px">' + esc(baseName(dir) || '未命名') + '</div>';
        list.forEach(function (s) {
          var cur = s.sessionId === r.currentSessionId;
          html += '<div class="ck-list-item" data-sid="' + esc(s.sessionId) + '" style="' + (cur ? 'background:var(--ck-primary-soft)' : '') + '">' +
            '<div style="font-size:12.5px;color:var(--ck-text)">' + esc(s.title || s.sessionId) + '</div></div>';
        });
      });
      setList('ws-list', html);
      document.querySelectorAll('#ws-list .ck-list-item').forEach(function (el) {
        el.onclick = function () { shellAPI.navigateSession(el.dataset.sid); };
      });
    });
  };

  // ================= 对话（官网） =================
  loaders.conversations = function () {
    setList('conv-list', '<div class="ck-list-empty">加载中…</div>');
    shellAPI.listWebSessions().then(function (r) {
      if (!r || !r.success || !r.sessions || !r.sessions.length) { empty('conv-list', '暂无会话（或当前平台不支持）'); return; }
      var html = r.sessions.slice(0, 60).map(function (s) {
        return '<div class="ck-list-item" data-url="' + esc(s.href) + '" style="' + (s.active ? 'background:var(--ck-primary-soft)' : '') + '">' + esc(s.title) + '</div>';
      }).join('');
      setList('conv-list', html);
      document.querySelectorAll('#conv-list .ck-list-item').forEach(function (el) {
        el.onclick = function () { if (el.dataset.url) shellAPI.navigateWebSession(el.dataset.url); };
      });
    });
    var nb = document.getElementById('conv-new'); if (nb) nb.onclick = function () { shellAPI.newWebConversation(); };
    var rb = document.getElementById('conv-refresh'); if (rb) rb.onclick = loaders.conversations;
  };

  // ================= 记忆 =================
  loaders.memories = function () {
    setList('mem-list', '<div class="ck-list-empty">加载中…</div>');
    shellAPI.getMemoriesEnabled().then(function (er) {
      var cb = document.getElementById('mem-enabled');
      if (cb && er && er.success) cb.checked = !!er.enabled;
    });
    shellAPI.listMemories().then(function (r) {
      var list = (r && r.memories) || [];
      if (!list.length) { empty('mem-list', '还没有记忆'); return; }
      var html = list.map(function (m) {
        return '<div class="ck-list-item" style="display:flex;gap:8px;align-items:flex-start">' +
          '<div style="flex:1;min-width:0;word-break:break-word">' + esc(m.text) + '</div>' +
          '<span class="ck-btn-text" data-del="' + esc(m.id) + '" style="flex-shrink:0">删除</span></div>';
      }).join('');
      setList('mem-list', html);
      document.querySelectorAll('#mem-list [data-del]').forEach(function (el) {
        el.onclick = function () { shellAPI.deleteMemory(el.dataset.del).then(loaders.memories); };
      });
    });
    var cb = document.getElementById('mem-enabled');
    if (cb) cb.onchange = function () { shellAPI.setMemoriesEnabled(cb.checked); };
  };

  // ================= 快照 =================
  loaders.snapshots = function () {
    setList('snap-list', '<div class="ck-list-empty">加载中…</div>');
    shellAPI.listSnapshots().then(function (r) {
      var list = (r && r.snapshots) || [];
      if (!list.length) { empty('snap-list', '还没有快照'); return; }
      var html = list.map(function (s) {
        return '<div class="ck-list-item"><div style="font-size:12.5px;color:var(--ck-text)">' + esc(s.name) + '</div>' +
          '<div style="font-size:11px;color:var(--ck-text-dim);margin-top:3px">' + esc(baseName(s.projectDir)) + ' · ' + (s.fileCount || 0) + ' 个文件</div></div>';
      }).join('');
      setList('snap-list', html);
    });
    var rb = document.getElementById('snap-refresh'); if (rb) rb.onclick = loaders.snapshots;
  };

  // ================= 技能 =================
  loaders.skills = function () {
    setList('skills-list', '<div class="ck-list-empty">加载中…</div>');
    shellAPI.listSkills().then(function (r) {
      var list = (r && r.skills) || (Array.isArray(r) ? r : []);
      if (!list.length) { empty('skills-list', '还没有技能'); return; }
      var html = list.map(function (s) {
        return '<div class="ck-list-item"><div style="font-size:12.5px;color:var(--ck-text)">' + esc(s.name) + '</div>' +
          (s.description ? '<div style="font-size:11px;color:var(--ck-text-dim);margin-top:3px">' + esc(s.description) + '</div>' : '') + '</div>';
      }).join('');
      setList('skills-list', html);
    });
    var rb = document.getElementById('skills-refresh'); if (rb) rb.onclick = loaders.skills;
  };

  // ================= 插件 =================
  loaders.plugins = function () {
    setList('plugin-installed', '<div class="ck-list-empty">加载中…</div>');
    shellAPI.listInstalledPlugins().then(function (r) {
      var list = (r && (r.plugins || r.list)) || (Array.isArray(r) ? r : []);
      if (!list.length) { empty('plugin-installed', '还没有安装插件'); return; }
      var html = list.map(function (p) {
        var on = p.enabled !== false;
        return '<div class="ck-list-item" style="display:flex;align-items:center;gap:8px">' +
          '<div style="flex:1;min-width:0"><div style="font-size:12.5px;color:var(--ck-text)">' + esc(p.name || p.id) + '</div>' +
          '<div style="font-size:11px;color:var(--ck-text-dim);margin-top:2px">' + esc(p.id || '') + '</div></div>' +
          '<label class="ck-btn-text" style="flex-shrink:0"><input type="checkbox" data-toggle="' + esc(p.id) + '" ' + (on ? 'checked' : '') + '></label></div>';
      }).join('');
      setList('plugin-installed', html);
      document.querySelectorAll('#plugin-installed [data-toggle]').forEach(function (el) {
        el.onchange = function () { shellAPI.pluginSetEnabled(el.dataset.toggle, el.checked); };
      });
    });
  };

  // ================= 设置 =================
  loaders.settings = function () {
    var body = document.getElementById('settings-form') || document.querySelector('[data-panel="settings"]');
    if (!body) return;
    shellAPI.getSettings().then(function (r) {
      var s = (r && (r.settings || r.data)) || {};
      body.innerHTML = '';
      var wrap = document.createElement('div');
      wrap.className = 'ck-card';
      wrap.innerHTML = '<div class="ck-label">设置项（JSON）</div>' +
        '<textarea id="m-settings-json" style="width:100%;min-height:220px;font-family:ui-monospace,monospace;font-size:11px;padding:8px;border:1px solid var(--ck-border);border-radius:8px;background:var(--ck-surface);color:var(--ck-text)"></textarea>' +
        '<button class="ck-btn ck-btn-primary" id="m-settings-save" style="margin-top:10px">保存</button>';
      body.appendChild(wrap);
      var ta = document.getElementById('m-settings-json');
      ta.value = JSON.stringify(s, null, 2);
      document.getElementById('m-settings-save').onclick = function () {
        try { var obj = JSON.parse(ta.value); shellAPI.saveSettings(obj); } catch (e) { alert('JSON 格式错误：' + e.message); }
      };
    });
  };

  // ================= 对话流 =================
  var $stream = document.getElementById('m-stream');
  var $empty = document.getElementById('m-empty');
  var $input = document.getElementById('m-input');
  var $send = document.getElementById('m-send');
  var wrap = document.createElement('div');
  wrap.className = 'm-wrap';
  var curAi = null, curThink = null, curTurn = null, toolMap = {}, busy = false, lastAi = '';

  function atBottom() { return $stream.scrollHeight - $stream.scrollTop - $stream.clientHeight < 80; }
  function toBottom() { $stream.scrollTop = $stream.scrollHeight; }
  function rmEmpty() { if ($empty && $empty.parentNode) { $empty.parentNode.removeChild($empty); $empty = null; } }
  function add(el) {
    rmEmpty();
    if (!wrap.parentNode) $stream.appendChild(wrap);
    wrap.appendChild(el);
    if (atBottom()) toBottom();
  }
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

  function onEvent(m) {
    var t = m.type;
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
        else { e2.wrap.className = 'm-tool err'; e2.badge.textContent = '失败'; if (m.error) e2.pre.textContent = String(m.code || '') + String.fromCharCode(10,10) + '错误：' + m.error; }
        delete toolMap[m.code];
      }
      curAi = null; curThink = null;
    } else if (t === 'task-idle') { curAi = null; curThink = null; curTurn = null; setBusy(false); }
    else if (t === 'ai-state') { setBusy(!!m.generating); }
  }

  function setBusy(on) {
    busy = on;
    if (on) { setStatus('busy'); $send.className = 'stop'; $send.disabled = false; $send.innerHTML = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'; }
    else { setStatus('on'); $send.className = ''; $send.innerHTML = '<svg viewBox="0 0 24 24"><path d="m5 12 7-7 7 7M12 5v14"/></svg>'; updateSend(); }
  }
  function updateSend() { if (busy) return; $send.disabled = !(ws && ws.readyState === 1) || !$input.value.trim(); }
  function grow() { $input.style.height = 'auto'; $input.style.height = Math.min($input.scrollHeight, 140) + 'px'; updateSend(); }
  function submit() {
    if (busy) { send({ type: 'stop' }); return; }
    var v = $input.value.trim(); if (!v) return;
    if (!send({ type: 'send', text: v })) { sysMsg('err', '未连接'); return; }
    curTurn = null; curAi = null; curThink = null; lastAi = '';
    userMsg(v); toBottom(); $input.value = ''; grow();
  }
  if ($send) $send.onclick = submit;
  if ($input) {
    $input.addEventListener('input', grow);
    $input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } });
  }

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
  connect();
  var t = setInterval(function () { if (ready) { clearInterval(t); updateSend(); } }, 300);
})();
