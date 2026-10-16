/** 局域网控制 —— 侧边栏面板（ui 插件，Cuckoo 风格） */
export const name = 'lan-control-panel';

const PLUGIN_ID = 'lan-control';
const DEFAULT_PORT = 18800;
const REPO_URL = 'https://github.com/8555uuy/cuckoo-plugin-lan-control';

const CSS = [
  '.ck-lc{padding:14px;font-size:13px;color:var(--ck-text);line-height:1.5}',
  '.ck-lc-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}',
  '.ck-lc-name{font-size:13.5px;font-weight:600;flex:1;letter-spacing:-.01em}',
  '.ck-lc-badge{font-size:11px;font-weight:600;padding:2px 9px;border-radius:99px;white-space:nowrap;background:var(--ck-surface)}',
  '.ck-lc-badge.on{color:var(--ck-green)}',
  '.ck-lc-badge.off{color:var(--ck-text-dim)}',
  '.ck-lc-badge.err{color:var(--ck-danger)}',
  '.ck-lc-toggle{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ck-text-2);cursor:pointer;margin-bottom:12px;user-select:none}',
  '.ck-lc-toggle input{accent-color:var(--ck-primary);width:15px;height:15px}',
  '.ck-lc-qr{display:flex;flex-direction:column;align-items:center;gap:8px;margin-bottom:14px}',
  '.ck-lc-qr-box{background:#fff;border-radius:10px;padding:9px;line-height:0;box-shadow:0 1px 4px rgba(0,0,0,.14)}',
  '.ck-lc-qr-box svg{display:block;border-radius:2px}',
  '.ck-lc-qr-cap{font-size:11px;color:var(--ck-text-dim);text-align:center;word-break:break-all;line-height:1.5}',
  '.ck-lc-qr-empty{font-size:11.5px;color:var(--ck-text-dim);padding:28px 0;text-align:center}',
  '.ck-lc-meta{margin-bottom:14px}',
  '.ck-lc-meta-row{display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--ck-border)}',
  '.ck-lc-meta-row:last-child{border-bottom:none}',
  '.ck-lc-meta-k{font-size:11.5px;color:var(--ck-text-dim);flex-shrink:0}',
  '.ck-lc-meta-v{font-family:var(--mono,ui-monospace,Consolas,monospace);font-size:11px;color:var(--ck-text-2);flex:1;text-align:right;word-break:break-all;line-height:1.4}',
  '.ck-lc-mini{font-size:11px;padding:3px 8px;border-radius:6px;border:1px solid var(--ck-border);background:transparent;color:var(--ck-text-dim);cursor:pointer;white-space:nowrap;font-family:inherit;transition:all .15s}',
  '.ck-lc-mini:hover{color:var(--ck-text);background:var(--ck-surface)}',
  '.ck-lc-sec{padding-top:12px;border-top:1px solid var(--ck-border);margin-bottom:14px}',
  '.ck-lc-sec-t{font-size:11.5px;font-weight:600;color:var(--ck-text-dim);margin-bottom:8px}',
  '.ck-lc-pw-row{display:flex;gap:6px}',
  '.ck-lc-input{flex:1;min-width:0;font-family:var(--mono,ui-monospace,Consolas,monospace);font-size:12px;padding:7px 10px;color:var(--ck-text);background:var(--ck-surface);border:1px solid var(--ck-border);border-radius:8px;outline:none;transition:border-color .15s}',
  '.ck-lc-input:focus{border-color:var(--ck-primary)}',
  '.ck-lc-input::placeholder{color:var(--ck-text-dim)}',
  '.ck-lc-btn{font-size:12px;padding:7px 11px;border-radius:8px;border:1px solid var(--ck-border);background:transparent;color:var(--ck-text-2);cursor:pointer;white-space:nowrap;font-family:inherit;transition:all .15s}',
  '.ck-lc-btn:hover{color:var(--ck-text);background:var(--ck-surface)}',
  '.ck-lc-hint{font-size:11px;color:var(--ck-text-dim);line-height:1.55;margin-top:7px}',
  '.ck-lc-foot{padding-top:13px;border-top:1px solid var(--ck-border);text-align:center}',
  '.ck-lc-star{display:inline-flex;align-items:center;justify-content:center;gap:6px;width:100%;font-size:12px;color:var(--ck-text-2);cursor:pointer;padding:8px 12px;border-radius:9px;border:1px solid var(--ck-border);background:transparent;font-family:inherit;transition:all .16s}',
  '.ck-lc-star:hover{color:var(--ck-primary);border-color:var(--ck-primary)}',
  '.ck-lc-star svg{width:13px;height:13px;flex-shrink:0}',
  '.ck-lc-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);background:var(--ck-surface,#334155);color:var(--ck-text,#e2e8f0);font-size:12px;padding:8px 16px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:99999;opacity:0;transition:opacity .2s;pointer-events:none;border:1px solid var(--ck-border,rgba(255,255,255,.1))}',
  '.ck-lc-toast.show{opacity:1}',
].join('');

