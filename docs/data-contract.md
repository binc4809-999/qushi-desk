# 管道数据合同（PyCharm → GitHub Pages）

公网站点是静态 GitHub Pages。**页面不手写机会表**；PyCharm / 研究脚本把结果写成 `data/*.json`，推到 `main` 后 `.github/workflows/pages.yml` 会把 `data/` 原样打进站点。

本地预览：仓库根目录 `python -m http.server 8080`，打开 http://127.0.0.1:8080/ 。浏览器从 `./data/` 拉 JSON，改文件后刷新即可。

## 文件

| 文件 | 谁写 | 页面怎么用 |
|---|---|---|
| `data/last_run.json` | 每次脚本跑完（成功/失败/运行中） | 投资机会与实盘页顶部心跳：状态、上海时间、本跑摘要 |
| `data/opportunities.json` | 调研脚本 | 「优先机会」表（按 `region` 分栏） |
| `data/quotes.json` | 已有 `publisher/refresh_quotes.py` | 「全球行情」面板；**不要改结构去迁就机会表** |
| `data/alerts.json` | `publisher/publish_alert.py` 或实盘脚本 | 「实盘策略/预警」预警流 |
| `data/strategies.json` | 策略/回测脚本 | 同页策略卡片（名称、交易所、状态、规则） |
| `data/runners.json` | `publisher/write_runner.py`（循环内心跳） | 「脚本运行状态」：谁在跑、最新一行日志 |
| `data/tips.json` | 监控 / 扫描 / 加密脚本 | 演示台「当前买卖点」：买 / 卖 / 预警 + 脚本归因 |
| `data/pools.json` | `scanner` / `scanner11` | 演示台选股池表（`selected_id` 决定展示哪一池） |
| `data/charts.json` | `monitor` / `monitor11` / 加密脚本 | 演示台 TOP3 与加密币对 K 线的标的、默认周期、markers |
| `data/contact.json` | 人手填写 | 首页获客表与「联系」页：邮件 / 电话 / 微信；未知项写「待填写」 |

时间一律 **UTC ISO-8601**（例 `2026-09-09T16:06:56+00:00`）。前端用 `Asia/Shanghai` 显示。

仓库里的 JSON 带 `"sample": true` 时，页面会标明示例，方便你覆盖。脚本写入正式结果后请设 `"sample": false` 或删掉该字段。预警条目另用 `"live": true|false` 区分实盘与样例。

## `data/last_run.json`

```json
{
  "schema_version": 1,
  "sample": false,
  "status": "success",
  "started_at": "2026-09-09T16:06:40+00:00",
  "finished_at": "2026-09-09T16:06:56+00:00",
  "last_success_at": "2026-09-09T16:06:56+00:00",
  "scripts": ["publisher/refresh_quotes.py"],
  "summary": "一句话：这跑改了什么",
  "error": null,
  "files_written": ["data/quotes.json"]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `status` | 是 | `success` \| `failed` \| `running` |
| `scripts` | 是 | 脚本名数组；也接受单个字符串 `script` |
| `summary` | 建议 | 给基金经理看的「这跑改了什么」 |
| `finished_at` | 结束时 | UTC |
| `last_success_at` | 建议 | 失败时仍保留上次成功时间，页面会分开显示 |
| `error` | 失败时 | 短错误，不要堆栈、不要密钥 |
| `files_written` | 否 | 本跑写过的仓库内路径 |
| `sample` | 否 | 示例心跳为 `true` |

在脚本末尾调用（与现有行情刷新同一套 GitHub Contents API）：

```python
from write_last_run import record_run   # 若从 publisher/ 目录运行
# 或: from publisher.write_last_run import record_run

