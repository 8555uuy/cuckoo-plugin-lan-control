/** 局域网控制 —— 侧边栏面板（ui 插件） */
export const name = 'lan-control-panel';

const PLUGIN_ID = 'lan-control';
const DEFAULT_PORT = 18800;

const CSS = [
  '.ck-lc-wrap{padding:12px}',
  '.ck-lc-hero{display:flex;align-items:center;gap:8px;margin-bottom:12px}',
  '.ck-lc-title{font-size:13px;font-weight:600;color:var(--ck-text);flex:1}',
  '.ck-lc-badge{font-size:11px;font-weight:500;padding:2px 9px;border-radius:20px;white-space:nowrap}',
  '.ck-lc-badge.on{background:rgba(52,211,153,.14);color:#34d399}',
  '.ck-lc-badge.off{background:rgba(107,116,130,.16);color:var(--ck-text-dim)}',
  '.ck-lc-badge.err{background:rgba(248,113,113,.14);color:#f87171}',
  '.ck-lc-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.06)}',
  '.ck-lc-row:last-of-type{border-bottom:none}',
  '.ck-lc-k{color:var(--ck-text-dim);font-size:12px;flex-shrink:0}',
  '.ck-lc-v{font-family:ui-monospace,Consolas,monospace;font-size:11.5px;color:#7dd3fc;text-align:right;word-break:break-all;line-height:1.4}',
  '.ck-lc-toggle{display:flex;align-items:center;gap:8px;margin:10px 0 2px;font-size:12px;color:var(--ck-text);cursor:pointer}',
  '.ck-lc-hint{margin-top:6px;font-size:11px;color:var(--ck-text-dim);line-height:1.5}',
  '.ck-lc-qr{margin:12px 0 4px;display:flex;flex-direction:column;align-items:center;gap:8px}',
  '.ck-lc-qr-box{background:#fff;border-radius:10px;padding:10px;line-height:0;box-shadow:0 2px 10px rgba(0,0,0,.25)}',
  '.ck-lc-qr-box svg{display:block}',
  '.ck-lc-qr-cap{font-size:11px;color:var(--ck-text-dim);text-align:center;line-height:1.5}',
  '.ck-lc-qr-empty{font-size:11px;color:var(--ck-text-dim);padding:18px 0;text-align:center}',
  '.ck-lc-sec{margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)}',
  '.ck-lc-sec-t{font-size:12px;font-weight:600;color:var(--ck-text);margin-bottom:8px;display:flex;align-items:center;gap:6px}',
  '.ck-lc-pw-row{display:flex;gap:6px;align-items:center}',
  '.ck-lc-pw{flex:1;min-width:0;font-family:ui-monospace,Consolas,monospace;font-size:12px;padding:7px 10px;color:var(--ck-text);background:rgba(15,23,42,.6);border:1px solid rgba(148,163,184,.2);border-radius:8px;outline:none}',
  '.ck-lc-pw:focus{border-color:#38bdf8}',
  '.ck-lc-pw::placeholder{color:var(--ck-text-dim)}',
  '.ck-lc-mini{font-size:11.5px;padding:7px 10px;border-radius:8px;border:1px solid rgba(148,163,184,.22);background:transparent;color:var(--ck-text);cursor:pointer;white-space:nowrap;transition:background .15s}',
  '.ck-lc-mini:hover{background:rgba(148,163,184,.12)}',
  '.ck-lc-mini.pri{background:#4c8dff;border-color:transparent;color:#fff}',
  '.ck-lc-mini.pri:hover{filter:brightness(1.1)}',
  '.ck-lc-pw-hint{margin-top:6px;font-size:10.5px;color:var(--ck-text-dim);line-height:1.5}',
  '.ck-lc-toast{position:fixed;left:50%;bottom:60px;transform:translateX(-50%);background:#334155;color:#e2e8f0;font-size:12px;padding:8px 16px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.4);z-index:99999;opacity:0;transition:opacity .2s;pointer-events:none}',
  '.ck-lc-toast.show{opacity:1}',
].join('');

