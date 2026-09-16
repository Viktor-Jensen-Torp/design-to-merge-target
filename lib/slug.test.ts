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
  it("keeps digits", () => {
    expect(slugify("Room 101")).toBe("room-101");
  });
});
