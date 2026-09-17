/**
 * What did we actually send, and what came back?
 *
 * Goes in the TARGET repo at `.pi/extensions/debug.ts`. **Off unless
 * `PI_DEBUG_PROVIDER` is set**, so it costs nothing on an ordinary run.
 *
 * Every "what did Pi actually send?" question this project has asked was
 * answered by `spikes/pi-probe` — a mock provider in a scratch directory,
 * answering about a request we constructed rather than one we sent. Pi exposes
 * the real thing:
 *
 *     before_provider_request    the outgoing payload
 *     after_provider_response    status and headers, before the stream is read
 *
 * Three failures this year were diagnosed the long way round and would have
 * been one line each:
 *
 *   - `NOTES.md` 47, a 403 gated on attribution headers. We inferred it from
 *     `stopReason=error` plus an error string; `status` says 403 directly.
 *   - `NOTES.md` 50, a rate limit. OpenRouter returns `x-ratelimit-*` on every
 *     response, so the run could have said how close it was BEFORE being
 *     refused.
 *   - `NOTES.md` 43 and 56, sampling and tool schemas. "Is `StringEnum` really
 *     emitting `enum`?" is answerable from a production run, not only a mock.
 *
 * It writes a SUMMARY by default, because a full payload is the whole
 * conversation and would bury the job log. `PI_DEBUG_PROVIDER=full` also writes
 * each payload to `$PI_DEBUG_DIR` (default `$RUNNER_TEMP`, else the system temp
 * directory) so the workflow can upload it as an artifact.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Headers worth naming. Everything else is noise in a job log. */
const INTERESTING = [
	"x-ratelimit-limit",
	"x-ratelimit-remaining",
	"x-ratelimit-reset",
	"x-ratelimit-limit-requests",
	"x-ratelimit-remaining-requests",
	"x-ratelimit-limit-tokens",
	"x-ratelimit-remaining-tokens",
	"retry-after",
	"x-request-id",
	"openrouter-provider-name",
	"x-openrouter-provider",
];

function summarise(payload: unknown): string {
	if (!payload || typeof payload !== "object") return `(payload is ${typeof payload})`;
	const p = payload as Record<string, unknown>;

	const bits: string[] = [];
	if (typeof p.model === "string") bits.push(`model=${p.model}`);

	// The sampling we pin, and whether it survived to the wire at all.
	for (const k of ["temperature", "top_p", "max_tokens", "max_completion_tokens"]) {
		if (p[k] !== undefined) bits.push(`${k}=${JSON.stringify(p[k])}`);
	}

	// OpenRouter routing rides as a top-level `provider` field.
	if (p.provider !== undefined) bits.push(`provider=${JSON.stringify(p.provider)}`);

	const messages = Array.isArray(p.messages) ? p.messages : [];
	bits.push(`messages=${messages.length}`);

	const tools = Array.isArray(p.tools) ? p.tools : [];
	if (tools.length) {
		const names = tools
			.map((t) => (t as { function?: { name?: string } })?.function?.name ?? "?")
			.join(",");
		bits.push(`tools=${tools.length}[${names}]`);
		// The schema dialect that broke `submit_review` on Google (`NOTES.md` 56).
		// Cheap to check on every request rather than only when it fails.
		const asText = JSON.stringify(tools);
		if (asText.includes('"anyOf"') || asText.includes('"const"')) {
			bits.push("SCHEMA=anyOf/const present — not portable to every provider");
		}
	}

	bits.push(`bytes=${JSON.stringify(payload).length}`);
	return bits.join(" ");
}

export default function (pi: ExtensionAPI) {
	const mode = (process.env.PI_DEBUG_PROVIDER ?? "").trim();
	if (!mode) return;

	const full = mode === "full";
	const dir = process.env.PI_DEBUG_DIR || process.env.RUNNER_TEMP || tmpdir();
	let n = 0;

	pi.on("before_provider_request", async (event) => {
		n += 1;
		console.error(`debug.ts: request ${n} — ${summarise(event.payload)}`);
		if (full) {
			const path = join(dir, `provider-request-${String(n).padStart(3, "0")}.json`);
			try {
				writeFileSync(path, JSON.stringify(event.payload, null, 2));
				console.error(`debug.ts: request ${n} body -> ${path}`);
			} catch (e) {
				console.error(`debug.ts: could not write ${path}: ${(e as Error).message}`);
			}
		}
		return undefined;
	});

	pi.on("after_provider_response", async (event) => {
		const named = INTERESTING.filter((h) => event.headers[h] !== undefined)
			.map((h) => `${h}=${event.headers[h]}`)
			.join(" ");
		// A non-2xx is the thing we have twice spent hours inferring. Say it
		// plainly, with whatever the provider volunteered about why.
		const level = event.status >= 400 ? "  ! " : "debug.ts: ";
		console.error(`${level}response ${event.status}${named ? " — " + named : ""}`);
		return undefined;
	});

	console.error(
		`debug.ts: recording provider traffic (mode=${mode}${full ? `, bodies -> ${dir}` : ""})`,
	);
}
