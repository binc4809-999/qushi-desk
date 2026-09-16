# 五饼二鱼 · 极简重定计划

## 目标（一句话）

**按「A股 / 加密 / 美股」三类，分类展示脚本发到邮箱的提醒**（开仓、平仓、成交、监控等）。不做复杂营销台。

## 信息架构（极简）

| 栏目 | 作用 |
|---|---|
| **预警**（首页） | 三分类切换 + 时间倒序卡片列表 |
| **联系** | 电话 / 邮件 / 微信 / 收款 |

以下暂不作为主路径（可后置或下线）：众筹长文、演示台 K 线、策略回测大页、产品套件营销。

## 数据（只保留一条主管道）

脚本发邮件 →（可选）IMAP 入库 / 脚本直调 → `data/alerts.json` → 页面展示。

每条预警最少字段：

```json
{
  "id": "unique",
  "ts": "2026-09-16T10:00:00+00:00",
  "market": "cn",
  "kind": "open",
  "title": "开仓 · 30B 做多",
  "body": "正文（来自邮件，可截断）",
  "symbol": "BTC-USDT-SWAP",
  "source": "QUSHIIZIYOU_BTCUSDT_V6",
  "live": true
}
```

| `market` | 含义 | 识别线索（发布时自动推断） |
|---|---|---|
| `cn` | A股 | 六位代码、monitor、选股、EXPMA、A股 |
| `crypto` | 加密 | USDT、OKX、Binance、BTC/ETH/SOL |
| `us` | 美股 | 美股、NASDAQ、NYSE、常见美股代码 |

`kind` 建议：`open` / `close` / `fill`（成交）/ `monitor` / `info` / `sl` / `tp`。

## 页面交互

1. 默认打开 **A股**。
2. 点 **加密** / **美股** 只过滤列表，不跳多页。
3. 卡片：时间（上海）· 类型 · 标的 · 标题 · 摘要 · 脚本来源 · LIVE/SAMPLE。
4. 无复杂图表、无多级筛选。

## 脚本怎么上墙

```text
python publisher/publish_alert.py --subject "开仓 ..." --body "..." --source my_script --push
```

或邮件入库后走同一 `publish_alert`。发布端写入 `market`；旧数据无该字段时前端按 venue/symbol 兜底推断。

## 验收

- 首页只有三类切换 + 列表。
- 样例数据三类都有至少 1 条。
- 公网刷新后可见。
