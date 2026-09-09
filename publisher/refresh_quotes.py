# -*- coding: utf-8 -*-
"""Fetch real-time quotes and update site/data/quotes.json.

Data sources (no API key needed):
  Crypto  : Binance public REST (/api/v3/ticker/24hr)
  Indices : yfinance (if installed); else akshare for CN indices
  Metals  : yfinance or Binance BTC/ETH proxy fallback

Usage:
    python refresh_quotes.py          # fetch once
    python refresh_quotes.py --loop   # keep running (default --interval 120 s)
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
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QUOTES_FILE = ROOT / "data" / "quotes.json"
DEFAULT_REPO = "binc4809-999/qushi-desk"

BINANCE_CRYPTO = {
    "BTC-USD":  "BTCUSDT",
    "ETH-USD":  "ETHUSDT",
    "SOL-USD":  "SOLUSDT",
}

COINGECKO_IDS = {
    "BTC-USD": "bitcoin",
    "ETH-USD": "ethereum",
    "SOL-USD": "solana",
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


def _get_json(url: str, timeout: int = 15) -> dict | list | None:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (promised-land-quotes/2.0)"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as exc:
        print(f"[quotes] GET {url[:60]} ERR: {exc}")
        return None


def _fetch_binance_crypto(symbols: list[str]) -> dict[str, dict]:
    """Fetch 24hr ticker from Binance for crypto symbols."""
    result: dict[str, dict] = {}
    for sym_label, binance_sym in BINANCE_CRYPTO.items():
        if sym_label not in symbols:
            continue
        data = _get_json(f"https://api.binance.com/api/v3/ticker/24hr?symbol={binance_sym}")
        if data and "lastPrice" in data:
            price = float(data["lastPrice"])
            chg = float(data.get("priceChangePercent", 0))
            result[sym_label] = {"price": round(price, 4), "chg_pct": round(chg, 2)}
        else:
            result[sym_label] = {"price": None, "chg_pct": None}
    return result


def _fetch_coingecko_crypto(symbols: list[str]) -> dict[str, dict]:
    """Fallback: CoinGecko simple price."""
    ids = [COINGECKO_IDS[s] for s in symbols if s in COINGECKO_IDS]
    if not ids:
        return {}
    url = (
        "https://api.coingecko.com/api/v3/simple/price"
        f"?ids={','.join(ids)}&vs_currencies=usd&include_24hr_change=true"
    )
    data = _get_json(url, timeout=20)
    if not data:
        return {}
    reverse = {v: k for k, v in COINGECKO_IDS.items()}
    result: dict[str, dict] = {}
    for cg_id, vals in data.items():
        label = reverse.get(cg_id)
        if label:
            result[label] = {
                "price": round(vals.get("usd") or 0, 4),
                "chg_pct": round(vals.get("usd_24h_change") or 0, 2),
            }
    return result


def _fetch_yfinance(symbols: list[str]) -> dict[str, dict]:
    """Fetch non-crypto via yfinance. Returns {} if yfinance not available."""
    try:
        import yfinance as yf
    except ImportError:
        return {}
    result: dict[str, dict] = {}
    for sym in symbols:
        try:
            fi = yf.Ticker(sym).fast_info
            price = getattr(fi, "last_price", None)
            prev = getattr(fi, "previous_close", None)
            chg = round((price - prev) / prev * 100, 2) if price and prev else None
            result[sym] = {"price": round(price, 4) if price else None, "chg_pct": chg}
            time.sleep(0.15)
        except Exception as exc:
            print(f"[quotes] yf {sym}: {exc}")
            result[sym] = {"price": None, "chg_pct": None}
    return result


def _fetch_akshare_cn() -> dict[str, dict]:
    """Fetch CN index quotes via akshare. Returns {} if not installed."""
    try:
        import akshare as ak
        df = ak.stock_zh_index_spot_em()
        name_col = "名称" if "名称" in df.columns else df.columns[1]
        price_col = [c for c in df.columns if "最新" in c or "价格" in c or "current" in c.lower()][0]
        chg_col = [c for c in df.columns if "涨跌幅" in c or "change" in c.lower()][0]
        mapping = {
            "上证指数": "000001.SS",
            "深证成指": "399001.SZ",
        }
        result: dict[str, dict] = {}
        for idx_name, label in mapping.items():
            row = df[df[name_col] == idx_name]
            if not row.empty:
                price = float(row[price_col].iloc[0])
                chg = float(row[chg_col].iloc[0])
                result[label] = {"price": round(price, 2), "chg_pct": round(chg, 2)}
        return result
    except Exception as exc:
        print(f"[quotes] akshare CN: {exc}")
        return {}


def fetch_quotes(data: dict) -> dict:
    all_syms: list[str] = []
    for group in data.get("groups", []):
        for item in group.get("items", []):
            all_syms.append(item["symbol"])

    crypto_syms = [s for s in all_syms if s in BINANCE_CRYPTO]
    other_syms = [s for s in all_syms if s not in BINANCE_CRYPTO]

    updates: dict[str, dict] = {}

    # --- Crypto: Binance first, CoinGecko fallback ---
    if crypto_syms:
        bn = _fetch_binance_crypto(crypto_syms)
        updates.update(bn)
        failed_crypto = [s for s in crypto_syms if not bn.get(s, {}).get("price")]
        if failed_crypto:
            cg = _fetch_coingecko_crypto(failed_crypto)
            updates.update(cg)

    # --- CN indices: akshare ---
    cn_syms = ["000001.SS", "399001.SZ"]
    cn_present = [s for s in cn_syms if s in other_syms]
    if cn_present:
        ak_data = _fetch_akshare_cn()
        updates.update(ak_data)

    # --- Rest: yfinance ---
    remaining = [s for s in other_syms if s not in updates and s not in cn_syms]
    if remaining:
        yf_data = _fetch_yfinance(remaining)
        updates.update(yf_data)

    # Apply updates
    for group in data.get("groups", []):
        for item in group.get("items", []):
            upd = updates.get(item["symbol"])
            if upd and upd.get("price") is not None:
                item["price"] = upd["price"]
            if upd and upd.get("chg_pct") is not None:
                item["chg_pct"] = upd["chg_pct"]

    data["updated_at"] = _now()
    print(f"[quotes] 已获取 {len(updates)} / {len(all_syms)} 个标的")
    return data


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


def main() -> None:
    ap = argparse.ArgumentParser(description="全球行情刷新器")
    ap.add_argument("--loop", action="store_true")
    ap.add_argument("--interval", type=float, default=120)
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()

    os.environ.setdefault("SIGNAL_DESK_REPO", DEFAULT_REPO)

    while True:
        try:
            raw = json.loads(QUOTES_FILE.read_text(encoding="utf-8"))
            data = fetch_quotes(raw)
            save_local(data)
            if args.push:
                push_github(data)
        except Exception as exc:
            print(f"[quotes] 刷新失败: {exc}")
        if not args.loop:
            break
        time.sleep(max(30.0, args.interval))


if __name__ == "__main__":
    main()