record_run(
    status="success",                    # 或 failed / running
    scripts=["my_research.py"],
    summary="更新 A1 预期收益",
    files_written=["data/opportunities.json"],
    push=True,                           # 需要 SIGNAL_DESK_TOKEN 或 gh auth
)
```

命令行：

```
python publisher/write_last_run.py --status success --script my_research.py --summary "更新机会表" --files data/opportunities.json --push
```

失败时同样写一笔 `status=failed`，并带上 `error`；`last_success_at` 会从上一份文件继承。

## `data/opportunities.json`

顶层：`schema_version`、`updated_at`、`items`（数组）。可选 `sample`、`as_of`、`disclaimer`。

每条 `items[]`：

| 字段 | 必填 | 别名（前端同样认） |
|---|---|---|
| `id` | 建议 | 稳定主键，便于脚本覆盖同一条 |
| `priority` | 是 | 表「优先级」，如 `A1` |
| `name` | 是 | 表「机会」 |
| `thesis` | 是 | `mechanism` — 表「机制」 |
| `expected` | 是 | `public_returns` — 表「公开收益」 |
| `drawdown` | 是 | 表「回撤」 |
| `cost` | 是 | `main_cost` — 表「主要代价」 |
| `status` | 是 | `watch` / `research` / `live` 等，控制色条 |
| `status_label` | 建议 | 中文：观察 / 研究 / 实盘脚本 |
| `region` | 是 | `global` / `crypto` / `cn` / `other` / `method`（对应页内筛选项） |
| `region_label` | 建议 | 全球 / 加密 / A股 … |
| `klass` / `klass_label` | 否 | 副标题第二段 |
| `as_of` | 否 | 该条数字日期；表内不展开，点一行在详情里看 |
| `source` | 否 | 短来源说明；同上，详情面板展示 |
| `links` | 否 | `[{"label":"…","url":"https://…"}]`；详情面板展示 |
| `evidence` | 否 | 调研备注 / 脚本证据；详情面板展示 |

页面表格只保留可扫读的短列（优先级、名称、截断后的机制/代价、收益、回撤、状态）。点一行打开深色详情抽屉，展示上表字段（有则显示）。状态列是标签，不是按钮；用页头「观察 / 研究 / 实盘」筛选 `status`。

`region=global` 的条目出现在「全球」栏（A1–A3 示例）。不要只改 HTML。

## `data/alerts.json`

由 `publisher/publish_alert.py` 前置写入。前端按 `ts` **倒序**展示，时间显示为上海时区。SAMPLE 条目请保留，直到实盘脚本推送 `live: true`。

```json
{
  "schema_version": 1,
  "sample": false,
  "updated_at": "2026-09-08T04:20:00+00:00",
  "count": 1,
  "items": [
    {
      "id": "okx-btc-open-1710000000",
      "ts": "2026-09-08T04:20:00+00:00",
      "severity": "signal",
      "kind": "open",
      "channel": "trade",
      "venue": "OKX",
      "symbol": "BTC-USDT-SWAP",
      "title": "开仓 · 30B 做多",
      "body": "信号 30B · 开仓价 28322.23 · 5x 逐仓",
      "source": "okx_v6",
      "confidence": 0.62,
      "live": true
    }
  ]
}
```

每条 `items[]`：

| 字段 | 必填 | 别名（前端同样认） |
|---|---|---|
| `id` | 是 | 稳定主键；重复 id 会覆盖旧条 |
| `ts` | 是 | UTC ISO；页面显示上海时间 |
| `title` | 是 | `action` — 卡片主标题（开仓/平仓/点火） |
| `body` | 建议 | `trigger` — 触发条件 / 正文 |
| `channel` | 是 | `trade` / `monitor` / `system`（页内频道筛选） |
| `kind` | 建议 | `open` / `close` / `tp` / `sl` / `monitor` / `system` … |
| `severity` | 建议 | `signal` / `risk` / `info` / `system` — 左边色条与「状态」 |
| `venue` | 建议 | OKX / Binance / A股 / SITE |
| `symbol` | 建议 | 合约或代码；与策略 `instId` 对得上时会填「最近信号」 |
| `live` | 是 | `true` 标 LIVE；`false` 标 SAMPLE |
| `source` | 否 | 脚本名 |
| `confidence` | 否 | `0–1` 显示为百分比，或短文本（高/中/低） |

不要把密钥、token、邮件密码写进 `body`。发布器最多保留 200 条，并按 `ts` 倒序。实盘脚本也可继续走 GitHub Contents API / Worker，字段保持上表即可。

可选：预警脚本跑完后另调 `record_run(...)` 更新 `last_run.json`，实盘页顶部的「管道」心跳就会一起变。预警流自己的新鲜度看本文件的 `updated_at`。

进程还在跑、只是挂起等开盘时，请另写 `data/runners.json`（见下），不要用 `last_run` 覆盖成一次「成功结束」。

## `data/strategies.json`

顶层：`venues[]`，每组下 `symbols[]`。旧的回测数字（`ret_pct` / `by_signal` 等）仍可写，页面只扫读：**名称、交易所、状态、最近信号、一句话规则**。

每条 `symbols[]`：

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` | 是 | 卡片标题，如 `BTC` |
| `exchange` / 父级 `venues[].title` | 建议 | 交易所 |
| `instId` | 建议 | 合约 id，用来匹配预警 `symbol` |
| `status` | 建议 | `live` / `paused` / `sample` |
| `status_label` | 建议 | 实盘运行 / 暂停 / 回测样例 |
| `rule` | 建议 | 一句话规则；缺省则用 `params` |
| `last_signal` | 否 | `{ts, title, kind, live}`；缺省则从前端预警流里取该品种最新一条 |
| `ret_pct` / `maxdd_pct` / `trades` | 否 | 卡片底部一行数字，不是正文 |

