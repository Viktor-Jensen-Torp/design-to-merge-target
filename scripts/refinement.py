#!/usr/bin/env python3
"""The refiner's deterministic halves, and the shape check (`0015`, `0016`).

Goes in the TARGET repo at `scripts/refinement.py`.

    refinement.py gather --repo R --limit N --out DIR      what the refiner reads
    refinement.py apply  --repo R --report F --backlog F   what it decided, applied
    refinement.py shape  --event $GITHUB_EVENT_PATH        does the issue have a Problem?

THE REFINER DECIDES; THIS ACTS. `submit_refinement` in `.pi/extensions/submit.ts`
validates the refiner's decisions and records them. It writes nothing to GitHub,
and the agent's token cannot. `apply` writes them with a token that can, and it
is the only part of the refiner that writes. Three things it does that a model
calling `gh` would not reliably do:

  1. It refuses to touch an issue that changed after the batch was read. If a
     person edited it, gated it or closed it during the run, the decision was
     made about something that no longer exists. The same rule as `0009`
     guard 2: what gets acted on is what was read.
  2. It reads issue field values back after writing them. GitHub documents that
     field values are "silently dropped" when the feature is off (`NOTES.md` 67),
     so a write that returned 200 proves nothing on its own.
  3. It never sends an empty field list. `POST .../issue-field-values` with an
     empty array "will clear all existing field values for the issue".

It applies every decision it can and reports every one it could not, then exits
1 if anything failed. One bad decision does not strand the rest. `--dry-run`
prints the writes and makes none.

Environment: GH_TOKEN, and for `apply` PRIORITY_FIELD_ID and EFFORT_FIELD_ID.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys

# Field names as the refiner sees them, and the variable holding each field's
# org-level id. Single-select values are written as the option NAME, not its id
# (REST docs for issue field values, read 2026-09-18).
FIELDS = {"priority": "PRIORITY_FIELD_ID", "effort": "EFFORT_FIELD_ID"}


class Failed(Exception):
    pass


class GitHub:
    def __init__(self, repo: str, dry: bool):
        self.repo, self.dry = repo, dry

    def api(self, path: str, method: str = "GET", body: dict | None = None, read: bool = False):
        """Call `gh api`. A read in a dry run returns None; a write is printed."""
        url = path if path.startswith("repos/") else f"repos/{self.repo}/{path}"
        if self.dry:
            if not read:
                print(f"  would {method} {url}" + (f" {json.dumps(body)}" if body else ""))
            return None
        args = ["gh", "api", url, "--method", method]
        if body is not None:
            args += ["--input", "-"]
        r = subprocess.run(args, input=json.dumps(body) if body is not None else None,
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise Failed(f"{method} {url}: {(r.stderr or r.stdout).strip()[:300]}")
        return json.loads(r.stdout) if r.stdout.strip() else None


def has_problem(body: str) -> bool:
    """True when a body has a Problem section with something under it (`0015`).

    `submit_refinement` in `.pi/extensions/submit.ts` applies the same rule to
    the refiner's edits, in TypeScript. Change them together.
    """
    lines = body.splitlines()
    at = next((i for i, l in enumerate(lines)
               if re.fullmatch(r"#{1,6}\s*problem\s*:?\s*", l.strip(), re.I)), None)
    if at is None:
        return False
    for l in lines[at + 1:]:
        t = l.strip()
        if re.match(r"#{1,6}\s", t):
            return False
        # What an issue form writes for an optional field left empty.
        if t and t != "_No response_":
            return True
    return False


# Being worked, or waiting on a person, so re-reading them every night would
# only churn. `active:agent` and `active:human` mean someone is working the
# issue now (`0017`): the refiner must not rewrite a body being worked from.
# needs:shape has no Problem to refine, and the other three are already
# someone's to answer. An assignee is NOT here: it means responsible, not
# working, and a person is expected to be assigned to everything.
SKIP = ("active:agent", "active:human", "needs:human", "needs:shape", "needs:split", "needs:spike")


def gather(gh: GitHub, limit: int, out: str) -> int:
    """Write the batch the refiner is given. Returns how many issues it holds.

    Oldest-updated first, and no watermark (`0016`): the refiner's own edits
    move an issue to the back, so a backlog larger than one batch rotates.
    An issue judged ready and left unchanged is NOT moved, so ready issues
    waiting on a person are re-read each night. That costs tokens, not edits,
    and the run summary lists them.
    """
    query = " ".join(f'-label:"{l}"' for l in SKIP) + " sort:updated-asc"
    r = subprocess.run(["gh", "issue", "list", "--repo", gh.repo, "--state", "open", "--search", query,
                        "--limit", str(limit), "--json", "number,title,body,labels,updatedAt"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise Failed(f"gh issue list: {r.stderr.strip()[:300]}")
    issues = json.loads(r.stdout)

    backlog, parts = [], []
    for i in issues:
        n = i["number"]
        fields = {v.get("issue_field_name"): (v.get("single_select_option") or {}).get("name", v.get("value"))
                  for v in gh.api(f"issues/{n}/issue-field-values", read=True) or []}
        blocked = gh.api(f"issues/{n}/dependencies/blocked_by", read=True) or []
        comments = gh.api(f"issues/{n}/comments?per_page=100", read=True) or []
        backlog.append({"number": n, "updated_at": i["updatedAt"]})

        part = [f"----- BEGIN ISSUE #{n} -----",
                f"# #{n}: {i['title']}", "",
                f"Labels: {', '.join(l['name'] for l in i['labels']) or 'none'}",
                f"Priority: {fields.get('Priority') or 'not set'} | Effort: {fields.get('Effort') or 'not set'}",
                "Blocked by: " + (", ".join(f"#{b['number']} ({b['state']}: {b['title']})" for b in blocked) or "nothing"),
                "", i["body"] or "_(empty body)_"]
        if comments:
            part += ["", "## Recent comments", ""]
            for c in comments[-5:]:
                part += [f"**{c['user']['login']}** wrote:", "", c["body"], ""]
        part.append(f"----- END ISSUE #{n} -----")
        parts.append("\n".join(part))

    os.makedirs(out, exist_ok=True)
    json.dump(backlog, open(f"{out}/backlog.json", "w"), indent=2)
    json.dump([b["number"] for b in backlog], open(f"{out}/batch.json", "w"))
    open(f"{out}/backlog.md", "w").write("\n\n".join(parts) + "\n")
    return len(backlog)


def apply_one(gh: GitHub, d: dict, read_at: str | None) -> list[str]:
    """Apply one issue's decisions. Returns what was done; raises on failure."""
    n = d["number"]
    done: list[str] = []

    cur = gh.api(f"issues/{n}", read=True)
    if cur is not None:
        labels = {l["name"] for l in cur.get("labels", [])}
        if cur["state"] != "open":
            raise Failed("closed since the batch was read; nothing applied")
        if "active:agent" in labels:
            raise Failed("gated with active:agent since the batch was read; nothing applied")
        if read_at and cur["updated_at"] != read_at:
            raise Failed(f"changed since the batch was read ({read_at} -> {cur['updated_at']}); nothing applied")

    # Everything that can refuse this issue is checked before its first write, so
    # an issue is changed completely or not at all.
    values = []
    for key, var in FIELDS.items():
        if key in d:
            fid = os.environ.get(var, "").strip()
            if not fid.isdigit():
                raise Failed(f"{key} was decided but {var} is not set to a field id")
            values.append({"field_id": int(fid), "value": d[key]})
    # A blocked-by edge names the blocker by its database id, not its number,
    # and a blocker that does not exist should refuse the issue, not half of it.
    ids = {}
    for m in d.get("add_blocked_by", []) + d.get("remove_blocked_by", []):
        blocker = gh.api(f"issues/{m}", read=True)
        ids[m] = blocker["id"] if blocker else 0

    if "duplicate_of" in d:
        m = d["duplicate_of"]
        # The documented convention: a "Duplicate of #n" comment is what makes
        # GitHub record the relationship (`duplicateOf`, a timeline event).
        gh.api(f"issues/{n}/comments", "POST", {"body": f"Duplicate of #{m}\n\n{d['reason']}"})
        gh.api(f"issues/{n}", "PATCH", {"state": "closed", "state_reason": "duplicate"})
        return [f"closed as a duplicate of #{m}"]

    edit = {k: d[k] for k in ("title", "body") if k in d}
    if edit:
        gh.api(f"issues/{n}", "PATCH", edit)
        done.append("edited " + " and ".join(edit))

    if values:  # never empty: an empty list clears every field on the issue
        gh.api(f"issues/{n}/issue-field-values", "POST", {"issue_field_values": values})
        back = gh.api(f"issues/{n}/issue-field-values", read=True)
        if back is not None:
            got = {v["issue_field_id"]: (v.get("single_select_option") or {}).get("name", v.get("value"))
                   for v in back}
            for v in values:
                if got.get(v["field_id"]) != v["value"]:
                    raise Failed(f"field {v['field_id']} reads back as {got.get(v['field_id'])!r}, "
                                 f"not {v['value']!r}: the write was dropped")
        done.append(", ".join(f"{k} {d[k]}" for k in FIELDS if k in d))

    for m in d.get("add_blocked_by", []):
        # `blocking` has no write endpoint: the edge is always written from the
        # blocked issue (`NOTES.md` 67).
        gh.api(f"issues/{n}/dependencies/blocked_by", "POST", {"issue_id": ids[m]})
        done.append(f"blocked by #{m}")
    for m in d.get("remove_blocked_by", []):
        gh.api(f"issues/{n}/dependencies/blocked_by/{ids[m]}", "DELETE")
        done.append(f"no longer blocked by #{m}")

    for key, label, heading in (("propose_split", "needs:split", "The refiner proposes a split"),
                                ("propose_spike", "needs:spike", "The refiner has a question that needs running")):
        if key in d:
            gh.api(f"issues/{n}/comments", "POST",
                   {"body": f"**{heading}.** A person decides.\n\n{d[key]}"})
            gh.api(f"issues/{n}/labels", "POST", {"labels": [label]})
            done.append(label)

    return done


