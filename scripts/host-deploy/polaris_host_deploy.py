#!/usr/bin/env python3
"""
Polaris host deploy runner.

Runs on the Mac, launched by launchd (com.polaris.hostdeploy). It watches
<repo>/.host-deploy/queue/ for job requests written by a client inside the
Linux Docker container and executes a *fixed, vetted lane whitelist* — never a
command string from the request.

Contract
--------
Request (written by scripts/host-deploy/client.mjs):
    .host-deploy/queue/<job_id>/request.json
    { "schema": 1, "lane": "beta", "note": "...", "requested_by": "...",
      "allow_dirty": false, "allow_non_main": false, "skip_match": false }

Result:
    .host-deploy/results/<job_id>/request.json   (moved here when claimed)
    .host-deploy/results/<job_id>/status.json    (rewritten live)
    .host-deploy/results/<job_id>/log.txt        (full stdout/stderr)
    .host-deploy/results/<job_id>/cancel         (created by client to abort)

Security boundary
-----------------
* The repo tree is treated as untrusted input: only a JSON request is read
  from it, and only known keys with known lanes are accepted.
* Credentials (ASC .p8 path, key id, issuer id) live in the host-only env
  file created by install.sh; they are never read from the repo or the queue.
* No general shell is exposed. LANE_COMMANDS below is the only executable
  surface, and it is the *installed copy* of this file, not the repo copy.
"""

from __future__ import annotations

import argparse
import datetime as dt
import errno
import fcntl
import hashlib
import json
import os
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
import traceback
from collections import deque
from pathlib import Path

VERSION = "1.0.0"
SCHEMA = 1
LABEL = "com.polaris.hostdeploy"
DEFAULT_SUPPORT = Path.home() / "Library" / "Application Support" / "polaris-host-deploy"

# ---- The only executable surface -------------------------------------------
# lane -> (shell command, timeout seconds, human description)
LANE_COMMANDS = {
    "beta": ("bundle exec fastlane ios beta", 5400, "archive, export and upload a TestFlight build"),
    "release": ("bundle exec fastlane ios release", 5400, "archive and upload an App Store release"),
    "validate": ("bundle exec fastlane ios validate", 900, "validate the existing build/archive"),
}
BUILTIN_LANES = {
    "preflight": (300, "host-side checks: Xcode, credentials, .env, git state, scheme"),
}

ALLOWED_REQUEST_KEYS = {
    "schema",
    "lane",
    "job_id",
    "note",
    "requested_by",
    "created_at",
    "allow_dirty",
    "allow_non_main",
    "skip_match",
}
BOOL_KEYS = {"allow_dirty", "allow_non_main", "skip_match"}

