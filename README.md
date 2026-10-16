# 局域网控制（lan-control）

通过局域网（手机 / 平板 / 其他设备）**实时双向控制** Cuckoo。

## 功能

### 基础
- ✅ 插件注册（可被 App 加载、侧边栏出现面板）
- ✅ 主进程 HTTP 服务 + 二维码（手机扫码即开）
- ✅ 密码门令（HMAC 签名 cookie，30 天）

### 双向通信（WebSocket）
- ✅ 电脑 → 手机：AI 流式输出、工具调用、任务状态**实时推送**
- ✅ 手机 → 电脑：发消息、停止生成、新对话、查状态、列窗口
- ✅ 手机端控制页：聊天流 + 输入框 + 工具卡片

### 待做
- ⬜ 会话切换、平台切换
- ⬜ 附件上传（手机拍图发给 AI）
- ⬜ 只读模式开关

## 目录结构

```
lan-control/
├── plugin.json          清单（id/名称/配置 schema）
├── ui/panel.js          侧边栏面板（二维码 + 密码管理）
├── ui/mobile.html       手机控制页（扫码后打开）
├── lib/qrcode.js        二维码生成（离线）
├── lib/ws.js            极简 WebSocket 服务端（零依赖，RFC6455）
├── lib/control.js       双向控制桥（手机 ↔ 主进程控制面）
├── providers/server.js  主进程入口（HTTP + WS + 控制面注册）
└── README.md
```

## 配置

存于 `~/.cuckoo/plugins-config.json` 的 `lan-control` 键：

| 键 | 默认 | 说明 |
|----|------|------|
| `port` | 18800 | HTTP 服务端口 |
| `host` | 0.0.0.0 | 绑定地址（0.0.0.0 = 局域网可访问）|
| `autoStart` | true | 插件加载时自动起服务 |
| `password` | "" | 访问密码（留空 = 不校验）|

## 访问

启动后在局域网设备浏览器打开：`http://<本机IP>:18800/`（扫码直达控制页）

## 双向通道

```
手机 ──WS──> /ws ──> __cuckooPluginControl ──> 活跃窗口 AI 页面
手机 <──WS── /ws <── broadcastPluginEvent <── harness-event-report
```

**依赖主项目**：`src/app/ipc/plugin-control.ts`（暴露控制面 + 事件广播）

## 手机指令协议

| type | 说明 |
|------|------|
| `send` | 发消息（`{type:'send', text:'...'}`）|
| `stop` | 停止当前生成 |
| `new` | 开新对话 |
| `status` | 查当前窗口状态 |
| `windows` | 列出所有窗口 |
| `ping` | 心跳 |

**电脑推送事件**（与主进程 harness 事件同名）：
`stream` / `assistant-done` / `tool-start` / `tool-end` / `task-idle` / `ai-state`