// 面板在壳页面：走 shellAPI.pluginHostCall（IPC）拿数据——不用 fetch（file:// 访问 127.0.0.1 会被拦）
const POLL = '(function(){' +
  'var PID="lan-control";var DEF_PORT=' + DEFAULT_PORT + ';' +
  'function g(id){return document.getElementById(id)}' +
  'function setStatus(on,text){var st=g("lc-status");if(st){st.textContent=text;st.className="ck-lc-badge "+(on?"on":"off");}}' +
  'function fill(s){' +
    'var port=s.port||DEF_PORT;' +
    'var ip=(s.lanIPs&&s.lanIPs[0])?s.lanIPs[0].ip:null;' +
    'var a=g("lc-lan");if(a)a.textContent=ip?("http://"+ip+":"+port):"-";' +
    'var loc=g("lc-local");if(loc)loc.textContent="http://127.0.0.1:"+port+"/";' +
    'var on=(s.running&&s.enabled!==false);' +
    'setStatus(on,on?"运行中":(s.enabled===false?"已关闭":"已停止"));' +
    'var c=g("lc-reqs");if(c)c.textContent=s.totalRequests||0;' +
    'var tg=g("lc-toggle");if(tg&&document.activeElement!==tg)tg.checked=s.enabled!==false;' +
    'refreshQr(on);' +
  '}' +
  'function refreshQr(on){' +
    'var box=g("lc-qr-box");if(!box)return;' +
    'if(!on){box.innerHTML="<div class=ck-lc-qr-empty>服务未启动</div>";return}' +
    'if(!window.shellAPI||!window.shellAPI.pluginHostCall)return;' +
    'window.shellAPI.pluginHostCall(PID,"qr").then(function(r){' +
      'if(!r||!r.success||!r.data||!r.data.svg){box.innerHTML="<div class=ck-lc-qr-empty>二维码不可用</div>";return}' +
      'box.innerHTML=r.data.svg;' +
      'var cap=g("lc-qr-cap");if(cap)cap.textContent=r.data.url;' +
    '}).catch(function(){box.innerHTML="<div class=ck-lc-qr-empty>二维码加载失败</div>";});' +
  '}' +
  'function poll(){' +
    'if(!window.shellAPI||!window.shellAPI.pluginHostCall){setStatus(false,"接口不可用");return}' +
    'window.shellAPI.pluginHostCall(PID,"status").then(function(r){if(r&&r.success&&r.data)fill(r.data);else setStatus(false,"未就绪")}).catch(function(){setStatus(false,"未连接")})' +
  '}' +
  'window.__lcOpen=function(){try{window.shellAPI.openExternal("http://127.0.0.1:"+DEF_PORT+"/")}catch(e){}};' +
  'window.__lcCopy=function(){var t=g("lc-lan").textContent;try{navigator.clipboard.writeText(t)}catch(e){}};' +
  'window.__lcToggle=function(on){' +
    'setStatus(!!on,on?"启动中…":"关闭中…");' +
    'if(window.shellAPI&&window.shellAPI.pluginHostCall){window.shellAPI.pluginHostCall(PID,"toggle",{enabled:!!on}).catch(function(){})}' +
    'setTimeout(poll,1200);' +
  '};' +
  'function toast(msg){var t=g("lc-toast");if(!t){t=document.createElement("div");t.id="lc-toast";t.className="ck-lc-toast";document.body.appendChild(t);}t.textContent=msg;t.className="ck-lc-toast show";clearTimeout(window.__lcToastT);window.__lcToastT=setTimeout(function(){t.className="ck-lc-toast";},1800);}' +
  'window.__lcPwGen=function(){if(!window.shellAPI||!window.shellAPI.pluginHostCall)return;window.shellAPI.pluginHostCall(PID,"randomPassword").then(function(r){if(r&&r.success&&r.data){var i=g("lc-pw");if(i)i.value=r.data.password;toast("已生成随机密码，点保存生效");}}).catch(function(){});};' +
  'window.__lcPwSave=function(){var i=g("lc-pw");if(!i)return;if(!window.shellAPI||!window.shellAPI.pluginHostCall)return;window.shellAPI.pluginHostCall(PID,"setPassword",{password:i.value}).then(function(r){if(r&&r.success){toast(i.value?"密码已保存":"门令已关闭");}else toast("保存失败");}).catch(function(){toast("保存失败");});};' +
  'function loadPw(){if(!window.shellAPI||!window.shellAPI.pluginHostCall)return;window.shellAPI.pluginHostCall(PID,"getPassword").then(function(r){if(r&&r.success&&r.data){var i=g("lc-pw");if(i&&document.activeElement!==i)i.value=r.data.password||"";}}).catch(function(){});}' +
  'loadPw();' +
  'poll();if(!window.__lcPollTimer)window.__lcPollTimer=setInterval(poll,4000);' +
