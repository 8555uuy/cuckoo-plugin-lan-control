# 局域网控制（lan-control）

通过局域网（手机 / 平板 / 其他设备）远程控制 Cuckoo。

## 当前状态：初版骨架

- ✅ 插件注册（可被 App 加载、侧边栏出现面板）
- ✅ 主进程 HTTP 服务（占位）：`GET /`、`GET /api/status`、`GET /api/ping`
- ⬜ 远程控制功能（待接入）

## 目录结构

```
lan-control/
├── plugin.json          清单（id/名称/配置 schema）
├── ui/panel.js          侧边栏面板（独立活动栏图标）
├── providers/server.js  主进程可执行入口（起 HTTP 服务）
└── README.md
```

## 配置

存于 `~/.cuckoo/plugins-config.json` 的 `lan-control` 键：

| 键 | 默认 | 说明 |
|----|------|------|
| `port` | 18800 | HTTP 服务端口 |
| `host` | 0.0.0.0 | 绑定地址（0.0.0.0 = 局域网可访问）|
| `autoStart` | true | 插件加载时自动起服务 |

## 访问

启动后，在局域网设备浏览器打开：`http://<本机IP>:18800/`

## 后续

功能待定，接入后再补文档。
