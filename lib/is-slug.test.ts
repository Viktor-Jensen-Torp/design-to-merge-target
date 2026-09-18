import { describe, expect, it } from "vitest";
import { slugify } from "./slug";
import { isSlug } from "./is-slug";

describe("isSlug", () => {
  it("hello-world is a valid slug", () => {
    expect(isSlug("hello-world")).toBe(true);
  });

  it("room-101 is a valid slug", () => {
    expect(isSlug("room-101")).toBe(true);
  });

  it("a is a valid slug", () => {
    expect(isSlug("a")).toBe(true);
  });

  it("empty string is not a valid slug", () => {
    expect(isSlug("")).toBe(false);
  });

  it("-hello is not a valid slug (leading dash)", () => {
    expect(isSlug("-hello")).toBe(false);
  });

  it("hello- is not a valid slug (trailing dash)", () => {
    expect(isSlug("hello-")).toBe(false);
  });

  it("hello--world is not a valid slug (consecutive dashes)", () => {
    expect(isSlug("hello--world")).toBe(false);
  });

  it("Hello-World is not a valid slug (uppercase)", () => {
    expect(isSlug("Hello-World")).toBe(false);
  });

  it("hello_world is not a valid slug (underscore)", () => {
    expect(isSlug("hello_world")).toBe(false);
  });

  it("héllo is not a valid slug (accented characters)", () => {
    expect(isSlug("héllo")).toBe(false);
  });

  // Property check: isSlug(slugify(t)) is true whenever slugify(t) is non-empty
  it("isSlug(slugify(t)) is true for varied titles", () => {
    const titles = [
      "Hello World",
      "Room 101",
      "Just One Word",
      "Multi   Word   Phrase",
      "Café",
      "Ñoño",
      "Crème brûlée",
      "Zoë Müller",
      "Tokyo",
    ];

    for (const title of titles) {
      const s = slugify(title);
      expect(isSlug(s)).toBe(s !== "");
    }
  });

  it('isSlug("a".repeat(60)) is true', () => {
    expect(isSlug("a".repeat(60))).toBe(true);
  });

  it('isSlug("a".repeat(61)) is false', () => {
    expect(isSlug("a".repeat(61))).toBe(false);
  });

  it('isSlug("a".repeat(200)) is false', () => {
    expect(isSlug("a".repeat(200))).toBe(false);
  });
});
