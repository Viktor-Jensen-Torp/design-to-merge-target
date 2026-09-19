/**
 * Finishing is an act, not an inference.
 *
 * Goes in the TARGET repo at `.pi/extensions/submit.ts`.
 *
 * Every role in this pipeline ends by doing something specific: the implementer
 * commits, the reviewer submits a verdict, the gatekeeper merges or escalates.
 * Until now none of them DECLARED that; the workflow inferred it afterwards from
 * repository state, and when the inference failed the run was wasted
 * (`NOTES.md` 27, 29, 39, 40).
 *
 * Pi's answer is a tool that returns `terminate: true`
 * (`examples/extensions/structured-output.ts`). The agent finishes by calling
 * it. Three things follow that we could not get any other way:
 *
 *   1. The arguments are a typebox schema, validated before `execute` runs.
 *      A malformed verdict is rejected and handed back to the model in-band,
 *      instead of being parsed out of a file by a script afterwards.
 *   2. `throw` from `execute` marks the result as an error and tells the model
 *      why. The role can be corrected without another workflow run.
 *   3. The run ends without paying for one more assistant turn.
 *
 * This does NOT replace `scripts/pi-driver.py`. The driver still checks the
 * repository, because a model that has decohered cannot be relied on to call
 * anything at all — twice on 2026-09-16 the driver's nudge was the only thing
 * that restarted one (`NOTES.md` 38). The tool is how a working agent says it
 * is done; the driver is what catches one that cannot say anything.
 *
 * Which tool is registered comes from `PI_ROLE` in the environment, so one file
 * serves every role and there is no second copy to disagree with the first.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Shell out, returning trimmed stdout and the exit code. */
async function sh(pi: ExtensionAPI, cmd: string, args: string[]): Promise<{ out: string; code: number }> {
	const r = await pi.exec(cmd, args);
	return { out: (r.stdout ?? "").trim(), code: r.code ?? 0 };
}

/**
 * The implementer and the rework role share this. Its terminal condition is the
 * one `implement.yml` and `rework.yml` already assert: a clean tree AND work on
 * the branch. Asserting it HERE means the agent learns it failed while it can
 * still act, rather than after the job has moved on.
 */
function implementationTool(pi: ExtensionAPI) {
	return defineTool({
		name: "submit_implementation",
		label: "Submit Implementation",
		description:
			"Declare the work finished. Call this as your final action, after committing. " +
			"It verifies the working tree is clean and that there is a commit on this branch, " +
			"and refuses if either is untrue.",
		promptSnippet: "Declare the implementation finished once it is committed",
		promptGuidelines: [
			"Use submit_implementation as your final action, after the gates pass and you have committed.",
			"submit_implementation refuses if the working tree is dirty or the branch has no new commit; fix that and call it again.",
			// The role file has said "do not read your files back" since the
			// morning of 2026-09-17 and the implementer did it anyway, twice
			// on three consecutive runs. Saying it here puts it beside
			// the tool the model is about to reach for, rather than in a long
			// document it read once.
			"When the gates pass, call submit_implementation immediately. Do not read back files you wrote, do not re-run a gate that already passed, and do not diff a file you never touched — the gates already checked all of it.",
		],
		parameters: Type.Object({
			summary: Type.String({
				description: "One or two sentences: what changed and why it satisfies the issue.",
			}),
		}),

		async execute(_id, params) {
			const status = await sh(pi, "git", ["status", "--porcelain"]);
			if (status.out.length > 0) {
				throw new Error(
					`The working tree is not clean, so this is not finished:\n${status.out}\n` +
						"Commit everything, then call submit_implementation again.",
				);
			}

			const base = process.env.PI_BASE_REF || "origin/develop";
			const ahead = await sh(pi, "git", ["rev-list", "--count", `${base}..HEAD`]);
			if (ahead.code !== 0) {
				throw new Error(`Could not compare against ${base}: ${ahead.out}`);
			}
			if (ahead.out === "0") {
				throw new Error(
					`The tree is clean but there is no commit beyond ${base}. ` +
						"A clean tree on its own is also true before any work starts. Commit your work. " +
						// `0022`: on round 2 of #96 rework correctly found nothing to change,
						// was refused here three times, and the run failed (`NOTES.md` 83).
						"If you are reworking and the findings are already addressed or wrong, so there is genuinely nothing to change, " +
						"do not invent a change: write why to the needs-human file your prompt names, and stop.",
				);
			}

			return {
				content: [
					{ type: "text", text: `Submitted: ${ahead.out} commit(s) on this branch. ${params.summary}` },
				],
				details: { commits: Number(ahead.out), summary: params.summary },
				terminate: true,
			};
		},
	});
}