`lede` 可以留在 JSON 里给脚本注释用，页面不再当营销长文展示。

## `data/runners.json`

多脚本心跳，和 `last_run.json`（整次作业结束）分开。页面**不能自动发现 PyCharm**；每个进程必须调用 `publisher.write_runner.heartbeat(..., push=True)`（或 CLI `--push`），按 `id` 覆盖。当前本机对照集：`monitor` / `scanner` / `zhangdiesudubang修正版` / `macd_crypto_bot_no_squeeze` / `s_v3_binance_monitor`。前端在「实盘策略/预警」展示，投资机会页有一行摘要。

```json
{
  "schema_version": 1,
  "sample": true,
  "updated_at": "2026-09-10T01:14:00+00:00",
  "count": 1,
  "runners": [
    {
      "id": "monitor",
      "name": "monitor",
      "script": "monitor.py",
      "status": "running",
      "last_message": "[monitor] 13:20 共29只 · [mail] TOP3 邮件发送失败 · 暂无点火标的",
      "updated_at": "2026-09-10T05:20:46+00:00",
      "started_at": "2026-09-10T01:10:00+00:00",
      "venue": "A股",
      "notes": "stock_convergence/monitor.py",
      "detail_url": "https://binc4809-999.github.io/qushi-desk/#live",
      "sample": true
    }
  ]
}
```

每条 `runners[]`（`items[]` 也可，前端同样认）：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 稳定主键；同一脚本反复覆盖 |
| `name` | 建议 | PyCharm 运行配置名 / 展示名；缺省用 `id` |
| `script` | 建议 | 脚本文件名 |
| `status` | 是 | `running` \| `waiting` \| `idle` \| `error` \| `stopped` |
| `last_message` | 建议 | `last_line` — 控制台最新一行，原样上墙 |
| `updated_at` | 是 | UTC ISO；页面显示上海时间 |
| `started_at` | 否 | 本次进程启动；waiting/running 时发布器会继承 |
| `venue` / `symbol` | 否 | 场所、品种 |
| `notes` | 否 | 点开卡片后的补充说明 |
| `detail_url` | 否 | 点开后的外链 |
| `sample` | 否 | 示例心跳为 `true`；实盘脚本不要带，或设 `false` |

`status` 语义：`running` 在干活；`waiting` 进程还在、只是等开盘/等条件；`idle` 空闲；`error` 异常；`stopped` 已停。

在循环里调用（不要每秒推一次，2–5 分钟或状态变化时即可）：

```python
from write_runner import heartbeat          # 若从 publisher/ 目录运行
# 或: from publisher.write_runner import heartbeat

heartbeat(
    id="monitor",
    status="running",                       # running / waiting / idle / error / stopped
    last_message=line,                      # 最近一行 print
    script="monitor.py",
    venue="A股",
    push=True,                              # 需要 SIGNAL_DESK_TOKEN 或 gh auth
)
```

命令行：

```
python publisher/write_runner.py --id monitor --status running --script monitor.py --venue A股 --message "[monitor] 暂无点火标的" --push
```

发布器按 `id` 覆盖本地文件；`--push` 时先 GET 远端 `data/runners.json` 再合并后 PUT，避免把别的脚本心跳盖掉。省略的 `name` / `script` / `venue` 会沿用上一条。

仓库里的示例带 `"sample": true`，方便你对照 PyCharm 运行面板；脚本写入正式心跳后不要带 `sample`，或设 `false`。

## `data/tips.json`（演示台买卖点）

`#desk` 展示当前买 / 卖 / 预警，**每条必须能追溯到脚本**。时间仍是 UTC ISO，页面显示上海时区。字段名请按表写，便于日后整改对照。首页营销页的产品卡片链到这里。

