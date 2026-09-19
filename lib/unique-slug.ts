import { MAX_SLUG_LENGTH } from "./slug";
import { slugify } from "./slug";

export function uniqueSlug(title: string, taken: Iterable<string>): string {
  const base = slugify(title);

  // If slugify returned empty, we cannot make it unique — return as-is
  if (base === "") {
    return base;
  }

  const takenSet = new Set(taken);
  if (!takenSet.has(base)) {
    return base;
  }

  // Try appending -2, -3, ... until we find one not in taken,
  // ensuring the result never exceeds MAX_SLUG_LENGTH by truncating the base.
  let suffix = 2;
  while (true) {
    const suffixStr = "-" + suffix;
    const maxBaseLength = MAX_SLUG_LENGTH - suffixStr.length;

    // No room for any suffix within the cap
    if (maxBaseLength <= 0) {
      return "";
    }

    // Truncate base to make room for the suffix
    const truncatedBase = base.substring(0, maxBaseLength);

    // Ensure no trailing dash remains
    const cleanBase = truncatedBase.endsWith("-")
      ? truncatedBase.slice(0, -1)
      : truncatedBase;

    const candidate = cleanBase + suffixStr;

    // Safety: if candidate somehow exceeds the cap, try next suffix
    if (candidate.length > MAX_SLUG_LENGTH) {
      suffix++;
      continue;
    }

    if (!takenSet.has(candidate)) {
      return candidate;
    }
    suffix++;

    // Prevent infinite loop: if suffix exceeds the cap, no valid candidate exists
    if (suffix > MAX_SLUG_LENGTH) {
      return "";
    }
  }
}
