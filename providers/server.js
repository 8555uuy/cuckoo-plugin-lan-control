/**
 * 局域网控制 —— 主进程可执行入口（providers/server.js）
 *
 * 初版：起一个 HTTP 服务（占位），暴露状态接口，供手机/平板在局域网访问。
 * 后续：接入远程控制功能（发消息、执行命令、管理会话等）。
 *
 * 注意：provider 文件在「主进程」与「渲染进程」都会被 require：
 *   - 主进程：真正起 HTTP 服务
 *   - 渲染进程：只跳过（服务只能在主进程起，否则会起两个实例）
 */
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const PLUGIN_ID = 'lan-control';

// 双向控制桥（WebSocket）：手机 ↔ 电脑
const { attach: attachWsBridge } = require(path.join(__dirname, '..', 'lib', 'control.js'));
let wsBridge = null;

// 二维码库（qrcode-generator，CommonJS）——本地 lib/ 下，离线可用
let _qrcode = null;
function getQrcode() {
  if (_qrcode !== null) return _qrcode;
  try {
    const p = path.join(__dirname, '..', 'lib', 'qrcode.js');
    if (fs.existsSync(p)) {
      const req = require('node:module').createRequire(__filename);
      _qrcode = req(p);
    }
  } catch (e) {
    console.log('[lan-control] 二维码库加载失败: ' + (e && e.message));
    _qrcode = false;
  }
  return _qrcode;
}