# Errors worth translating into something the container agent can act on.
# (regex, kind, message, hint)
DIAGNOSTICS = [
    (
        r'No signing certificate "iOS Distribution" found',
        "signing-missing-cert",
        "No iOS Distribution certificate in the login keychain.",
        "Export the distribution cert from the developer portal, or keep "
        "-allowProvisioningUpdates with an App Manager API key.",
    ),
    (
        r"No profiles for '",
        "signing-missing-profile",
        "No provisioning profile found for the bundle id.",
        "Profile missing/expired, or the bundle id drifted from App Store Connect. "
        "Regenerate it or use automatic signing.",
    ),
    (
        r"doesn't include signing certificate",
        "signing-profile-cert-mismatch",
        "The provisioning profile does not include the selected signing certificate.",
        "Recreate the profile against the current cert, or switch to automatic signing.",
    ),
    (
        r"requires a provisioning profile with the .* features",
        "signing-missing-capability",
        "The profile lacks a capability the app declares (CarPlay/associated domains/etc.).",
        "Xcode automatic signing must provision a profile that covers current entitlements; "
        "drop any hardcoded manual profile name.",
    ),
    (
        r"Operation not permitted @ rb_sysopen|Operation not permitted.*\.p8",
        "tcc-key-blocked",
        "macOS TCC is blocking the App Store Connect key file, not a wrong key.",
        "Move the .p8 to ~/.appstoreconnect/private_keys/ and re-run install.sh so "
        "APP_STORE_CONNECT_KEY_PATH points there.",
    ),
    (
        r"Unsupported SDK or Xcode version|code\s*90534",
        "beta-xcode",
        "The archive was built with a beta Xcode/SDK; App Store Connect rejects it.",
        "Re-archive with release Xcode (/Applications/Xcode.app).",
    ),
    (
        r"AEAD authentication tag verification failed|Invalid password passed via 'MATCH_PASSWORD'",
        "match-password",
        "fastlane match could not decrypt the certificates repo (local passphrase problem).",
        "Do not route to CI: either supply MATCH_PASSWORD or run with skip_match=true "
        "so Xcode signs automatically through the API key.",
    ),
    (
        r"Refusing to archive from '([^']+)'",
        "not-main",
        "The lane refuses to build from a branch other than main.",
        "Merge your work to main first, or re-submit with allow_non_main=true for a "
        "deliberate one-off.",
    ),
    (
        r"Working tree has uncommitted changes",
        "dirty-tree",
        "The working tree has uncommitted changes the lane will not build over.",
        "Commit in the container (smart-commit) and re-submit, or pass allow_dirty=true.",
    ),
    (
        r"\.env not found at",
        "missing-env",
        "The repo-root .env is missing, so the shipped bundle would have no traffic key.",
        "Copy .env into the working tree (it is gitignored and not shared with worktrees).",
    ),
    (
        r"does not contain the TomTom key",
        "missing-traffic-key",
        "The exported JS bundle has no TomTom key — the build would ship with no traffic data.",
        "Re-check the EXPO_PUBLIC_* values and the expo export:embed build phase.",
    ),
    (
        r"already been used|The provided entity includes an attribute with a value that has already been used",
        "duplicate-build-number",
        "App Store Connect already has this build number.",
        "Bump again (pnpm ios:build-number) and re-submit.",
    ),
    (
        r"Test Suites:.*?(\d+) failed",
        "tests-failed",
        "The repo's test suite failed.",
        "Run the failing suite directly (pnpm test <path>) — the log's FAIL lines name the "
        "file and assertion. A release build would package broken behaviour.",
    ),
    (
        r"error TS\d+:",
        "typecheck-failed",
        "TypeScript reported errors.",
        "Run pnpm typecheck for the full list; the lane stops before archiving.",
    ),
    (
        r"No space left on device",
        "disk-full",
        "The Mac is out of disk space.",
        "Free space (build/ and build_derived_data/ are safe to delete) and re-submit.",
    ),
]

STEP_RE = re.compile(r"Step\s+(\d+)/(\d+):\s*(.+?)\s*$")
BANNER_RE = re.compile(r"^\[(\d+)/(\d+)\]\s*(.+?)\s*$")
# fastlane's UI.message("→ Tests") / UI.header("--- Step: x ---")
ARROW_RE = re.compile(r"\]\s*:?\s*→\s*(.+?)\s*$")
HEADER_RE = re.compile(r"\]\s*:?\s*---\s*(?:Step:\s*)?(.+?)\s*---\s*$")

# Lines worth keeping verbatim: the changelog fastlane prints on exit otherwise
# shoves the actual error out of the tail window. Curated for precision — generic
# words like "error" also appear in this app's normal console.warn noise.
SIGNAL_RE = re.compile(
    r"(FAIL\s+\S+\.|✕|Test Suites:|\bTests:\s+\d|error TS\d+|\[!\]|"
    r"BUILD FAILED|ARCHIVE FAILED|EXPORT FAILED|Command failed|"
    r"No signing certificate|No profiles for|doesn't include signing certificate|"
    r"requires a provisioning profile|Unsupported SDK or Xcode|code 90534|"
    r"Operation not permitted|fatal error:|The following build commands failed)"
)

TAIL_LINES = 60
SIGNAL_LINES = 40


def stage_from_line(line: str) -> tuple[str, str] | None:
    """Return (progress, stage) for a fastlane progress line, else None."""
    for regex in (STEP_RE, BANNER_RE):
        match = regex.search(line)
        if match:
            return f"{match.group(1)}/{match.group(2)}", sanitize(match.group(3))
    match = HEADER_RE.search(line) or ARROW_RE.search(line)
    if match:
        return "", sanitize(match.group(1))
    return None


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log_line(kind: str, msg: str) -> None:
    print(f"{now_iso()} [{kind}] {msg}", flush=True)


def atomic_write_json(path: Path, payload: dict) -> None:
    tmp = path.with_suffix(path.suffix + f".tmp.{os.getpid()}")
    tmp.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")
    os.replace(tmp, path)


