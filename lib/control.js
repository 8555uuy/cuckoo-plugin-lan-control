/**
 * 双向控制桥（WebSocket）
 *
 * 挂在插件自己的 http.Server 上；手机连接 /ws 后：
 *   - 手机 → 电脑：见下方 handleMessage 的命令表
 *   - 电脑 → 手机：主进程广播的 AI 事件（stream / assistant-done / tool-start / tool-end / task-idle / ai-state）
 *
 * 控制能力来自主进程注入的 globalThis.__cuckooPluginControl（见 src/app/ipc/plugin-control.ts）。
 */
const { createWsServer } = require('./ws.js');

function attach(httpServer, opts) {
  const options = opts || {};
  const wsPath = options.path || '/ws';
  const isAuthed = options.isAuthed;
  const wsServer = createWsServer(httpServer, { path: wsPath });
  const authed = new Set();

  function reply(ws, obj) {
    try { ws.send(JSON.stringify(obj)); } catch (_) { /* ignore */ }
  }

  function handleMessage(ws, raw) {
    let msg = null;
    try { msg = JSON.parse(typeof raw === 'string' ? raw : String(raw)); } catch (_) {}
    if (!msg || typeof msg.type !== 'string') {
      reply(ws, { type: 'error', error: 'bad-message' });
      return;
    }
    const ctl = (globalThis.__cuckooPluginControl) || null;

    function call(fn) {
      if (!ctl) { reply(ws, { type: 'error', error: 'control-unavailable' }); return; }
      try {
        const r = fn(ctl);
        if (r && typeof r.then === 'function') {
          r.then((data) => reply(ws, { type: 'ack', ok: true, forType: msg.type, data }))
           .catch((e) => reply(ws, { type: 'error', error: String((e && e.message) || e) }));
        } else {
          reply(ws, { type: 'ack', ok: true, forType: msg.type, data: r });
        }
      } catch (e) {
        reply(ws, { type: 'error', error: String((e && e.message) || e) });
      }
    }

    switch (msg.type) {
      // ===== 对话 =====
      case 'send':    call((c) => c.sendMessage(String(msg.text || ''))); break;
      case 'stop':    call((c) => c.stop()); break;
      case 'new':     call((c) => c.newConversation()); break;

      // ===== 查询 =====
      case 'status':    call((c) => c.getStatus()); break;
      case 'windows':   call((c) => c.listWindows()); break;
      case 'providers': call((c) => c.listProviders()); break;
      case 'sessions':  call((c) => c.listSessions()); break;
      case 'web-sessions': call((c) => c.listWebSessions()); break;
      case 'navigate-url': call((c) => c.navigateUrl(String(msg.url || ''))); break;
      case 'appinfo':   call((c) => c.getAppInfo()); break;

      // ===== 会话操作 =====
      case 'switch-session': call((c) => c.navigateSession(String(msg.sessionId || ''))); break;
      case 'new-for-project': call((c) => c.newConversationForProject(String(msg.projectDir || ''))); break;

      // ===== 窗口操作 =====
      case 'switch-window': call((c) => c.setActiveWindow(Number(msg.windowId))); break;

      // ===== 导航 =====
      case 'back':    call((c) => c.goBack()); break;
      case 'forward': call((c) => c.goForward()); break;
      case 'reload':  call((c) => c.reload()); break;
      case 'home':    call((c) => c.goHome()); break;

      // ===== 心跳 =====
      case 'ping':    reply(ws, { type: 'pong' }); break;
      default:        reply(ws, { type: 'error', error: 'unknown-type:' + msg.type });
    }
  }

  wsServer.on('connection', (ws, req) => {
    let ok = true;
    try { ok = (typeof isAuthed === 'function') ? !!isAuthed(req) : true; } catch (_) { ok = false; }
    if (!ok) {
      reply(ws, { type: 'unauthorized' });
      ws.close(4001, 'unauthorized');
      return;
    }
    authed.add(ws);
    reply(ws, { type: 'hello', ok: true });
    ws.on('message', (text) => handleMessage(ws, text));
    ws.on('close', () => authed.delete(ws));
  });

  function broadcast(payload) {
    let s;
    try { s = JSON.stringify(payload); } catch (_) { return; }
    for (const ws of authed) ws.send(s);
  }

  return { wsServer, authed, broadcast, clientCount: () => authed.size };
}

module.exports = { attach };