// 面板在壳页面：走 shellAPI.pluginHostCall（IPC）拿数据——不用 fetch（file:// 访问 127.0.0.1 会被拦）
const POLL = '(function(){' +
  'var PID="lan-control";var DEF_PORT=' + DEFAULT_PORT + ';var REPO="' + REPO_URL + '";' +
  'function g(id){return document.getElementById(id)}' +
  'function setStatus(cls,text){var st=g("lc-status");if(st){st.textContent=text;st.className="ck-lc-badge "+cls;}}' +
  'function fill(s){' +
    'var port=s.port||DEF_PORT;' +
    'var ip=(s.lanIPs&&s.lanIPs[0])?s.lanIPs[0].ip:null;' +
    'var a=g("lc-lan");if(a)a.textContent=ip?("http://"+ip+":"+port):"-";' +
    'var on=(s.running&&s.enabled!==false);' +
    'setStatus(on?"on":"off",on?"运行中":(s.enabled===false?"已关闭":"已停止"));' +
    'var cc=g("lc-clients");if(cc)cc.textContent=(s.wsClients||0);' +
    'var tg=g("lc-toggle");if(tg&&document.activeElement!==tg)tg.checked=s.enabled!==false;' +
    'refreshQr(on);' +
  '}' +
  'function refreshQr(on){' +
    'var box=g("lc-qr-box");if(!box)return;' +
    'if(!on){box.innerHTML="<div class=ck-lc-qr-empty>服务未启动</div>";var c0=g("lc-qr-cap");if(c0)c0.textContent="";return}' +
    'if(!window.shellAPI||!window.shellAPI.pluginHostCall)return;' +
    'window.shellAPI.pluginHostCall(PID,"qr").then(function(r){' +
      'if(!r||!r.success||!r.data||!r.data.svg){box.innerHTML="<div class=ck-lc-qr-empty>二维码不可用</div>";return}' +
      'box.innerHTML=r.data.svg;' +
      'var cap=g("lc-qr-cap");if(cap)cap.textContent="手机扫码打开";' +
    '}).catch(function(){box.innerHTML="<div class=ck-lc-qr-empty>二维码加载失败</div>";});' +
  '}' +
  'function poll(){' +
    'if(!window.shellAPI||!window.shellAPI.pluginHostCall){setStatus("err","接口不可用");return}' +
    'window.shellAPI.pluginHostCall(PID,"status").then(function(r){if(r&&r.success&&r.data)fill(r.data);else setStatus("off","未就绪")}).catch(function(){setStatus("err","未连接")})' +
  '}' +
  'function toast(msg){var t=g("lc-toast");if(!t){t=document.createElement("div");t.id="lc-toast";t.className="ck-lc-toast";document.body.appendChild(t);}t.textContent=msg;t.className="ck-lc-toast show";clearTimeout(window.__lcToastT);window.__lcToastT=setTimeout(function(){t.className="ck-lc-toast";},1800);}' +
  'window.__lcToggle=function(on){' +
    'setStatus(on?"on":"off",on?"启动中…":"关闭中…");' +
    'if(window.shellAPI&&window.shellAPI.pluginHostCall){window.shellAPI.pluginHostCall(PID,"toggle",{enabled:!!on}).catch(function(){})}' +
    'setTimeout(poll,1200);' +
  '};' +
  'window.__lcCopy=function(){var a=g("lc-lan");if(!a)return;var t=a.textContent;' +
    'try{navigator.clipboard.writeText(t).then(function(){toast("已复制地址")},function(){toast(t)})}catch(e){toast(t)}' +
  '};' +
  'window.__lcPwGen=function(){if(!window.shellAPI||!window.shellAPI.pluginHostCall)return;window.shellAPI.pluginHostCall(PID,"randomPassword").then(function(r){if(r&&r.success&&r.data){var i=g("lc-pw");if(i)i.value=r.data.password;window.__lcPwSave(true);}}).catch(function(){});};' +
  'window.__lcPwSave=function(silent){var i=g("lc-pw");if(!i)return;if(!window.shellAPI||!window.shellAPI.pluginHostCall)return;' +
    'var val=i.value||"";if(val===window.__lcLastPw){if(!silent)toast(val?"密码未变":"门令已关闭");return;}' +
    'window.shellAPI.pluginHostCall(PID,"setPassword",{password:val}).then(function(r){if(r&&r.success){window.__lcLastPw=val;toast(val?"密码已保存":"门令已关闭");}else toast("保存失败");}).catch(function(){toast("保存失败");});};' +
  'function loadPw(){if(!window.shellAPI||!window.shellAPI.pluginHostCall)return;window.shellAPI.pluginHostCall(PID,"getPassword").then(function(r){if(r&&r.success&&r.data){var i=g("lc-pw");if(i&&document.activeElement!==i){i.value=r.data.password||"";window.__lcLastPw=i.value;}}}).catch(function(){});}' +
  'window.__lcStar=function(){try{window.shellAPI.openExternal(REPO)}catch(e){}};' +
  'loadPw();' +
  'poll();if(!window.__lcPollTimer)window.__lcPollTimer=setInterval(poll,4000);' +
