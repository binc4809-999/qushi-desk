# 迦南美地 · The Promised Land

公网地址：https://binc4809-999.github.io/qushi-desk/

全球可访问的静态站点：展示调研里的投资机会，以及 OKX BTC/SOL 趋势脚本的预警。

**不是投资建议。** 页面上的收益和回撤来自公开指数、基金净值，或本仓库 2023-09-07 至 2026-09-07 的回测。

## 为什么这样能撑约 10 万同时在线

浏览路径没有数据库、没有源站动态渲染。

| 流量 | 路径 | 作用 |
|---|---|---|
| 10 万读者打开页面 | HTML/CSS/JS/JSON → 全球 CDN | 边缘缓存命中后源站几乎无压力 |
| 脚本偶尔开仓/平仓 | 发布器写入 `data/alerts.json` 或 Worker | 写入量极低，与阅读流量隔离 |

预警 JSON 允许短暂过期（约 15–30 秒）。不要在前端对每个用户做 `cache: reload`，那会把 CDN 打穿。

GitHub Pages 自带 Fastly CDN，静态文件足够支撑这个量级的**阅读**。若以后要更短的预警延迟，把 Cloudflare 接到 Pages 前面，或启用 `worker/`。

## 本地预览

```
python -m http.server 8080
```

打开 http://127.0.0.1:8080/

## 研究脚本怎么驱动页面

机会表和管道心跳来自 `data/opportunities.json` 与 `data/last_run.json`，不是手写 HTML。预警流与策略卡片来自 `data/alerts.json` 与 `data/strategies.json`。各 PyCharm 脚本的运行中心跳（最新一行日志）来自 `data/runners.json`。合同、字段和发布方式见 [docs/data-contract.md](docs/data-contract.md)。

行情仍由 `publisher/refresh_quotes.py` 写 `data/quotes.json`（成功/失败时会更新心跳）。机会表请用你的 PyCharm 脚本覆盖 JSON 后 push `main`，或走与预警相同的 GitHub Contents API。

## 脚本怎么推预警

实盘包 `send_email_alert` 会同时调用 `publisher/publish_alert.py`。

本地会更新 `data/alerts.json`。若要更新公网站点，在运行脚本的机器上设置：

```
SIGNAL_DESK_REPO=binc4809-999/qushi-desk
SIGNAL_DESK_TOKEN=<github token，需要 repo 权限>
```

可选：`SIGNAL_DESK_API_URL` + `SIGNAL_DESK_API_SECRET` 推到 Cloudflare Worker。

## 脚本怎么上报运行状态

公网站点**不能自动发现 PyCharm**。Run 标签开着不会出现在 `#live`；每个进程必须自己调用 `publisher.write_runner.heartbeat`（或 CLI）并带 `push=True`。

循环里每隔几分钟（或状态变化时）调用，不要每秒推：

```python
from publisher.write_runner import heartbeat

heartbeat(
    id="monitor",
    status="running",
    last_message="[monitor] 13:20 共29只 · [mail] TOP3 邮件发送失败 · 暂无点火标的",
    script="monitor.py",
    venue="A股",
    push=True,
)
```

本地写 `data/runners.json`；`push=True` 时用同一套 Contents API 合并进远端，避免覆盖其它脚本。`last_run.json` 仍表示整次作业结束，不要混用。

## Cloudflare Worker（可选）

```
npx wrangler kv namespace create ALERTS
npx wrangler secret put ALERT_SECRET
npx wrangler deploy
```
