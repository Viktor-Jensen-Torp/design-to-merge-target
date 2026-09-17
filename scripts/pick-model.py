#!/usr/bin/env python3
"""Choose an OpenRouter model for a pipeline role, and say why.

Three model choices have now cost us a run each, and every one was knowable
from OpenRouter's own API before anything was deployed:

  - `poolside/laguna-s-2.1:free` has ONE endpoint. When that provider
    rate-limited, `allow_fallbacks` had nowhere to fall back to and the
    gatekeeper stopped for at least eight hours (`NOTES.md` 48).
  - `thinkingmachines/inkling:free` is gated to recognised agentic harnesses.
    With Pi's attribution headers off it answered 403 and every review died in
    three seconds (`NOTES.md` 47).
  - We pinned `top_p` on laguna, whose only endpoint does not support it. With
    `require_parameters: true` that is zero eligible providers by construction
    (`NOTES.md` 46).

This script asks OpenRouter the questions we kept failing to ask.

WHAT IT DOES AND DOES NOT DECIDE FOR YOU
----------------------------------------
Only two things genuinely DISQUALIFY a model, and one of them depends on the
role you are choosing for:

  1. no endpoints        — nothing serves it. Always disqualifying.
  2. no `tools` support  — disqualifying ONLY for a role that calls tools.
                           Every role today does, but a summarising or
                           classifying role need not, and that opens up models
                           this script would otherwise hide.

Everything else is RISK, not disqualification, and each one is opt-in and
printed with its reason. A model with one endpoint works perfectly well right
up until it does not. Dressing a preference up as a rule is how you end up
unable to explain your own config six weeks later.

    ./pick-model.py                      # interactive, explains each check
    ./pick-model.py --yes                # take the defaults, no prompts
    ./pick-model.py --paid               # include models that cost money
    ./pick-model.py --pin temperature,top_p
    ./pick-model.py --no-tools      # for a role that never calls a tool
"""

import argparse
import json
import subprocess
import sys
import urllib.request

API = "https://openrouter.ai/api/v1"
LOW_BIT = {"int4", "fp4", "int3", "int2"}


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def curl(url):
    """urllib first; fall back to curl where a proxy only trusts that."""
    try:
        return get(url)
    except Exception:
        out = subprocess.run(["curl", "-sS", "-m", "30", url],
                             capture_output=True, text=True)
        if out.returncode != 0 or not out.stdout.strip():
            return None
        try:
            return json.loads(out.stdout)
        except json.JSONDecodeError:
            return None


