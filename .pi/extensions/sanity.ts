/**
 * Refuse a tool call whose arguments have stopped making sense.
 *
 * Goes in the TARGET repo at `.pi/extensions/sanity.ts`.
 *
 * On 2026-09-17 the implementer emitted this, and nothing noticed:
 *
 *     bash { command: "pnpm lint",
 *            path: "<tool_call>\n<function>\n<parameter=path>\n…/lib/is-slug.php" }
 *
 * The `path` carried the model's own tool-call scaffolding as literal text, and
 * a `.php` file that does not exist in a TypeScript repository. The `command`
 * happened to be fine, so the tool succeeded, `isError` was false, and
 * `stopReason` was `toolUse`. Every signal the driver reads said the turn was
 * healthy.
 *
 * That is `NOTES.md` 38 — the token soup — surviving in one argument instead of
 * a whole message. It is the same failure, at a scale small enough that every
 * existing check misses it.
 *
 * **We check that a call did not error. This checks that it was coherent.**
 *
 * Blocking rather than warning is deliberate. A model that has emitted its own
 * framing into a value is not reliable at that instant, and the cost of a
 * refusal is one turn: `block` returns the reason to the model in-band and it
 * tries again. The cost of proceeding is a command that runs against a path
 * nobody chose.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Fragments of a model's own serialisation format. None of these has any
 * business inside an argument value; if one appears, the stream has bled its
 * scaffolding into the payload.
 *
 * Deliberately NOT a general "looks like XML" test — this repository is full of
 * legitimate angle brackets, and a false positive blocks real work.
 */
const SCAFFOLDING = [
	"<tool_call>",
	"</tool_call>",
	"<function=",
	"<function>",
	"</function>",
	"<parameter=",
	"</parameter>",
	"<|im_start|>",
	"<|im_end|>",
	"<|eot_id|>",
];

// NOT in that list, deliberately: a bare "<". This repository is TypeScript —
// `Set<string>`, `a < b`, `Iterable<string>` — and matching it would refuse
// nearly every legitimate call. A marker has to be something no honest value
// contains.

function contamination(value: unknown, path: string, found: string[]): void {
	if (typeof value === "string") {
		for (const marker of SCAFFOLDING) {
			if (value.includes(marker)) found.push(`${path}: ${marker}`);
		}
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((v, i) => contamination(v, `${path}[${i}]`, found));
		return;
	}
	if (value && typeof value === "object") {
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			contamination(v, path ? `${path}.${k}` : k, found);
		}
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		const found: string[] = [];
		contamination(event.input, "", found);
		if (found.length === 0) return undefined;

		// stderr reaches the job log, so this is visible even if the model
		// recovers silently and the run goes on to succeed.
		console.error(
			`sanity.ts: REFUSED ${event.toolName} — arguments contain model scaffolding: ${found.join(", ")}`,
		);

		return {
			block: true,
			reason:
				`Refused: the arguments to ${event.toolName} contain your own tool-call ` +
				`framing as literal text (${found.join(", ")}). That is not a value you ` +
				`meant to send. Re-issue the call with the arguments you intended, and ` +
				`nothing else.`,
		};
	});

	console.error(`sanity.ts: watching tool arguments for ${SCAFFOLDING.length} scaffolding markers`);
}
