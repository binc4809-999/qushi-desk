# -*- coding: utf-8 -*-
"""Pull alert emails and publish them to the public desk.

Preferred inbox: QQ receive box 289833873@qq.com (IMAP).
Fallback: 163 Sent Messages for mails addressed to that QQ.

Env (any one set of credentials works):
  QQ_IMAP_USER / QQ_IMAP_PASS     — QQ IMAP auth code (recommended)
  MAIL_USER / MAIL_PASS           — 163 sender; reads Sent for To: target QQ
  MAIL_TO                         — target address filter (default 289833873@qq.com)

Also uses secrets_local.py in EXPMA选股项目 if present (same as mailer).

Loop:
  python ingest_mailbox.py --loop --interval 45
"""
from __future__ import annotations

import argparse
import email
import imaplib
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from email.header import decode_header, make_header
from email.utils import parsedate_to_datetime
from pathlib import Path

from publish_alert import html_to_text, publish_from_email

ROOT = Path(__file__).resolve().parents[1]
STATE_FILE = ROOT / "publisher" / ".mail_ingest_state.json"
TARGET_DEFAULT = "289833873@qq.com"

ALERT_HINTS = (
    "开仓",
    "平仓",
    "止盈",
    "止损",
    "EMA55",
    "MOVE_SL",
    "EXPMA",
    "点火",
    "收敛池",
    "监控",
    "异常",
    "失败",
    "USDT",
    "选股",
)


def _env(name: str) -> str:
    val = os.environ.get(name, "").strip()
    if val:
        return val
    if os.name == "nt":
        try:
            import winreg

            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Environment") as key:
                val, _ = winreg.QueryValueEx(key, name)
                val = str(val).strip() if val else ""
                if val:
                    return val
        except OSError:
            pass
    for base in (
        Path(r"G:\EXPMA选股项目"),
        Path(__file__).resolve().parents[2],
    ):
        secrets = base / "secrets_local.py"
        if not secrets.exists():
            continue
        try:
            ns: dict = {}
            exec(secrets.read_text(encoding="utf-8"), ns)
            val = str(ns.get(name, "")).strip()
            if val:
                return val
        except Exception:
            pass
    return ""


def _decode(value) -> str:
    if value is None:
        return ""
    try:
        return str(make_header(decode_header(value)))
    except Exception:
        return str(value)


def _load_state() -> dict:
    if not STATE_FILE.exists():
        return {"seen": [], "last_top_ts": 0}
    try:
        return json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"seen": [], "last_top_ts": 0}


def _save_state(state: dict) -> None:
    state["seen"] = list(dict.fromkeys(state.get("seen", [])))[-800:]
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _is_alert(subject: str, body: str) -> bool:
    blob = f"{subject}\n{body}"
    return any(k in blob for k in ALERT_HINTS)


def _message_id(msg: email.message.Message, fallback: str) -> str:
    mid = (msg.get("Message-ID") or msg.get("Message-Id") or "").strip()
    if mid:
        return mid
    return fallback


