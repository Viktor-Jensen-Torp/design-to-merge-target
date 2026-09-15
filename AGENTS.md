# AGENTS.md

Read this first. It is the one file every agent and every person working in this
repository gets — Pi, Claude Code, Cursor, and you (`docs/adr/0008` in the
design repo).

Project knowledge goes here. Not in `.pi/settings.json`, which only Pi reads.

## What this is

A small Next.js and TypeScript web application. It exists to be the target of
the agentic Design-to-Merge pipeline — the code agents actually change — so it
is deliberately ordinary. `lib/slug.ts` is the seed: small, tested, and
incomplete on purpose.

## Commands

Everything runs from the repository root.

| | |
|---|---|
| `pnpm install` | dependencies — **humans only**, see below |
| `pnpm lint` | eslint |
| `pnpm format:check` | prettier, check only |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | unit tests, Vitest |
| `pnpm build` | production build |

There is **no `test:e2e` and no mutation testing yet** — Playwright and Stryker
are not installed. `.github/workflows/ci.yml` says the same. When they land,
both jobs come back from the design repo rather than being stubbed, because a
job that exits 0 without checking anything is worse than no job.

A healthy `pnpm test` ends with a line like `Test Files  12 passed (12)`.
A healthy `pnpm typecheck` ends with `tsc` printing nothing and exiting 0. It
runs `next typegen` first: route and layout types are generated, not written by
hand, and `tsc` alone cannot see them on a clean checkout.

## Rules

**Do not change dependencies.** No `pnpm add`, no edits to `package.json` or
`pnpm-lock.yaml`. An issue that needs a new package is human work and stops
here — say so and stop rather than working around it. Any diff touching those
files is escalated to a human automatically, so doing it anyway only wastes a
run.

**Do not touch the gates.** `.github/`, `.githooks/`, `.agents/`, `CODEOWNERS`
and this file are the root of trust. Changing them is a human decision, and a
diff that touches them is escalated before anyone reads it.

**Never loosen a gate to get a build green.** Not a skipped test, not a widened
lint rule, not a `// @ts-expect-error`. If a gate is wrong, say so and stop.

**Commit, do not push.** The workflow pushes and opens the pull request.

## Conventions

- TypeScript, strict. No `any`; use `unknown` and narrow.
- Tests live next to the code they test, `*.test.ts`.
- Components are functions, not classes.
- No file over ~300 lines without a reason.

<!-- Add project-specific conventions as they are decided, not as they are
     imagined. A convention nobody has needed yet is noise in every context
     window from now on. -->

## Corrections

**This section is the pipeline's only memory.** When a review flags the same
mistake twice, the correction is written here, and every run after that reads
it. One occurrence is a mistake; two is a pattern (`PRD.md`, "What the pipeline
learns").

Keep each one short, concrete, and about this repository. Delete any that stop
being true.

<!-- Example of the shape:
- Use the `cn()` helper in `src/lib/cn.ts` for class names. Do not import
  `clsx` directly — it is a transitive dependency and not ours to depend on.
-->

*(nothing yet)*

## Local setup

    pnpm install
    git config core.hooksPath .githooks

The second line is not optional. The hooks in `.githooks/` are the same gates CI
runs, and they are what stop a broken commit becoming a red build five minutes
later. Agents get them armed by the workflow; people have to run this once.