```json
{
  "schema_version": 1,
  "sample": true,
  "updated_at": "2026-09-10T05:20:00+00:00",
  "count": 1,
  "items": [
    {
      "id": "tip-monitor-600519-buy",
      "ts": "2026-09-10T05:18:00+00:00",
      "side": "buy",
      "symbol": "600519",
      "name": "贵州茅台",
      "venue": "A股",
      "message": "EXPMA 池点火 · 量比 2.41",
      "script_id": "monitor",
      "script_name": "monitor",
      "price": 1486.20,
      "live": false
    }
  ]
}
```

每条 `items[]`：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 稳定主键；同一脚本反复覆盖同一条 |
| `ts` | 是 | UTC ISO；页面显示上海时间 |
| `side` | 是 | `buy` / `sell` / `alert`（买入 / 卖出 / 预警） |
| `symbol` | 是 | 代码或币对，由脚本固定，访客不能改 |
| `name` | 建议 | 中文名 / 展示名 |
| `venue` | 建议 | `A股` / `Binance` / `OKX` …；首页可按 A股 / 加密筛选 |
| `message` | 是 | 短说明（触发条件、量比、涨速等） |
| `script_id` | 是 | 脚本稳定 id，与 `runners.json` 的 `id` 对齐，例如 `monitor` / `monitor11` / `scanner` / `macd_crypto_bot_no_squeeze` / `s_v3_binance_monitor` / `zhangdiesudubang` |
| `script_name` | 建议 | 展示名（如 `zhangdiesudubang修正版`）；缺省用 `script_id` |
| `price` | 否 | 提示价 |
| `live` | 是 | `true` 标 LIVE；`false` 标 SAMPLE |
| `source` | 否 | 旧字段别名；若无 `script_id` 会回退到这里（不推荐） |

不要把密钥写进 `message`。SAMPLE 条目请保留到实盘脚本推送 `live: true`。

## `data/pools.json`（scanner 选股池）

`scanner` / `scanner11` 把当前选中的股票池写到这里。页面只渲染 `selected_id` 对应的那一池。

