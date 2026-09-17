/**
 * The root of trust, guarded at the moment it is touched.
 *
 * Goes in the TARGET repo at `.pi/extensions/protect.ts`.
 *
 * `review.yml`'s deterministic risk check already escalates a diff touching
 * these paths, and that is the control. This is the *in-loop* half of the same
 * rule: `CONTEXT.md` distinguishes a gate the agent can still act on from one
 * that fires after the work is published, and only the first teaches the agent
 * anything. Escalating a lockfile edit after a 900-second run wastes the run;
 * refusing the write costs a turn and the agent picks another approach.
 *
 * Adapted from Pi's own `examples/extensions/protected-paths.ts`, with three
 * changes: the list is this repository's root of trust rather than a generic
 * one, the reason names the ADR so the model can reason about it, and it is
 * silent about `ctx.ui` because no role here runs with a UI.
 *
 * WHAT THIS IS NOT. It is hygiene, not containment. Every role holds `bash`,
 * and `bash` writes files — `echo x > .pi/settings.json` sails straight past
 * this. Pi's `security.md` is explicit that project trust "is not a sandbox",
 * and the real controls are elsewhere: the App's token has no ruleset bypass,
 * CODEOWNERS covers `/.github/**`, and the risk check escalates the diff. This
 * closes the accident, not the attack.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Matched against the path the tool was given, normalised to forward slashes. */
const PROTECTED: { pattern: RegExp; why: string }[] = [
	{ pattern: /(^|\/)\.github\//, why: "the workflows are the root of trust" },
	{ pattern: /(^|\/)\.githooks\//, why: "the local gates are the root of trust" },
	{ pattern: /(^|\/)\.agents\//, why: "role instructions are the root of trust" },
	{
		pattern: /(^|\/)\.pi\//,
		why: "`.pi/` decides what finishing means and runs with full system permissions",
	},
	{ pattern: /(^|\/)CODEOWNERS$/, why: "CODEOWNERS routes work to a human" },
	{ pattern: /(^|\/)AGENTS\.md$/, why: "AGENTS.md is the repository's shared context" },
	{
		pattern: /(^|\/)(package\.json|pnpm-lock\.yaml)$/,
		why: "dependency changes are human work (`0002`)",
	},
];

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

		const raw = (event.input as { path?: unknown }).path;
		if (typeof raw !== "string") return undefined;
		const path = raw.replace(/\\/g, "/");

		const hit = PROTECTED.find((p) => p.pattern.test(path));
		if (!hit) return undefined;

		// The reason reaches the model as the block message, so it is written to
		// be acted on rather than merely obeyed: say what it is and what to do.
		return {
			block: true,
			reason:
				`Refused: ${path} is part of this repository's root of trust — ${hit.why}. ` +
				"A diff touching it is escalated to a human before anyone reads it, so " +
				"changing it cannot get your work merged. If the change genuinely " +
				"requires it, stop and write your reason to $RUNNER_TEMP/needs-human.md " +
				"instead — that is a valid ending and does not spend an attempt.",
		};
	});

	console.error(`protect.ts: guarding ${PROTECTED.length} root-of-trust paths against write/edit`);
}
