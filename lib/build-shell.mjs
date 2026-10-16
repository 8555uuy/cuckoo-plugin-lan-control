/**
 * 构建手机端壳页面（shell.html）
 *
 * 复用电脑端的 CSS（base/components/pages）+ HTML 片段（partials），
 * 从 shell-preload.ts 自动提取 shellAPI 方法 → IPC 通道映射，
 * 拼成一个移动端 shell.html（视觉与电脑端一致）。
 *
 * 用法：node ui/build-shell.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const SHELL_SRC = 'D:/cuckoo-code/src/ui/shell';
const PRELOAD = 'D:/cuckoo-code/src/app/shell-preload.ts';
const HERE = import.meta.dirname;   // lib/
const OUT = path.join(HERE, '..', 'ui', 'shell.html');

const read = (rel) => fs.readFileSync(path.join(SHELL_SRC, rel), 'utf8');

// 1. CSS（电脑端三件套）
const css = [
  read('styles/base.css'),
  read('styles/components.css'),
  read('styles/pages.css'),
].join('\n');

// 2. HTML 片段
const activitybar = read('partials/activitybar.html');
const modals = read('partials/modals.html');
const statusbar = read('partials/statusbar.html');
const P1_PAGES = ['workspaces', 'conversations', 'memories', 'snapshots', 'skills', 'plugins', 'settings', 'files', 'agents', 'mcp', 'windows', 'token', 'about'];
const panels = P1_PAGES.map((p) => read('partials/pages/' + p + '.html')).join('\n');

// 3. 从 shell-preload.ts 提取 shellAPI 方法 → IPC 通道映射
const preloadSrc = fs.readFileSync(PRELOAD, 'utf8');
const apiMap = {};
const re = /(\w+):\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\('([^']+)'/g;
let m;
while ((m = re.exec(preloadSrc)) !== null) {
  apiMap[m[1]] = m[2];
}
// 无参调用形式：xxx: () => ipcRenderer.invoke('chan')
const re2 = /(\w+):\s*\(\)\s*=>\s*ipcRenderer\.invoke\('([^']+)'/g;
while ((m = re2.exec(preloadSrc)) !== null) {
  apiMap[m[1]] = m[2];
}
// onXXX 订阅（手机端无推送）：标记为 no-op。
// 宽松匹配：所有以 on + 大写字母开头、返回 ipcRenderer.on/onReceive 的方法名。
const noops = [];
const noopRe = /\b(on[A-Z]\w*)\s*:\s*\([^)]*\)\s*=>/g;
while ((m = noopRe.exec(preloadSrc)) !== null) { if (noops.indexOf(m[1]) === -1) noops.push(m[1]); }

const appJs = fs.readFileSync(path.join(HERE, 'shell-app.js'), 'utf8')   // 同在 lib/
  .replace('__API_MAP__', JSON.stringify(apiMap))
  .replace('__API_NOOP__', JSON.stringify(noops));

// 4. 拼装
const html = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="color-scheme" content="light dark">',
  '<title>Cuckoo</title>',
  // 早期错误捕获（单行，避免任何转义问题）
  '<script>',
  'window.__lcBoot=1;window.onerror=function(m,src,ln){var b=document.getElementById("m-boot");if(b){b.style.cssText="position:fixed;left:0;right:0;top:0;z-index:999999;background:#b91c1c;color:#fff;font:12px/1.5 monospace;padding:10px;white-space:pre-wrap;max-height:60%;overflow:auto";b.textContent="JS\u9519\u8bef: "+m+"  @"+(src||"")+":"+ln;}};window.addEventListener("unhandledrejection",function(e){var b=document.getElementById("m-boot");if(b){b.style.cssText="position:fixed;left:0;right:0;top:0;z-index:999999;background:#b45309;color:#fff;font:12px/1.5 monospace;padding:10px;white-space:pre-wrap;max-height:60%;overflow:auto";b.textContent="Promise: "+((e.reason&&(e.reason.message||e.reason))||e);}});',
  '<\/script>',
  '<style>',
  // 硬编码兜底（不依赖 --ck-* 变量，确保浅/深色都可读）
  ':root{--ck-bg:#16181d;--ck-bg-sub:#191c22;--ck-surface:rgba(255,255,255,.05);--ck-surface-hover:rgba(255,255,255,.09);--ck-border:rgba(255,255,255,.1);--ck-border-strong:rgba(255,255,255,.16);--ck-primary:#6b83ff;--ck-primary-strong:#8b9dff;--ck-primary-soft:rgba(107,131,255,.16);--ck-text:#e6e8eb;--ck-text-2:#a8adba;--ck-text-dim:#757b8a;--ck-danger:#ff6369;--ck-green:#46b47e;--ck-shadow-sm:none;--ck-shadow:none;}',
  'html,body{background:#16181d!important;color:#e6e8eb!important;}',
  css,
  // ===== 移动端适配（不改变视觉，只让布局在窄屏可用）=====
  `
  /* 手机端布局：对话流为主，侧栏为抽屉 */
  .shell { height: 100vh; height: 100dvh; display: flex; flex-direction: column; }
  .toolbar { display: none !important; }
  .ck-win-divider, .ck-win-controls { display: none !important; }
  .statusbar { display: none !important; }
  .ck-sidebar-resizer { display: none !important; }
  .ck-sidebar { width: 100% !important; height: 100% !important; position: static !important; border-right: none !important; }
  .ck-activitybar { width: 46px !important; }
  .ck-panel { flex: 1 !important; min-width: 0 !important; box-shadow: none !important; }
  body { overscroll-behavior: none; -webkit-tap-highlight-color: transparent; }
  .ck-list-item { padding: 12px 14px; }
  .ck-icon-btn { width: 36px; height: 36px; }

  /* 对话流 */
  .m-stream { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 12px 0 4px; background: var(--ck-bg); }
  .m-stream::-webkit-scrollbar { width: 0; }
  .m-wrap { max-width: 720px; margin: 0 auto; padding: 0 14px; }
  .m-empty { text-align: center; color: var(--ck-text-dim); padding: 18vh 24px 0; }
  .m-empty-icon { display: flex; justify-content: center; margin-bottom: 14px; color: var(--ck-primary); }
  .m-empty-icon svg { width: 38px; height: 38px; }
  .m-empty-t1 { color: var(--ck-text-2); font-size: 14px; font-weight: 600; margin-bottom: 4px; }
  .m-empty-t2 { font-size: 12px; }
  .m-msg { margin-bottom: 16px; animation: m-fade .16s ease; }
  @keyframes m-fade { from{opacity:0;transform:translateY(3px)} to{opacity:1;transform:none} }
  .m-msg.user { display: flex; justify-content: flex-end; }
  .m-msg.user .m-bubble { max-width: 82%; background: var(--ck-surface-hover); color: var(--ck-text); padding: 9px 13px; border-radius: 10px; border: 1px solid var(--ck-border); white-space: pre-wrap; word-break: break-word; line-height: 1.6; }
  .m-msg.ai .m-prefix { display: flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 600; color: var(--ck-primary); letter-spacing: .4px; margin-bottom: 7px; }
  .m-msg.ai .m-prefix svg { width: 12px; height: 12px; stroke: currentColor; fill: none; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .m-msg.ai .m-body { font-size: 14px; line-height: 1.75; color: var(--ck-text); word-break: break-word; white-space: pre-wrap; }
  .m-cursor { display: inline-block; width: 7px; height: 15px; margin-left: 2px; background: var(--ck-primary); vertical-align: text-bottom; animation: m-blink 1s step-end infinite; }
  @keyframes m-blink { 50%{opacity:0} }
  .m-sys { display: flex; justify-content: center; padding: 6px 0; }
  .m-sys span { font-size: 12px; color: var(--ck-text-dim); padding: 4px 12px; border-radius: 6px; background: var(--ck-surface); }
  .m-sys.err span { color: var(--ck-danger); }
  .m-think { margin-bottom: 10px; border-left: 2px solid var(--ck-border); background: var(--ck-surface); border-radius: 0 6px 6px 0; }
  .m-think-h { display: flex; align-items: center; gap: 7px; padding: 6px 12px; cursor: pointer; font-size: 11.5px; color: var(--ck-text-dim); }
  .m-think-h svg { width: 11px; height: 11px; stroke: currentColor; fill: none; stroke-width: 2; }
  .m-think-h svg.m-caret { transition: transform .15s; }
  .m-think.open .m-caret { transform: rotate(90deg); }
  .m-think-b { display: none; padding: 2px 12px 10px; font-size: 12.5px; line-height: 1.7; color: var(--ck-text-dim); white-space: pre-wrap; word-break: break-word; }
  .m-think.open .m-think-b { display: block; }
  .m-tool { margin-bottom: 12px; border: 1px solid var(--ck-border); border-radius: 8px; background: var(--ck-bg-sub); overflow: hidden; }
  .m-tool-h { display: flex; align-items: center; gap: 9px; padding: 9px 12px; cursor: pointer; }
  .m-tool-h svg { width: 14px; height: 14px; stroke: currentColor; fill: none; stroke-width: 1.9; flex-shrink: 0; }
  .m-tool-name { font-size: 12px; font-weight: 600; color: var(--ck-text-2); font-family: var(--mono, monospace); flex-shrink: 0; }
  .m-tool-arg { flex: 1; font-size: 12px; color: var(--ck-text-dim); font-family: var(--mono, monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m-tool-badge { font-size: 10px; padding: 1.5px 6px; border-radius: 4px; font-weight: 600; }
  .m-tool.run .m-tool-h svg { color: var(--ck-primary); }
  .m-tool.run .m-tool-badge { color: var(--ck-primary); background: var(--ck-primary-soft); }
  .m-tool.ok .m-tool-badge { color: var(--ck-green); background: var(--ck-primary-soft); }
  .m-tool.err .m-tool-badge { color: var(--ck-danger); background: var(--ck-primary-soft); }
  .m-tool-b { display: none; border-top: 1px solid var(--ck-border); padding: 10px 12px; }
  .m-tool.open .m-tool-b { display: block; }
  .m-tool-pre { background: var(--ck-surface); border-radius: 8px; padding: 10px; margin: 0; overflow: auto; max-height: 300px; font-family: var(--mono, monospace); font-size: 11.5px; line-height: 1.6; color: var(--ck-text-2); white-space: pre-wrap; word-break: break-word; }

  /* 输入区 */
  .m-composer { flex-shrink: 0; padding: 10px 14px calc(12px + env(safe-area-inset-bottom)); background: var(--ck-bg); border-top: 1px solid var(--ck-border); }
  .m-input-wrap { max-width: 720px; margin: 0 auto; display: flex; align-items: flex-end; gap: 8px; background: var(--ck-bg-sub); border: 1px solid var(--ck-border); border-radius: 12px; padding: 8px 8px 8px 14px; transition: border-color .15s, box-shadow .15s; }
  .m-input-wrap:focus-within { border-color: var(--ck-primary); box-shadow: 0 0 0 3px var(--ck-primary-soft); }
  #m-input { flex: 1; border: none; outline: none; background: transparent; resize: none; color: var(--ck-text); font-family: inherit; font-size: 15px; line-height: 1.6; max-height: 140px; padding: 4px 0; }
  #m-input::placeholder { color: var(--ck-text-dim); }
  #m-send { flex-shrink: 0; width: 32px; height: 32px; border-radius: 8px; border: none; background: var(--ck-primary); color: #fff; display: flex; align-items: center; justify-content: center; }
  #m-send:disabled { background: var(--ck-surface); color: var(--ck-text-dim); }
  #m-send.stop { background: var(--ck-surface); color: var(--ck-danger); }
  #m-send svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }

  /* 侧栏抽屉 */
  .m-scrim { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 90; opacity: 0; pointer-events: none; transition: opacity .22s; }
  .m-scrim.open { opacity: 1; pointer-events: auto; }
  .m-drawer { position: fixed; top: 0; left: 0; bottom: 0; z-index: 91; width: 84%; max-width: 340px; background: var(--ck-bg); border-right: 1px solid var(--ck-border); transform: translateX(-100%); transition: transform .25s cubic-bezier(.32,.72,0,1); display: flex; flex-direction: column; padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom); }
  .m-drawer.open { transform: translateX(0); }
  .m-drawer .ck-sidebar { flex: 1; min-height: 0; }
  .m-drawer .ck-panel-body { flex: 1; overflow-y: auto; }
  /* 顶部返回/标题条（手机端自绘，因为隐藏了 toolbar） */
  .m-topbar {
    display: flex; align-items: center; gap: 8px;
    height: 48px; padding: 0 12px; padding-top: env(safe-area-inset-top);
    min-height: calc(48px + env(safe-area-inset-top));
    background: var(--ck-bg); border-bottom: 1px solid var(--ck-border);
    flex-shrink: 0;
  }
  .m-topbar .m-title { flex: 1; font-size: 14px; font-weight: 600; text-align: center; }
  .m-topbar .m-btn {
    width: 36px; height: 36px; display: flex; align-items: center; justify-content: center;
    border: none; background: transparent; color: var(--ck-text-2); cursor: pointer; border-radius: 9px;
  }
  .m-topbar .m-btn svg { width: 19px; height: 19px; stroke: currentColor; fill: none; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }
  .m-status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ck-text-dim); }
  .m-status-dot.on { background: var(--ck-green); }
  .m-status-dot.busy { background: var(--ck-primary); animation: m-pulse 1.2s infinite; }
  .m-status-dot.off { background: var(--ck-danger); }
  @keyframes m-pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
  .m-star {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    margin: 12px; padding: 11px; border-radius: 10px;
    background: var(--ck-surface); color: var(--ck-text-2); font-size: 12.5px; text-decoration: none;
  }
  .m-star svg { width: 14px; height: 14px; stroke: var(--ck-primary); fill: none; stroke-width: 1.7; }
  `,
  '</style>',
  '</head>',
  '<body>',
  // 开机标记（JS 执行后会移除；若一直显示说明 JS 挂了）
  '<div id="m-boot" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:99998;color:#6b83ff;font:14px/1.6 -apple-system,sans-serif;text-align:center">正在加载界面…<br><span style="font-size:11px;opacity:.7">若长时间停留，说明脚本报错</span></div>',
  '<div class="shell">',
  // 顶栏
  '  <div class="m-topbar">',
  '    <button class="m-btn" id="m-menu"><svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h16"/></svg></button>',
  '    <div class="m-title">Cuckoo</div>',
  '    <button class="m-btn" id="m-new"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>',
  '    <span class="m-status-dot off" id="m-status"></span>',
  '  </div>',
  // 对话流（主区域）
  '  <div class="m-stream" id="m-stream"><div class="m-empty" id="m-empty">',
  '    <div class="m-empty-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 6v6c0 5 3.5 9 8 10 4.5-1 8-5 8-10V6z"/><path d="m9 12 2 2 4-4"/></svg></div>',
  '    <div class="m-empty-t1">Cuckoo</div><div class="m-empty-t2">在下面输入，遥控电脑上的 AI</div>',
  '  </div></div>',
  // 输入区
  '  <div class="m-composer"><div class="m-input-wrap">',
  '    <textarea id="m-input" rows="1" placeholder="给 Cuckoo 发消息…"></textarea>',
  '    <button id="m-send" disabled><svg viewBox="0 0 24 24"><path d="m5 12 7-7 7 7M12 5v14"/></svg></button>',
  '  </div></div>',
  // 侧栏抽屉
  '  <div class="m-scrim" id="m-scrim"></div>',
  '  <div class="m-drawer" id="m-drawer">',
  '    <div class="ck-sidebar" id="ck-sidebar">',
  activitybar,
  '      <div class="ck-panel">',
  modals,
  '        <div class="ck-panel-body">',
  panels,
  '        </div>',
  '      </div>',
  '    </div>',
  '  </div>',
  statusbar,
  '</div>',
  '<script>',
  appJs,
  '</script>',
  '</body>',
  '</html>',
].join('\n');

fs.writeFileSync(OUT, html, 'utf8');
console.log('[build-shell] 生成 ui/shell.html（' + Math.round(html.length / 1024) + 'KB，' + Object.keys(apiMap).length + ' 个 API 映射，' + noops.length + ' 个订阅 no-op）');
