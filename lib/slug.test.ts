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
});
