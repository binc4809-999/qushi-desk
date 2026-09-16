# -*- coding: utf-8 -*-
"""Push a structured alert to the public desk.

Local write: site/data/alerts.json
Remote write (optional): GitHub Contents API so Pages/CDN refreshes.
Worker write (optional): HMAC POST if SIGNAL_DESK_API_URL is set.

Never put API keys, tokens, or email passwords into the alert body.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Optional

MAX_ITEMS = 200
ROOT = Path(__file__).resolve().parents[1]
LOCAL_FILE = ROOT / "data" / "alerts.json"
DEFAULT_REPO = "binc4809-999/qushi-desk"


class _HTMLStripper(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._chunks: list[str] = []

    def handle_data(self, data: str) -> None:
        self._chunks.append(data)

    def get_text(self) -> str:
        return re.sub(r"\s+\n", "\n", " ".join(self._chunks))


def html_to_text(raw: str) -> str:
    if not raw:
        return ""
    if "<" not in raw:
        return raw.strip()
    parser = _HTMLStripper()
    try:
        parser.feed(raw)
        text = parser.get_text()
    except Exception:
        text = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"[ \t]+", " ", text).strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _slug(text: str) -> str:
    raw = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return (raw or "alert")[:48]


def infer_market(subject: str, body: str, venue: str = "", symbol: str = "") -> str:
    blob = f"{subject or ''}\n{body or ''}\n{venue or ''}\n{symbol or ''}"
    up = blob.upper()
    if any(k in blob for k in ("美股", "NASDAQ", "NYSE", "美股盘")) or re.search(
        r"\b(AAPL|TSLA|NVDA|MSFT|AMZN|GOOGL|META|SPY|QQQ)\b", up
    ):
        return "us"
    if any(
        k in blob
        for k in ("USDT", "OKX", "Binance", "币安", "永续", "SWAP", "BTC", "ETH", "SOL", "加密")
    ) or re.search(r"[A-Z0-9]+-USDT", up):
        return "crypto"
    if re.search(r"\b\d{6}\b", blob) or any(
        k in blob for k in ("A股", "EXPMA", "选股", "monitor", "scanner", "涨速", "量比")
    ):
        return "cn"
    if venue in ("A股", "CN"):
        return "cn"
    if venue in ("OKX", "Binance", "Crypto"):
        return "crypto"
    if venue in ("美股", "US", "NASDAQ", "NYSE"):
        return "us"
    return "crypto" if "USDT" in up else "cn"


def infer_event(subject: str, body: str, source: str = "") -> dict:
    sub = subject or ""
    blob = f"{sub}\n{body or ''}"
    kind, severity, channel, venue = "info", "info", "system", "MAIL"

    if any(k in blob for k in ("开仓", "平仓", "止盈", "止损", "MOVE_SL", "EMA55", "USDT-SWAP", "USDT", "成交")):
        channel, venue = "trade", "OKX"
    if any(k in blob for k in ("EXPMA", "点火", "收敛池", "选股", "量比", "涨速")):
        channel, venue = "monitor", "A股"
    if "Binance" in blob or "币安" in blob:
        venue = "Binance" if channel == "trade" else venue
    if any(k in blob for k in ("美股", "NASDAQ", "NYSE")) or re.search(
        r"\b(AAPL|TSLA|NVDA|MSFT|AMZN|GOOGL|META)\b", blob, re.I
    ):
        venue = "美股"

    if "开仓" in sub:
        kind, severity = "open", "signal"
    elif "成交" in sub:
        kind, severity = "fill", "info"
    elif any(k in sub for k in ("平仓", "MOVE_SL")):
        kind, severity = "close", "info"
    elif "EMA55" in sub or "止盈" in sub:
        kind, severity = "tp", "signal"
    elif "止损" in sub:
        kind, severity = "sl", "risk"
    elif any(k in sub for k in ("点火", "EXPMA", "收敛池", "监控")):
        kind, severity = "monitor", "signal"
    elif "异常" in sub or "失败" in sub:
        kind, severity = "data", "risk"

    symbol = "UNKNOWN"
    m = re.search(r"(BTC|SOL|ETH)[-_ ]?USDT(?:-SWAP)?", blob, re.I)
    if m:
        symbol = f"{m.group(1).upper()}-USDT-SWAP"
    else:
        m_us = re.search(r"\b(AAPL|TSLA|NVDA|MSFT|AMZN|GOOGL|META|SPY|QQQ)\b", blob, re.I)
        if m_us:
            symbol = m_us.group(1).upper()
        else:
            m2 = re.search(r"\b([0-9]{6})\b", blob)
            if m2 and channel == "monitor":
                symbol = m2.group(1)

    market = infer_market(sub, body or "", venue, symbol)
    return {
        "id": f"{_slug(source or 'script')}-{_slug(sub)}-{int(time.time())}",
        "ts": _now_iso(),
        "market": market,
        "severity": severity,
        "kind": kind,
        "channel": channel,
        "venue": venue,
        "symbol": symbol,
        "title": sub[:120] or "脚本预警",
        "body": html_to_text(body or "")[:2000],
        "source": source or "script",
        "live": True,
    }


def _read_bundle(path: Path) -> dict:
    if not path.exists():
        return {"updated_at": _now_iso(), "count": 0, "items": []}
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _write_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="alerts.", suffix=".json", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def prepend(event: dict, bundle: dict) -> dict:
    items = [event] + [x for x in bundle.get("items", []) if x.get("id") != event.get("id")]
    items.sort(key=lambda x: str(x.get("ts") or ""), reverse=True)
    items = items[:MAX_ITEMS]
    sample = all(not x.get("live") for x in items) if items else bool(bundle.get("sample"))
    out = {
        "schema_version": bundle.get("schema_version") or 1,
        "updated_at": event.get("ts") or _now_iso(),
        "count": len(items),
        "items": items,
    }
    if sample:
        out["sample"] = True
    else:
        out["sample"] = False
    return out


def publish_local(event: dict) -> dict:
    bundle = prepend(event, _read_bundle(LOCAL_FILE))
    _write_atomic(LOCAL_FILE, bundle)
    return bundle


def _github_token() -> str:
    token = os.environ.get("SIGNAL_DESK_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
    if token.strip():
        return token.strip()
    try:
        proc = subprocess.run(
            ["gh", "auth", "token"],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return proc.stdout.strip()
    except Exception:
        pass
    return ""


def publish_github(event: dict) -> None:
    repo = (os.environ.get("SIGNAL_DESK_REPO") or DEFAULT_REPO).strip()
    token = _github_token()
    if not repo or not token:
        return
    path = os.environ.get("SIGNAL_DESK_PATH", "data/alerts.json")
    api = f"https://api.github.com/repos/{repo}/contents/{path}"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "promised-land-publisher",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    sha = None
    current = {"items": []}
    req = urllib.request.Request(api, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=20) as res:
            payload = json.loads(res.read().decode("utf-8"))
            sha = payload.get("sha")
            raw = base64.b64decode(payload.get("content") or b"{}")
            current = json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise

    bundle = prepend(event, current)
    body = {
        "message": f"alert: {event.get('symbol')} {event.get('title', '')[:60]}",
        "content": base64.b64encode(
            json.dumps(bundle, ensure_ascii=False, indent=2).encode("utf-8") + b"\n"
        ).decode("ascii"),
        "branch": os.environ.get("SIGNAL_DESK_BRANCH", "main"),
    }
    if sha:
        body["sha"] = sha
    put = urllib.request.Request(
        api,
        data=json.dumps(body).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(put, timeout=20) as res:
        res.read()


def publish_worker(event: dict) -> None:
    url = os.environ.get("SIGNAL_DESK_API_URL", "").strip()
    secret = os.environ.get("SIGNAL_DESK_API_SECRET", "").strip()
    if not url:
        return
    raw = json.dumps(event, ensure_ascii=False).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if secret:
        ts = str(int(time.time()))
        sig = hmac.new(secret.encode("utf-8"), ts.encode("utf-8") + b"." + raw, hashlib.sha256).hexdigest()
        headers["X-Timestamp"] = ts
        headers["X-Signature"] = sig
    req = urllib.request.Request(url, data=raw, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=15) as res:
        res.read()


def publish(event: dict) -> dict:
    bundle = publish_local(event)
    errors = []
    for fn, label in ((publish_github, "github"), (publish_worker, "worker")):
        try:
            fn(event)
        except Exception as exc:
            errors.append(f"{label}: {exc}")
    if errors:
        print("[WEB] 远程发布部分失败: " + "; ".join(errors))
    else:
        print(f"[WEB] 已发布预警 {event.get('title')}")
    return bundle


def publish_from_email(subject: str, body: str, source: str = "", extra: Optional[dict] = None) -> dict:
    event = infer_event(subject, body, source)
    event["via"] = "mail"
    if not event.get("source") or event.get("source") == "script":
        event["source"] = source or "mailbox"
    if extra:
        event.update({k: v for k, v in extra.items() if v is not None})
    return publish(event)


if __name__ == "__main__":
    import sys

    sub = sys.argv[1] if len(sys.argv) > 1 else "系统测试"
    body = sys.argv[2] if len(sys.argv) > 2 else "手动发布一条预警"
    publish_from_email(sub, body, source="cli")
