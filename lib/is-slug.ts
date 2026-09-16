/**
 * Check whether a string is a valid slug — exactly what slugify would produce
 * for some input.
 *
 * A valid slug consists of lowercase a-z and 0-9, single - separators, no
 * leading or trailing -, no empty segments, and is not the empty string.
 */
export function isSlug(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
