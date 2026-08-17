#!/usr/bin/env python3
"""Trigger and monitor an Xcode Cloud build via the App Store Connect API.

Usage: asc_ci.py <command>
  list      — list ciProducts and workflows
  trigger   — start a build run for the given workflow name (or first workflow)
  status    — show the latest build run and its actions/issues
"""

import subprocess, json, time, base64, os, sys

KEY_ID = os.environ['APP_STORE_CONNECT_KEY_ID']
ISSUER_ID = os.environ['APP_STORE_CONNECT_ISSUER_ID']
KEY_PATH = os.environ['APP_STORE_CONNECT_KEY_PATH']

BASE = "https://api.appstoreconnect.apple.com/v1"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode()


def make_jwt() -> str:
    header = {"alg": "ES256", "kid": KEY_ID, "typ": "JWT"}
    claims = {
        "iss": ISSUER_ID,
        "iat": int(time.time()),
        "exp": int(time.time()) + 900,
        "aud": "appstoreconnect-v1",
    }
    signing_input = (
        b64url(json.dumps(header, separators=(",", ":")).encode())
        + "."
        + b64url(json.dumps(claims, separators=(",", ":")).encode())
    )
    der_sig = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", KEY_PATH],
        input=signing_input.encode(),
        capture_output=True,
        check=True,
    ).stdout
    # openssl emits DER-encoded ECDSA-Sig-Value (SEQUENCE { r, s });
    # JWT ES256 requires the raw 64-byte r||s concatenation.
    raw_sig = der_to_raw(der_sig)
    return signing_input + "." + b64url(raw_sig)


def der_to_raw(der: bytes) -> bytes:
    """Convert DER ECDSA signature to raw r||s (32 + 32 bytes for P-256)."""
    # SEQUENCE tag 0x30, then length, then INTEGER r (0x02) and INTEGER s (0x02)
    i = 0
    assert der[i] == 0x30, "not a DER sequence"
    i += 1
    if der[i] & 0x80:
        i += der[i] & 0x7F
    i += 1
    assert der[i] == 0x02, "expected INTEGER r"
    i += 1
    r_len = der[i]
    i += 1
    r = der[i : i + r_len]
    i += r_len
    assert der[i] == 0x02, "expected INTEGER s"
    i += 1
    s_len = der[i]
    i += 1
    s = der[i : i + s_len]

    def fix(v: bytes) -> bytes:
        # Strip leading zero padding and pad to 32 bytes
        v = v.lstrip(b"\x00")
        return v.rjust(32, b"\x00")[-32:]

    return fix(r) + fix(s)


def api(path: str, method: str = "GET", body: dict | None = None) -> dict:
    jwt = make_jwt()
    cmd = [
        "curl", "-s", "-g",
        "-H", f"Authorization: Bearer {jwt}",
        "-H", "Content-Type: application/json",
    ]
    if method == "POST" and body is not None:
        cmd += ["-X", "POST", "-d", json.dumps(body)]
    cmd.append(f"{BASE}{path}")
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    return json.loads(out)


def list_things():
    data = api("/ciProducts")
    products = data.get("data", [])
    print(f"ciProducts: {len(products)}")
    for p in products:
        pid = p["id"]
        attrs = p["attributes"]
        print(f"  product {pid} | {attrs.get('name')} | {attrs.get('productType')}")
        workflows = api(f"/ciProducts/{pid}/workflows").get("data", [])
        for w in workflows:
            wattrs = w["attributes"]
            print(f"    workflow {w['id']} | {wattrs.get('name')}")
    with open("/tmp/asc_products.json", "w") as f:
        json.dump(data, f)