```json
{
  "schema_version": 1,
  "sample": true,
  "updated_at": "2026-09-10T01:40:00+00:00",
  "selected_id": "scanner",
  "pools": [
    {
      "id": "scanner",
      "script_id": "scanner",
      "script_name": "scanner",
      "title": "scanner 当日选股池",
      "venue": "A股",
      "as_of": "2026-09-10T01:40:00+00:00",
      "members": [
        {
          "symbol": "600519",
          "name": "贵州茅台",
          "price": 1486.20,
          "chg_pct": 1.42,
          "speed_pct": 0.38,
          "volume_ratio": 1.62,
          "note": "酒"
        }
      ]
    }
  ]
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `selected_id` | 是 | 展示哪一池；与 `pools[].id` 对应 |
| `pools[].id` | 是 | 池主键 |
| `pools[].script_id` / `script_name` | 是 | 产出该池的脚本 |
| `pools[].members[]` | 是 | 池内标的 |
| `members[].symbol` | 是 | 代码 |
| `members[].name` | 建议 | 名称 |
| `members[].price` / `chg_pct` / `speed_pct` / `volume_ratio` | 建议 | 现价、涨跌幅、涨速、量比 |
| `members[].note` | 否 | 短备注 |

## `data/charts.json`（TOP3 + 加密 K 线 markers）

`monitor` / `monitor11` 写 `top3`（默认周期 **日线 `1d`**）。加密脚本写 `crypto`（默认周期 **30 分 `30m`**）。标的由脚本固定；访客只能拖动 K 线和切换周期。

每条图表下的 `markers[]` 会画在对应币对 / 股票 K 线上（买 / 卖 / 预警），不要只发文字。

```json
{
  "schema_version": 1,
  "sample": true,
  "updated_at": "2026-09-10T05:20:00+00:00",
  "top3": [
    {
      "id": "top3-600519",
      "rank": 1,
      "kind": "stock",
      "symbol": "600519",
      "name": "贵州茅台",
      "venue": "A股",
      "script_id": "monitor",
      "script_name": "monitor",
      "default_interval": "1d",
      "message": "EXPMA 点火",
      "markers": [
        {
          "ts": "2026-09-10T07:00:00+00:00",
          "price": 1486.20,
          "side": "buy",
          "label": "买入",
          "script_id": "monitor"
        }
      ]
    }
  ],
  "crypto": [
    {
      "id": "crypto-btcusdt",
      "kind": "crypto",
      "symbol": "BTCUSDT",
      "name": "BTC/USDT",
      "venue": "Binance",
      "script_id": "macd_crypto_bot_no_squeeze",
      "script_name": "macd_crypto_bot_no_squeeze",
      "default_interval": "30m",
      "markers": [
        {
          "ts": "2026-09-10T03:30:00+00:00",
          "price": 64180,
          "side": "buy",
          "label": "买入",
          "script_id": "macd_crypto_bot_no_squeeze"
        }
      ]
    }
  ]
}
```

`top3[]` / `crypto[]` 共用字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 图表主键 |
| `symbol` | 是 | 固定标的 |
| `name` / `venue` | 建议 | 展示名、场所 |
| `kind` | 建议 | `stock` / `crypto`（决定默认周期与可选周期） |
| `rank` | TOP3 建议 | 1 / 2 / 3 |
| `script_id` / `script_name` | 是 | 产出该图的脚本 |
| `default_interval` | 建议 | 股票默认 `1d`，加密默认 `30m`；也认 `5m` / `15m` / `1h` / `4h` |
| `message` | 否 | 图标题旁的短说明 |
| `markers` | 建议 | 画在 K 线上的买卖点 |

`markers[]`：

| 字段 | 必填 | 说明 |
|---|---|---|
| `ts` | 是 | UTC ISO；前端对齐到最近一根 K 线 |
| `price` | 建议 | 标记价；缺省用该根收盘价 |
| `side` | 是 | `buy` / `sell` / `alert` |
| `label` | 建议 | 图上短标签（买入 / 卖出 / 观察） |
| `script_id` | 建议 | 该标记来自哪个脚本 |

当前页面的 K 线 OHLC **先按 `symbol` 种子生成示意数据**（可拖动、切周期）。脚本以后若要推真实 bar，可再扩展 `bars[]`；现阶段以 UX + markers + 脚本归因为准。

兼容：也接受顶层 `charts[]`，用 `kind` / `role`（`top3` / `pair`）分流到股票 / 加密。

## `data/contact.json`（获客联系方式）

首页预约表和「联系」页读这份文件。**未知项写中文「待填写」**，并设 `placeholder: true`；不要编造看起来像真的电话或微信号。改完 push `main` 即可，不必改 HTML。

```json
{
  "schema_version": 1,
  "headline": "预约交流 / 合作对接",
  "lede": "面向基金管理人的研究台演示、脚本对接或内容合作。",
  "email": "you@example.com",
  "tel": "待填写",
  "tel_href": "",
  "wechat": { "id": "待填写", "placeholder": true, "qr": "./img/wechat-qr.jpg", "hint": "扫二维码添加好友" },
  "binance": { "label": "BINANCE 收款码", "id": "待填写", "qr": "./img/binance-pay.jpg", "hint": "使用币安 App 扫码支付" },
  "form": { "mailto": "you@example.com", "subject": "【迦南美地】预约交流" }
}
```

`form.mailto` 决定「发送邮件预约」是否可用。邮件客户端在访客本机打开，站点不收集表单。

## 怎么发布到公网

站点只在 **`main` 上的文件** 经 GitHub Pages 工作流上线（`pages.yml` 复制 `css/` `js/` `data/` `img/`）。任选一种：

1. **提交并 push `main`**（最直观）：在仓库里改 JSON → `git add data/*.json && git commit && git push`。Pages 约 1 分钟刷新；CDN 可能再缓存几十秒。
2. **GitHub Contents API**（现有脚本已用）：本机设

```
SIGNAL_DESK_REPO=binc4809-999/qushi-desk
SIGNAL_DESK_TOKEN=<github token，repo 权限>
SIGNAL_DESK_BRANCH=main
```

然后 `record_run(..., push=True)`、`heartbeat(..., push=True)` 或 `python publisher/refresh_quotes.py --push`。token 不要写进 JSON、不要提交进仓库。

行情刷新继续只写 `data/quotes.json`；它现在也会更新 `last_run.json`。演示台买卖点覆盖 `tips.json`，选股池覆盖 `pools.json`，TOP3 / 加密 K 线与 markers 覆盖 `charts.json`。机会表请由你的调研脚本覆盖 `opportunities.json`，预警请走 `publisher/publish_alert.py`，策略卡片覆盖 `strategies.json`，进程心跳走 `publisher/write_runner.py`。获客联系方式只改 `data/contact.json`（未知项写「待填写」），不要把电话/微信写死在 HTML。