'})()';

const HTML = [
  '<div class="ck-lc">',
    '<div class="ck-lc-head"><span class="ck-lc-name">局域网控制</span><span class="ck-lc-badge off" id="lc-status">连接中…</span></div>',
    '<label class="ck-lc-toggle"><input type="checkbox" id="lc-toggle" onchange="window.__lcToggle&&window.__lcToggle(this.checked)"> 启用服务</label>',
    '<div class="ck-lc-qr"><div class="ck-lc-qr-box" id="lc-qr-box"><div class="ck-lc-qr-empty">加载中…</div></div><div class="ck-lc-qr-cap" id="lc-qr-cap"></div></div>',
    '<div class="ck-lc-meta">',
      '<div class="ck-lc-meta-row"><span class="ck-lc-meta-k">局域网</span><code class="ck-lc-meta-v" id="lc-lan">-</code><button class="ck-lc-mini" onclick="window.__lcCopy&&window.__lcCopy()">复制</button></div>',
      '<div class="ck-lc-meta-row"><span class="ck-lc-meta-k">已连接</span><code class="ck-lc-meta-v" id="lc-clients">0</code></div>',
    '</div>',
    '<div class="ck-lc-sec">',
      '<div class="ck-lc-sec-t">访问密码</div>',
      '<div class="ck-lc-pw-row">',
        '<input class="ck-lc-input" id="lc-pw" type="text" placeholder="留空 = 不校验" onblur="window.__lcPwSave&&window.__lcPwSave()">',
        '<button class="ck-lc-btn" onclick="window.__lcPwGen&&window.__lcPwGen()">随机</button>',
      '</div>',
      '<div class="ck-lc-hint">设置后手机打开需先输入。改完自动保存。</div>',
    '</div>',
    '<div class="ck-lc-foot">',
      '<button class="ck-lc-star" onclick="window.__lcStar&&window.__lcStar()">',
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3 6.5 7 .9-5 4.8 1.2 7L12 18l-6.2 3.2L7 14.2 2 9.4l7-.9z"/></svg>',
        '感谢支持 · 给个 Star',
      '</button>',
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
