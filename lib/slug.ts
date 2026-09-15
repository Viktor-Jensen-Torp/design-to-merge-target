/**
 * Turn a human title into a URL slug.
 *
 * Deliberately small and deliberately incomplete — it is the seed the first
 * issues extend, so that a pull request has something real to change.
 */
export function slugify(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
