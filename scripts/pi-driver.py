#!/usr/bin/env python3
"""Drive Pi in RPC mode and refuse to let a role stop unfinished.

Why this exists
---------------
Three implement runs produced a correct change and then ended without
committing it, and the workflow step went green anyway. `NOTES.md` section 1:
`pi -p` exits 0 on failure, and `--mode json` never checks `stopReason`. So
every workflow step that runs Pi today is a gate that checks nothing.

`pi --mode rpc` is Pi's documented interface for headless operation. This driver
owns the loop and the exit code:

    prompt -> wait for agent_settled -> run --done -> clean? exit 0
                   ^                                  dirty? prompt again
                   |                                         (up to --max-nudges)
                   +-----------------------------------------------+
                                                     out of nudges -> exit 1

Two properties an extension on `agent_settled` could not have: the exit code is
this process's, and the check runs outside the agent, so the agent cannot pass
it by asserting that it has.

Exit codes
----------
  0  the --done command succeeded
  1  the agent settled but --done never succeeded within the nudge budget
  2  timed out (no events for --idle-timeout, or --timeout total)
  3  Pi died, or spoke something that was not the protocol
  4  bad usage
  5  the provider kept failing past --max-retries

Framing
-------
RPC is strict JSONL delimited by LF only. `rpc.md` calls out that Node's
`readline` is non-compliant; Python's text-mode iteration has the same problem
in reverse (universal newlines silently rewrite a lone \\r inside a JSON
string). So stdout is read as BYTES and split on b"\\n" here, by hand.
"""

import argparse
import json
import os
import select
import signal
import subprocess
import sys
import time


def log(msg):
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


class Framer:
    """Split a byte stream on LF only, per rpc.md."""

    def __init__(self):
        self.buf = b""

    def feed(self, chunk):
        self.buf += chunk
        out = []
        while True:
            i = self.buf.find(b"\n")
            if i < 0:
                break
            line, self.buf = self.buf[:i], self.buf[i + 1 :]
            if line.endswith(b"\r"):
                line = line[:-1]
            if line.strip():
                out.append(line)
        return out


def tool_error_text(ev):
    """The error a failed tool handed back, as one short line.

    `tool_execution_end.result` is whatever the tool returned, so this reads the
    documented shapes and falls back to a truncated dump rather than guessing.
    """
    r = ev.get("result")
    if isinstance(r, dict):
        parts = r.get("content")
        if isinstance(parts, list):
            text = " ".join(
                str(c.get("text", "")) for c in parts if isinstance(c, dict)
            ).strip()
            if text:
                return text[:400].replace("\n", " ⏎ ")
        if r.get("error"):
            return str(r["error"])[:400]
    return (json.dumps(r) if r is not None else "(no result)")[:400]


def run_check(cmd, cwd):
    p = subprocess.run(
        ["bash", "-c", cmd],
        cwd=cwd,
        capture_output=True,
        text=True,
    )
    return p.returncode, (p.stdout + p.stderr).strip()


