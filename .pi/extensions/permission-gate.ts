/**
 * Dangerous shell commands, refused before they run.
 *
 * Goes in the TARGET repo at `.pi/extensions/permission-gate.ts`.
 *
 * Adapted from Pi's own `examples/extensions/permission-gate.ts`, which asks a
 * person to confirm `rm -rf`, `sudo` and `chmod 777`, and "in non-interactive
 * mode, block[s] by default". No role here has a person to ask, so this keeps
 * only the blocking half. The patterns are Pi's, with the recursive-delete one
 * widened to catch `rm -fr` and `rm -Rf`, which Pi's `-rf?` does not.
 *
 * Why it exists: on round 2 of #96 the rework agent ran `rm -rf $RUNNER_TEMP`
 * while cleaning up a folder it had created by mistake. The shell expanded the
 * variable, and the command deleted the job's real temporary folder, including
 * the driver's finish check. The run could not finish and the work was lost
 * (`NOTES.md` 81).
 *
 * WHAT THIS IS NOT. Like `protect.ts`, it is hygiene, not containment: a
 * determined command can delete files in ways no pattern lists. Pi's
 * `examples/extensions/sandbox` is the OS-level answer, and a separate
 * decision. This closes the accident.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const DANGEROUS: { pattern: RegExp; why: string }[] = [
	{ pattern: /\brm\s+(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)\b/, why: "a recursive delete" },
	{ pattern: /\bsudo\b/, why: "sudo" },
	{ pattern: /\b(chmod|chown)\b.*777/, why: "a world-writable permission change" },
];

/** Which rule a command breaks, or undefined. */
function dangerous(command: string): string | undefined {
	return DANGEROUS.find((d) => d.pattern.test(command))?.why;
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return undefined;
		const why = dangerous(String(event.input.command ?? ""));
		if (!why) return undefined;
		return {
			block: true,
			reason:
				`Blocked: ${why}. This run has no person to confirm it, so it is refused. ` +
				"Delete single files by name if you must. If a whole folder really has to go, say so in your final message instead.",
		};
	});
	console.error("permission-gate.ts: refusing recursive deletes, sudo and chmod 777 in bash");
}
