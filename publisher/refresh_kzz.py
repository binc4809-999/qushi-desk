# -*- coding: utf-8 -*-
"""Refresh convertible-bond snapshots for the public site.

Sources:
  - Eastmoney RPT_BOND_CB_LIST (subscription calendar)
  - Jisilu cbnew/pre_list (pending CBs, filter 同意注册)

Only factual market fields are kept. Links point back to the official pages.
"""
from __future__ import annotations

import json
import re
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "kzz.json"

EM_URL = (
    "https://datacenter-web.eastmoney.com/api/data/v1/get"
    "?reportName=RPT_BOND_CB_LIST"
    "&columns=SECURITY_CODE,SECUCODE,SECURITY_NAME_ABBR,CONVERT_STOCK_CODE,"
    "ACTUAL_ISSUE_SCALE,ISSUE_PRICE,RATING,VALUE_DATE,PUBLIC_START_DATE,"
    "CORRECODE,TRANSFER_PRICE"
    "&quoteColumns=&pageNumber=1&pageSize=80&sortTypes=-1"
    "&sortColumns=PUBLIC_START_DATE&source=WEB&client=WEB"
)
JSL_URL = "https://www.jisilu.cn/data/cbnew/pre_list/"


def _get(url: str, referer: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0",
            "Referer": referer,
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def _date(v) -> str:
    if not v:
        return ""
    s = str(v)
    m = re.match(r"(\d{4}-\d{2}-\d{2})", s)
    return m.group(1) if m else s[:10]


def fetch_eastmoney() -> list[dict]:
    data = _get(EM_URL, "https://data.eastmoney.com/xg/xg/?mkt=kzz")
    rows = ((data.get("result") or {}).get("data") or [])
    out = []
    for r in rows:
        apply_date = _date(r.get("PUBLIC_START_DATE") or r.get("VALUE_DATE"))
        if not apply_date:
            continue
        out.append(
            {
                "bond_code": r.get("SECURITY_CODE") or "",
                "bond_name": r.get("SECURITY_NAME_ABBR") or "",
                "apply_code": r.get("CORRECODE") or "",
                "apply_date": apply_date,
                "stock_code": r.get("CONVERT_STOCK_CODE") or "",
                "issue_scale": r.get("ACTUAL_ISSUE_SCALE"),
                "rating": r.get("RATING") or "",
                "convert_price": r.get("TRANSFER_PRICE"),
            }
        )
    # Keep nearest upcoming / recent first (already sorted desc by API).
    return out[:30]


def fetch_jisilu_approved() -> list[dict]:
    data = _get(JSL_URL, "https://www.jisilu.cn/web/data/cb/pre")
    rows = data.get("rows") or []
    out = []
    for row in rows:
        c = row.get("cell") or {}
        progress = (c.get("progress_nm") or "").strip()
        # Strip HTML in progress labels when present.
        progress_plain = re.sub(r"<[^>]+>", "", progress)
        if progress_plain != "同意注册":
            continue
        # Registration announcement date is usually the last 同意注册 line in progress_full.
        reg_date = ""
        full = c.get("progress_full") or ""
        for line in reversed(full.splitlines()):
            if "同意注册" in line:
                reg_date = _date(line)
                break
        out.append(
            {
                "stock_code": c.get("stock_id") or "",
                "stock_name": c.get("stock_nm") or "",
                "bond_code": c.get("bond_id") or "",
                "bond_name": c.get("bond_nm") or "",
                "progress": "同意注册",
                "reg_date": reg_date or _date(c.get("progress_dt")),
                "issue_scale": c.get("amount"),
                "cb_type": c.get("cb_type") or "可转债",
                "rating": c.get("rating_cd") or "",
                "convert_price": c.get("convert_price"),
                "stock_price": c.get("price"),
                "stock_chg": c.get("increase_rt"),
                "pb": c.get("pb"),
                "apply10": c.get("apply10"),
            }
        )
    out.sort(key=lambda x: x.get("reg_date") or "", reverse=True)
    return out


def main() -> None:
    subscribe = fetch_eastmoney()
    approved = fetch_jisilu_approved()
    payload = {
        "updated_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "sources": {
            "eastmoney": "https://data.eastmoney.com/xg/xg/?mkt=kzz",
            "jisilu": "https://www.jisilu.cn/web/data/cb/pre",
        },
        "note": "数据来自东方财富 / 集思录公开接口，仅作研究备忘；点标题可回原站。",
        "subscribe": subscribe,
        "approved": approved,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {OUT} subscribe={len(subscribe)} approved={len(approved)}")


if __name__ == "__main__":
    main()
