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
const HERE = import.meta.dirname;
const OUT = path.join(HERE, 'shell.html');

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
const P1_PAGES = ['workspaces', 'conversations', 'memories', 'snapshots', 'skills', 'plugins', 'settings'];
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
// onXXX 订阅（手机端无推送）：标记为 no-op
const noopRe = /(\w+):\s*\([^)]*\)\s*=>\s*\{?\s*ipcRenderer\.on\(/g;
const noops = [];
while ((m = noopRe.exec(preloadSrc)) !== null) { noops.push(m[1]); }

const appJs = fs.readFileSync(path.join(HERE, 'shell-app.js'), 'utf8')
  .replace('/*__API_MAP__*/', JSON.stringify(apiMap))
  .replace('/*__API_NOOP__*/', JSON.stringify(noops));

// 4. 拼装
const html = [
  '<!DOCTYPE html>',
  '<html lang="zh-CN">',
  '<head>',
  '<meta charset="UTF-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="color-scheme" content="light dark">',
  '<title>Cuckoo</title>',
  '<style>',
  css,
  // ===== 移动端适配（不改变视觉，只让布局在窄屏可用）=====
  `
  /* 手机端：默认展开侧栏，占满宽度（不做悬浮） */
  .ck-sidebar { position: static !important; width: 100% !important; }
  .ck-sidebar.ck-collapsed { width: 100% !important; }
  .ck-panel { position: static !important; flex: 1 !important; width: auto !important; box-shadow: none !important; }
  .ck-activitybar { width: 46px !important; }
  .shell { height: 100vh; height: 100dvh; }
  .toolbar { display: none !important; }        /* 顶部工具栏（窗口控制）手机端隐藏 */
  .ck-sidebar-resizer { display: none !important; } /* 禁拖拽调宽 */
  .ck-win-divider, .ck-win-controls { display: none !important; }
  .viewport { display: none !important; }        /* 电脑端 AI 网页区，手机端不显示 */
  body { overscroll-behavior: none; -webkit-tap-highlight-color: transparent; }
  .ck-list-item { padding: 12px 14px; }          /* 触控加大点击区 */
  .ck-icon-btn { width: 36px; height: 36px; }
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
  '<div class="shell">',
  '  <div class="m-topbar">',
  '    <button class="m-btn" id="m-back"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>',
  '    <div class="m-title">Cuckoo</div>',
  '    <span class="m-status-dot off" id="m-status"></span>',
  '  </div>',
  '  <div class="main-area">',
  '    <div class="ck-sidebar" id="ck-sidebar">',
  activitybar,
  '      <div class="ck-panel">',
  modals,
  '        <div class="ck-panel-body">',
  panels,
  '        </div>',
  '      </div>',
  '    </div>',
  '    <div class="viewport"></div>',
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