def mark_ready(gh: GitHub, report: dict, read_at: dict, applied: set) -> list[str]:
    """Keep the `refined` label in step with the refiner's judgement.

    `refined` means the refiner judged the issue ready at its last read, so a
    person can find those issues on the board without opening a run report.
    It starts nothing: only `active:agent` does. Added to issues judged ready,
    removed from batch issues judged not ready. An issue someone changed since
    the batch was read is skipped, unless the change was this run's own edit.
    """
    notes = []
    ready = set(report["ready"])
    for n in sorted(read_at):
        cur = gh.api(f"issues/{n}", read=True)
        if cur is None:  # dry run
            if n in ready:
                gh.api(f"issues/{n}/labels", "POST", {"labels": ["refined"]})
            continue
        labels = {l["name"] for l in cur.get("labels", [])}
        if cur["state"] != "open" or "active:agent" in labels or "active:human" in labels:
            continue
        if n not in applied and cur["updated_at"] != read_at[n]:
            notes.append(f"#{n} changed since the batch was read; `refined` left as it was")
            continue
        if n in ready and "refined" not in labels:
            gh.api(f"issues/{n}/labels", "POST", {"labels": ["refined"]})
        elif n not in ready and "refined" in labels:
            gh.api(f"issues/{n}/labels/refined", "DELETE")
    return notes


