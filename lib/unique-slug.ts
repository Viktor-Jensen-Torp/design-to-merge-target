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

  // Try appending -2, -3, ... until we find one not in taken
  let suffix = 2;
  while (true) {
    const candidate = base + "-" + suffix;
    if (!takenSet.has(candidate)) {
      return candidate;
    }
    suffix++;
  }
}
