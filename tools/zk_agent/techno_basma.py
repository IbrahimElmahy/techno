from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
from datetime import datetime

import zk_agent

try:
    import basma_defaults as DEFAULTS
except ImportError:
    DEFAULTS = None

APP_NAME = "TechnoBasma"
TASK_NAME = "TechnoBasma"
APP_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), APP_NAME)
EXE_PATH = os.path.join(APP_DIR, f"{APP_NAME}.exe")
CONFIG_PATH = os.path.join(APP_DIR, "config.ini")
NO_WINDOW = 0x08000000


def prepare_paths() -> None:
    os.makedirs(APP_DIR, exist_ok=True)
    zk_agent.STATE_PATH = os.path.join(APP_DIR, "state.json")
    zk_agent.LOG_PATH = os.path.join(APP_DIR, "agent.log")


def write_config() -> None:
    if os.path.exists(CONFIG_PATH) or DEFAULTS is None:
        return
    with open(CONFIG_PATH, "w", encoding="utf-8") as fh:
        fh.write(
            "[server]\n"
            f"url = {DEFAULTS.SERVER_URL}\n"
            f"token = {DEFAULTS.TOKEN}\n"
            "verify_tls = true\n"
            "timeout = 60\n\n"
            "[device]\n"
            f"ip = {DEFAULTS.DEVICE_IP}\n"
            f"port = {DEFAULTS.DEVICE_PORT}\n"
            "password = 0\n"
            "timeout = 10\n"
            "force_udp = false\n"
            "udp_fallback = true\n"
            "ommit_ping = true\n"
            "encoding = UTF-8\n"
            "disable_during_read = true\n"
            "log_capacity = 80000\n\n"
            "[sync]\n"
            f"since_date = {DEFAULTS.SINCE_DATE}\n"
            "batch_size = 1000\n"
            "overlap_hours = 24\n"
            "retries = 4\n"
            "interval_minutes = 5\n"
        )


def install() -> None:
    prepare_paths()
    write_config()
    if getattr(sys, "frozen", False):
        me = os.path.abspath(sys.executable)
        if os.path.normcase(me) != os.path.normcase(EXE_PATH):
            try:
                shutil.copy2(me, EXE_PATH)
            except OSError:
                pass
        target = EXE_PATH if os.path.exists(EXE_PATH) else me
        command = f'"{target}" --sync'
    else:
        command = f'"{sys.executable}" "{os.path.abspath(__file__)}" --sync'
    subprocess.run(
        ["schtasks", "/create", "/tn", TASK_NAME, "/tr", command, "/sc", "minute", "/mo", "5", "/f"],
        capture_output=True, creationflags=NO_WINDOW)
    startup = os.path.join(os.environ.get("APPDATA", ""), "Microsoft", "Windows", "Start Menu",
                           "Programs", "Startup")
    if os.path.isdir(startup) and getattr(sys, "frozen", False):
        link = os.path.join(startup, f"{APP_NAME}.cmd")
        try:
            with open(link, "w", encoding="ascii", errors="ignore") as fh:
                fh.write(f'@start "" "{EXE_PATH}" --sync\r\n')
        except OSError:
            pass


def sync_once(since=None) -> tuple[bool, str]:
    prepare_paths()
    write_config()
    if not zk_agent.log.handlers:
        zk_agent.setup_logging(False)
    try:
        cfg = zk_agent.Config(CONFIG_PATH)
        zk_agent.run_sync(cfg, since)
        return True, ""
    except SystemExit as exc:
        return False, str(exc)
    except Exception as exc:
        zk_agent.log.exception("sync failed: %s", exc)
        return False, str(exc)


def friendly(error: str) -> str:
    low = error.lower()
    ip = DEFAULTS.DEVICE_IP if DEFAULTS else ""
    if "server refused" in low:
        if " 401" in low or " 403" in low:
            return "رمز الربط غير صحيح. تواصل مع الدعم."
        return "السيرفر رفض البيانات. تواصل مع الدعم."
    if "giving up on" in low:
        return "تعذّر الاتصال بالسيرفر. تأكد أن الإنترنت يعمل على هذا الجهاز."
    return f"تعذّر الاتصال بجهاز البصمة ({ip}). تأكد أن الجهاز يعمل ومتصل بنفس الشبكة."


def run_gui() -> None:
    import tkinter as tk
    from tkinter import ttk

    install()
    root = tk.Tk()
    root.title("تكنو — جهاز البصمة")
    root.geometry("460x300")
    root.resizable(False, False)
    try:
        root.attributes("-topmost", True)
        root.after(1500, lambda: root.attributes("-topmost", False))
    except tk.TclError:
        pass

    font = ("Segoe UI", 12)
    big = ("Segoe UI", 15, "bold")
    tk.Label(root, text="ربط جهاز البصمة بنظام تكنو", font=big).pack(pady=(18, 6))
    status = tk.Label(root, text="جاري الاتصال بالجهاز وإرسال البصمات…", font=font,
                      wraplength=420, justify="right")
    status.pack(pady=6)
    details = tk.Label(root, text="", font=("Segoe UI", 10), fg="#475569", wraplength=420,
                       justify="right")
    details.pack(pady=4)
    bar = ttk.Progressbar(root, mode="indeterminate", length=300)
    bar.pack(pady=8)
    buttons = tk.Frame(root)
    buttons.pack(pady=10)
    sync_btn = tk.Button(buttons, text="مزامنة الآن", font=font, width=12)
    close_btn = tk.Button(buttons, text="إغلاق", font=font, width=12, command=root.destroy)
    sync_btn.pack(side="right", padx=8)
    close_btn.pack(side="right", padx=8)

    def show(ok: bool, error: str) -> None:
        bar.stop()
        sync_btn.config(state="normal")
        state = zk_agent.load_state()
        if ok:
            totals = state.get("last_totals") or {}
            status.config(text="تم الربط بنجاح ✔ البرنامج يعمل تلقائياً كل ٥ دقائق ولا يحتاج أي تدخل.",
                          fg="#15803d")
            when = state.get("last_run", "")[:16].replace("T", " ")
            details.config(text=(
                f"آخر مزامنة: {when}\n"
                f"موظفون على الجهاز: {state.get('users_count', '-')} — "
                f"حركات على الجهاز: {state.get('records_count', '-')}\n"
                f"بصمات جديدة أُرسلت: {totals.get('inserted', 0)}"))
        else:
            status.config(text=friendly(error), fg="#b91c1c")
            details.config(text="البرنامج مثبّت وسيحاول مرة أخرى تلقائياً.")

    def start() -> None:
        sync_btn.config(state="disabled")
        status.config(text="جاري الاتصال بالجهاز وإرسال البصمات…", fg="black")
        bar.start(12)

        def work() -> None:
            ok, err = sync_once()
            root.after(0, lambda: show(ok, err))

        threading.Thread(target=work, daemon=True).start()

    sync_btn.config(command=start)
    root.after(300, start)
    root.mainloop()


def main() -> int:
    if "--sync" in sys.argv:
        prepare_paths()
        lock = os.path.join(APP_DIR, "sync.lock")
        try:
            if os.path.exists(lock) and (datetime.now().timestamp() - os.path.getmtime(lock)) < 600:
                return 0
            open(lock, "w").close()
            ok, _ = sync_once()
            return 0 if ok else 1
        finally:
            try:
                os.remove(lock)
            except OSError:
                pass
    run_gui()
    return 0


if __name__ == "__main__":
    sys.exit(main())
