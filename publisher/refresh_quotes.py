# -*- coding: utf-8 -*-
"""Fetch real-time quotes and update site/data/quotes.json.

Data sources (all free, no API key):
  A股/港股/全球指数 : 新浪财经 hq.sinajs.cn
  加密             : Binance public REST + CoinGecko fallback
  贵金属/原油       : 新浪外汇 hf_* 接口

Usage:
    python refresh_quotes.py          # fetch once
    python refresh_quotes.py --loop   # keep running (--interval 120 s)
    python refresh_quotes.py --push   # also push to GitHub Pages

Env:
    SIGNAL_DESK_REPO   binc4809-999/qushi-desk
    SIGNAL_DESK_TOKEN  github token (repo scope); falls back to gh auth token
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUOTES_FILE = ROOT / "data" / "quotes.json"
DEFAULT_REPO = "binc4809-999/qushi-desk"

# ── 新浪财经行情代码映射 ──────────────────────────────────────────────────
# s_sh/s_sz 格式: "名称,现价,涨跌点,涨跌幅%,成交量,成交额"
# gb_ 格式(海外): "名称,现价,涨跌幅%,时间,涨跌点,..."
# hk 港股指数: "代码,名称,现价,昨收,今开,最低,最高,涨跌点,涨跌幅%,..."
# hf_ 格式(贵金属/原油): "现价,昨收,最高,最低,..."

SINA_MAP: dict[str, dict] = {
    # A股
    "000001.SS": {"code": "s_sh000001", "fmt": "s_sh"},
    "399001.SZ": {"code": "s_sz399001", "fmt": "s_sz"},
    "000300.SS": {"code": "s_sh000300", "fmt": "s_sh"},
    "399006.SZ": {"code": "s_sz399006", "fmt": "s_sz"},
    "000016.SS": {"code": "s_sh000016", "fmt": "s_sh"},
    # 港股
    "HSI":       {"code": "hkHSI",      "fmt": "hk"},
    "HSCEI":     {"code": "hkHSCEI",    "fmt": "hk"},
    # 海外指数 (gb_)
    "^DJI":      {"code": "gb_dji",     "fmt": "gb"},
    "^IXIC":     {"code": "gb_ixic",    "fmt": "gb"},
    "^GSPC":     {"code": "gb_inx",     "fmt": "gb"},
    # 贵金属 / 原油
    "GC=F":      {"code": "hf_XAU",     "fmt": "hf"},
    "SI=F":      {"code": "hf_XAG",     "fmt": "hf"},
    "CL=F":      {"code": "hf_OIL",     "fmt": "hf"},
    # 白银期货转人民币(新浪报的是人民币每克)
}

# Binance 合约 symbol
BINANCE_MAP = {
    "BTC-USD": "BTCUSDT",
    "ETH-USD": "ETHUSDT",
    "SOL-USD": "SOLUSDT",
}


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _github_token() -> str:
    token = os.environ.get("SIGNAL_DESK_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    if token.strip():
        return token.strip()
    try:
        proc = subprocess.run(
            ["gh", "auth", "token"], capture_output=True, text=True, timeout=10, check=False
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return proc.stdout.strip()
    except Exception:
        pass
    return ""


def _get(url: str, timeout: int = 12, encoding: str = "utf-8") -> str | None:
    req = urllib.request.Request(
        url, headers={"Referer": "https://finance.sina.com.cn",
                       "User-Agent": "Mozilla/5.0"}
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode(encoding, errors="replace")
    except Exception as exc:
        print(f"[quotes] GET {url[:60]}  ERR: {exc}")
        return None


# ── 新浪解析 ─────────────────────────────────────────────────────────────

def _parse_sina(raw: str) -> dict[str, dict]:
    """Parse hq.sinajs.cn multi-code response. Returns {label: {price, chg_pct}}."""
    result: dict[str, dict] = {}
    for line in raw.splitlines():
        m = re.match(r'var hq_str_(\S+?)="([^"]*)"', line)
        if not m:
            continue
        code, data = m.group(1), m.group(2)
        if not data.strip():
            continue
        parts = data.split(",")
        try:
            if code.startswith("s_sh") or code.startswith("s_sz"):
                # 名称,现价,涨跌点,涨跌幅%,成交量,成交额
                price = float(parts[1])
                chg = float(parts[3])
                result[code] = {"price": round(price, 4), "chg_pct": round(chg, 2)}
            elif code.startswith("hk"):
                # 代码,名称,现价,昨收,今开,最低,最高,涨跌点,涨跌幅%,...
                price = float(parts[2])
                chg = float(parts[8])
                result[code] = {"price": round(price, 4), "chg_pct": round(chg, 2)}
            elif code.startswith("gb_"):
                # 名称,现价,涨跌幅%,时间,...
                price = float(parts[1])
                chg = float(parts[2])
                result[code] = {"price": round(price, 4), "chg_pct": round(chg, 2)}
            elif code.startswith("hf_"):
                # 现价,昨收,最高?,最低?,...
                price = float(parts[0])
                prev = float(parts[1]) if parts[1] else price
                chg = round((price - prev) / prev * 100, 2) if prev else 0.0
                result[code] = {"price": round(price, 4), "chg_pct": chg}
        except (IndexError, ValueError):
            pass
    return result


def fetch_sina(symbols: list[str]) -> dict[str, dict]:
    """Fetch from 新浪财经 for all symbols that have a SINA_MAP entry."""
    sina_codes = []
    code_to_label: dict[str, str] = {}
    for sym in symbols:
        entry = SINA_MAP.get(sym)
        if entry:
            sina_codes.append(entry["code"])
            code_to_label[entry["code"]] = sym

    if not sina_codes:
        return {}

    url = f"https://hq.sinajs.cn/list={','.join(sina_codes)}"
    raw = _get(url, encoding="gbk")
    if not raw:
        return {}

    parsed = _parse_sina(raw)
    result: dict[str, dict] = {}
    for code, vals in parsed.items():
        sym_label = code_to_label.get(code)
        if sym_label:
            result[sym_label] = vals
    return result


# ── Binance 加密 ──────────────────────────────────────────────────────────

def fetch_binance(symbols: list[str]) -> dict[str, dict]:
    result: dict[str, dict] = {}
    for label in symbols:
        bsym = BINANCE_MAP.get(label)
        if not bsym:
            continue
        raw = _get(f"https://api.binance.com/api/v3/ticker/24hr?symbol={bsym}")
        if not raw:
            result[label] = {"price": None, "chg_pct": None}
            continue
        try:
            d = json.loads(raw)
            price = float(d["lastPrice"])
            chg = float(d["priceChangePercent"])
            result[label] = {"price": round(price, 4), "chg_pct": round(chg, 2)}
        except Exception as exc:
            print(f"[quotes] binance {label}: {exc}")
            result[label] = {"price": None, "chg_pct": None}
    return result


def fetch_coingecko(symbols: list[str]) -> dict[str, dict]:
    """CoinGecko fallback for crypto."""
    CG = {"BTC-USD": "bitcoin", "ETH-USD": "ethereum", "SOL-USD": "solana"}
    ids = [CG[s] for s in symbols if s in CG]
    if not ids:
        return {}
    url = (
        "https://api.coingecko.com/api/v3/simple/price"
        f"?ids={','.join(ids)}&vs_currencies=usd&include_24hr_change=true"
    )
    raw = _get(url, timeout=20)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    rev = {v: k for k, v in CG.items()}
    return {
        rev[cg_id]: {
            "price": round(vals.get("usd") or 0, 4),
            "chg_pct": round(vals.get("usd_24h_change") or 0, 2),
        }
        for cg_id, vals in data.items()
        if cg_id in rev
    }


# ── Main fetch ────────────────────────────────────────────────────────────

def fetch_quotes(data: dict) -> tuple[dict, int, int]:
    all_syms: list[str] = []
    for group in data.get("groups", []):
        for item in group.get("items", []):
            all_syms.append(item["symbol"])

    crypto_syms = [s for s in all_syms if s in BINANCE_MAP]
    sina_syms = [s for s in all_syms if s in SINA_MAP]

    updates: dict[str, dict] = {}

    # 1. 新浪 (A股 + 港股 + 海外指数 + 贵金属/原油)
    sina_result = fetch_sina(sina_syms)
    updates.update(sina_result)

    # 2. 加密 Binance → CoinGecko fallback
    bn = fetch_binance(crypto_syms)
    updates.update(bn)
    failed_crypto = [s for s in crypto_syms if not bn.get(s, {}).get("price")]
    if failed_crypto:
        cg = fetch_coingecko(failed_crypto)
        updates.update(cg)

    # Apply
    for group in data.get("groups", []):
        for item in group.get("items", []):
            upd = updates.get(item["symbol"])
            if upd and upd.get("price") is not None:
                item["price"] = upd["price"]
            if upd and upd.get("chg_pct") is not None:
                item["chg_pct"] = upd["chg_pct"]

    fetched = sum(1 for u in updates.values() if u.get("price") is not None)
    print(f"[quotes] 已获取 {fetched} / {len(all_syms)} 个标的")
    data["updated_at"] = _now()
    return data, fetched, len(all_syms)


# ── Persist ───────────────────────────────────────────────────────────────

def save_local(data: dict) -> None:
    QUOTES_FILE.parent.mkdir(parents=True, exist_ok=True)
    QUOTES_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"[quotes] 已写入 {QUOTES_FILE}")


def push_github(data: dict) -> None:
    repo = (os.environ.get("SIGNAL_DESK_REPO") or DEFAULT_REPO).strip()
    token = _github_token()
    if not repo or not token:
        print("[quotes] 未配置 GitHub token，跳过推送")
        return
    path = "data/quotes.json"
    api = f"https://api.github.com/repos/{repo}/contents/{path}"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "promised-land-quotes",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    sha = None
    try:
        req = urllib.request.Request(api, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=15) as res:
            sha = json.loads(res.read()).get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(f"[quotes] GET 失败: {e}")
            return

    encoded = base64.b64encode(
        (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    ).decode("ascii")
    body: dict = {
        "message": f"quotes: refresh {data.get('updated_at', _now())}",
        "content": encoded,
        "branch": "main",
    }
    if sha:
        body["sha"] = sha
    try:
        put = urllib.request.Request(
            api,
            data=json.dumps(body).encode("utf-8"),
            headers={**headers, "Content-Type": "application/json"},
            method="PUT",
        )
        with urllib.request.urlopen(put, timeout=20) as res:
            res.read()
        print("[quotes] GitHub Pages 更新成功")
    except Exception as exc:
        print(f"[quotes] GitHub 推送失败: {exc}")


def _record(status: str, summary: str, error: str | None = None, push: bool = False) -> None:
    try:
        from write_last_run import record_run
    except ImportError:
        from publisher.write_last_run import record_run
    try:
        record_run(
            status=status,
            scripts=["publisher/refresh_quotes.py"],
            summary=summary,
            error=error,
            files_written=["data/quotes.json", "data/last_run.json"] if status == "success" else ["data/last_run.json"],
            push=push,
        )
    except Exception as exc:
        print(f"[quotes] 写入 last_run 失败: {exc}")


# ── Entry ─────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="全球行情刷新器 (新浪 + Binance)")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--interval", type=float, default=120)
    ap.add_argument("--push", action="store_true", help="同步推送到 GitHub Pages")
    args = ap.parse_args()

    os.environ.setdefault("SIGNAL_DESK_REPO", DEFAULT_REPO)

    while True:
        try:
            raw = json.loads(QUOTES_FILE.read_text(encoding="utf-8"))
            data, fetched, total = fetch_quotes(raw)
            save_local(data)
            if args.push:
                push_github(data)
            _record(
                "success",
                f"行情快照 {fetched}/{total} 个标的有报价",
                push=args.push,
            )
        except Exception as exc:
            print(f"[quotes] 刷新失败: {exc}")
            _record("failed", "行情刷新失败", error=str(exc), push=args.push)
        if not args.loop:
            break
        time.sleep(max(30.0, args.interval))


if __name__ == "__main__":
    main()
