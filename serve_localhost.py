#!/usr/bin/env python3
"""WEB-Z -- localhost static server, the ONLY fully featured runtime.

Why localhost and not the file:// single-file edition:
  * Web MIDI with SysEx needs a trustworthy origin (https or localhost) AND a
    site permission grant triggered by a user gesture.
  * Web Bluetooth and Service Worker need an HTTP(S) origin with a real scope.
  * The PWA precache list is resolved relative to the SW scope; file:// has none.

This server binds 127.0.0.1 only. It NEVER binds 0.0.0.0: no LAN exposure, no
certificates, no backend, no database, no outbound network access. Ctrl+C stops it.
Everything it serves is static; the OP-Z is reached only through browser APIs.

Usage:
    python3 serve_localhost.py                  # 127.0.0.1:8080, open browser
    python3 serve_localhost.py --port 8081     # alternate port when 8080 is busy
    python3 serve_localhost.py --no-open       # print URL, do not open a browser
    python3 serve_localhost.py --check         # preflight only, no socket opened

Equivalent one-liner (no launcher needed, e.g. on SteamOS):
    python3 -m http.server 8080 --bind 127.0.0.1 --directory <web folder>
"""
from __future__ import annotations

import argparse
import functools
import http.server
import sys
import threading
import webbrowser
from pathlib import Path

WEB_ROOT = Path(__file__).resolve().parent
BIND = "127.0.0.1"
DEFAULT_PORT = 8080

# Fail fast if the release is incomplete (e.g. someone copied index.html only).
REQUIRED = (
    "index.html",
    "dist/app.js",
    "service-worker.js",
    "manifest.webmanifest",
    "captures/demo.txt",
    "credits.html",
)


def preflight() -> int:
    """Report missing runtime assets. Returns the number of missing files."""
    missing = 0
    for rel in REQUIRED:
        p = WEB_ROOT / rel
        ok = p.is_file()
        print(f"  {'OK  ' if ok else 'MISS'} {rel}")
        if not ok:
            missing += 1
    return missing


def banner(url: str) -> None:
    print("WEB-Z -- localhost static service (full feature set)")
    print(f"  URL        : {url}")
    print(f"  web root   : {WEB_ROOT}")
    print(f"  bound to   : {BIND} only (never 0.0.0.0)")
    print("  ---")
    print("  Available here, unavailable in the file:// single-file preview:")
    print("    * USB Web MIDI LIVE (Sysex) - user gesture + allow in the site prompt")
    print("    * BLE-MIDI / Web Bluetooth  - BLE CONNECT button, host support is unknown")
    print("    * PWA install / service worker precache (opb-web-v7)")
    print("    * Stage 6 write editor with device fresh baseline / ARM / readback")
    print("    * Gamepad navigation when launched via tools/gaming-mode.sh")
    print("  ---")
    print("  Notes:")
    print("    * Use the exact host shown above. http://localhost:PORT is a DIFFERENT")
    print("      origin: MIDI permission and SW scope are granted per origin.")
    print("    * Firefox / Safari are not suitable: use a Chromium-based browser.")
    print("    * If Web MIDI is denied, the app falls back to the synthetic OFFLINE replay.")
    print("    * Ctrl+C to stop.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve WEB-Z over 127.0.0.1")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help=f"TCP port (default {DEFAULT_PORT})")
    parser.add_argument("--no-open", action="store_true",
                        help="do not open a browser (useful in Gaming Mode / remote)")
    parser.add_argument("--deck-midi", metavar="DEVICE", help="enable read-only RawMIDI bridge")
    parser.add_argument("--check", action="store_true",
                        help="preflight asset check only, open no socket")
    args = parser.parse_args()

    print("preflight:")
    missing = preflight()
    if missing:
        print(f"{missing} required asset(s) missing. Run 'npm run build' or unpack OPB-Web.zip fully.",
              file=sys.stderr)
        return 1
    if args.check:
        print("PREFLIGHT OK (no server started)")
        return 0

    url = f"http://{BIND}:{args.port}/index.html"
    handler_class = http.server.SimpleHTTPRequestHandler
    if args.deck_midi:
        from deck_midi import DeckMidi, bridge_handler
        handler_class = bridge_handler(DeckMidi(args.deck_midi))
        url += "?deck-midi=1"
    handler = functools.partial(handler_class, directory=str(WEB_ROOT))
    try:
        httpd = http.server.ThreadingHTTPServer((BIND, args.port), handler)
    except OSError as exc:
        print(f"cannot bind {BIND}:{args.port}: {exc}", file=sys.stderr)
        print("Port busy? Retry with --port 8081 (and use that port in the URL).", file=sys.stderr)
        return 1

    banner(url)
    if not args.no_open:
        opener = threading.Timer(0.8, lambda: webbrowser.open(url))
        opener.daemon = True
        opener.start()

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped.")
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
