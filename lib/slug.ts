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
  const truncated = slug.substring(0, MAX_SLUG_LENGTH);
  const lastDashIndex = truncated.lastIndexOf("-");
  if (lastDashIndex > 0) {
    return truncated.substring(0, lastDashIndex);
  }
  return truncated;
}