'})()';

const HTML = [
  '<div class="ck-lc-wrap">',
    '<div class="ck-lc-hero"><div class="ck-lc-title">局域网控制</div><div class="ck-lc-badge off" id="lc-status">连接中…</div></div>',
    '<label class="ck-lc-toggle"><input type="checkbox" id="lc-toggle" onchange="window.__lcToggle&&window.__lcToggle(this.checked)"> 启用服务</label>',
    '<div class="ck-lc-row"><span class="ck-lc-k">局域网</span><code class="ck-lc-v" id="lc-lan">-</code></div>',
    '<div class="ck-lc-row"><span class="ck-lc-k">本机</span><code class="ck-lc-v" id="lc-local">-</code></div>',
    '<div class="ck-lc-row"><span class="ck-lc-k">总请求</span><code class="ck-lc-v" id="lc-reqs">0</code></div>',
    '<div class="ck-lc-qr"><div class="ck-lc-qr-box" id="lc-qr-box"><div class="ck-lc-qr-empty">加载中…</div></div><div class="ck-lc-qr-cap" id="lc-qr-cap"></div></div>',
    '<div class="ck-lc-hint">手机扫码即可打开（需与电脑同一局域网）。</div>',
    '<div class="ck-lc-sec">',
      '<div class="ck-lc-sec-t">🔒 访问密码（门令）</div>',
      '<div class="ck-lc-pw-row">',
        '<input class="ck-lc-pw" id="lc-pw" type="text" placeholder="留空 = 不校验">',
        '<button class="ck-lc-mini" onclick="window.__lcPwGen&&window.__lcPwGen()">随机</button>',
        '<button class="ck-lc-mini pri" onclick="window.__lcPwSave&&window.__lcPwSave()">保存</button>',
      '</div>',
      '<div class="ck-lc-pw-hint">设置后，手机打开需先输入此密码。修改后手机需重新登录。</div>',
    '</div>',
    '<img src="x" style="width:0;height:0;position:absolute;opacity:0" onerror="' + POLL.replace(/"/g, '&quot;') + '">',
  '</div>',
].join('');

export function apply(ctx) {
  try {
    if (ctx.ui && ctx.ui.shell && typeof ctx.ui.shell.addStyle === 'function') {
      ctx.ui.shell.addStyle(CSS);
    }
    if (ctx.ui && ctx.ui.shell && typeof ctx.ui.shell.addSidebarPanel === 'function') {
      ctx.ui.shell.addSidebarPanel({
        id: PLUGIN_ID,
        title: '局域网控制',
        icon: '<svg class="ck-ab-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9"/><path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5"/><circle cx="12" cy="9" r="2"/><path d="M16.2 4.8c2 2 2.26 5.11.8 7.47"/><path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1"/><path d="M9.5 18h5"/><path d="m8 22 4-11 4 11"/></svg>',
        html: HTML,
      }).then(function () {
        ctx.log('局域网控制面板已挂载');
      }).catch(function (e) { ctx.log('挂载失败: ' + (e && e.message)); });
    }
  } catch (e) { ctx.log('面板出错: ' + (e && e.message)); }
}
