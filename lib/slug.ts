/**
 * Turn a human title into a URL slug.
 *
 * Deliberately small and deliberately incomplete — it is the seed the first
 * issues extend, so that a pull request has something real to change.
 */
export const MAX_SLUG_LENGTH = 60;

export function slugify(title: string): string {
  return capSlug(
    title
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, ""),
  );
}

function capSlug(slug: string): string {
  if (slug.length <= MAX_SLUG_LENGTH) {
    return slug;
  }
  // Truncate to max length first
  const truncated = slug.substring(0, MAX_SLUG_LENGTH);
  // Find the last dash that serves as a word boundary.
  // A word boundary dash has a lowercase letter before and after it,
  // ensuring we cut between words rather than inside hyphenated words.
  // Digits (charCode 48-57) are excluded so dashes like 'a-1' are not treated
  // as word boundaries.
  let wordBoundaryIndex = -1;
  for (let i = truncated.length - 1; i >= 0; i--) {
    if (truncated[i] !== "-") continue;
    // Must have a letter before and after to be a word boundary
    if (i === 0 || i === truncated.length - 1) continue;
    const before = truncated.charCodeAt(i - 1);
    const after = truncated.charCodeAt(i + 1);
    if (before >= 97 && before <= 122 && after >= 97 && after <= 122) {
      wordBoundaryIndex = i;
      break;
    }
  }
  if (wordBoundaryIndex > 0) {
    const result = truncated.substring(0, wordBoundaryIndex);
    // Ensure the result does not end with a trailing dash
    if (result.endsWith("-")) {
      return result.slice(0, -1);
    }
    return result;
  }
  // No word-boundary dash found; hard-cut at 60
  // Ensure no trailing dash remains
  if (truncated.endsWith("-")) {
    return truncated.slice(0, -1);
  }
  return truncated;
}
