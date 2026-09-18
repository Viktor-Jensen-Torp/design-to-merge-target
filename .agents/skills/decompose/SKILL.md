---
name: decompose
description: Turn a design (.pen) or document change in this repository into a set of GitHub issues, with a person steering every step. Use when a design or docs change needs to become work for the pipeline.
---

# Decompose

Turn a design or document change into issues. This is a conversation with a
person, not a batch job: deciding how work divides is exactly the part this
repository decided a model should not do alone (`docs/adr/0015`). You read and
propose; the person decides.

## 1. Read the change

Start from what changed, not from the whole design:

    git diff <base>..<head> -- design/ docs/

A `.pen` file is JSON. Copy is in `content` fields. Its `variables` and `themes`
are a **durable contract** (`0001`): implementers read them as constraints, and
they are never turned into issues. Frames and copy behave like a backlog, and
those are what you decompose.

## 2. Propose the split before writing anything

List the issues you would create, one line each:

- each one reviewable as **one pull request**;
- in the order they can land, noting which cannot start before another;
- with anything that needs a dependency change marked as human work (`0002`).

Ask the person to confirm, merge, split or drop items. Do not create anything
until they agree. If you are unsure where a boundary goes, say so rather than
guessing.

## 3. Write each issue

Use the *write-an-issue* skill for every agreed piece. It holds the contract:
Problem, Acceptance criteria, Out of scope, Open questions, Context. In Context,
link the pull request that changed the design. Do not cite a file path and
commit as the source of truth (`0001`).

Leave Priority and Effort to refinement unless the person already knows them.
**Never add `ready-to-develop`.** A person gates each issue after refinement.

## 4. Link them

When one issue cannot start until another lands, record it on the **blocked**
issue. The API names the blocker by its id, not its number:

    gh api repos/<owner>/<repo>/issues/<blocked>/dependencies/blocked_by \
      -F issue_id=$(gh api repos/<owner>/<repo>/issues/<blocker> --jq .id)

When the change is large enough to be an epic, create a parent issue for it and
add each piece as a sub-issue:

    gh api repos/<owner>/<repo>/issues/<parent>/sub_issues \
      -F sub_issue_id=$(gh api repos/<owner>/<repo>/issues/<child> --jq .id)

## 5. Hand over

Tell the person what was created, with links, and what is blocked by what. The
refiner picks the issues up on its next nightly run.
