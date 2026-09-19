#!/usr/bin/env bash
# Is this commit still the head of this open pull request?  (`0020`)
#
# Goes in the TARGET repo at scripts/still-current.sh.
#
#   still-current.sh <pr> <sha>
#
# Prints exactly one line to stdout, `current=true` or `current=false`, so a
# workflow step can append it to $GITHUB_OUTPUT as it is. The reason goes to
# stderr. Exits 0 either way: a stale run is not a failure (`0020`, `NOTES.md`
# 37). Exits 2 only when the question cannot be answered, and prints nothing.
#
# The one definition of "stale" in the pipeline. Workflows call it before they
# act, `submit_review` calls it before it posts, and the done-checks count
# `current=false` as an ending. Do not restate this check anywhere else.
#
# Needs GH_TOKEN, and REPO or GH_REPO.
set -uo pipefail

PR="${1:-}"
SHA="${2:-}"
REPO="${REPO:-${GH_REPO:-}}"
if [ -z "$PR" ] || [ -z "$SHA" ] || [ -z "$REPO" ]; then
	echo "usage: still-current.sh <pr> <sha>, with REPO or GH_REPO set" >&2
	exit 2
fi

J=$(gh pr view "$PR" --repo "$REPO" --json state,headRefOid 2>&1) || {
	echo "still-current: could not read #$PR: $J" >&2
	exit 2
}
STATE=$(jq -r '.state' <<< "$J")
HEAD=$(jq -r '.headRefOid' <<< "$J")

if [ "$STATE" != "OPEN" ]; then
	echo "still-current: #$PR is $STATE, so nothing about $SHA is current." >&2
	echo "current=false"
elif [ "$HEAD" != "$SHA" ]; then
	echo "still-current: #$PR has moved on. This run is about ${SHA:0:7}; the head is ${HEAD:0:7}, and its own chain decides." >&2
	echo "current=false"
else
	echo "still-current: ${SHA:0:7} is still the head of #$PR." >&2
	echo "current=true"
fi
