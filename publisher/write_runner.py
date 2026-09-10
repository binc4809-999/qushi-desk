# -*- coding: utf-8 -*-
"""Upsert one script heartbeat into data/runners.json.

PyCharm / live loops should call heartbeat() every few minutes so the public
desk can show which jobs are running and their latest console line — without
opening the IDE. This is per-process status, not the end-of-job last_run.json.

Usage (from a monitor11-style loop):

    from write_runner import heartbeat          # if cwd is publisher/
    # from publisher.write_runner import heartbeat

    heartbeat(
        id="monitor11",
        status="waiting",                       # running|waiting|idle|error|stopped
        last_message=line,                      # e.g. "[monitor11] 非交易时段，等待 09-10 09:30 开盘..."
        script="monitor11.py",
        venue="A股",
        push=True,                              # needs SIGNAL_DESK_TOKEN
    )

Do not call this every second — GitHub Contents API + Pages deploy. Every 2–5
minutes (or on status change) is enough.

CLI:
    python publisher/write_runner.py --id monitor11 --status waiting \\
        --message "[monitor11] 非交易时段，等待 09-10 09:30 开盘..." --push

Env (same as write_last_run / publish_alert):
    SIGNAL_DESK_REPO    binc4809-999/qushi-desk
    SIGNAL_DESK_TOKEN   github token (repo scope); falls back to gh auth token
    SIGNAL_DESK_BRANCH  main
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import subprocess
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parents[1]
RUNNERS_FILE = ROOT / "data" / "runners.json"
DEFAULT_REPO = "binc4809-999/qushi-desk"
ALLOWED_STATUS = {"running", "waiting", "idle", "error", "stopped"}
ACTIVE_STATUS = {"running", "waiting"}
STATUS_RANK = {"running": 0, "waiting": 1, "error": 2, "idle": 3, "stopped": 4}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


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


def _parse_ts(value: object) -> float:
    if not value:
        return 0.0
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
    except Exception:
        return 0.0


def _read_bundle(path: Path) -> dict:
    if not path.exists():
        return {"schema_version": 1, "updated_at": now_iso(), "count": 0, "runners": []}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"schema_version": 1, "updated_at": now_iso(), "count": 0, "runners": []}


def _write_atomic(path: Path, data: dict) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="runners.", suffix=".json", dir=str(path.parent))
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
    return path


def _runners_of(bundle: dict) -> list[dict]:
    raw = bundle.get("runners")
    if raw is None:
        raw = bundle.get("items")
    return [r for r in (raw or []) if isinstance(r, dict)]


def _clean(value: Optional[str]) -> str:
    return (value or "").strip()


def build_runner(
    *,
    id: str,
    status: str,
    name: str = "",
    script: str = "",
    last_message: str = "",
    last_line: str = "",
    updated_at: Optional[str] = None,
    started_at: Optional[str] = None,
    venue: str = "",
    symbol: str = "",
    notes: str = "",
    detail_url: str = "",
    sample: bool = False,
    prev: Optional[dict] = None,
) -> dict:
    rid = _clean(id)
    if not rid:
        raise ValueError("id is required")
    status = _clean(status).lower()
    if status not in ALLOWED_STATUS:
        raise ValueError(f"status must be one of {sorted(ALLOWED_STATUS)}")

    prev = prev or {}
    message = _clean(last_message) or _clean(last_line) or _clean(prev.get("last_message") or prev.get("last_line"))
    stamp = updated_at or now_iso()

    if started_at:
        started = started_at
    elif status in ACTIVE_STATUS:
        started = prev.get("started_at") or stamp
    else:
        started = prev.get("started_at")

    runner = {
        "id": rid,
        "name": _clean(name) or _clean(prev.get("name")) or rid,
        "script": _clean(script) or _clean(prev.get("script")),
        "status": status,
        "last_message": message,
        "updated_at": stamp,
        "started_at": started,
        "venue": _clean(venue) or _clean(prev.get("venue")),
        "symbol": _clean(symbol) or _clean(prev.get("symbol")),
        "notes": _clean(notes) or _clean(prev.get("notes")),
        "detail_url": _clean(detail_url) or _clean(prev.get("detail_url")),
    }
    if sample:
        runner["sample"] = True
    # keep unknown extras (status_label, pid, …) from the previous row
    reserved = set(runner) | {
        "last_line",
        "items",
        "runners",
        "schema_version",
        "count",
        "updated_at",
        "sample",
    }
    for key, value in (prev or {}).items():
        if key in runner or key in reserved:
            continue
        if value in (None, ""):
            continue
        runner[key] = value
    # drop empty optional strings so the file stays scannable
    for key in ("script", "started_at", "venue", "symbol", "notes", "detail_url", "last_message"):
        if not runner.get(key):
            runner.pop(key, None)
    return runner


def upsert_into(bundle: dict, runner: dict) -> dict:
    runners = _runners_of(bundle)
    rid = runner.get("id")
    prev = next((r for r in runners if r.get("id") == rid), None)
    if prev:
        # re-merge so omitted fields keep the previous values
        runner = build_runner(
            id=str(rid),
            status=str(runner.get("status") or ""),
            name=str(runner.get("name") or ""),
            script=str(runner.get("script") or ""),
            last_message=str(runner.get("last_message") or runner.get("last_line") or ""),
            updated_at=str(runner.get("updated_at") or ""),
            started_at=str(runner.get("started_at") or ""),
            venue=str(runner.get("venue") or ""),
            symbol=str(runner.get("symbol") or ""),
            notes=str(runner.get("notes") or ""),
            detail_url=str(runner.get("detail_url") or ""),
            sample=bool(runner.get("sample")),
            prev=prev,
        )
    kept = [r for r in runners if r.get("id") != rid]
    kept.append(runner)
    kept.sort(
        key=lambda r: (
            STATUS_RANK.get(str(r.get("status") or ""), 9),
            -_parse_ts(r.get("updated_at")),
            str(r.get("id") or ""),
        )
    )
    sample = all(bool(r.get("sample")) for r in kept) if kept else bool(bundle.get("sample"))
    out = {
        "schema_version": bundle.get("schema_version") or 1,
        "updated_at": runner.get("updated_at") or now_iso(),
        "count": len(kept),
        "runners": kept,
        "sample": sample,
    }
    if not out["sample"]:
        out.pop("sample", None)
    else:
        out["sample"] = True
    return out


def save_local(bundle: dict, dest: Optional[Path] = None) -> Path:
    path = dest or RUNNERS_FILE
    _write_atomic(path, bundle)
    print(f"[runners] 已写入 {path}")
    return path


def push_github(runner: dict) -> None:
    repo = (os.environ.get("SIGNAL_DESK_REPO") or DEFAULT_REPO).strip()
    token = _github_token()
    if not repo or not token:
        print("[runners] 未配置 GitHub token，跳过推送")
        return
    path = os.environ.get("SIGNAL_DESK_RUNNERS_PATH", "data/runners.json")
    api = f"https://api.github.com/repos/{repo}/contents/{path}"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "promised-land-runners",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    sha = None
    current: dict = {"runners": []}
    try:
        req = urllib.request.Request(api, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=20) as res:
            payload = json.loads(res.read().decode("utf-8"))
            sha = payload.get("sha")
            raw = base64.b64decode(payload.get("content") or b"{}")
            current = json.loads(raw.decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(f"[runners] GET 失败: {e}")
            return
    except Exception as exc:
        print(f"[runners] GET 失败: {exc}")
        return

    bundle = upsert_into(current, runner)
    body: dict = {
        "message": f"runners: {runner.get('id')} {runner.get('status')} {(runner.get('last_message') or '')[:50]}",
        "content": base64.b64encode(
            (json.dumps(bundle, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        ).decode("ascii"),
        "branch": os.environ.get("SIGNAL_DESK_BRANCH", "main"),
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
        print("[runners] GitHub Pages 更新成功")
    except Exception as exc:
        print(f"[runners] GitHub 推送失败: {exc}")


def heartbeat(
    *,
    id: str,
    status: str,
    name: str = "",
    script: str = "",
    last_message: str = "",
    last_line: str = "",
    venue: str = "",
    symbol: str = "",
    notes: str = "",
    detail_url: str = "",
    sample: bool = False,
    push: bool = False,
    dest: Optional[Path] = None,
) -> dict:
    path = dest or RUNNERS_FILE
    bundle = _read_bundle(path)
    prev = next((r for r in _runners_of(bundle) if r.get("id") == _clean(id)), None)
    runner = build_runner(
        id=id,
        status=status,
        name=name,
        script=script,
        last_message=last_message,
        last_line=last_line,
        venue=venue,
        symbol=symbol,
        notes=notes,
        detail_url=detail_url,
        sample=sample,
        prev=prev,
    )
    out = upsert_into(bundle, runner)
    save_local(out, dest=path)
    if push:
        push_github(runner)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="写入 data/runners.json 脚本心跳")
    ap.add_argument("--id", required=True, help="稳定主键，同一脚本反复覆盖")
    ap.add_argument("--status", required=True, choices=sorted(ALLOWED_STATUS))
    ap.add_argument("--name", default="", help="PyCharm 运行配置名或展示名")
    ap.add_argument("--script", default="", help="脚本文件名")
    ap.add_argument("--message", "--line", dest="last_message", default="", help="最近一行日志")
    ap.add_argument("--venue", default="")
    ap.add_argument("--symbol", default="")
    ap.add_argument("--notes", default="")
    ap.add_argument("--url", dest="detail_url", default="")
    ap.add_argument("--push", action="store_true", help="同步推送到 GitHub Pages")
    ap.add_argument("--sample", action="store_true", help="标记为示例心跳")
    args = ap.parse_args()
    heartbeat(
        id=args.id,
        status=args.status,
        name=args.name,
        script=args.script,
        last_message=args.last_message,
        venue=args.venue,
        symbol=args.symbol,
        notes=args.notes,
        detail_url=args.detail_url,
        sample=args.sample,
        push=args.push,
    )


if __name__ == "__main__":
    main()