type Finding = {
	severity: "important" | "nit";
	pass: "bugs" | "security" | "compliance";
	text: string;
	example?: string;
	fix?: string;
	path?: string;
	line?: number;
	quote?: string;
};

/**
 * An important finding sends the change to rework, so it has to tell rework
 * what "fixed" means. The first rework of #96 answered findings like "the logic
 * should be explicit" with comments and token changes (`NOTES.md` 78, 79).
 * Every important finding now carries a concrete example (an input, what
 * happens now, and what should happen) and what to change. Nits stay one line.
 */
function missingDetail(findings: Finding[]): string[] {
	return findings.flatMap((f, i) =>
		f.severity !== "important"
			? []
			: [
					...(f.example?.trim() ? [] : [`finding ${i + 1} ("${f.text.slice(0, 50)}") has no example`]),
					...(f.fix?.trim() ? [] : [`finding ${i + 1} ("${f.text.slice(0, 50)}") has no fix`]),
				],
	);
}

/**
 * `0021`: an important finding quotes the code it is about, and the quote must
 * be in that file at the reviewed commit, which is checked out in the working
 * directory. On round 2 of #96 the reviewer repeated its previous review's
 * finding about a line rework had already removed (`NOTES.md` 83). Whitespace
 * is collapsed on both sides, so indentation and line breaks do not matter.
 * Nits are not checked: they do not block.
 */
function unquoted(findings: Finding[], root: string): string[] {
	const squash = (t: string) => t.replace(/\s+/g, " ").trim();
	return findings.flatMap((f, i) => {
		if (f.severity !== "important") return [];
		const at = `finding ${i + 1} ("${f.text.slice(0, 50)}")`;
		if (!f.path?.trim() || !f.quote?.trim()) return [`${at} has no path and quote`];
		const file = join(root, f.path);
		if (!existsSync(file)) return [`${at}: ${f.path} does not exist at this commit`];
		if (!squash(readFileSync(file, "utf8")).includes(squash(f.quote))) {
			return [`${at}: the quote is not in ${f.path} at this commit. Read the file as it is now; it may already be fixed`];
		}
		return [];
	});
}

/** One finding as a reader sees it: the line, then the example and the fix. */
function renderFinding(f: Finding): string {
	const tag = f.severity === "important" ? "Important" : "Nit";
	const where = f.path ? ` (\`${f.path}${f.line ? `:${f.line}` : ""}\`)` : "";
	const lines = [`- [${tag}] ${f.text}${where}`];
	if (f.example?.trim()) lines.push(`  - **Example:** ${f.example.trim()}`);
	if (f.fix?.trim()) lines.push(`  - **Change:** ${f.fix.trim()}`);
	return lines.join("\n");
}

/**
 * The verdict follows from the findings; the reviewer does not choose it
 * (`0018`). Any question stops the chain for a person, even beside an important
 * finding. Otherwise an important finding sends the change back for rework, and
 * otherwise it is approved.
 *
 * On 2026-09-18 a review listed two findings it tagged Important and submitted
 * COMMENT, so the gatekeeper escalated to a person instead of sending it to
 * rework (`NOTES.md` 77). Severity is now a required field on every finding, so
 * an untagged finding cannot exist and the choice cannot be made wrongly.
 * A question wins over an important finding. Sent to rework, the question
 * could vanish from the next review and merge unanswered, or be "answered" in
 * code by the implementer, and the answer may change what the right fix is.
 * Decided with the owner, 2026-09-18.
 */