def _body_of(msg: email.message.Message) -> str:
    texts: list[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            ctype = part.get_content_type()
            if ctype not in ("text/plain", "text/html"):
                continue
            try:
                raw = part.get_payload(decode=True) or b""
                charset = part.get_content_charset() or "utf-8"
                texts.append(raw.decode(charset, errors="replace"))
            except Exception:
                continue
    else:
        try:
            raw = msg.get_payload(decode=True) or b""
            charset = msg.get_content_charset() or "utf-8"
            texts.append(raw.decode(charset, errors="replace"))
        except Exception:
            texts.append(str(msg.get_payload()))
    joined = "\n".join(texts)
    return html_to_text(joined)


def _accounts(target: str) -> list[dict]:
    out: list[dict] = []
    qq_user = _env("QQ_IMAP_USER") or (target if _env("QQ_IMAP_PASS") else "")
    qq_pass = _env("QQ_IMAP_PASS")
    if qq_user and qq_pass:
        out.append(
            {
                "label": "QQ收件箱",
                "user": qq_user,
                "password": qq_pass,
                "host": "imap.qq.com",
                "folders": ("INBOX",),
                "to_filter": "",
            }
        )
    mail_user = _env("MAIL_USER")
    mail_pass = _env("MAIL_PASS")
    if mail_user and mail_pass:
        domain = mail_user.split("@")[-1].lower()
        host = {
            "163.com": "imap.163.com",
            "126.com": "imap.126.com",
            "yeah.net": "imap.yeah.net",
        }.get(domain, f"imap.{domain}")
        out.append(
            {
                "label": "发件箱Sent",
                "user": mail_user,
                "password": mail_pass,
                "host": host,
                "folders": ("Sent Messages", "已发送", "INBOX"),
                "to_filter": target.lower(),
            }
        )
    return out


def _open_folder(conn: imaplib.IMAP4_SSL, names: tuple[str, ...]) -> str | None:
    for name in names:
        typ, _ = conn.select(name, readonly=True)
        if typ == "OK":
            return name
    return None


def _since_imap_date(days: int) -> str:
    dt = datetime.now(timezone.utc) - timedelta(days=days)
    return dt.strftime("%d-%b-%Y")


def ingest_once(days: int = 2, dry_run: bool = False) -> int:
    target = (_env("MAIL_TO") or TARGET_DEFAULT).split(",")[0].strip() or TARGET_DEFAULT
    accounts = _accounts(target)
    if not accounts:
        print("[ingest] 未配置 QQ_IMAP_PASS 或 MAIL_USER/MAIL_PASS，无法拉邮箱")
        return 0

    state = _load_state()
    seen = set(state.get("seen", []))
    published = 0

    for account in accounts:
        try:
            conn = imaplib.IMAP4_SSL(account["host"], 993, timeout=30)
            conn.login(account["user"], account["password"])
        except Exception as exc:
            print(f"[ingest] {account['label']} 登录失败: {exc}")
            continue

        try:
            folder = _open_folder(conn, account["folders"])
            if not folder:
                print(f"[ingest] {account['label']} 找不到可用文件夹 {account['folders']}")
                continue
            typ, data = conn.search(None, f'(SINCE {_since_imap_date(days)})')
            if typ != "OK":
                continue
            ids = data[0].split()
            # newest first, cap per pass
            for num in reversed(ids[-80:]):
                typ, payload = conn.fetch(num, "(RFC822)")
                if typ != "OK" or not payload or not payload[0]:
                    continue
                raw = payload[0][1]
                msg = email.message_from_bytes(raw)
                subject = _decode(msg.get("Subject"))
                to_hdr = _decode(msg.get("To"))
                if account["to_filter"] and account["to_filter"] not in to_hdr.lower():
                    # also accept if subject looks like alert and folder is Sent
                    if not _is_alert(subject, ""):
                        continue
                body = _body_of(msg)
                if not _is_alert(subject, body):
                    continue
                mid = _message_id(msg, f"{account['user']}-{num.decode()}-{subject[:40]}")
                if mid in seen:
                    continue

                # throttle EXPMA TOP mail spam (~10 min)
                is_top = "点火TOP" in subject or ("EXPMA" in subject and "TOP" in subject.upper())
                now = time.time()
                if is_top and now - float(state.get("last_top_ts") or 0) < 600:
                    seen.add(mid)
                    continue

                try:
                    ts = parsedate_to_datetime(msg.get("Date")).astimezone(timezone.utc).isoformat()
                except Exception:
                    ts = None

                extra = {"live": True, "source": f"mail:{account['label']}"}
                if ts:
                    extra["ts"] = ts
                # stable id from message-id
                extra["id"] = "mail-" + re.sub(r"[^a-zA-Z0-9]+", "-", mid)[:72]

                if dry_run:
                    print(f"[dry] {subject}")
                else:
                    publish_from_email(subject, body, source="qq-mail", extra=extra)
                    published += 1
                    if is_top:
                        state["last_top_ts"] = now
                    print(f"[ingest] 已收录: {subject}")
                seen.add(mid)
        finally:
            try:
                conn.logout()
            except Exception:
                pass

    state["seen"] = list(seen)
    _save_state(state)
    return published


def main() -> None:
    ap = argparse.ArgumentParser(description="邮箱预警 → 五饼二鱼脚本预警")
    ap.add_argument("--loop", action="store_true", help="常驻轮询")
    ap.add_argument("--interval", type=float, default=45, help="轮询秒数")
    ap.add_argument("--days", type=int, default=2, help="回溯天数")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    os.environ.setdefault("SIGNAL_DESK_REPO", "binc4809-999/qushi-desk")

    while True:
        try:
            n = ingest_once(days=args.days, dry_run=args.dry_run)
            if n:
                print(f"[ingest] 本轮新增 {n} 条")
        except Exception as exc:
            print(f"[ingest] 异常: {exc}")
        if not args.loop:
            break
        time.sleep(max(15.0, args.interval))


if __name__ == "__main__":
    main()
