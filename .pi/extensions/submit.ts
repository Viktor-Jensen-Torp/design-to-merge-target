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

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
						"A clean tree on its own is also true before any work starts. Commit your work.",
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
			"Submit the review. This is the only way to end your run. The event is the verdict: " +
			"APPROVE to merge, REQUEST_CHANGES to send back, COMMENT when you cannot tell or need a question answered.",
		promptSnippet: "Submit the verdict as a pull request review",
		promptGuidelines: [
			"Use submit_review as your final action. It is the only thing that ends a review.",
			"submit_review takes the verdict as its event: APPROVE, REQUEST_CHANGES, or COMMENT.",
			"Put findings about a specific line in submit_review's comments array, anchored to path and line.",
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
			event: StringEnum(["APPROVE", "REQUEST_CHANGES", "COMMENT"] as const, {
				description: "The verdict. APPROVE = merge, REQUEST_CHANGES = rework, COMMENT = unsure.",
			}),
			body: Type.String({ description: "Findings grouped by pass, each tagged [Important] or [Nit]." }),
			comments: Type.Optional(
				Type.Array(
					Type.Object({
						path: Type.String({ description: "File path as the diff shows it." }),
						line: Type.Integer({ description: "Line number in the NEW version of the file." }),
						body: Type.String(),
					}),
					{ description: "Findings about one line each. Omit for findings that are not about a line." },
				),
			),
		}),

		async execute(_id, params) {
			const repo = process.env.PI_REPO;
			const pr = process.env.PI_PR;
			if (!repo || !pr) {
				throw new Error("PI_REPO and PI_PR are not set; the workflow must provide them.");
			}

			const head = await sh(pi, "gh", ["pr", "view", pr, "--repo", repo, "--json", "headRefOid", "--jq", ".headRefOid"]);
			if (head.code !== 0 || !head.out) {
				throw new Error(`Could not read the head SHA of #${pr}: ${head.out}`);
			}

			// `pi.exec` takes no stdin — ExecOptions is {signal, timeout, cwd} and
			// nothing else — so the payload goes to a file and `gh api --input`
			// reads it from there. A review body is far past what is safe to put
			// on a command line in any case.
			const scratch = mkdtempSync(join(tmpdir(), "submit-review-"));
			const payloadPath = join(scratch, "review.json");

			const post = async (body: string, comments: typeof params.comments) => {
				const payload: Record<string, unknown> = {
					commit_id: head.out,
					body,
					event: params.event,
				};
				if (comments?.length) {
					payload.comments = comments.map((c) => ({
						path: c.path,
						line: c.line,
						side: "RIGHT",
						body: c.body,
					}));
				}
				writeFileSync(payloadPath, JSON.stringify(payload));
				const r = await pi.exec("gh", [
					"api",
					`repos/${repo}/pulls/${pr}/reviews`,
					"--method",
					"POST",
					"--input",
					payloadPath,
				]);
				return { ok: (r.code ?? 0) === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
			};

			let anchored = Boolean(params.comments?.length);
			let result: { ok: boolean; out: string };
			try {
				result = await post(params.body, params.comments);

				if (!result.ok && anchored) {
					// Almost always a line outside the diff: GitHub rejects the whole
					// review if one anchor is unusable. Fold the findings into the body
					// and post again — never lose the verdict over a nit's position.
					const folded = (params.comments ?? [])
						.map((c) => `- \`${c.path}:${c.line}\` — ${c.body}`)
						.join("\n");
					anchored = false;
					result = await post(
						`${params.body}\n\n## Findings that could not be anchored\n\n${folded}`,
						undefined,
					);
				}
			} finally {
				rmSync(scratch, { recursive: true, force: true });
			}

			if (!result.ok) {
				throw new Error(`GitHub refused the review: ${result.out}`);
			}

			return {
				content: [
					{ type: "text", text: `Submitted ${params.event} against ${head.out.slice(0, 7)}${anchored ? " with inline comments" : ""}.` },
				],
				details: { event: params.event, commit: head.out, anchored },
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
					"Set PI_ROLE to implementer, rework or reviewer.",
			);
	}
}