/** 生成二维码 SVG 字符串（失败返回空串） */
function makeQrSvg(text, sizePx) {
  const qr = getQrcode();
  if (!qr) return '';
  try {
    const q = qr(0, 'M');   // 0 = 自动选版本，M = 纠错等级
    q.addData(text);
    q.make();
    const n = q.getModuleCount();
    const quiet = 2;                     // 静默区（模块数）
    const total = n + quiet * 2;
    const px = sizePx || 220;
    const cell = px / total;
    let rects = '';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (q.isDark(r, c)) {
          rects += '<rect x="' + ((c + quiet) * cell).toFixed(2) + '" y="' + ((r + quiet) * cell).toFixed(2) + '" width="' + cell.toFixed(2) + '" height="' + cell.toFixed(2) + '"/>';
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + px + '" height="' + px + '" viewBox="0 0 ' + px + ' ' + px + '" shape-rendering="crispEdges">' +
      '<rect width="' + px + '" height="' + px + '" fill="#ffffff"/>' +
      '<g fill="#000000">' + rects + '</g></svg>';
  } catch (e) {
    console.log('[lan-control] 二维码生成失败: ' + (e && e.message));
    return '';
  }
}

/** 当前可访问的局域网地址（优先第一个非虚拟网卡 IP） */
function lanUrl() {
  const cfg = readConfig();
  const ips = getLanIPs();
  const ip = ips.length ? ips[0].ip : '127.0.0.1';
  return 'http://' + ip + ':' + (listenPort || cfg.port) + '/';
}

function configFile() {
  const home = process.env.CUCKOO_HOME || path.join(os.homedir(), '.cuckoo');
  return path.join(home, 'plugins-config.json');
}

function readConfig() {
  const out = { port: 18800, host: '0.0.0.0', autoStart: true, enabled: true, password: '' };
  try {
    const table = JSON.parse(fs.readFileSync(configFile(), 'utf-8'));
    const mine = table[PLUGIN_ID] || {};
    if (typeof mine.port === 'number') out.port = mine.port;
    if (typeof mine.host === 'string') out.host = mine.host;
    if (typeof mine.autoStart === 'boolean') out.autoStart = mine.autoStart;
    if (typeof mine.enabled === 'boolean') out.enabled = mine.enabled;
    if (typeof mine.password === 'string') out.password = mine.password;
  } catch (_) { /* ignore */ }
  return out;
}

/** 合并写入本插件配置（保留其它键） */
function writeConfig(patch) {
  try {
    const file = configFile();
    let t = {};
    try { t = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (_) { /* ignore */ }
    t[PLUGIN_ID] = Object.assign({}, t[PLUGIN_ID] || {}, patch || {});
    fs.writeFileSync(file, JSON.stringify(t, null, 2), 'utf-8');
    return true;
  } catch (_) { return false; }
}

/** 随机密码（去除易混字符） */
function randomPassword(len) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  const n = len || 10;
  for (let i = 0; i < n; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

const crypto = require('node:crypto');

/**
 * 登录 cookie 的签名密钥 —— 持久化到文件，重启后旧 cookie 仍有效。
 * （原来每次进程重启都随机生成，导致手机每隔一会儿就被踢回登录页。）
 */
const COOKIE_NAME = 'lc_auth';
const COOKIE_SECRET = (function () {
  try {
    const f = path.join(path.dirname(configFile()), 'lan-control-secret');
    if (fs.existsSync(f)) {
      const s = fs.readFileSync(f, 'utf-8').trim();
      if (s) return s;
    }
    const s = crypto.randomBytes(24).toString('hex');
    fs.writeFileSync(f, s, { encoding: 'utf-8', mode: 0o600 });
    return s;
  } catch (_) {
    return crypto.randomBytes(16).toString('hex');
  }
})();

/** 诊断日志（写文件，便于排查） */
function dlog(msg) {
  try {
    const f = path.join(path.dirname(configFile()), 'lan-control.log');
    fs.appendFileSync(f, new Date().toISOString() + ' ' + msg + '\n', 'utf-8');
  } catch (_) { /* ignore */ }
  console.log('[lan-control] ' + msg);
}

/** 生成登录 cookie 值：HMAC(密码) */
function makeCookie(pw) {
  const h = crypto.createHmac('sha256', COOKIE_SECRET).update(String(pw || '')).digest('hex');
  return h;
}

/** 校验请求是否已登录 */
function isAuthed(req, cfg) {
  if (!cfg.password) return true;   // 未设密码 → 直接放行
  const raw = req.headers.cookie || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + COOKIE_NAME + '=([^;]+)'));
  if (!m) return false;
  return m[1] === makeCookie(cfg.password);
}

/** 登录页 HTML */
function loginPage(wrong) {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>局域网控制 · 登录</title><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 600px at 20% 10%,#1e293b,#0b1220 60%);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#e2e8f0;padding:20px}' +
    '.card{width:100%;max-width:340px;background:rgba(30,41,59,.72);backdrop-filter:blur(14px);border:1px solid rgba(148,163,184,.16);border-radius:18px;padding:30px 26px;box-shadow:0 24px 60px rgba(0,0,0,.5)}' +
    '.ic{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#38bdf8,#6366f1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px}' +
    '.ic svg{width:26px;height:26px;stroke:#fff}' +
    'h1{font-size:18px;font-weight:600;text-align:center;margin-bottom:6px}' +
    'p.sub{font-size:12px;color:#94a3b8;text-align:center;margin-bottom:22px}' +
    '.fld{position:relative;margin-bottom:14px}' +
    'input{width:100%;padding:13px 14px;font-size:15px;color:#e2e8f0;background:rgba(15,23,42,.8);border:1px solid rgba(148,163,184,.2);border-radius:11px;outline:none;transition:border-color .15s,box-shadow .15s}' +
    'input::placeholder{color:#64748b}' +
    'input:focus{border-color:#38bdf8;box-shadow:0 0 0 3px rgba(56,189,248,.14)}' +
    'button{width:100%;padding:13px;font-size:15px;font-weight:600;color:#fff;background:linear-gradient(135deg,#38bdf8,#6366f1);border:none;border-radius:11px;cursor:pointer;transition:transform .1s,filter .15s}' +
    'button:active{transform:scale(.985)}' +
    'button:hover{filter:brightness(1.08)}' +
    '.err{font-size:12.5px;color:#fca5a5;text-align:center;margin-bottom:14px;min-height:16px}' +
    '.ft{margin-top:18px;font-size:11px;color:#475569;text-align:center}' +
    '</style></head><body><div class="card">' +
    '<div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>' +
    '<h1>局域网控制</h1><p class="sub">请输入访问密码</p>' +
    '<div class="err">' + (wrong ? '密码错误，请重试' : '') + '</div>' +
    '<form method="POST" action="/auth">' +
    '<div class="fld"><input type="password" name="password" placeholder="访问密码" autofocus autocomplete="current-password"></div>' +
    '<button type="submit">进入</button></form>' +
    '<div class="ft">Cuckoo Code · 局域网控制</div>' +
    '</div></body></html>';
}

/** 主页 HTML（登录后） */
function homePage(url) {
  return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>局域网控制</title><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{min-height:100vh;background:radial-gradient(1200px 600px at 20% 10%,#1e293b,#0b1220 60%);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#e2e8f0;padding:32px 20px}' +
    '.wrap{max-width:560px;margin:0 auto}' +
    'h1{font-size:20px;font-weight:600;margin-bottom:6px}' +
    'p.sub{font-size:13px;color:#94a3b8;margin-bottom:24px}' +
    '.grid{display:grid;gap:12px}' +
    '.tile{background:rgba(30,41,59,.66);border:1px solid rgba(148,163,184,.16);border-radius:14px;padding:16px 18px}' +
    '.tile .k{font-size:12px;color:#94a3b8;margin-bottom:4px}' +
    '.tile .v{font-size:14px;color:#7dd3fc;font-family:ui-monospace,Consolas,monospace;word-break:break-all}' +
    '</style></head><body><div class="wrap">' +
    '<h1>局域网控制</h1><p class="sub">服务已启动 · 已登录</p>' +
    '<div class="grid"><div class="tile"><div class="k">服务地址</div><div class="v">' + url + '</div></div>' +
    '<div class="tile"><div class="k">状态</div><div class="v">运行中</div></div></div>' +
    '</div></body></html>';
}

function getLanIPs() {
  const out = [];
  try {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      if (/vEthernet|VMware|VirtualBox|Loopback|Hyper-V|WSL|Docker/i.test(name)) continue;
      for (const info of ifaces[name] || []) {
        if (info.family !== 'IPv4' || info.internal) continue;
        if (info.address.startsWith('169.254.')) continue;
        out.push({ iface: name, ip: info.address });
      }
    }
  } catch (_) { /* ignore */ }
  return out;
}

let server = null;
let listenPort = 0;
const startedAt = Date.now();
let totalRequests = 0;

function start() {
  return new Promise((resolve) => {
    if (server) return resolve();
    const cfg = readConfig();
    server = http.createServer((req, res) => {
      totalRequests++;
      try {
        const cfg = readConfig();
        const url = (req.url || '/').split('?')[0];

        // 登录提交（POST /auth）
        if (url === '/auth' && req.method === 'POST') {
          let body = '';
          req.on('data', (c) => { body += c; if (body.length > 4096) req.destroy(); });
          req.on('end', () => {
            let pw = '';
            try { pw = new URLSearchParams(body).get('password') || ''; } catch (_) {}
            if (pw && pw === cfg.password) {
              dlog('登录成功 → 下发 cookie');
              res.writeHead(302, {
                'Set-Cookie': COOKIE_NAME + '=' + makeCookie(cfg.password) + '; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax',
                'Location': '/',
              });
              res.end();
            } else {
              dlog('登录失败（密码错误）');
              res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
              res.end(loginPage(true));
            }
          });
          return;
        }

        // API（不登录返回 401）
        if (url === '/api/status' || url === '/api/ping') {
          if (!isAuthed(req, cfg)) {
            res.writeHead(401, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
          }
          if (url === '/api/ping') {
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('pong');
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, plugin: PLUGIN_ID, version: '0.2.0', startedAt, totalRequests }));
          return;
        }

        // 需要登录的页面
        if (!isAuthed(req, cfg)) {
          dlog('未登录 → 登录页  path=' + url + '  hasPw=' + !!cfg.password + '  cookie=' + (req.headers.cookie || '无'));
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(loginPage(false));
          return;
        }

        // 壳页（手机端 Cuckoo 完整界面）—— 根路径直接进
        if (url === '/' || url === '/shell') {
          try {
            const file = path.join(__dirname, '..', 'ui', 'shell.html');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(file, 'utf-8'));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('shell page not found');
          }
          return;
        }

        // 旧控制页（保留，/control 访问）
        if (url === '/control') {
          try {
            const file = path.join(__dirname, '..', 'ui', 'mobile.html');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fs.readFileSync(file, 'utf-8'));
          } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('control page not found');
          }
          return;
        }

        // 其它路径 → 404
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('not found');
      } catch (e) {
        try { res.writeHead(500); res.end('error'); } catch (_) { /* ignore */ }
      }
    });
    // 双向控制桥：挂到同一 http 服务（/ws 路径）
    try {
      wsBridge = attachWsBridge(server, {
        path: '/ws',
        isAuthed: (req) => isAuthed(req, readConfig()),
      });
      console.log('[lan-control] WebSocket 桥已挂载: /ws');
    } catch (e) {
      console.log('[lan-control] WebSocket 桥挂载失败: ' + (e && e.message));
      wsBridge = null;
    }
    server.listen(cfg.port, cfg.host, () => {
      listenPort = cfg.port;
      console.log('[lan-control] 服务已启动: http://' + cfg.host + ':' + cfg.port);
      resolve();
    });
    server.on('error', (e) => {
      console.log('[lan-control] 启动失败: ' + (e && e.message ? e.message : e));
      server = null;
      resolve();
    });
  });
}