function verdictFor(findings: Finding[], questions: string[]): "APPROVE" | "REQUEST_CHANGES" | "COMMENT" {
	if (questions.length > 0) return "COMMENT";
	if (findings.some((f) => f.severity === "important")) return "REQUEST_CHANGES";
	return "APPROVE";
}

/** The review body a person reads, grouped by pass. Built here, not written by the model. */
function renderReview(summary: string | undefined, findings: Finding[], questions: string[]): string {
	const titles = { bugs: "Bugs", security: "Security", compliance: "Compliance" } as const;
	const out: string[] = [];
	if (summary?.trim()) out.push(summary.trim(), "");
	if (findings.length === 0) out.push("No findings.");
	for (const pass of ["bugs", "security", "compliance"] as const) {
		const here = findings.filter((f) => f.pass === pass);
		if (here.length === 0) continue;
		out.push(`## ${titles[pass]}`, "");
		for (const f of here) out.push(renderFinding(f));
		out.push("");
	}
	if (questions.length > 0) {
		out.push("## Questions for a person", "");
		for (const q of questions) out.push(`- ${q}`);
	}
	return out.join("\n").trim();
}

/**
 * Replaces `scripts/post-review.py`. The reviewer used to write a JSON file by
 * hand and a Python script parsed it; here the same structure is a schema Pi
 * validates before this code runs, and the failure path is a message to the
 * model rather than a workflow step going red.
 *
 * Inline anchors stay best effort and the verdict does not: GitHub refuses a
 * comment on a line outside the diff, and a model cannot be sure which lines
 * qualify. `0012`.
 */