def main():
    ap = argparse.ArgumentParser(
        description="Run Pi over RPC and assert it finished the job.",
        epilog="Everything after -- is the pi command line.",
    )
    ap.add_argument("--prompt-file", required=True)
    ap.add_argument(
        "--done",
        required=True,
        help="shell command; exit 0 means the role is finished. "
        'e.g. \'test -z "$(git status --porcelain)"\'',
    )
    ap.add_argument(
        "--max-retries",
        type=int,
        default=6,
        help="give up after this many provider auto-retries. Without a ceiling "
        "a failing provider burns the whole --timeout budget in silence.",
    )
    ap.add_argument(
        "--nudge-file",
        required=True,
        help="message sent back to the agent when --done fails. "
        "{{done_output}} in it is replaced by what --done printed, so the "
        "nudge can report the actual state instead of restating the role file.",
    )
    ap.add_argument("--max-nudges", type=int, default=2)
    ap.add_argument(
        "--idle-timeout",
        type=int,
        default=600,
        help="seconds with no event before giving up (default 600)",
    )
    ap.add_argument(
        "--timeout",
        type=int,
        default=2700,
        help="total wall-clock seconds (default 2700)",
    )
    ap.add_argument("--cwd", default=os.getcwd())
    ap.add_argument("--log", help="write every raw RPC event line here")
    ap.add_argument(
        "--quiet",
        action="store_true",
        help="do not stream the model's text to stderr",
    )
    ap.add_argument("pi", nargs=argparse.REMAINDER)
    args = ap.parse_args()

    pi_cmd = args.pi
    if pi_cmd and pi_cmd[0] == "--":
        pi_cmd = pi_cmd[1:]
    if not pi_cmd:
        log("pi-driver: no pi command given; put it after --")
        return 4

    prompt = open(args.prompt_file).read()
    nudge_template = open(args.nudge_file).read()

    # If it is already done before the agent runs, the check is vacuous and we
    # would never learn anything. Say so rather than exiting 0 on nothing.
    rc, out = run_check(args.done, args.cwd)
    if rc == 0:
        log("pi-driver: WARNING --done already passes before the agent ran.")
        log("pi-driver: a gate that is green before the work starts is not a gate.")

    logf = open(args.log, "wb") if args.log else None

    log(f"pi-driver: {' '.join(pi_cmd)}")
    proc = subprocess.Popen(
        pi_cmd,
        cwd=args.cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=None,  # pi's own diagnostics go straight to the job log
        bufsize=0,
    )

    def send(obj):
        proc.stdin.write((json.dumps(obj) + "\n").encode())
        proc.stdin.flush()

    framer = Framer()
    started = time.time()
    last_event = time.time()
    nudges = 0
    retries = 0
    tool_errors = 0
    stop_reasons = []
    verdict = None
    tools = []
    streaming_text = False

    send({"id": "run", "type": "prompt", "message": prompt})

    try:
        while verdict is None:
            now = time.time()
            if now - started > args.timeout:
                log(f"\npi-driver: total timeout after {args.timeout}s")
                verdict = 2
                break
            if now - last_event > args.idle_timeout:
                log(f"\npi-driver: no events for {args.idle_timeout}s")
                verdict = 2
                break

            budget = min(
                args.timeout - (now - started), args.idle_timeout - (now - last_event)
            )
            r, _, _ = select.select([proc.stdout], [], [], min(5.0, max(0.5, budget)))
            if not r:
                if proc.poll() is not None:
                    log("\npi-driver: pi exited before the run settled")
                    verdict = 3
                    break
                continue

            chunk = proc.stdout.read1(65536) if hasattr(proc.stdout, "read1") else proc.stdout.read(1)
            if not chunk:
                log("\npi-driver: pi closed stdout before the run settled")
                verdict = 3
                break

            for raw in framer.feed(chunk):
                last_event = time.time()
                if logf:
                    logf.write(raw + b"\n")
                    logf.flush()
                try:
                    ev = json.loads(raw)
                except json.JSONDecodeError:
                    log(f"\npi-driver: not JSON on stdout: {raw[:200]!r}")
                    verdict = 3
                    break

                t = ev.get("type")

                if t == "response" and ev.get("success") is False:
                    log(f"\npi-driver: command {ev.get('command')} failed: {ev.get('error')}")
                    verdict = 3
                    break

                if t == "message_update" and not args.quiet:
                    d = ev.get("assistantMessageEvent") or {}
                    if d.get("type") == "text_delta":
                        sys.stderr.write(d.get("delta", ""))
                        sys.stderr.flush()
                        streaming_text = True
                    elif d.get("type") == "toolcall_start":
                        tools.append(d.get("toolName"))

                elif t == "tool_execution_start":
                    if streaming_text:
                        sys.stderr.write("\n")
                        streaming_text = False
                    name = ev.get("toolName")
                    detail = ""
                    a = ev.get("args") or {}
                    if name == "bash":
                        detail = " " + str(a.get("command", ""))[:120]
                    elif a.get("path"):
                        detail = " " + str(a["path"])
                    log(f"  · {name}{detail}")

                elif t == "tool_execution_end" and ev.get("isError"):
                    # The agent sees this text and we did not, which is how a
                    # command that failed for a fixable reason — a missing
                    # binary, a wrong path — looked from the outside exactly
                    # like a model that had stopped trying (`NOTES.md` 38).
                    log(f"  ! {ev.get('toolName')} failed: {tool_error_text(ev)}")
                    tool_errors += 1

                elif t == "message_end":
                    # `stopReason` is the model's own account of why it stopped.
                    # "length" means the reply was truncated mid-thought, which
                    # is indistinguishable from a finished one in the text —
                    # and "error"/"aborted" mean the turn did not happen at all.
                    reason = (ev.get("message") or {}).get("stopReason")
                    if reason and reason not in ("stop", "toolUse"):
                        log(f"  ! turn ended on stopReason={reason}")
                        stop_reasons.append(reason)

                elif t == "auto_retry_start":
                    retries += 1
                    log(f"  ~ auto-retry {retries}/{args.max_retries} (transient provider error)")
                    if retries > args.max_retries:
                        # Without this the run sits here until --timeout fires,
                        # spending the whole budget learning nothing. A provider
                        # that has failed this many times will not recover
                        # inside one job.
                        log(
                            f"pi-driver: {retries} provider retries is past "
                            f"--max-retries {args.max_retries}. Giving up."
                        )
                        verdict = 5
                        break

                elif t == "compaction_start":
                    log("  ~ compacting context")

                elif t == "extension_error":
                    log(f"  ! extension error: {ev.get('error')}")

                elif t == "agent_settled":
                    if streaming_text:
                        sys.stderr.write("\n")
                        streaming_text = False
                    rc, out = run_check(args.done, args.cwd)
                    if rc == 0:
                        log("pi-driver: settled, and --done passes.")
                        verdict = 0
                        break
                    if nudges >= args.max_nudges:
                        log(
                            f"pi-driver: settled with --done still failing "
                            f"after {nudges} nudge(s). Giving up."
                        )
                        if out:
                            log(f"pi-driver: --done said: {out[:800]}")
                        verdict = 1
                        break
                    nudges += 1
                    log(
                        f"pi-driver: settled but --done failed "
                        f"(nudge {nudges}/{args.max_nudges})."
                    )
                    if out:
                        log(f"pi-driver: --done said: {out[:800]}")
                    # The agent is idle here, so a plain `prompt` is the
                    # documented way to grant another turn. `follow_up` is for
                    # queueing while it is still streaming.
                    send({
                        "type": "prompt",
                        "message": nudge_template.replace(
                            "{{done_output}}", out or "(the check printed nothing)"
                        ),
                    })
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        try:
            proc.wait(timeout=15)
        except subprocess.TimeoutExpired:
            proc.send_signal(signal.SIGTERM)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
        if logf:
            logf.close()

    if tools:
        counts = {}
        for n in tools:
            counts[n] = counts.get(n, 0) + 1
        log("pi-driver: tools used — " + ", ".join(f"{k}×{v}" for k, v in counts.items()))
    # Everything the job log needs to tell a bad run from a slow one, on one
    # line. The three parallel runs on 2026-09-16 each had all of this and none
    # of it was written down, so the only symptom was the wall clock.
    health = [f"{nudges} nudge(s)"]
    if retries:
        health.append(f"{retries} provider retr{'y' if retries == 1 else 'ies'}")
    if tool_errors:
        health.append(f"{tool_errors} tool error(s)")
    if stop_reasons:
        health.append("stopReason " + ",".join(sorted(set(stop_reasons))))
    log(f"pi-driver: exit {verdict} after {int(time.time() - started)}s, " + ", ".join(health))
    return verdict if verdict is not None else 3


if __name__ == "__main__":
    sys.exit(main())
