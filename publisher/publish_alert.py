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
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

MAX_ITEMS = 200
ROOT = Path(__file__).resolve().parents[1]
LOCAL_FILE = ROOT / "data" / "alerts.json"


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _slug(text: str) -> str:
    raw = re.sub(r"[^a-zA-Z0-9]+", "-", text).strip("-").lower()
    return (raw or "alert")[:48]


def infer_event(subject: str, body: str, source: str = "") -> dict:
    sub = subject or ""
    kind, severity = "info", "info"
    if "开仓" in sub:
        kind, severity = "open", "signal"
    elif "EMA55" in sub or "止盈" in sub:
        kind, severity = "tp", "signal"
    elif "止损" in sub:
        kind, severity = "sl", "risk"
    elif "异常" in sub or "失败" in sub:
        kind, severity = "data", "risk"
    symbol = "UNKNOWN"
    m = re.search(r"(BTC|SOL|ETH)[-_ ]?USDT(?:-SWAP)?", sub + " " + (body or ""), re.I)
    if m:
        symbol = f"{m.group(1).upper()}-USDT-SWAP"
    return {
        "id": f"{_slug(source or 'script')}-{_slug(sub)}-{int(time.time())}",
        "ts": _now_iso(),
        "severity": severity,
        "kind": kind,
        "symbol": symbol,
        "title": sub[:120] or "脚本预警",
        "body": (body or "")[:2000],
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
    items = items[:MAX_ITEMS]
    return {"updated_at": event.get("ts") or _now_iso(), "count": len(items), "items": items}


def publish_local(event: dict) -> dict:
    bundle = prepend(event, _read_bundle(LOCAL_FILE))
    _write_atomic(LOCAL_FILE, bundle)
    return bundle


def publish_github(event: dict) -> None:
    repo = os.environ.get("SIGNAL_DESK_REPO", "").strip()
    token = os.environ.get("SIGNAL_DESK_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
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
    if extra:
        event.update({k: v for k, v in extra.items() if v is not None})
    return publish(event)


if __name__ == "__main__":
    import sys
    sub = sys.argv[1] if len(sys.argv) > 1 else "系统测试"
    body = sys.argv[2] if len(sys.argv) > 2 else "手动发布一条预警"
    publish_from_email(sub, body, source="cli")
