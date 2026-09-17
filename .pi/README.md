---
type: Configuration Guide
title: Pi runtime configuration
description: What lives in the target's .pi/ and why none of it may be turned off casually.
tags:
  - pi
  - config
status: stable
verified:
  by: human:ViktorJT
  at: 2026-09-16
generated:
  by: claude-opus-5
  at: 2026-09-16
---

# `.pi/` — Pi's runtime configuration for this repository

Nothing here is project knowledge. That goes in `AGENTS.md`, which every
harness reads (`docs/adr/0008`).

| file | what it does |
|---|---|
| `settings.json` | retry, timeouts, the built-in tool set, telemetry off |
| `models.json` | sampling and provider routing, per model |
| `extensions/submit.ts` | the terminating tool each role finishes with |
| `extensions/protect.ts` | refuses writes to the root of trust, in-loop |

## `extensions/submit.ts`

`.pi/extensions/` is **auto-discovered** — Pi loads what it finds, and finds
nothing silently. Every workflow therefore asserts the file exists before
running a role, because a role told to call `submit_implementation` in a run
where no such tool was registered is a role told to call nothing.

Which tool it registers comes from `PI_ROLE`, set by the workflow:

| `PI_ROLE` | tool | also needs |
|---|---|---|
| `implementer`, `rework` | `submit_implementation` | `PI_BASE_REF` |
| `reviewer` | `submit_review` | `PI_REPO`, `PI_PR` |
| `gatekeeper` | none, by design | — |

Anything else registers nothing and says so on stderr. `NOTES.md` 44 has the
reasoning and the measurements; `spikes/pi-submit/` is the test.

## `extensions/protect.ts`

Blocks `write` and `edit` against `.github/`, `.githooks/`, `.agents/`, `.pi/`,
`CODEOWNERS`, `AGENTS.md`, `package.json` and `pnpm-lock.yaml`, and tells the
model why and what to do instead. Adapted from Pi's own
`examples/extensions/protected-paths.ts`.

`review.yml`'s risk check is the control and escalates the same paths after the
fact. This is the in-loop half: refusing the write costs a turn, escalating the
diff costs the run.

**It is hygiene, not containment.** Every role holds `bash`, and `bash` writes
files. `security.md` is explicit that project trust is not a sandbox.

Extensions are transpiled, not typechecked. Run the spike after editing this
file — a type error here surfaces as a broken production run, not a build
failure.

## Why this directory did not exist until 2026-09-16

It should have. Three consequences of its absence, all recorded in `NOTES.md`:

- **43** — no sampling parameters were ever sent. Pi only sends them when
  something defines them; OpenRouter omits absent ones upstream rather than
  substituting a default. So the serving provider chose, and a `:free` model
  routes across several of them. Sampling changed between requests inside one
  run.
- **Retries were unbounded in effect.** `retry.provider.maxRetryDelayMs` is what
  makes a provider asking for a long delay fail fast with a message instead of
  waiting silently. Runs sat for minutes.
- **`--approve` was a no-op.** Every workflow passes it to load project
  settings, and `security.md` says a bare `.pi` directory is not a project
  resource requiring trust. There was nothing to trust.

## Trust

Project settings load only after the project is trusted. Non-interactive modes
(`-p`, `--mode json`, `--mode rpc`) never prompt, so the workflows pass
`--approve` to trust project-local files for that run. Without it this directory
is ignored and nothing here applies — silently.
