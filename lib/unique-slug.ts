import { slugify, MAX_SLUG_LENGTH } from "./slug";

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

  // Try appending -2, -3, ... until we find one not in taken
  // that fits within MAX_SLUG_LENGTH
  let suffix = 2;
  while (true) {
    // Calculate how many characters we can use for the base
    // we need: base.length + 1 (dash) + suffix.length <= MAX_SLUG_LENGTH
    const maxBaseLength = MAX_SLUG_LENGTH - 1 - String(suffix).length;
    if (maxBaseLength <= 0) {
      // No room for any suffix within the cap
      return "";
    }

    // Truncate the base if needed to leave room for the suffix
    const truncatedBase =
      base.length > maxBaseLength ? base.substring(0, maxBaseLength) : base;

    const candidate = truncatedBase + "-" + suffix;
    if (!takenSet.has(candidate)) {
      return candidate;
    }

    suffix++;
  }
}
