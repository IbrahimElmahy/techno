#!/usr/bin/env python3
from __future__ import annotations

import argparse
import configparser
import json
import logging
import os
import sys
import time
from datetime import date, datetime, timedelta
from logging.handlers import RotatingFileHandler

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "config.ini")
STATE_PATH = os.path.join(HERE, "state.json")
LOG_PATH = os.path.join(HERE, "zk_agent.log")
AGENT_PATH = "/api/v1/hr/attendance/agent"
DEFAULT_CAPACITY = 80000

log = logging.getLogger("zk_agent")


def setup_logging(verbose: bool) -> None:
    log.setLevel(logging.DEBUG if verbose else logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    file_handler = RotatingFileHandler(LOG_PATH, maxBytes=1_000_000, backupCount=3,
                                       encoding="utf-8")
    file_handler.setFormatter(fmt)
    log.addHandler(file_handler)
    if sys.stdout is not None:
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(fmt)
        log.addHandler(console)


def as_bool(value: str | None, default: bool) -> bool:
    if value is None or str(value).strip() == "":
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


class Config:
    def __init__(self, path: str):
        if not os.path.exists(path):
            raise SystemExit(f"config file not found: {path}")
        cp = configparser.ConfigParser()
        cp.read(path, encoding="utf-8-sig")
        server = cp["server"] if cp.has_section("server") else {}
        device = cp["device"] if cp.has_section("device") else {}
        sync = cp["sync"] if cp.has_section("sync") else {}

        self.server_url = (server.get("url") or "").strip().rstrip("/")
        self.token = (server.get("token") or "").strip()
        self.verify_tls = as_bool(server.get("verify_tls"), True)
        self.http_timeout = int(server.get("timeout") or 60)

        self.ip = (device.get("ip") or "192.168.1.201").strip()
        self.port = int(device.get("port") or 4370)
        self.password = int(device.get("password") or device.get("comm_key") or 0)
        self.timeout = int(device.get("timeout") or 10)
        self.force_udp = as_bool(device.get("force_udp"), False)
        self.udp_fallback = as_bool(device.get("udp_fallback"), True)
        self.ommit_ping = as_bool(device.get("ommit_ping"), True)
        self.encoding = (device.get("encoding") or "UTF-8").strip()
        self.disable_during_read = as_bool(device.get("disable_during_read"), True)
        self.log_capacity = int(device.get("log_capacity") or DEFAULT_CAPACITY)

        since = (sync.get("since_date") or "").strip()
        self.since_date = (date.fromisoformat(since) if since
                           else date.today().replace(day=1))
        self.batch_size = max(1, min(int(sync.get("batch_size") or 1000), 5000))
        self.interval_minutes = max(1, int(sync.get("interval_minutes") or 5))
        self.retries = max(1, int(sync.get("retries") or 4))
        self.overlap_hours = max(0, int(sync.get("overlap_hours") or 24))

    def require_server(self) -> None:
        if not self.server_url or not self.token or "PUT_" in self.token.upper():
            raise SystemExit("set [server] url and token in config.ini first")


def load_state() -> dict:
    try:
        with open(STATE_PATH, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def save_state(state: dict) -> None:
    tmp = STATE_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, ensure_ascii=False, indent=2)
    os.replace(tmp, STATE_PATH)


def _zk(cfg: Config, force_udp: bool):
    from zk import ZK

    return ZK(cfg.ip, port=cfg.port, timeout=cfg.timeout, password=cfg.password,
              force_udp=force_udp, ommit_ping=cfg.ommit_ping, encoding=cfg.encoding)


def connect(cfg: Config):
    try:
        return _zk(cfg, cfg.force_udp).connect(), cfg.force_udp
    except Exception as exc:
        if cfg.force_udp or not cfg.udp_fallback:
            raise
        log.warning("TCP connect failed (%s); retrying over UDP", exc)
        return _zk(cfg, True).connect(), True


def safe(fn, default=None):
    try:
        return fn()
    except Exception as exc:
        log.debug("device call failed: %s", exc)
        return default


class DeviceSnapshot:
    def __init__(self):
        self.serial = None
        self.firmware = None
        self.device_time = None
        self.users_count = None
        self.records_count = None
        self.records_capacity = None
        self.fingers = None
        self.users: list = []
        self.records: list = []
        self.udp = False


def read_device(cfg: Config, *, want_records: bool, last_records: int | None) -> DeviceSnapshot:
    snap = DeviceSnapshot()
    conn, snap.udp = connect(cfg)
    disabled = False
    try:
        snap.serial = safe(conn.get_serialnumber)
        snap.firmware = safe(conn.get_firmware_version)
        snap.device_time = safe(conn.get_time)
        safe(conn.read_sizes)
        snap.users_count = getattr(conn, "users", None)
        snap.records_count = getattr(conn, "records", None)
        snap.fingers = getattr(conn, "fingers", None)
        snap.records_capacity = getattr(conn, "rec_cap", None) or cfg.log_capacity

        if want_records:
            unchanged = (last_records is not None and snap.records_count is not None
                         and snap.records_count == last_records)
            if cfg.disable_during_read:
                conn.disable_device()
                disabled = True
            snap.users = conn.get_users()
            if not unchanged:
                snap.records = conn.get_attendance()
            else:
                log.info("device log count unchanged (%s); skipping log read", last_records)
    finally:
        if disabled:
            try:
                conn.enable_device()
            except Exception as exc:
                log.error("enable_device failed: %s", exc)
        try:
            conn.disconnect()
        except Exception:
            pass
    return snap


class Server:
    def __init__(self, cfg: Config):
        import requests

        self.cfg = cfg
        self.session = requests.Session()
        self.session.headers.update({
            "X-Device-Token": cfg.token,
            "Content-Type": "application/json",
            "User-Agent": "techno-zk-agent/1.0",
        })

    def post(self, name: str, payload: dict) -> dict:
        url = f"{self.cfg.server_url}{AGENT_PATH}/{name}"
        delay = 5
        last_error = None
        for attempt in range(1, self.cfg.retries + 1):
            try:
                resp = self.session.post(url, data=json.dumps(payload, default=str),
                                         timeout=self.cfg.http_timeout,
                                         verify=self.cfg.verify_tls)
                if resp.status_code in (401, 403, 409, 422):
                    raise SystemExit(f"server refused {name}: {resp.status_code} {resp.text[:300]}")
                resp.raise_for_status()
                return resp.json()
            except SystemExit:
                raise
            except Exception as exc:
                last_error = exc
                log.warning("POST %s failed (attempt %d/%d): %s",
                            name, attempt, self.cfg.retries, exc)
                if attempt < self.cfg.retries:
                    time.sleep(delay)
                    delay = min(delay * 3, 120)
        raise RuntimeError(f"giving up on {name}: {last_error}")


def punch_dict(rec) -> dict:
    return {
        "user_no": str(rec.user_id).strip(),
        "time": rec.timestamp.replace(microsecond=0).isoformat(),
        "status": int(getattr(rec, "punch", 0) or 0),
        "verify": int(getattr(rec, "status", 0) or 0),
    }


def run_test(cfg: Config) -> int:
    started = time.time()
    snap = read_device(cfg, want_records=False, last_records=None)
    cap = snap.records_capacity or cfg.log_capacity
    pct = (snap.records_count or 0) * 100.0 / cap if cap else 0
    print("connected      :", "UDP" if snap.udp else "TCP", f"{cfg.ip}:{cfg.port}")
    print("serial         :", snap.serial)
    print("firmware       :", snap.firmware)
    print("device time    :", snap.device_time, "| pc time:", datetime.now().replace(microsecond=0))
    print("users_count    :", snap.users_count)
    print("fingerprints   :", snap.fingers)
    print("records_count  :", snap.records_count)
    print("log capacity   :", cap, f"({pct:.1f}% used)")
    print("took           :", f"{time.time() - started:.1f}s")
    if pct >= 90:
        print("WARNING: device log is above 90% of its capacity")
    return 0


def run_sync(cfg: Config, since_override: date | None = None) -> int:
    cfg.require_server()
    state = load_state()
    if since_override is not None:
        state = {}
    since_dt = datetime.combine(since_override or cfg.since_date, datetime.min.time())
    last_sent = state.get("last_punch")
    cursor = datetime.fromisoformat(last_sent) if last_sent else since_dt
    if last_sent and cfg.overlap_hours:
        cursor = max(since_dt, cursor - timedelta(hours=cfg.overlap_hours))
    force_read = since_override is not None or not last_sent

    started = time.time()
    snap = read_device(cfg, want_records=True,
                       last_records=None if force_read else state.get("records_count"))
    read_secs = time.time() - started
    log.info("device read in %.1fs: serial=%s users=%s records=%s/%s via %s",
             read_secs, snap.serial, snap.users_count, snap.records_count,
             snap.records_capacity, "UDP" if snap.udp else "TCP")

    if snap.device_time:
        drift = abs((snap.device_time - datetime.now()).total_seconds())
        if drift > 300:
            log.warning("device clock differs from this PC by %d minutes", int(drift // 60))

    server = Server(cfg)
    serial = snap.serial or None

    hb = server.post("heartbeat", {
        "serial": serial, "users_count": snap.users_count,
        "records_count": snap.records_count,
        "records_capacity": snap.records_capacity or cfg.log_capacity,
        "firmware": snap.firmware,
    })
    log.info("heartbeat ok: device=%s server_last_punch=%s",
             hb.get("device"), hb.get("last_punch_at"))
    pct = (snap.records_count or 0) * 100.0 / (snap.records_capacity or cfg.log_capacity)
    if pct >= 90:
        log.warning("device log is %.1f%% full", pct)

    if snap.users:
        users = [{"user_no": str(u.user_id).strip(), "name": (u.name or "").strip(),
                  "privilege": int(u.privilege or 0)} for u in snap.users]
        res = server.post("users", {"serial": serial, "users": users})
        log.info("users sent: %s", res)

    pending = sorted((r for r in snap.records if r.timestamp and r.timestamp >= cursor),
                     key=lambda r: r.timestamp)
    log.info("punches to send since %s: %d (of %d on device)",
             cursor.isoformat(), len(pending), len(snap.records))
    totals = {"inserted": 0, "duplicates": 0, "unmatched": 0, "days_updated": 0,
              "days_skipped": 0}
    for start in range(0, len(pending), cfg.batch_size):
        chunk = pending[start:start + cfg.batch_size]
        res = server.post("punches", {"serial": serial,
                                      "punches": [punch_dict(r) for r in chunk]})
        for key in totals:
            totals[key] += int(res.get(key) or 0)
        newest = chunk[-1].timestamp.replace(microsecond=0).isoformat()
        if not state.get("last_punch") or newest > state["last_punch"]:
            state["last_punch"] = newest
        save_state(state)

    state["records_count"] = snap.records_count
    state["last_run"] = datetime.now().replace(microsecond=0).isoformat()
    if not state.get("last_punch"):
        state["last_punch"] = since_dt.isoformat()
    save_state(state)
    log.info("sync done in %.1fs: %s", time.time() - started, totals)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="ZKTeco -> Techno attendance agent")
    parser.add_argument("--test", action="store_true", help="read device counters only")
    parser.add_argument("--loop", action="store_true", help="run forever every interval")
    parser.add_argument("--since", help="resend punches from this date (YYYY-MM-DD)")
    parser.add_argument("--config", default=CONFIG_PATH)
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    setup_logging(args.verbose)
    cfg = Config(args.config)

    if args.test:
        try:
            return run_test(cfg)
        except Exception as exc:
            log.error("device test failed: %s", exc)
            return 2

    since = date.fromisoformat(args.since) if args.since else None
    while True:
        try:
            code = run_sync(cfg, since)
        except SystemExit as exc:
            log.error("%s", exc)
            code = 3
        except Exception as exc:
            log.exception("sync failed: %s", exc)
            code = 1
        since = None
        if not args.loop:
            return code
        time.sleep(cfg.interval_minutes * 60)


if __name__ == "__main__":
    sys.exit(main())
