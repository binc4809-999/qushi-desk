# -*- coding: utf-8 -*-
"""Write data/last_run.json (pipeline heartbeat) for the public desk.

PyCharm / research scripts should call record_run() at the end of a job so
fund managers see freshness on 投资机会 — not a static marketing line.

Usage:
    python write_last_run.py --status success --script my_job.py --summary "更新机会表"
    python write_last_run.py --status failed --script my_job.py --error "timeout" --push

Env (same as refresh_quotes / publish_alert):
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
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable, Optional

ROOT = Path(__file__).resolve().parents[1]
LAST_RUN_FILE = ROOT / "data" / "last_run.json"
DEFAULT_REPO = "binc4809-999/qushi-desk"
ALLOWED_STATUS = {"success", "failed", "running"}


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


def _read_prev() -> dict:
    if not LAST_RUN_FILE.exists():
        return {}
    try:
        return json.loads(LAST_RUN_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _as_scripts(scripts: Optional[Iterable[str] | str]) -> list[str]:
    if scripts is None:
        return []
    if isinstance(scripts, str):
        return [scripts] if scripts.strip() else []
    return [str(s) for s in scripts if str(s).strip()]


def build_payload(
    *,
    status: str,
    scripts: Optional[Iterable[str] | str] = None,
    summary: str = "",
    error: Optional[str] = None,
    files_written: Optional[Iterable[str]] = None,
    started_at: Optional[str] = None,
    finished_at: Optional[str] = None,
    last_success_at: Optional[str] = None,
    sample: bool = False,
    prev: Optional[dict] = None,
) -> dict:
    status = (status or "").strip().lower()
    if status not in ALLOWED_STATUS:
        raise ValueError(f"status must be one of {sorted(ALLOWED_STATUS)}")

    prev = prev if prev is not None else _read_prev()
    finished = finished_at or (now_iso() if status != "running" else None)
    if status == "success":
        success_at = last_success_at or finished
    else:
        success_at = last_success_at or prev.get("last_success_at")

    names = _as_scripts(scripts) or _as_scripts(prev.get("scripts"))
    payload = {
        "schema_version": 1,
        "sample": bool(sample),
        "status": status,
        "started_at": started_at or now_iso(),
        "finished_at": finished,
        "last_success_at": success_at,
        "scripts": names,
        "summary": summary or "",
        "error": error,
        "files_written": [str(p) for p in (files_written or [])],
    }
    if not payload["sample"]:
        payload.pop("sample", None)
    return payload


def save_local(payload: dict) -> Path:
    LAST_RUN_FILE.parent.mkdir(parents=True, exist_ok=True)
    LAST_RUN_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"[last_run] 已写入 {LAST_RUN_FILE}")
    return LAST_RUN_FILE


def push_github(payload: dict) -> None:
    repo = (os.environ.get("SIGNAL_DESK_REPO") or DEFAULT_REPO).strip()
    token = _github_token()
    if not repo or not token:
        print("[last_run] 未配置 GitHub token，跳过推送")
        return
    path = "data/last_run.json"
    api = f"https://api.github.com/repos/{repo}/contents/{path}"
    headers = {
        "Accept": "application/vnd.github+json",
        "Authorization": f"Bearer {token}",
        "User-Agent": "promised-land-last-run",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    sha = None
    try:
        req = urllib.request.Request(api, headers=headers, method="GET")
        with urllib.request.urlopen(req, timeout=15) as res:
            sha = json.loads(res.read()).get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404:
            print(f"[last_run] GET 失败: {e}")
            return

    encoded = base64.b64encode(
        (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    ).decode("ascii")
    body: dict = {
        "message": f"last_run: {payload.get('status')} {payload.get('summary', '')[:60]}",
        "content": encoded,
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
        print("[last_run] GitHub Pages 更新成功")
    except Exception as exc:
        print(f"[last_run] GitHub 推送失败: {exc}")


def record_run(
    *,
    status: str,
    scripts: Optional[Iterable[str] | str] = None,
    summary: str = "",
    error: Optional[str] = None,
    files_written: Optional[Iterable[str]] = None,
    started_at: Optional[str] = None,
    finished_at: Optional[str] = None,
    last_success_at: Optional[str] = None,
    sample: bool = False,
    push: bool = False,
) -> dict:
    payload = build_payload(
        status=status,
        scripts=scripts,
        summary=summary,
        error=error,
        files_written=files_written,
        started_at=started_at,
        finished_at=finished_at,
        last_success_at=last_success_at,
        sample=sample,
    )
    save_local(payload)
    if push:
        push_github(payload)
    return payload


def main() -> None:
    ap = argparse.ArgumentParser(description="写入 data/last_run.json 管道心跳")
    ap.add_argument("--status", required=True, choices=sorted(ALLOWED_STATUS))
    ap.add_argument("--script", action="append", dest="scripts", help="可重复")
    ap.add_argument("--summary", default="")
    ap.add_argument("--error", default=None)
    ap.add_argument("--files", action="append", dest="files_written", default=None)
    ap.add_argument("--push", action="store_true", help="同步推送到 GitHub Pages")
    ap.add_argument("--sample", action="store_true", help="标记为示例心跳")
    args = ap.parse_args()
    record_run(
        status=args.status,
        scripts=args.scripts,
        summary=args.summary,
        error=args.error,
        files_written=args.files_written,
        sample=args.sample,
        push=args.push,
    )


if __name__ == "__main__":
    main()
