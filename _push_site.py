import base64, json, subprocess, sys
from pathlib import Path

def gh(method, path, payload=None):
    cmd = ["gh", "api", "-X", method, path]
    if payload is not None:
        cmd += ["--input", "-"]
        proc = subprocess.run(cmd, input=json.dumps(payload).encode("utf-8"), capture_output=True)
    else:
        proc = subprocess.run(cmd, capture_output=True)
    out = proc.stdout.decode("utf-8", errors="replace")
    err = proc.stderr.decode("utf-8", errors="replace")
    if proc.returncode != 0:
        sys.stderr.write(err or out)
        sys.exit(proc.returncode)
    return json.loads(out) if out.strip() else {}

root = Path(".").resolve()
ref = gh("GET", "/repos/binc4809-999/qushi-desk/git/ref/heads/main")
parent = ref["object"]["sha"]
print("parent", parent)

skip_dirs = {".git", "__pycache__", "_site", "node_modules", ".wrangler"}
entries = []
for path in sorted(root.rglob("*")):
    if not path.is_file():
        continue
    if any(part in skip_dirs for part in path.parts):
        continue
    if path.name in {"_push_site.py"}:
        continue
    rel = path.relative_to(root).as_posix()
    blob = gh("POST", "/repos/binc4809-999/qushi-desk/git/blobs", {
        "content": base64.b64encode(path.read_bytes()).decode("ascii"),
        "encoding": "base64",
    })
    entries.append({"path": rel, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    print("blob", rel)

tree = gh("POST", "/repos/binc4809-999/qushi-desk/git/trees", {"tree": entries})
commit = gh("POST", "/repos/binc4809-999/qushi-desk/git/commits", {
    "message": "Place A-share premarket and limit-up links under the A-share block.",
    "tree": tree["sha"],
    "parents": [parent],
})
print("commit", commit["sha"])
gh("PATCH", "/repos/binc4809-999/qushi-desk/git/refs/heads/main", {"sha": commit["sha"]})
print("updated main")