def sha256_file(path: Path, limit: int | None = None) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        remaining = limit
        while True:
            chunk = fh.read(1 << 20 if remaining is None else min(1 << 20, remaining))
            if not chunk:
                break
            h.update(chunk)
            if remaining is not None:
                remaining -= len(chunk)
                if remaining <= 0:
                    break
    return h.hexdigest()


def parse_env_file(path: Path) -> dict:
    out = {}
    if not path.is_file():
        return out
    for raw in path.read_text(errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        out[key.strip()] = value.strip().strip("'\"")
    return out


def sanitize(text: str, limit: int = 400) -> str:
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", str(text))
    return text[:limit]


# --------------------------------------------------------------------------- #
# runner
# --------------------------------------------------------------------------- #
class Runner:
    def __init__(self, support: Path):
        self.support = support
        self.config = json.loads((support / "config.json").read_text())
        self.repo = Path(self.config["repo_root"]).resolve()
        self.state = self.repo / ".host-deploy"
        self.queue = self.state / "queue"
        self.results = self.state / "results"
        self.creds = parse_env_file(support / "env")
        self.child: subprocess.Popen | None = None
        self.cancel_requested = False
        self.current_job: str | None = None
        self.caffeinate: subprocess.Popen | None = None

    # -- environment -------------------------------------------------------
    def build_env(self) -> dict:
        env = {
            "HOME": str(Path.home()),
            "USER": os.environ.get("USER", "andrewg"),
            "LOGNAME": os.environ.get("LOGNAME", "andrewg"),
            "SHELL": "/bin/zsh",
            "TMPDIR": os.environ.get("TMPDIR", "/tmp"),
            "LANG": "en_US.UTF-8",
            "LC_ALL": "en_US.UTF-8",
            "POLARIS_HOST_DEPLOY_JOB": self.current_job or "",
            "TERM": "dumb",
        }
        env.update(self.creds)

        # Path order matters: Homebrew Ruby must win over /usr/bin/ruby (2.6),
        # whose bundler cannot read this repo's Gemfile.lock (BUNDLED WITH 4.0.10).
        parts = [
            "/opt/homebrew/opt/ruby/bin",
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            str(Path.home() / ".local" / "bin"),
            str(Path.home() / ".hermes" / "tools"),
        ]
        for pattern in ("pnpm-*", "node-*"):
            for candidate in sorted((Path.home() / ".hermes" / "tools").glob(pattern)):
                parts.append(str(candidate))
        nvm = Path.home() / ".nvm" / "versions" / "node"
        if nvm.is_dir():
            for candidate in sorted(nvm.iterdir(), reverse=True):
                parts.append(str(candidate / "bin"))
        parts += ["/usr/bin", "/bin", "/usr/sbin", "/sbin"]
        seen, path_parts = set(), []
        for p in parts:
            if p and p not in seen and Path(p).exists():
                seen.add(p)
                path_parts.append(p)
        env["PATH"] = ":".join(path_parts)

        # Release Xcode only: an archive built by a beta Xcode is rejected at
        # upload with code 90534, after the expensive part.
        release_xcode = Path("/Applications/Xcode.app/Contents/Developer")
        if release_xcode.is_dir():
            env["DEVELOPER_DIR"] = str(release_xcode)
        return env

    # -- queue -------------------------------------------------------------
    def claim_next(self) -> Path | None:
        if not self.queue.is_dir():
            return None
        for job_dir in sorted(p for p in self.queue.iterdir() if p.is_dir()):
            job_id = job_dir.name
            request = job_dir / "request.json"
            if not request.is_file() or request.is_symlink():
                # Half-written or bogus entry: leave it for a later sweep.
                continue
            result_dir = self.results / job_id
            result_dir.mkdir(parents=True, exist_ok=True)
            try:
                os.replace(request, result_dir / "request.json")
            except OSError as exc:
                if exc.errno == errno.ENOENT:
                    continue  # someone else claimed it
                raise
            try:
                job_dir.rmdir()
            except OSError:
                pass
            return result_dir
        return None

    def validate_request(self, result_dir: Path) -> tuple[dict | None, str | None]:
        path = result_dir / "request.json"
        if path.stat().st_size > 8192:
            return None, "request.json larger than 8 KiB"
        try:
            data = json.loads(path.read_text())
        except Exception as exc:  # noqa: BLE001
            return None, f"request.json is not valid JSON: {exc}"
        if not isinstance(data, dict):
            return None, "request.json must be a JSON object"

        unknown = set(data) - ALLOWED_REQUEST_KEYS
        if unknown:
            return None, f"unknown request key(s): {', '.join(sorted(unknown))}"
        if data.get("schema") != SCHEMA:
            return None, f"unsupported schema {data.get('schema')!r} (expected {SCHEMA})"

        lane = data.get("lane")
        if lane not in LANE_COMMANDS and lane not in BUILTIN_LANES:
            allowed = ", ".join(sorted(set(LANE_COMMANDS) | set(BUILTIN_LANES)))
            return None, f"unknown lane {lane!r} (allowed: {allowed})"
        for key in BOOL_KEYS:
            if key in data and not isinstance(data[key], bool):
                return None, f"{key} must be a boolean"
        return data, None

    # -- status ------------------------------------------------------------
    def status_payload(self, result_dir: Path, **fields) -> dict:
        path = result_dir / "status.json"
        current = {}
        if path.is_file():
            try:
                current = json.loads(path.read_text())
            except Exception:  # noqa: BLE001
                current = {}
        current.update(fields)
        current.setdefault("schema", SCHEMA)
        current.setdefault("job_id", result_dir.name)
        current["runner_version"] = VERSION
        current["updated_at"] = now_iso()
        return current

    def write_status(self, result_dir: Path, **fields) -> dict:
        payload = self.status_payload(result_dir, **fields)
        atomic_write_json(result_dir / "status.json", payload)
        return payload

    def finish(self, result_dir: Path, state: str, **fields) -> dict:
        payload = self.write_status(result_dir, state=state, **fields)
        payload["finished_at"] = payload.get("finished_at") or now_iso()
        atomic_write_json(result_dir / "status.json", payload)
        log_line(state.upper(), f"{result_dir.name}: {state}")
        return payload

    # -- git ---------------------------------------------------------------
    def git_state(self) -> dict:
        def run(*args: str) -> str:
            try:
                return subprocess.run(
                    ["git", "-C", str(self.repo), *args],
                    capture_output=True,
                    text=True,
                    timeout=30,
                ).stdout
            except Exception:  # noqa: BLE001
                return ""

        dirty = [ln for ln in run("status", "--porcelain").splitlines() if ln.strip()]
        return {
            "branch": run("rev-parse", "--abbrev-ref", "HEAD").strip(),
            "sha": run("rev-parse", "--short", "HEAD").strip(),
            "dirty_files": dirty,
            "dirty_count": len(dirty),
        }

    # -- lanes -------------------------------------------------------------
    def run_lane(self, job_id: str, lane: str, request: dict, result_dir: Path) -> int:
        if lane in BUILTIN_LANES:
            return self.run_preflight(job_id, result_dir, request)

        command, timeout, _desc = LANE_COMMANDS[lane]
        env = self.build_env()
        if request.get("allow_dirty"):
            env["POLARIS_ALLOW_DIRTY"] = "1"
        if request.get("allow_non_main"):
            env["POLARIS_ALLOW_NON_MAIN"] = "1"
        if request.get("skip_match"):
            env["SKIP_MATCH"] = "1"

        log_path = result_dir / "log.txt"
        started = time.time()
        tail: deque[str] = deque(maxlen=TAIL_LINES)
        signals: deque[str] = deque(maxlen=SIGNAL_LINES)

        with log_path.open("a", encoding="utf-8", errors="replace") as log:
            header = (
                f"=== polaris-host-deploy {VERSION} ===\n"
                f"job      : {job_id}\n"
                f"lane     : {lane} ({command})\n"
                f"repo     : {self.repo}\n"
                f"host     : {socket.gethostname()} ({platform.mac_ver()[0]})\n"
                f"started  : {now_iso()}\n"
                f"=== end header ===\n"
            )
            log.write(header)
            log.flush()

            self.write_status(
                result_dir,
                state="running",
                lane=lane,
                stage="starting",
                progress="0/0",
                started_at=now_iso(),
                command=command,
                host=socket.gethostname(),
                git=self.git_state(),
            )

            try:
                self.child = subprocess.Popen(
                    ["/bin/zsh", "-c", command],
                    cwd=str(self.repo),
                    env=env,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                    text=True,
                    bufsize=1,
                    errors="replace",
                )
            except FileNotFoundError as exc:
                log.write(f"failed to launch: {exc}\n")
                log_line("ERROR", f"launch failed: {exc}")
                return 127

            self.start_caffeinate()

            def pump() -> None:
                assert self.child and self.child.stdout
                for line in self.child.stdout:
                    log.write(line)
                    log.flush()
                    stripped = line.rstrip("\n")
                    tail.append(stripped)
                    if SIGNAL_RE.search(stripped):
                        signals.append(stripped[:400])
                    parsed = stage_from_line(line)
                    if parsed:
                        stage, progress = parsed[1], parsed[0]
                        try:
                            self.write_status(result_dir, stage=stage, progress=progress or "0/0")
                        except Exception:  # noqa: BLE001
                            pass

            reader = threading.Thread(target=pump, daemon=True)
            reader.start()

            timed_out = False
            while self.child.poll() is None:
                time.sleep(1)
                if (result_dir / "cancel").exists() and not self.cancel_requested:
                    self.cancel_requested = True
                    log.write("\n=== cancel requested by client ===\n")
                    self.kill_child()
                if time.time() - started > timeout:
                    timed_out = True
                    log.write(f"\n=== timeout after {timeout}s — terminating ===\n")
                    self.kill_child()

            reader.join(timeout=15)
            rc = self.child.returncode
            self.stop_caffeinate()
            self.child = None

        duration = round(time.time() - started, 1)
        log_excerpt = "\n".join(tail)
        error_excerpt = "\n".join(signals)
        fields = dict(
            exit_code=rc,
            duration_s=duration,
            stage="finished",
            tail=sanitize(log_excerpt, 4000),
            errors=sanitize(error_excerpt, 4000) if error_excerpt else None,
            log=f".host-deploy/results/{job_id}/log.txt",
        )

        if (result_dir / "cancel").exists():
            self.finish(result_dir, "cancelled", **fields)
            return 130
        if timed_out:
            self.finish(
                result_dir,
                "failed",
                failure={
                    "kind": "timeout",
                    "message": f"lane exceeded {timeout}s and was terminated",
                    "hint": "Check the log for the last stage reached.",
                },
                **fields,
            )
            return 124
        if rc == 0:
            fields["artifacts"] = self.collect_artifacts()
            self.finish(result_dir, "succeeded", failure=None, **fields)
            return 0

        self.finish(result_dir, "failed", failure=diagnose(f"{log_excerpt}\n{error_excerpt}"), **fields)
        return rc

    def kill_child(self) -> None:
        if not self.child or self.child.poll() is not None:
            return
        try:
            os.killpg(os.getpgid(self.child.pid), signal.SIGTERM)
        except ProcessLookupError:
            return
        for _ in range(20):
            if self.child.poll() is not None:
                return
            time.sleep(0.5)
        try:
            os.killpg(os.getpgid(self.child.pid), signal.SIGKILL)
        except ProcessLookupError:
            pass

    def start_caffeinate(self) -> None:
        """Keep the Mac awake for the duration of a build."""
        try:
            self.caffeinate = subprocess.Popen(
                ["/usr/bin/caffeinate", "-i", "-m"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception:  # noqa: BLE001
            self.caffeinate = None

    def stop_caffeinate(self) -> None:
        if self.caffeinate and self.caffeinate.poll() is None:
            self.caffeinate.terminate()
        self.caffeinate = None

    def collect_artifacts(self) -> list[dict]:
        out = []
        candidates = [
            self.repo / "build_derived_data",
            self.repo / "build" / "export",
            self.repo / "build",
        ]
        seen = set()
        for folder in candidates:
            if not folder.is_dir():
                continue
            for ipa in sorted(folder.glob("*.ipa")):
                if ipa in seen:
                    continue
                seen.add(ipa)
                try:
                    out.append(
                        {
                            "path": str(ipa.relative_to(self.repo)),
                            "bytes": ipa.stat().st_size,
                            "sha256": sha256_file(ipa),
                        }
                    )
                except OSError:
                    continue
        return out

    # -- builtin: preflight ------------------------------------------------
    def run_preflight(self, job_id: str, result_dir: Path, request: dict) -> int:
        checks: list[dict] = []

        def add(name: str, ok: bool, detail: str, hint: str | None = None, warn: bool = False) -> None:
            checks.append(
                {
                    "check": name,
                    "status": "ok" if ok else ("warn" if warn else "fail"),
                    "detail": sanitize(detail),
                    **({"hint": hint} if hint and not ok else {}),
                }
            )

        env = self.build_env()
        log_path = result_dir / "log.txt"
        log_fh = log_path.open("a", encoding="utf-8", errors="replace")
        lines: list[str] = []

        def note(msg: str) -> None:
            lines.append(msg)
            log_fh.write(f"{msg}\n")
            log_fh.flush()
            log_line("preflight", msg)

        note(f"host {socket.gethostname()} — macOS {platform.mac_ver()[0]} {platform.machine()}")

        # Xcode
        try:
            dd = subprocess.run(
                ["/usr/bin/xcode-select", "-p"], capture_output=True, text=True, timeout=30
            ).stdout.strip()
        except Exception as exc:  # noqa: BLE001
            dd = f"<error: {exc}>"
        ver = subprocess.run(
            [env.get("DEVELOPER_DIR", "/Applications/Xcode.app/Contents/Developer") + "/usr/bin/xcodebuild", "-version"],
            capture_output=True,
            text=True,
            env=env,
            timeout=120,
        )
        version_text = " ".join((ver.stdout or ver.stderr).split())
        is_beta = "beta" in version_text.lower() or "beta" in dd.lower()
        add("xcode", ver.returncode == 0 and not is_beta, f"{version_text} (developer dir: {dd})",
            hint="Install the current release Xcode; a beta SDK is rejected at upload (90534).")
        note(f"xcode: {version_text}")

        # Ruby / bundler / fastlane prerequisites
        bundler = subprocess.run(
            ["/opt/homebrew/opt/ruby/bin/bundle", "--version"],
            capture_output=True, text=True, env=env, timeout=60,
        )
        bundler_ver = (bundler.stdout or bundler.stderr).strip()
        major = re.match(r"(\d+)", bundler_ver)
        add("bundler", bundler.returncode == 0 and major is not None and int(major.group(1)) >= 4,
            f"bundle {bundler_ver} via /opt/homebrew/opt/ruby/bin "
            f"(system /usr/bin/bundle is Ruby 2.6 and cannot read this Gemfile.lock)",
            hint="Run `brew install ruby` — fastlane lanes need bundler 4.x from Homebrew Ruby.")
        note(f"bundler: {bundler_ver}")

        pnpm = shutil.which("pnpm", path=env["PATH"])
        add("pnpm", bool(pnpm), pnpm or "pnpm not found on PATH",
            hint="Install pnpm, or add its directory to the PATH list in the runner.")
        note(f"pnpm: {pnpm}")

        # App Store Connect credentials
        key_id = self.creds.get("APP_STORE_CONNECT_KEY_ID", "")
        issuer = self.creds.get("APP_STORE_CONNECT_ISSUER_ID", "")
        key_path = Path(self.creds.get("APP_STORE_CONNECT_KEY_PATH", "")).expanduser()
        missing = [
            name
            for name, val in (
                ("APP_STORE_CONNECT_KEY_ID", key_id),
                ("APP_STORE_CONNECT_ISSUER_ID", issuer),
                ("APP_STORE_CONNECT_KEY_PATH", str(key_path) if key_path else ""),
            )
            if not val
        ]
        add("credentials", not missing,
            "all three ASC variables set" if not missing else f"missing: {', '.join(missing)}",
            hint="Export the three variables in ~/.zshenv and re-run "
                 "scripts/host-deploy/install.sh so the host env file is refreshed.")
        note(f"credentials: key id {key_id or '-'}, issuer {issuer[:8] + '…' if issuer else '-'}")

        tcc_gated = any(part in str(key_path) for part in ("/Downloads/", "/Desktop/", "/Documents/"))
        readable = False
        if key_path and key_path.is_file() and not tcc_gated:
            try:
                with key_path.open("rb") as fh:
                    head = fh.read(40)
                readable = head.startswith(b"-----BEGIN PRIVATE KEY-----")
            except OSError as exc:
                readable = False
                note(f"key read error: {exc}")
        add("key-file", readable,
            f"{key_path}" if readable else f"cannot read {key_path}",
            hint="Move the .p8 to ~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8 (TCC protects "
                 "Downloads/Desktop/Documents), then re-run the install script.")
        if key_path and key_id:
            add("key-name", key_path.name == f"AuthKey_{key_id}.p8",
                f"{key_path.name} vs key id {key_id}",
                hint="altool resolves the key by id from ~/.appstoreconnect/private_keys/; "
                     "the filename must match the key id.",
                warn=True)

        # Signing identity
        ident = subprocess.run(
            ["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"],
            capture_output=True, text=True, timeout=60,
        ).stdout
        dist = [ln for ln in ident.splitlines() if "Apple Distribution" in ln or "iPhone Distribution" in ln]
        add("signing-identity", bool(dist), f"{len(dist)} distribution identity(ies) in the keychain",
            hint="Needed unless Xcode provisions through the API key; export the cert if signing fails.",
            warn=True)

        # Repo .env (the lane hard-fails without the traffic key)
        dotenv = parse_env_file(self.repo / ".env")
        tomtom = dotenv.get("EXPO_PUBLIC_TOMTOM_API_KEY", "")
        add("env-file", bool(tomtom) and not tomtom.startswith("$"),
            f".env present, EXPO_PUBLIC_TOMTOM_API_KEY {'set (' + str(len(tomtom)) + ' chars)' if tomtom else 'MISSING'}",
            hint="The lane refuses to build without the TomTom key: every viewport would show no traffic.")

        # Git state, judged the way the lane judges it
        git = self.git_state()
        lane_owned = (
            "ios/PolarisMaps/Info.plist",
            "ios/PolarisMaps.xcodeproj/project.pbxproj",
            "ios/Podfile.lock",
            "ios/Pods/",
            "fastlane/README.md",
        )
        blocking = []
        for line in git["dirty_files"]:
            path = line[3:].strip().strip('"')
            if not any(path == own or path.startswith(own) for own in lane_owned):
                blocking.append(path)
        add("git-clean", not blocking, f"{len(blocking)} blocking change(s)" if blocking else "no blocking changes",
            hint="Commit in the container (smart-commit) before submitting, or set allow_dirty=true.")
        add("git-branch", git["branch"] == "main", f"branch {git['branch']} @ {git['sha']}",
            hint="The lane only archives from main; merge first or set allow_non_main=true.")
        note(f"git: {git['branch']} @ {git['sha']}, {git['dirty_count']} changed file(s)")

        # Workspace + scheme
        ws = self.repo / "ios" / "PolarisMaps.xcworkspace"
        add("workspace", ws.is_dir(), str(ws.relative_to(self.repo)),
            hint="Run `pnpm ios:pods` / `bundle exec pod install` to regenerate the workspace.")
        if ws.is_dir():
            listing = subprocess.run(
                [env.get("DEVELOPER_DIR", "/Applications/Xcode.app/Contents/Developer") + "/usr/bin/xcodebuild",
                 "-list", "-workspace", str(ws)],
                capture_output=True, text=True, env=env, timeout=300,
            ).stdout
            schemes = re.findall(r"^\s{8}(\S+)\s*$", listing.split("Schemes:")[-1], re.M) if "Schemes:" in listing else []
            add("scheme", "PolarisMaps" in schemes or "PolarisMaps" in listing, "PolarisMaps scheme present"
                if "PolarisMaps" in listing else "PolarisMaps scheme not listed",
                hint="The lane archives -scheme PolarisMaps; regenerate the project if it is missing.")

        # Disk
        usage = shutil.disk_usage(str(self.repo))
        free_gb = round(usage.free / 1e9, 1)
        add("disk", free_gb >= 25, f"{free_gb} GB free",
            hint="An archive needs ~15-25 GB; delete build/ and build_derived_data/ to reclaim space.",
            warn=True)

        failed = [c for c in checks if c["status"] == "fail"]
        warned = [c for c in checks if c["status"] == "warn"]
        summary = (
            f"{len(checks) - len(failed) - len(warned)} ok, {len(warned)} warning(s), "
            f"{len(failed)} failure(s)"
        )
        log_fh.write(summary + "\n")
        log_fh.close()

        self.write_status(
            result_dir,
            lane="preflight",
            state="succeeded" if not failed else "failed",
            stage="finished",
            progress=f"{len(checks) - len(failed)}/{len(checks)}",
            checks=checks,
            summary=summary,
            git=git,
            started_at=now_iso(),
            host=socket.gethostname(),
            log=f".host-deploy/results/{job_id}/log.txt",
            exit_code=0 if not failed else 1,
        )
        if failed:
            first = failed[0]
            self.write_status(
                result_dir,
                failure={
                    "kind": f"preflight-{first['check']}",
                    "message": f"{first['check']}: {first['detail']}",
                    "hint": first.get("hint", ""),
                },
            )
        self.finish(result_dir, "succeeded" if not failed else "failed")
        return 0 if not failed else 1

    # -- main loop ---------------------------------------------------------
    def run(self) -> int:
        for d in (self.queue, self.results):
            d.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.queue, 0o777)
        except OSError:
            pass

        lock_path = self.support / "run.lock"
        lock_file = lock_path.open("w")
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            log_line("STATE", "another runner instance holds the lock — exiting")
            return 0

        self.heartbeat(running=True)
        log_line("STATE", f"runner {VERSION} up (repo {self.repo})")
        exit_code = 0
        try:
            while True:
                result_dir = self.claim_next()
                if result_dir is None:
                    break
                request, error = self.validate_request(result_dir)
                if error:
                    log_line("REJECT", f"{result_dir.name}: {error}")
                    self.finish(
                        result_dir,
                        "rejected",
                        lane=None,
                        failure={"kind": "invalid-request", "message": error,
                                 "hint": "Resubmit with scripts/host-deploy/client.mjs — it validates the shape."},
                    )
                    exit_code = 2
                    continue

                job_id = result_dir.name
                self.current_job = job_id
                assert request is not None  # validated above; error is None
                lane = request["lane"]
                log_line("START", f"{job_id}: lane={lane} requested_by={request.get('requested_by', '?')}")
                try:
                    rc = self.run_lane(job_id, lane, request, result_dir)
                except Exception as exc:  # noqa: BLE001
                    traceback.print_exc()
                    self.finish(
                        result_dir,
                        "failed",
                        failure={"kind": "runner-error", "message": f"{type(exc).__name__}: {exc}",
                                 "hint": "See daemon.log in the support directory."},
                    )
                    rc = 1
                finally:
                    self.stop_caffeinate()
                    self.current_job = None
                exit_code = rc if rc != 0 else exit_code
        finally:
            self.heartbeat(running=False)
            log_line("STATE", "runner idle — exiting")
            try:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
            except OSError:
                pass
            lock_file.close()

        return 0 if exit_code == 0 else 1

    def heartbeat(self, running: bool) -> None:
        payload = {
            "schema": SCHEMA,
            "runner_version": VERSION,
            "label": LABEL,
            "host": socket.gethostname(),
            "repo_root": str(self.repo),
            "state": "running" if running else "idle",
            "current_job": self.current_job,
            "updated_at": now_iso(),
            "lanes": {
                **{name: desc for name, (_c, _t, desc) in LANE_COMMANDS.items()},
                **{name: desc for name, (_t, desc) in BUILTIN_LANES.items()},
            },
        }
        atomic_write_json(self.state / "heartbeat.json", payload)


def diagnose(text: str) -> dict:
    for pattern, kind, message, hint in DIAGNOSTICS:
        match = re.search(pattern, text)
        if match:
            return {"kind": kind, "message": message, "hint": hint, "match": sanitize(match.group(0), 200)}
    return {
        "kind": "unclassified",
        "message": "lane exited non-zero; see log.txt tail",
        "hint": "Read log.txt around the last 'Step N/7' banner to find the failing stage.",
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Polaris host deploy runner")
    parser.add_argument("--support", default=os.environ.get("POLARIS_HOST_DEPLOY_SUPPORT", str(DEFAULT_SUPPORT)))
    parser.add_argument("--version", action="store_true")
    parser.add_argument("--config", action="store_true", help="print resolved configuration and exit")
    args = parser.parse_args(argv)

    if args.version:
        print(f"polaris-host-deploy {VERSION}")
        return 0

    support = Path(args.support).expanduser().resolve()
    if not (support / "config.json").is_file():
        print(f"no config.json in {support} — run scripts/host-deploy/install.sh on the Mac first", file=sys.stderr)
        return 2

    runner = Runner(support)
    if args.config:
        print(json.dumps({
            "version": VERSION,
            "support": str(runner.support),
            "repo_root": str(runner.repo),
            "queue": str(runner.queue),
            "results": str(runner.results),
            "lanes": sorted(set(LANE_COMMANDS) | set(BUILTIN_LANES)),
            "credentials_present": sorted(runner.creds),
        }, indent=2))
        return 0

    def handle_signal(signum, _frame):  # noqa: ANN001
        log_line("STATE", f"signal {signum} — terminating child and exiting")
        runner.kill_child()
        runner.stop_caffeinate()
        raise SystemExit(128 + signum)

    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, handle_signal)

    return runner.run()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
