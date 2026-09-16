import { describe, expect, it } from "vitest";
import { slugify } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("collapses runs of punctuation", () => {
    expect(slugify("a -- b")).toBe("a-b");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  !Hi!  ")).toBe("hi");
  });

  it("folds accented letters to their base", () => {
    expect(slugify("Café")).toBe("cafe");
  });

  it("folds ñ to n", () => {
    expect(slugify("Ñoño")).toBe("nono");
  });

  it("creme brulee from crème brûlée", () => {
    expect(slugify("Crème brûlée")).toBe("creme-brulee");
  });

  it("zoe mueller from Zoë Müller", () => {
    expect(slugify("Zoë Müller")).toBe("zoe-muller");
  });

  it("CJK characters disappear", () => {
    expect(slugify("東京")).toBe("");
  });
  it("keeps digits", () => {
    expect(slugify("Room 101")).toBe("room-101");
  });
  it("turns underscores into separators", () => {
    expect(slugify("a_b")).toBe("a-b");
  });

  it("caps slug at 60 characters", () => {
    expect(slugify("a".repeat(100))).toHaveLength(60);
  });

  it("caps long slug at word boundary", () => {
    expect(
      slugify(
        "The quick brown fox jumps over the lazy dog and keeps on running forever",
      ),
    ).toBe("the-quick-brown-fox-jumps-over-the-lazy-dog-and-keeps-on");
  });

  it("returns 60-char slug unchanged", () => {
    const sixtyA = "a".repeat(60);
    expect(slugify(sixtyA)).toBe(sixtyA);
  });

  it("truncates 61-char slug and does not end with dash", () => {
    const sixtyOneA = "a".repeat(61);
    const result = slugify(sixtyOneA);
    expect(result).toHaveLength(60);
    expect(result.slice(-1)).not.toBe("-");
  });

  it("single word longer than 60 chars is cut at exactly 60", () => {
    const longWord =
      "abcdefghijklmnopqrstuvwxyz1234567890abcdefghijklmnopqrstuvwxyz";
    expect(slugify(longWord)).toHaveLength(60);
  });

  it("empty string returns empty string", () => {
    expect(slugify("")).toBe("");
  });
});