function stop() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => { server = null; listenPort = 0; resolve(); });
  });
}

// ===== 自动启动（仅主进程）=====
if (process.type === 'renderer') {
  console.log('[lan-control] 渲染进程：跳过启动（服务由主进程提供）');
} else {
  (async function bootstrap() {
    const cfg = readConfig();
    if (cfg.autoStart && cfg.enabled) {
      await start();
    } else {
      console.log('[lan-control] 未自动启动（autoStart=' + cfg.autoStart + ' enabled=' + cfg.enabled + '）');
    }
  })();
}

// ===== 向壳页面暴露运行时状态（走 IPC）=====
try {
  const table = (globalThis.__cuckooPluginHostFns = globalThis.__cuckooPluginHostFns || {});
  table[PLUGIN_ID + ':status'] = function () {
    const cfg = readConfig();
    return {
      running: !!server,
      enabled: cfg.enabled,
      port: listenPort || cfg.port,
      host: cfg.host,
      startedAt: startedAt,
      totalRequests: totalRequests,
      lanIPs: getLanIPs(),
      wsClients: wsBridge ? wsBridge.clientCount() : 0,
    };
  };
  table[PLUGIN_ID + ':qr'] = function () {
    const url = lanUrl();
    return { url: url, svg: makeQrSvg(url, 220) };
  };
  // 取当前密码（供面板显示/编辑）
  table[PLUGIN_ID + ':getPassword'] = function () {
    return { password: readConfig().password || '' };
  };
  // 设密码（空字符串 = 关闭门令）
  table[PLUGIN_ID + ':setPassword'] = function (args) {
    const pw = (args && typeof args.password === 'string') ? args.password : '';
    writeConfig({ password: pw });
    return { password: pw };
  };
  // 生成随机密码（仅返回，不落盘；由面板决定是否保存）
  table[PLUGIN_ID + ':randomPassword'] = function () {
    return { password: randomPassword(10) };
  };
  // 主进程 → 插件：AI 事件（供 WS 广播给手机）
  table[PLUGIN_ID + ':onEvent'] = function (payload) {
    if (wsBridge) {
      try { wsBridge.broadcast(payload); } catch (_) { /* ignore */ }
    }
  };
  table[PLUGIN_ID + ':toggle'] = async function (args) {
    const want = !args || args.enabled !== false;
    try {
      const file = configFile();
      let t = {};
      try { t = JSON.parse(fs.readFileSync(file, 'utf-8')); } catch (_) { /* ignore */ }
      t[PLUGIN_ID] = Object.assign({}, t[PLUGIN_ID] || {}, { enabled: want });
      fs.writeFileSync(file, JSON.stringify(t, null, 2), 'utf-8');
    } catch (_) { /* ignore */ }
    if (want) await start(); else await stop();
    return { enabled: want, running: !!server };
  };
} catch (_) { /* ignore */ }

// ===== Provider 接口（市场格式必需字段，否则被 validateProvider 跳过）=====
const provider = {
  id: PLUGIN_ID,
  name: '局域网控制',
  homeUrl: 'http://127.0.0.1:18800',
  sessionUrlBase: 'http://127.0.0.1:18800/',
  extractSessionId: function () { return null; },
  matchesUrl: function () { return false; },  // 不是 AI 平台，不劫持平台识别
};

module.exports = provider;
