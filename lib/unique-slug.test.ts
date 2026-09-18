import { describe, expect, it } from "vitest";
import { uniqueSlug } from "./unique-slug";
import { isSlug } from "./is-slug";

describe("uniqueSlug", () => {
  it("returns slugify(title) when not taken", () => {
    expect(uniqueSlug("Hello World", [])).toBe("hello-world");
  });

  it("appends -2 when base slug is taken", () => {
    expect(uniqueSlug("Hello World", ["hello-world"])).toBe("hello-world-2");
  });

  it("appends -3 when multiple slugs are taken", () => {
    expect(uniqueSlug("Hello World", ["hello-world", "hello-world-2"])).toBe(
      "hello-world-3",
    );
  });

  it("returns base slug when a different suffix is taken", () => {
    expect(uniqueSlug("Hello World", ["hello-world-2"])).toBe("hello-world");
  });

  it("returns empty string when slugify returns empty (CJK)", () => {
    expect(uniqueSlug("東京", [])).toBe("");
  });

  it("returns empty string when slugify returns empty and taken contains empty string", () => {
    expect(uniqueSlug("東京", [""])).toBe("");
  });

  it("accepts Set<string> as taken", () => {
    expect(uniqueSlug("Hello World", new Set(["hello-world"]))).toBe(
      "hello-world-2",
    );
  });

  it("result satisfies isSlug whenever non-empty", () => {
    const titles = ["Hello World", "Room 101", "Just One Word"];
    for (const title of titles) {
      const s = uniqueSlug(title, []);
      expect(isSlug(s)).toBe(s !== "");
    }
  });

  it("never returns more than MAX_SLUG_LENGTH characters", () => {
    const sixtyA = "a".repeat(60);
    expect(uniqueSlug(sixtyA, [])).toBe(sixtyA);
    expect(uniqueSlug(sixtyA, [sixtyA])).toBe(sixtyA.slice(0, 58) + "-2");
  });

  it("truncates base and appends -2 when base is 60 chars and taken", () => {
    const base = "a".repeat(60);
    const result = uniqueSlug(base, [base]);
    expect(result).toHaveLength(60);
    expect(result).toBe("a".repeat(58) + "-2");
  });

  it("returns a valid slug within MAX_SLUG_LENGTH when base is taken", () => {
    const base = "a".repeat(60);
    const taken: Set<string> = new Set();
    taken.add(base); // base is taken
    const result = uniqueSlug(base, taken);
    expect(isSlug(result)).toBe(true);
    expect(result.length).toBe(60);
  });

  it("property test: includes base slug in taken to exercise collision path", () => {
    const titles = ["Hello World", "Room 101", "Just One Word"];
    for (const title of titles) {
      const base = uniqueSlug(title, [
        title.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      ]);
      expect(isSlug(base)).toBe(base !== "");
    }
  });
});
