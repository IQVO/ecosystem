#!/usr/bin/env python3
"""Fail when a committed copy under specs/<context>/ differs from the producer's develop.

specs/ is a byte-for-byte copy of each context's apis/*.yaml (npm run sync). The copies are refreshed by hand, so
they rot: on 2026-11-05, 15 of 77 were stale (including the REST guideline cutover of 2026-11-01), and the catalogue
silently showed retired routes and event shapes. Each file is read from IQVO/<context> on `develop` with the raw media
type. Exit codes: 0 all equal, 1 stale copies (listed), 2 a producer could not be read (an unreadable producer is
NOT a pass), 3 nothing to check.
usage: check-specs-fresh.py [--root .] [--org IQVO]
"""
import argparse, os, subprocess, sys


def fetch(org, ctx, name):
    r = subprocess.run(["gh", "api", "-H", "Accept: application/vnd.github.raw",
                        f"repos/{org}/{ctx}/contents/apis/{name}?ref=develop"], capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"{org}/{ctx} apis/{name}@develop: {r.stderr.strip()[:140]}")
    return r.stdout


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--org", default="IQVO")
    a = ap.parse_args(argv)
    specs = os.path.join(a.root, "specs")
    stale, unreadable, n = [], [], 0
    for ctx in sorted(os.listdir(specs)):
        d = os.path.join(specs, ctx)
        if not os.path.isdir(d):
            continue
        for name in sorted(f for f in os.listdir(d) if f.endswith(".yaml") and f.startswith(("asyncapi", "openapi"))):
            local = open(os.path.join(d, name)).read()
            try:
                remote = fetch(a.org, ctx, name)
            except RuntimeError as e:
                # specs/<ctx> may hold a hand-written file (e.g. no-consumer-reasons.yaml is not matched above); a
                # missing producer file for a spec we hold is a real finding, not a skip
                unreadable.append(str(e))
                continue
            n += 1
            if local != remote:
                stale.append(f"specs/{ctx}/{name}")
    if unreadable:
        print("check-specs-fresh: cannot read " + "; ".join(unreadable))
        return 2
    if not n:
        print("check-specs-fresh: no spec copies found")
        return 3
    if stale:
        print(f"STALE: {len(stale)} of {n} spec copies differ from the producer's develop:")
        print("\n".join("  " + s for s in stale))
        print("FIX: npm run sync (WAREHOUSE_ROOT=<dir with the clones>), review the diff, commit.")
        return 1
    print(f"check-specs-fresh: {n} spec copies equal their producer's develop")
    return 0


if __name__ == "__main__":
    sys.exit(main())