def trigger(workflow_name: str):
    data = api("/ciProducts")
    products = data.get("data", [])
    if not products:
        print("No ciProducts found")
        sys.exit(1)
    product = products[0]
    pid = product["id"]
    workflows = api(f"/ciProducts/{pid}/workflows").get("data", [])
    if not workflows:
        print("No workflows found")
        sys.exit(1)
    target = None
    for w in workflows:
        if workflow_name.lower() in w["attributes"].get("name", "").lower():
            target = w
            break
    if target is None:
        target = workflows[0]
        print(f"Workflow not found by name, using first: {target['attributes']['name']}")
    else:
        print(f"Triggering workflow: {target['attributes']['name']}")

    # Find the source branch: resolve the workflow's repository via its
    # relationship endpoint (the list response only carries links).
    repo_ref = target["relationships"].get("repository", {}).get("data")
    if not repo_ref:
        repo = api(f"/ciWorkflows/{target['id']}/repository")
        repo_ref = repo.get("data")
    branch_id = None
    branch_name = None
    if repo_ref:
        repo_id = repo_ref["id"]
        branches = api(f"/scmRepositories/{repo_id}/gitReferences").get("data", [])
        for b in branches:
            name = b["attributes"].get("name")
            if b["attributes"].get("kind") == "BRANCH":
                if name in ("main", "master"):
                    branch_id = b["id"]
                    branch_name = name
                    break
        if branch_id is None and branches:
            b = branches[0]
            branch_id = b["id"]
            branch_name = b["attributes"].get("name")
    print(f"Building branch: {branch_name} ({branch_id})")

    body = {
        "data": {
            "type": "ciBuildRuns",
            "relationships": {
                "workflow": {"data": {"type": "ciWorkflows", "id": target["id"]}},
                "sourceBranchOrTag": {"data": {"type": "scmGitReferences", "id": branch_id}},
            },
        }
    }
    run = api("/ciBuildRuns", method="POST", body=body)
    run_id = run["data"]["id"]
    print(f"Build run created: {run_id}")
    with open("/tmp/asc_build_run.json", "w") as f:
        json.dump({"id": run_id, "workflow": target["attributes"]["name"], "branch": branch_name}, f)
    print(f"Build run: https://appstoreconnect.apple.com/ci/builds/{run_id}")


def fetch_run(run_id: str) -> dict:
    """Fetch a build run and its actions (via the actions sub-resource)."""
    run = api(f"/ciBuildRuns/{run_id}")
    actions = api(f"/ciBuildRuns/{run_id}/actions").get("data", [])
    run["actions"] = actions
    return run


def status():
    with open("/tmp/asc_build_run.json") as f:
        meta = json.load(f)
    run_id = meta["id"]
    run = fetch_run(run_id)
    attrs = run["data"]["attributes"]
    print(f"Build run {run_id} (workflow: {meta['workflow']}, branch: {meta['branch']})")
    print(f"  status: {attrs.get('executionProgress')} ({attrs.get('completionStatus')})")
    print(f"  number: {attrs.get('number')}")
    for a in run.get("actions", []):
        aattrs = a["attributes"]
        print(
            f"  action: {aattrs.get('name')} | {aattrs.get('executionProgress')} | "
            f"{aattrs.get('completionStatus')} | issues={aattrs.get('issueCounts', {})}"
        )


def watch(interval_sec: int = 30, max_checks: int = 120):
    """Poll the build run until it completes, printing actions and issues."""
    with open("/tmp/asc_build_run.json") as f:
        meta = json.load(f)
    run_id = meta["id"]
    print(f"Watching build run {run_id} ({meta['workflow']}, {meta['branch']})")

    for check in range(max_checks):
        time.sleep(interval_sec)
        run = fetch_run(run_id)
        attrs = run["data"]["attributes"]
        progress = attrs.get("executionProgress")
        completion = attrs.get("completionStatus")
        print(f"[{check + 1}] {progress} / {completion}")
        for a in run.get("actions", []):
            aattrs = a["attributes"]
            print(
                f"    action {aattrs.get('name')}: {aattrs.get('executionProgress')} "
                f"({aattrs.get('completionStatus')}) issues={aattrs.get('issueCounts', {})}"
            )
        if completion is not None:
            print(f"Build finished: {completion}")
            if completion != "SUCCEEDED":
                # Fetch and print issues
                issues = api(f"/ciBuildRuns/{run_id}/issues").get("data", [])
                print(f"Issues ({len(issues)}):")
                for i in issues:
                    iattrs = i["attributes"]
                    print(f"  - [{iattrs.get('category')}] {iattrs.get('message')}")
            return 0 if completion == "SUCCEEDED" else 1
    print("Timed out watching the build")
    return 2


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    if cmd == "list":
        list_things()
    elif cmd == "trigger":
        trigger(sys.argv[2] if len(sys.argv) > 2 else "send to testflight")
    elif cmd == "status":
        status()
    elif cmd == "watch":
        sys.exit(watch())
