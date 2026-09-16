#!/usr/bin/env python3
"""Post the reviewer's verdict as a GitHub review, with inline comments.

    post-review.py <repo> <pr> <findings.json>

The reviewer writes the JSON; this posts it. The split is deliberate: deciding
what to say is judgement, and turning that into a correct API call is not. A
model that also has to remember `commit_id`, the `event` spelling and the
inline-comment schema gets one of them wrong eventually, and the verdict is the
one thing that must not be lost (`0006`: silence is never an outcome).

Input:

    {
      "event": "APPROVE" | "REQUEST_CHANGES" | "COMMENT",
      "body":  "the findings, grouped by pass",
      "comments": [ {"path": "lib/slug.ts", "line": 42, "body": "..."} ]
    }

`comments` is optional. Each one is anchored to a line **as it appears in the
new version of the file**, which is what a human sees when they open Files
changed. GitHub rejects a line that is not part of the diff.

**Inline comments are best effort; the verdict is not.** If GitHub refuses the
inline anchors — a line outside the diff is the usual reason, and the model has
no way to be certain which lines qualify — this retries with the body alone and
folds the inline findings into it, so nothing the reviewer said is lost. It
exits non-zero only if even that fails.
"""

import json
import subprocess
import sys

EVENTS = {"APPROVE", "REQUEST_CHANGES", "COMMENT"}


def gh(args, payload=None):
    """Run gh; return (ok, stdout_or_stderr)."""
    p = subprocess.run(
        ["gh", *args],
        input=json.dumps(payload) if payload is not None else None,
        capture_output=True,
        text=True,
    )
    return p.returncode == 0, (p.stdout if p.returncode == 0 else p.stderr)


def post(repo, pr, payload):
    return gh(
        ["api", f"repos/{repo}/pulls/{pr}/reviews", "--method", "POST", "--input", "-"],
        payload,
    )


def main():
    if len(sys.argv) != 4:
        sys.exit("usage: post-review.py <repo> <pr> <findings.json>")
    repo, pr, path = sys.argv[1], sys.argv[2], sys.argv[3]

    try:
        f = json.load(open(path))
    except (OSError, json.JSONDecodeError) as e:
        sys.exit(f"cannot read {path}: {e}")

    event = (f.get("event") or "").upper()
    if event not in EVENTS:
        sys.exit(f"event must be one of {sorted(EVENTS)}, got {f.get('event')!r}")
    body = (f.get("body") or "").strip()
    if not body:
        sys.exit("body is empty — a verdict with no findings tells nobody anything")

    ok, head = gh(["pr", "view", pr, "--repo", repo, "--json", "headRefOid", "--jq", ".headRefOid"])
    if not ok:
        sys.exit(f"cannot read the head SHA: {head}")
    head = head.strip()

    comments = []
    for c in f.get("comments") or []:
        missing = [k for k in ("path", "line", "body") if not c.get(k)]
        if missing:
            print(f"skipping an inline comment missing {missing}", file=sys.stderr)
            continue
        comments.append(
            {"path": c["path"], "line": int(c["line"]), "side": "RIGHT", "body": c["body"]}
        )

    payload = {"commit_id": head, "body": body, "event": event}
    if comments:
        payload["comments"] = comments
        ok, out = post(repo, pr, payload)
        if ok:
            print(f"posted {event} on {head[:7]} with {len(comments)} inline comment(s)")
            return 0
        # Almost always a line outside the diff. Do not lose the verdict over it.
        print(f"inline comments refused, falling back to the body alone:\n{out}", file=sys.stderr)
        extra = "\n".join(
            f"- `{c['path']}:{c['line']}` — {c['body']}" for c in comments
        )
        payload = {
            "commit_id": head,
            "body": body + "\n\n## Findings that could not be anchored\n\n" + extra,
            "event": event,
        }

    ok, out = post(repo, pr, payload)
    if not ok:
        print(f"could not post the review at all:\n{out}", file=sys.stderr)
        return 1
    print(f"posted {event} on {head[:7]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
