---
name: write-an-issue
description: Write one GitHub issue for this repository in its issue contract (Problem, Acceptance criteria, Out of scope, Open questions, Context). Use when creating or rewriting a single issue, including each piece of a decomposition.
---

# Write an issue

An issue here is one piece of work, small enough to review as **one pull
request**. People write issues; the pipeline refines, implements and reviews
them. This is the shape every issue has, whoever writes it (`docs/adr/0015`).

## The sections

Write them as `### ` headings, exactly as named. The shape check and the refiner
read those headings, and an issue without a Problem section is labelled
`needs:shape` until it has one.

- **Problem** (required). What is wrong or missing, and for whom. Describe the
  need, not the fix.
- **Acceptance criteria**. What done means, written so each line can be tested.
  The implementer is judged against these and nothing else. It is fine to leave
  them rough; refinement sharpens them.
- **Out of scope**. What this issue deliberately does not do. This stops the
  implementer from being helpful in the wrong direction.
- **Open questions**. What is not yet known. Put them here rather than guessing:
  this is where refinement starts, and a question that needs something run
  becomes a spike.
- **Context**. Links to designs, documents, pull requests and discussion.

## What does not go in the body

- **Priority and Effort.** They are issue fields, set during refinement. Set
  them in the sidebar if you already know them.
- **A plan.** The implementer writes its plan in the pull request (`0007`).
- **A spec path or commit as the source of truth** (`0001`). Link the pull
  request that changed a design, for context, and let the issue stand alone.

## Before you create it

- **One pull request.** If it plainly needs several, it is decomposition, not
  an issue: use the *decompose* skill.
- **Dependencies are human work** (`0002`). If the work needs a package added or
  upgraded, say so in the Problem. A person does that part.
- **Blocked by.** If it cannot start until another issue lands, set that
  relationship in the sidebar, or leave it for the refiner.
- **Assign the person responsible**, usually the owner of the epic it belongs
  to. An assignee means responsible, not working on it.
- **Do not add `active:agent`.** That label is a person's approval that the
  issue is ready for an agent, given after refinement. It is the only gate before
  a pull request exists. If *you* are about to work on it yourself, add
  `active:human` instead, and remove it when you stop.

## Creating it

Write the body to a file and create the issue from it, so the headings survive
exactly:

    gh issue create --title "<a short imperative title>" --body-file issue.md

Show the person the title and body before creating anything.
