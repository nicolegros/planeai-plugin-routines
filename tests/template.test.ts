import { describe, expect, it } from "vitest";
import { render } from "../src/template";

// Tuesday 2026-10-06 09:05 in Toronto.
const at = new Date("2026-10-06T13:05:00Z");

describe("render", () => {
  it("fills every placeholder from the occurrence time", () => {
    expect(
      render("{{date}} {{time}} {{weekday}} W{{week}} {{month}} {{year}} {{routine}}", {
        at,
        routine: "Weekly retro",
      }),
    ).toBe("2026-10-06 09:05 Tuesday W41 October 2026 Weekly retro");
  });

  it("uses the ISO week, which can belong to the previous year", () => {
    expect(
      render("{{week}} {{year}}", { at: new Date("2027-01-01T17:00:00Z"), routine: "r" }),
    ).toBe("53 2027");
    expect(render("{{week}}", { at: new Date("2026-12-31T17:00:00Z"), routine: "r" })).toBe("53");
    expect(render("{{week}}", { at: new Date("2027-01-04T17:00:00Z"), routine: "r" })).toBe("1");
  });

  it("leaves unknown placeholders and stray braces untouched", () => {
    expect(render("{{ date }} {{nope}} {{constructor}} {date} {{date", { at, routine: "r" })).toBe(
      "2026-10-06 {{nope}} {{constructor}} {date} {{date",
    );
  });
});