def ask(question, reason, default=True):
    """Every question carries the reason. Nothing is applied silently."""
    print(f"\n  {question}")
    for line in reason.strip().split("\n"):
        print(f"      {line}")
    d = "Y/n" if default else "y/N"
    try:
        a = input(f"  apply this? [{d}] ").strip().lower()
    except EOFError:
        return default
    if not a:
        return default
    return a.startswith("y")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--paid", action="store_true",
                    help="include models that are not :free")
    ap.add_argument("--yes", "-y", action="store_true",
                    help="take the default for every risk filter, no prompts")
    ap.add_argument("--pin", default="temperature,top_p",
                    help="the sampling parameters you intend to pin (default: temperature,top_p)")
    ap.add_argument("--min-context", type=int, default=131072,
                    help="reject models whose context window is below this (default: 131072)")
    ap.add_argument("--top", type=int, default=8, help="how many to show")
    tools = ap.add_mutually_exclusive_group()
    tools.add_argument("--tools", dest="tools", action="store_true", default=None,
                       help="the role calls tools (default; required by every role today)")
    tools.add_argument("--no-tools", dest="tools", action="store_false",
                       help="the role never calls a tool — do not filter on tool support")
    args = ap.parse_args()

    pinned = [p.strip() for p in args.pin.split(",") if p.strip()]
    tier = "paid and free" if args.paid else "free only"

    # Whether the role calls tools is a property of the ROLE, not of the model,
    # so it is asked rather than assumed. Every role in the pipeline today calls
    # tools — the implementer edits files, the reviewer runs `gh`, and all of
    # them finish through a `submit_*` tool. A role that only reads and writes
    # prose would not, and requiring tool support would hide models that suit it
    # perfectly well.
    needs_tools = args.tools
    if needs_tools is None:
        if args.yes:
            needs_tools = True
        else:
            needs_tools = ask(
                "Does this role call tools?",
                "Every role in this pipeline does today: the implementer edits\n"
                "files, the reviewer runs `gh`, and each finishes by calling a\n"
                "`submit_*` tool. Answer no only for a role that produces text and\n"
                "nothing else — it widens the field considerably.")

    print(__doc__.split("WHAT IT DOES")[0].rstrip())
    print(f"\n{'='*72}\nLooking at {tier}. Parameters you intend to pin: {', '.join(pinned) or '(none)'}\n{'='*72}")

    catalog = curl(f"{API}/models")
    if not catalog:
        sys.exit("could not reach OpenRouter's model list")

    models = catalog["data"]
    if not args.paid:
        models = [m for m in models if m["id"].endswith(":free")]

    # ---- Disqualifiers. Always applied, because the model cannot work. ----
    print("\nDISQUALIFIERS — applied without asking, because the model cannot do the job:")
    print("  1. no endpoints       — nothing serves it")
    if needs_tools:
        print("  2. no `tools` support — this role calls tools")
        before = len(models)
        models = [m for m in models if "tools" in (m.get("supported_parameters") or [])]
        print(f"\n  {before - len(models)} rejected: no tool support")
    else:
        print("  2. tool support NOT required — you said this role never calls a tool")
        with_tools = sum(1 for m in models
                         if "tools" in (m.get("supported_parameters") or []))
        print(f"\n  {len(models) - with_tools} extra models are in scope that a "
              f"tool-calling role could not use")

    # ---- Risks. Opt-in, each with its reason. -----------------------------
    print("\nRISKS — these do not make a model unusable. Each one is your call.")
    want_multi = want_params = True
    flag_lowbit = True
    if not args.yes:
        want_multi = ask(
            "Require at least 2 endpoints?",
            "A single-provider model has nowhere to fall back to. When Poolside\n"
            "rate-limited laguna-s-2.1 the gatekeeper was stuck for 8+ hours and\n"
            "`allow_fallbacks: true` could not help.\n"
            "NOTE: EVERY `:free` variant has exactly one endpoint, so on the free\n"
            "tier this filter rejects everything. It is meaningful only with\n"
            "--paid, or alongside a BYOK key that gives you your own quota.")
        if pinned:
            want_params = ask(
                f"Require every endpoint to support {', '.join(pinned)}?",
                "Only matters because we send `require_parameters: true`, which\n"
                "restricts routing to providers honouring every parameter. Pin a\n"
                "parameter one endpoint lacks and that endpoint is gone; pin one\n"
                "the ONLY endpoint lacks and you have zero providers and an\n"
                "instant error. The alternative fix is to stop pinning it.")
        flag_lowbit = ask(
            "Flag int4/fp4 endpoints?",
            "Heavily quantised endpoints are the leading suspect behind the\n"
            "gibberish in `NOTES.md` 38 — UNPROVEN. Flagged, never filtered:\n"
            "there is no evidence strong enough to exclude a model over it.")

    rows = []
    for m in models:
        # Ask about the EXACT id, `:free` included. Stripping the suffix asks
        # about the paid model, which is a different set of providers entirely:
        # `google/gemma-4-26b-a4b-it` has eleven, `…:free` has one. This script
        # shipped with that bug and recommended a model on the strength of
        # redundancy it did not have (`NOTES.md` 50).
        d = curl(f"{API}/models/{m['id']}/endpoints")
        eps = ((d or {}).get("data") or {}).get("endpoints") or []
        if not eps:
            continue  # disqualifier 2
        quants = [(e.get("quantization") or "unknown") for e in eps]
        missing = {}
        for p in pinned:
            lacking = [e.get("provider_name", "?") for e in eps
                       if p not in (e.get("supported_parameters") or [])]
            if lacking:
                missing[p] = lacking
        rows.append({
            "id": m["id"], "n": len(eps), "ctx": m.get("context_length") or 0,
            "providers": [e.get("provider_name", "?") for e in eps],
            "quants": quants, "missing": missing,
            "lowbit": sorted({q for q in quants if q in LOW_BIT}),
        })

    if not args.paid:
        singles = sum(1 for r in rows if r["n"] == 1)
        if singles == len(rows) and rows:
            # Applying it anyway would reject every candidate and return
            # nothing, which is a worse answer than the honest one. Stand the
            # filter down and say so, loudly.
            want_multi = False
            print(f"\n{'='*72}\nEVERY FREE MODEL HERE HAS ONE ENDPOINT\n{'='*72}")
            print("  All %d of them. A `:free` variant is one provider donating" % len(rows))
            print("  capacity, so `allow_fallbacks` has nowhere to go and an upstream")
            print("  rate limit stops the role outright. Redundancy is not available")
            print("  on the free tier at all.")
            print()
            print("  Two ways out, neither of which this script can choose for you:")
            print("    - BYOK: add your own provider key at")
            print("      https://openrouter.ai/settings/integrations, and set shared-capacity")
            print("      fallback to `never` so a quota miss fails loudly instead of")
            print("      spending OpenRouter credits. Free, and it is what fixed ours.")
            print("    - --paid: the paid slug of the same model, which does have")
            print("      several providers. Pennies per run for a role like the gatekeeper.")
            print()
            print("  The endpoint filter is STOOD DOWN for this run — applying it would")
            print("  reject every candidate and tell you nothing. Ranking below is by")
            print("  context window, and redundancy is a problem you solve with a key,")
            print("  not by picking a different free model.")

    kept, rejected = [], []
    for r in rows:
        why = []
        if want_multi and r["n"] < 2:
            why.append(f"only {r['n']} endpoint")
        if want_params and r["missing"]:
            why.append("; ".join(f"{p} unsupported by {', '.join(v)}"
                                 for p, v in r["missing"].items()))
        if r["ctx"] and r["ctx"] < args.min_context:
            why.append(f"context {r['ctx']} < {args.min_context}")
        (rejected if why else kept).append((r, why))

    kept.sort(key=lambda t: (-t[0]["n"], -t[0]["ctx"]))

    print(f"\n{'='*72}\nRULED OUT ({len(rejected)})\n{'='*72}")
    for r, why in sorted(rejected, key=lambda t: t[0]["id"]):
        print(f"  {r['id']:<44} {'; '.join(why)}")

    print(f"\n{'='*72}\nUSABLE ({len(kept)}), best first\n{'='*72}")
    for r, _ in kept[:args.top]:
        flag = ""
        if flag_lowbit and r["lowbit"]:
            flag = f"   ⚠ {'/'.join(r['lowbit'])} endpoint present (NOTES 38, unproven)"
        print(f"  {r['id']:<44} {r['n']} endpoints  ctx {r['ctx']:>9}{flag}")
        print(f"      {', '.join(r['providers'])}  |  {'/'.join(sorted(set(r['quants'])))}")

    if not kept:
        sys.exit("\nNothing passed. Loosen a filter, or reconsider what you pin.")

    best = kept[0][0]
    print(f"\n{'='*72}\nRECOMMENDED: {best['id']}\n{'='*72}")
    print(f"  {best['n']} endpoints, so a rate limit on one is survivable — which is")
    print(f"  the failure that put this script here.")
    if best["lowbit"]:
        print(f"  NOTE: it can be served at {'/'.join(best['lowbit'])}. Unproven risk; see below.")
        # Ranking is by endpoint count alone, deliberately — quantization is a
        # suspicion, not evidence. But if a runner-up avoids it entirely, the
        # reader should be told rather than having to notice.
        clean = [r for r, _ in kept[1:] if not r["lowbit"]]
        if clean:
            alt = clean[0]
            print(f"  ALTERNATIVE: {alt['id']} has {alt['n']} endpoints and NO low-bit")
            print(f"  quantization at all ({'/'.join(sorted(set(alt['quants'])))}). Fewer providers,")
            print(f"  no need for a `quantizations` filter. Both are defensible; this script")
            print(f"  ranks on redundancy because that is the failure we have actually had.")
    print(f"  Every endpoint supports: {', '.join(pinned) if pinned else '(nothing pinned)'}")

    block = {"samplingParams": {}, "compat": {"openRouterRouting": {
        "allow_fallbacks": True, "require_parameters": True}}}
    for p in pinned:
        block["samplingParams"][p] = 0.0 if p == "temperature" else 1.0
    if best["lowbit"]:
        good = sorted({q for q in best["quants"] if q not in LOW_BIT and q != "unknown"})
        if good:
            block["compat"]["openRouterRouting"]["quantizations"] = good

    print("\n  For .pi/models.json, under providers.openrouter.modelOverrides:\n")
    print(json.dumps({best["id"]: block}, indent=2))
    print("\n  Sampling values above are PLACEHOLDERS — set them for the role.")
    if "quantizations" in block["compat"]["openRouterRouting"]:
        print("  `quantizations` is included because a low-bit endpoint exists. Removing")
        print("  it widens routing and accepts that risk; both are defensible.")
    print(f"\n  gh variable set <ROLE>_MODEL --body '{best['id']}'")


if __name__ == "__main__":
    main()