function reviewTool(pi: ExtensionAPI) {
	return defineTool({
		name: "submit_review",
		label: "Submit Review",
		description:
			"Submit the review. This is the only way to end your run. You do not choose a verdict: " +
			"any question stops the change for a person, otherwise any important finding sends it back for rework, " +
			"otherwise it is approved.",
		promptSnippet: "Submit your findings and questions as a pull request review",
		promptGuidelines: [
			"Use submit_review as your final action. It is the only thing that ends a review.",
			"Give every finding a severity: important if it must change before this merges, nit otherwise. The verdict follows from these.",
			"Put a finding about one line on that line with path and line. Put questions you cannot settle yourself in questions.",
			// 2026-09-18, #96: a review asked a person whether its own important
			// findings should be fixed, which stopped the chain for nothing
			// (`NOTES.md` 78). Stated here as well as in the role file (NOTES 57).
			"A question is only for what a person must decide: intent, scope, or a trade-off. Never ask whether your own findings should be fixed; an important finding is rework, not a question.",
			"Every important finding needs an example (the input, what happens now, what should happen) and a fix (what to change). submit_review refuses one without them.",
			"When the code is checked out, every important finding also needs path and quote: a few lines copied exactly from that file as it is now. submit_review refuses a quote that is not there, because the code may already be fixed.",
		],
		parameters: Type.Object({
			// `StringEnum`, not `Type.Union([Type.Literal(…)])`. The union form
			// emits `anyOf`/`const`; this emits `{type:"string", enum:[…]}`,
			// which every provider accepts. Pi's own examples call the union
			// form out as incompatible with Google, and while Pi's direct
			// Google path does handle it via `parametersJsonSchema`, ours goes
			// through OpenRouter as `openai-completions` and nothing promises
			// the shape survives. The portable form costs nothing, so there is
			// no trade to make.
			summary: Type.Optional(
				Type.String({ description: "Anything a reader needs that is not a finding, such as a suspicion about the plan." }),
			),
			findings: Type.Array(
				Type.Object({
					severity: StringEnum(["important", "nit"] as const, {
						description: "important: must change before this merges. nit: worth saying, does not block.",
					}),
					pass: StringEnum(["bugs", "security", "compliance"] as const),
					text: Type.String({ description: "What is wrong, in one or two sentences." }),
					example: Type.Optional(
						Type.String({
							description:
								"Required for important: a concrete case — the input, what happens now, and what should happen.",
						}),
					),
					fix: Type.Optional(
						Type.String({ description: "Required for important: what to change, specifically enough to act on." }),
					),
					path: Type.Optional(Type.String({ description: "File path as the diff shows it, for a finding about a line." })),
					line: Type.Optional(Type.Integer({ description: "Line number in the NEW version of the file." })),
					quote: Type.Optional(
						Type.String({
							description:
								"Required for important when the code is checked out: the code the finding is about, copied exactly from path as it is now. For something missing, quote the nearest code that is there.",
						}),
					),
				}),
				{ description: "Every finding, each with its severity. An empty list means nothing to report." },
			),
			questions: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Only what a person must decide: intent, scope, or a trade-off. Never whether your own findings should be fixed. Any question stops the change until a person answers.",
				}),
			),
		}),

		async execute(_id, params) {
			const findings = params.findings as Finding[];
			const missing = missingDetail(findings);
			if (missing.length) {
				throw new Error(
					`Nothing was posted. Every important finding needs an example and a fix, because rework acts on them:\n- ${missing.join("\n- ")}\n` +
						"Add them, or mark the finding a nit if it does not need to change before merging. Call submit_review again.",
				);
			}
			// `PI_HEAD_SHA` is set only by a review.yml that checks the reviewed
			// commit out (`0021`). An older review.yml sets neither, so the quote
			// check and the pinning below stay off until it is released (`0019`).
			const pinned = process.env.PI_HEAD_SHA?.trim();
			if (pinned) {
				const bad = unquoted(findings, process.cwd());
				if (bad.length) {
					throw new Error(
						`Nothing was posted. An important finding must quote the code it is about, as it is at this commit:\n- ${bad.join("\n- ")}\n` +
							"Fix the quote, or drop the finding if the code no longer has the problem. Call submit_review again.",
					);
				}
			}
			const questions = (params.questions ?? []).filter((q) => q.trim());
			const event = verdictFor(findings, questions);
			const body = renderReview(params.summary, findings, questions);
			const inline = findings
				.filter((f) => f.path && f.line)
				.map((f) => ({ path: f.path as string, line: f.line as number, body: renderFinding(f).replace(/^- /, "") }));

			const repo = process.env.PI_REPO;
			const pr = process.env.PI_PR;
			if (!repo || !pr) {
				throw new Error("PI_REPO and PI_PR are not set; the workflow must provide them.");
			}

			// `0020`: the review is about the commit the run was started for, not
			// whatever the head is when it posts. Reading the head here stamped a
			// review of one commit with another if a push landed mid-review.
			const head = pinned
				? { out: pinned, code: 0 }
				: await sh(pi, "gh", ["pr", "view", pr, "--repo", repo, "--json", "headRefOid", "--jq", ".headRefOid"]);
			if (head.code !== 0 || !head.out) {
				throw new Error(`Could not read the head SHA of #${pr}: ${head.out}`);
			}

			// Checked right before acting (`0020`). A stale review is not posted
			// and is not a failure: the newer commit gets its own review.
			const check = process.env.PI_STILL_CURRENT;
			if (pinned && check) {
				const r = await pi.exec("bash", [check, pr, pinned]);
				const answer = (r.stdout ?? "").trim();
				if (answer === "current=false") {
					return {
						content: [
							{
								type: "text",
								text: `Not posted: ${pinned.slice(0, 7)} is no longer the head of #${pr}. A newer commit has its own review coming. Your run is over.`,
							},
						],
						details: { stale: true, commit: pinned },
						terminate: true,
					};
				}
				if (answer !== "current=true") {
					throw new Error(`Could not check whether ${pinned.slice(0, 7)} is still the head: ${(r.stderr ?? "").trim()}`);
				}
			}

			// `pi.exec` takes no stdin — ExecOptions is {signal, timeout, cwd} and
			// nothing else — so the payload goes to a file and `gh api --input`
			// reads it from there. A review body is far past what is safe to put
			// on a command line in any case.
			const scratch = mkdtempSync(join(tmpdir(), "submit-review-"));
			const payloadPath = join(scratch, "review.json");

			const post = async (text: string, comments: typeof inline | undefined) => {
				const payload: Record<string, unknown> = { commit_id: head.out, body: text, event };
				if (comments?.length) {
					payload.comments = comments.map((c) => ({ path: c.path, line: c.line, side: "RIGHT", body: c.body }));
				}
				writeFileSync(payloadPath, JSON.stringify(payload));
				const r = await pi.exec("gh", ["api", `repos/${repo}/pulls/${pr}/reviews`, "--method", "POST", "--input", payloadPath]);
				return { ok: (r.code ?? 0) === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
			};

			let anchored = inline.length > 0;
			// Initialised rather than declared: Pi transpiles extensions without
			// typechecking, so a definite-assignment mistake here would surface
			// as a runtime error in production rather than a build failure.
			let result: { ok: boolean; out: string } = { ok: false, out: "not attempted" };
			try {
				result = await post(body, inline);
				if (!result.ok && anchored) {
					// Usually a line outside the diff: GitHub rejects the whole review
					// if one anchor is unusable. The body already lists every finding
					// with its path and line, so post it alone and say why the inline
					// comments are missing, rather than losing the verdict. This
					// branch also catches a 403 or a network fault, so the reason is
					// always shown.
					const why = result.out.slice(0, 300) || "(GitHub gave no reason)";
					anchored = false;
					result = await post(
						`${body}\n\n<sub>Inline comments were refused, so the findings above carry their lines instead. GitHub said: ${why}</sub>`,
						undefined,
					);
				}
			} finally {
				rmSync(scratch, { recursive: true, force: true });
			}

			if (!result.ok) {
				throw new Error(`GitHub refused the review: ${result.out}`);
			}

			const why = event === "COMMENT" ? "a question for a person" : event === "REQUEST_CHANGES" ? "an important finding" : "no question and no important finding";
			return {
				content: [
					{
						type: "text",
						text: `Submitted ${event} against ${head.out.slice(0, 7)}, because of ${why}${anchored ? ", with inline comments" : ""}.`,
					},
				],
				details: { event, commit: head.out, anchored },
				terminate: true,
			};
		},
	});
}

