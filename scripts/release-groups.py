#!/usr/bin/env python3
"""Which pull requests in a release cannot be dropped on their own.

    release-groups.py <pairs-file>

`pairs-file` is one "<pull request> <path>" per line, which is what
`release-pr.yml` already builds to compute the seam table. This reads the same
data the other way round: the seam table says WHERE two changes met, this says
what dropping one of them costs.

Output is one group per line, space-separated pull request numbers, largest
group first. Groups of one are not printed — they are the ordinary case.

Transitive, by union-find: if 16 and 17 share a file and 17 and 18 share a
different one, all three move together even though 16 and 18 touch nothing in
common. `0011` lets a release reject one issue by reverting it, and a revert of
something another change was built on leaves the second calling into code that
is no longer there.

**File overlap is a proxy, not a proof.** Two pull requests can depend on each
other without sharing a file — one calls a function the other added. The release
body says so; do not let this script's precision imply completeness.

It lives in a FILE rather than in a heredoc inside the workflow so that it can
be tested. The first version was a `python3 - <<PY` inside `$( )`, which cannot
be run outside the workflow and was wrongly blamed for `NOTES.md` 36 — the real
cause was assigning its output to `GROUPS`, a bash special variable.
"""

import collections
import sys


def groups(pairs):
    """pairs: iterable of (pr, path). -> list of sets of prs, largest first."""
    touched = collections.defaultdict(set)
    for pr, path in pairs:
        touched[path].add(pr)

    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for prs in touched.values():
        prs = sorted(prs, key=int)
        for other in prs[1:]:
            union(prs[0], other)

    found = collections.defaultdict(set)
    for pr in parent:
        found[find(pr)].add(pr)

    return sorted(
        (g for g in found.values() if len(g) > 1),
        key=lambda s: (-len(s), sorted(s, key=int)),
    )


def read_pairs(path):
    for line in open(path):
        if not line.strip():
            continue
        pr, rest = line.split(None, 1)
        yield pr, rest.strip()


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: release-groups.py <pairs-file>")
    for g in groups(read_pairs(sys.argv[1])):
        print(" ".join(sorted(g, key=int)))
