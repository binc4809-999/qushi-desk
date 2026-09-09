# 管道数据合同（PyCharm → GitHub Pages）

公网站点是静态 GitHub Pages。**页面不手写机会表**；PyCharm / 研究脚本把结果写成 `data/*.json`，推到 `main` 后 `.github/workflows/pages.yml` 会把 `data/` 原样打进站点。

本地预览：仓库根目录 `python -m http.server 8080`，打开 http://127.0.0.1:8080/ 。浏览器从 `./data/` 拉 JSON，改文件后刷新即可。

## 文件

| 文件 | 谁写 | 页面怎么用 |
|---|---|---|
| `data/last_run.json` | 每次脚本跑完（成功/失败/运行中） | 投资机会页顶部心跳：状态、上海时间、本跑摘要 |
| `data/opportunities.json` | 调研脚本 | 「优先机会」表（按 `region` 分栏） |
| `data/quotes.json` | 已有 `publisher/refresh_quotes.py` | 「全球行情」面板；**不要改结构去迁就机会表** |

预警仍走 `publisher/publish_alert.py` → `data/alerts.json`。本切片不改实盘/预警。

时间一律 **UTC ISO-8601**（例 `2026-09-09T16:06:56+00:00`）。前端用 `Asia/Shanghai` 显示。

仓库里的 JSON 带 `"sample": true` 时，页面会标明示例，方便你覆盖。脚本写入正式结果后请设 `"sample": false` 或删掉该字段。

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

## 怎么发布到公网

站点只在 **`main` 上的文件** 经 GitHub Pages 工作流上线（`pages.yml` 复制 `css/` `js/` `data/` `img/`）。任选一种：

1. **提交并 push `main`**（最直观）：在仓库里改 JSON → `git add data/*.json && git commit && git push`。Pages 约 1 分钟刷新；CDN 可能再缓存几十秒。
2. **GitHub Contents API**（现有脚本已用）：本机设

```
SIGNAL_DESK_REPO=binc4809-999/qushi-desk
SIGNAL_DESK_TOKEN=<github token，repo 权限>
SIGNAL_DESK_BRANCH=main
```

然后 `record_run(..., push=True)` 或 `python publisher/refresh_quotes.py --push`。token 不要写进 JSON、不要提交进仓库。

行情刷新继续只写 `data/quotes.json`；它现在也会更新 `last_run.json`。机会表请由你的调研脚本覆盖 `opportunities.json`，不要手改 `index.html`。
