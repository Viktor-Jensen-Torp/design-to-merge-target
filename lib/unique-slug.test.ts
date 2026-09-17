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
});