def apply(a) -> int:
    report = json.load(open(a.report))
    read_at = {i["number"]: i["updated_at"] for i in json.load(open(a.backlog))}
    gh = a.gh

    rows, failed, applied = [], 0, set()
    for d in report["issues"]:
        n = d["number"]
        if n not in read_at:
            # submit.ts refuses this already. Checked again because this is
            # the step holding the write token.
            rows.append((n, d["reason"], "**not in the batch; refused**"))
            failed += 1
            continue
        try:
            rows.append((n, d["reason"], "; ".join(apply_one(gh, d, read_at[n])) or "nothing"))
            applied.add(n)
        except Failed as e:
            rows.append((n, d["reason"], f"**failed:** {e}"))
            failed += 1

    try:
        label_notes = mark_ready(gh, report, read_at, applied)
    except Failed as e:
        label_notes = [f"**`refined` labels failed:** {e}"]
        failed += 1

    out = ["## Refinement", "", report["summary"], ""]
    if rows:
        out += ["| Issue | Why | Result |", "|---|---|---|"]
        out += [f"| #{n} | {why.replace('|', '/')} | {res.replace('|', '/')} |" for n, why, res in rows]
    else:
        out.append("Nothing to refine. This run wrote nothing, which is a correct outcome.")
    if report["ready"]:
        out += ["", "**Ready, labelled `refined`, waiting for a person to add `active:agent`:** "
                + ", ".join(f"#{n}" for n in report["ready"])]
    out += [f"- {x}" for x in label_notes]
    text = "\n".join(out) + "\n"
    print(text)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f:
            f.write(text)
    if failed:
        print(f"::error::{failed} decision(s) could not be applied", file=sys.stderr)
    return 1 if failed else 0




def shape(a) -> int:
    """Print `add`, `remove` or `keep` for the needs:shape label."""
    issue = json.load(open(a.event))["issue"]
    labelled = any(l["name"] == "needs:shape" for l in issue.get("labels", []))
    ok = has_problem(issue.get("body") or "")
    print("remove" if ok and labelled else "add" if not ok and not labelled else "keep")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gather", help="write the batch the refiner reads")
    g.add_argument("--repo", required=True)
    g.add_argument("--limit", type=int, default=10)
    g.add_argument("--out", required=True)
    p = sub.add_parser("apply", help="apply what submit_refinement recorded")
    p.add_argument("--repo", required=True)
    p.add_argument("--report", required=True)
    p.add_argument("--backlog", required=True, help="backlog.json from gather")
    p.add_argument("--dry-run", action="store_true")
    s_ = sub.add_parser("shape", help="decide the needs:shape label for one issue event")
    s_.add_argument("--event", required=True)
    a = ap.parse_args()

    if a.cmd == "shape":
        return shape(a)
    if a.cmd == "gather":
        n = gather(GitHub(a.repo, False), a.limit, a.out)
        print(f"gathered {n} issue(s)")
        return 0
    a.gh = GitHub(a.repo, a.dry_run)
    return apply(a)


if __name__ == "__main__":
    sys.exit(main())
