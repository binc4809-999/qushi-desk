# -*- coding: utf-8 -*-
"""Unit tests for publisher/write_runner.py (no network)."""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "publisher"))

from write_runner import (  # noqa: E402
    ALLOWED_STATUS,
    build_runner,
    heartbeat,
    upsert_into,
)


class BuildRunnerTests(unittest.TestCase):
    def test_requires_id_and_known_status(self):
        with self.assertRaises(ValueError):
            build_runner(id="", status="running")
        with self.assertRaises(ValueError):
            build_runner(id="x", status="success")
        for status in ALLOWED_STATUS:
            row = build_runner(id="x", status=status)
            self.assertEqual(row["status"], status)

    def test_last_line_alias_and_defaults(self):
        row = build_runner(id="monitor11", status="waiting", last_line="[monitor11] 非交易时段，等待 09-10 09:30 开盘...")
        self.assertEqual(row["name"], "monitor11")
        self.assertEqual(row["last_message"], "[monitor11] 非交易时段，等待 09-10 09:30 开盘...")
        self.assertIn("updated_at", row)
        self.assertNotIn("sample", row)

    def test_inherits_omitted_fields(self):
        prev = {
            "id": "monitor11",
            "name": "monitor11",
            "script": "monitor11.py",
            "venue": "A股",
            "started_at": "2026-09-09T23:55:00+00:00",
            "notes": "keep me",
            "status_label": "等待开盘",
        }
        row = build_runner(
            id="monitor11",
            status="waiting",
            last_message="still waiting",
            prev=prev,
        )
        self.assertEqual(row["script"], "monitor11.py")
        self.assertEqual(row["venue"], "A股")
        self.assertEqual(row["started_at"], "2026-09-09T23:55:00+00:00")
        self.assertEqual(row["notes"], "keep me")
        self.assertEqual(row["status_label"], "等待开盘")
        self.assertEqual(row["last_message"], "still waiting")


class UpsertTests(unittest.TestCase):
    def test_replaces_same_id_keeps_others(self):
        bundle = {
            "runners": [
                {"id": "btc", "status": "running", "updated_at": "2026-09-10T01:00:00+00:00", "sample": True},
                {"id": "monitor11", "status": "waiting", "updated_at": "2026-09-10T00:00:00+00:00", "sample": True},
            ]
        }
        nxt = build_runner(
            id="monitor11",
            status="running",
            last_message="开盘扫描中",
            updated_at="2026-09-10T01:35:00+00:00",
        )
        out = upsert_into(bundle, nxt)
        ids = [r["id"] for r in out["runners"]]
        self.assertEqual(len(out["runners"]), 2)
        self.assertIn("btc", ids)
        mon = next(r for r in out["runners"] if r["id"] == "monitor11")
        self.assertEqual(mon["status"], "running")
        self.assertEqual(mon["last_message"], "开盘扫描中")
        self.assertEqual(out["count"], 2)
        self.assertIsNone(out.get("sample"))

    def test_sorts_running_before_waiting(self):
        bundle = {"runners": []}
        waiting = build_runner(id="monitor11", status="waiting", updated_at="2026-09-10T02:00:00+00:00")
        running = build_runner(id="btc", status="running", updated_at="2026-09-10T01:00:00+00:00")
        out = upsert_into(upsert_into(bundle, waiting), running)
        self.assertEqual([r["id"] for r in out["runners"]], ["btc", "monitor11"])

    def test_items_alias_and_sample_rollup(self):
        bundle = {"items": [{"id": "a", "status": "idle", "sample": True}]}
        row = build_runner(id="b", status="idle", sample=True)
        out = upsert_into(bundle, row)
        self.assertTrue(out["sample"])
        self.assertEqual(out["count"], 2)
        self.assertEqual(len(out["runners"]), 2)


class HeartbeatFileTests(unittest.TestCase):
    def test_writes_local_file_without_push(self):
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "runners.json"
            dest.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "sample": True,
                        "runners": [
                            {
                                "id": "other",
                                "name": "other",
                                "status": "running",
                                "last_message": "keep",
                                "updated_at": "2026-09-10T00:00:00+00:00",
                                "sample": True,
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            out = heartbeat(
                id="monitor11",
                status="waiting",
                last_message="[monitor11] 非交易时段，等待 09-10 09:30 开盘...",
                script="monitor11.py",
                venue="A股",
                dest=dest,
                push=False,
            )
            saved = json.loads(dest.read_text(encoding="utf-8"))
            self.assertEqual(saved["count"], 2)
            self.assertEqual({r["id"] for r in saved["runners"]}, {"other", "monitor11"})
            mon = next(r for r in saved["runners"] if r["id"] == "monitor11")
            self.assertEqual(mon["script"], "monitor11.py")
            self.assertIn("非交易时段", mon["last_message"])
            self.assertEqual(out["count"], 2)

            heartbeat(id="monitor11", status="running", last_message="开盘", dest=dest)
            again = json.loads(dest.read_text(encoding="utf-8"))
            mon = next(r for r in again["runners"] if r["id"] == "monitor11")
            self.assertEqual(mon["status"], "running")
            self.assertEqual(mon["venue"], "A股")
            self.assertEqual(len(again["runners"]), 2)


if __name__ == "__main__":
    unittest.main()