/**
 * The refiner decides and the workflow acts (`0016`).
 *
 * This tool writes no issue. It validates the refiner's decisions and records
 * them in `PI_REPORT`. `refine.yml` applies them afterwards with a separate
 * token that can write. The agent's own token is read-only, so "investigate
 * read-only" is a property of the token, not an instruction the model is
 * trusted to follow.
 *
 * Everything the refiner may do has a field here, and nothing else does. There
 * is no label field, so `active:agent` cannot be applied by construction.
 * `PI_BATCH` holds the issue numbers the workflow gave it, and a decision about
 * any other issue is refused. Gated issues are never in the batch.
 */

/**
 * True when a body keeps a Problem section with something under it (`0015`).
 * `shape.yml` applies the same rule to every issue. Change them together.
 */
function hasProblem(body: string): boolean {
	const lines = body.split(/\r?\n/);
	const at = lines.findIndex((l) => /^#{1,6}\s*problem\s*:?\s*$/i.test(l.trim()));
	if (at < 0) return false;
	for (const l of lines.slice(at + 1)) {
		const t = l.trim();
		if (/^#{1,6}\s/.test(t)) return false;
		if (t && t !== "_No response_") return true;
	}
	return false;
}

function refinementTool() {
	const Priority = StringEnum(["Urgent", "High", "Medium", "Low"] as const);
	const Effort = StringEnum(["High", "Medium", "Low"] as const);
	const Numbers = Type.Array(Type.Integer({ minimum: 1 }));

	return defineTool({
		name: "submit_refinement",
		label: "Submit Refinement",
		description:
			"Record every decision from this run in one call. This is the only way to end your run. " +
			"List only issues you are changing or proposing something for; list issues you judge ready in `ready`. " +
			"An empty `issues` list is a correct answer when nothing needs refining.",
		promptSnippet: "Record the refinement decisions and end the run",
		promptGuidelines: [
			"Use submit_refinement once, as your final action, with every decision from this run.",
			"submit_refinement changes nothing itself. The workflow applies your decisions after you stop, so do not try to edit issues with gh.",
			"If nothing needs refining, call submit_refinement with an empty issues list. That is a correct outcome, not a failure.",
			// The first real run read the same six files about fifteen times each
			// and never submitted (`NOTES.md` 71). The role file says it too, but
			// NOTES 57 is why it also goes here: beside the tool, where the model
			// looks before it acts.
			"Once you know what each issue needs, call submit_refinement. Do not re-read a file you have already read; your tool results are complete and nothing is truncated.",
		],
		parameters: Type.Object({
			summary: Type.String({ description: "Two or three sentences on what this run found." }),
			ready: Type.Array(Type.Integer({ minimum: 1 }), {
				description: "Issues you judge ready for a person to gate with active:agent.",
			}),
			issues: Type.Array(
				Type.Object({
					number: Type.Integer({ minimum: 1 }),
					reason: Type.String({ description: "Why, in one or two sentences. Shown in the run summary." }),
					title: Type.Optional(Type.String({ description: "The new title, in full." })),
					body: Type.Optional(
						Type.String({ description: "The new body, in full. It must keep the Problem section." }),
					),
					priority: Type.Optional(Priority),
					effort: Type.Optional(Effort),
					add_blocked_by: Type.Optional(Numbers),
					remove_blocked_by: Type.Optional(Numbers),
					duplicate_of: Type.Optional(
						Type.Integer({ minimum: 1, description: "Close this issue as a duplicate of that one." }),
					),
					propose_split: Type.Optional(
						Type.String({ description: "The split you propose, as a comment. A person decides." }),
					),
					propose_spike: Type.Optional(
						Type.String({ description: "The question that needs running, and what would answer it." }),
					),
				}),
			),
		}),

		async execute(_id, params) {
			const reportPath = process.env.PI_REPORT;
			const batchPath = process.env.PI_BATCH;
			if (!reportPath || !batchPath) {
				throw new Error("PI_REPORT and PI_BATCH are not set; the workflow must provide them.");
			}
			const batch = new Set<number>(JSON.parse(readFileSync(batchPath, "utf8")));

			const problems: string[] = [];
			const outside = (n: number) => !batch.has(n);

			for (const n of params.ready) {
				if (outside(n)) problems.push(`#${n} is in \`ready\` but was not in this run's batch.`);
			}

			const seen = new Set<number>();
			for (const d of params.issues) {
				const n = d.number;
				const at = `#${n}`;
				if (outside(n)) problems.push(`${at} was not in this run's batch. You may only decide about issues you were given.`);
				if (seen.has(n)) problems.push(`${at} appears twice. Put every decision about one issue in one entry.`);
				seen.add(n);

				const changes = [
					d.title, d.body, d.priority, d.effort, d.duplicate_of, d.propose_split, d.propose_spike,
					d.add_blocked_by?.length ? d.add_blocked_by : undefined,
					d.remove_blocked_by?.length ? d.remove_blocked_by : undefined,
				].filter((v) => v !== undefined);
				if (changes.length === 0) {
					problems.push(`${at} changes nothing. List it in \`ready\` if it is ready, or leave it out.`);
				}
				if (d.title !== undefined && !d.title.trim()) problems.push(`${at}: an empty title.`);
				if (d.body !== undefined && !hasProblem(d.body)) {
					problems.push(`${at}: the new body has no Problem section with content under it. Keep the author's Problem section (\`0015\`).`);
				}
				if (d.duplicate_of !== undefined) {
					if (d.duplicate_of === n) problems.push(`${at} cannot be a duplicate of itself.`);
					if (changes.length > 1) problems.push(`${at}: an issue closed as a duplicate takes no other change.`);
				}
				for (const m of [...(d.add_blocked_by ?? []), ...(d.remove_blocked_by ?? [])]) {
					if (m === n) problems.push(`${at} cannot be blocked by itself.`);
				}
				const both = (d.add_blocked_by ?? []).filter((m) => (d.remove_blocked_by ?? []).includes(m));
				if (both.length) problems.push(`${at} both adds and removes blocked-by ${both.map((m) => `#${m}`).join(", ")}.`);
				for (const [k, v] of [["propose_split", d.propose_split], ["propose_spike", d.propose_spike]] as const) {
					if (v !== undefined && !v.trim()) problems.push(`${at}: ${k} is empty.`);
				}
				if (params.ready.includes(n) && (d.duplicate_of !== undefined || d.propose_split !== undefined || d.propose_spike !== undefined)) {
					problems.push(`${at} cannot be ready and also be a duplicate, need a split, or need a spike.`);
				}
			}

			if (problems.length) {
				throw new Error(`Nothing was recorded. Fix these and call submit_refinement again:\n- ${problems.join("\n- ")}`);
			}

			writeFileSync(reportPath, JSON.stringify(params, null, 2));
			const n = params.issues.length;
			return {
				content: [
					{
						type: "text",
						text: n
							? `Recorded decisions for ${n} issue(s) and ${params.ready.length} ready. The workflow applies them after you stop.`
							: `Recorded: nothing to refine, ${params.ready.length} ready.`,
					},
				],
				details: { issues: n, ready: params.ready.length },
				terminate: true,
			};
		},
	});
}

export default function (pi: ExtensionAPI) {
	const role = (process.env.PI_ROLE ?? "").trim();

	// An unknown role registers nothing. Silence here would be the failure this
	// repository keeps hitting, so say so loudly instead — the workflow asserts
	// on the startup output.
	switch (role) {
		case "implementer":
		case "rework":
			pi.registerTool(implementationTool(pi));
			console.error(`submit.ts: registered submit_implementation for role "${role}"`);
			break;
		case "reviewer":
			pi.registerTool(reviewTool(pi));
			console.error('submit.ts: registered submit_review for role "reviewer"');
			break;
		case "refiner":
			pi.registerTool(refinementTool());
			// The refiner never needs a text-only turn: every turn is a read or
			// the submit. On 2026-09-18 nex-n2.5-pro reached the right answer and
			// wrote submit_refinement's arguments out as TEXT, three times
			// identically at temperature 0, until the nudges ran out (`NOTES.md`
			// 75). `tool_choice: "required"` makes a text answer impossible.
			// The provider must support it: `require_parameters: true` routes
			// only to providers honouring every parameter sent, so an
			// unsupported one fails loudly rather than being ignored.
			pi.on("before_provider_request", (event) => {
				const payload = event.payload as Record<string, unknown>;
				if (Array.isArray(payload?.tools) && payload.tools.length > 0) {
					return { ...payload, tool_choice: "required" };
				}
				return undefined;
			});
			console.error('submit.ts: registered submit_refinement for role "refiner", with tool_choice "required"');
			break;
		case "gatekeeper":
			// Deliberately none. The gatekeeper's finish is a merge or an
			// escalation, both of which are `gh` calls the workflow can see
			// afterwards; there is nothing for a tool to assert that the
			// driver's --done check does not already assert better.
			console.error('submit.ts: role "gatekeeper" registers no submit tool, by design');
			break;
		default:
			console.error(
				`submit.ts: PI_ROLE is "${role || "(unset)"}" — no submit tool registered. ` +
					"Set PI_ROLE to implementer, rework, reviewer or refiner.",
			);
	}
}
