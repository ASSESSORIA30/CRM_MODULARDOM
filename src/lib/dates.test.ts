import { describe, expect, it } from "vitest";
import { addDays, addMonths, isoWeekday, madridDateKey, madridLocalToDate, startOfWeek, toMadridInput } from "./dates";

describe("hora de Madrid", () => {
  it("hivern (UTC+1)", () => {
    expect(madridLocalToDate("2026-11-07T10:30").toISOString()).toBe("2026-11-07T09:30:00.000Z");
  });
  it("estiu (UTC+2)", () => {
    expect(madridLocalToDate("2026-07-15T10:30").toISOString()).toBe("2026-07-15T08:30:00.000Z");
  });
  it("dies de canvi d'hora", () => {
    expect(madridLocalToDate("2026-03-29T12:00").toISOString()).toBe("2026-03-29T10:00:00.000Z");
    expect(madridLocalToDate("2026-10-25T12:00").toISOString()).toBe("2026-10-25T11:00:00.000Z");
  });
  it("anada i tornada", () => {
    for (const s of ["2026-01-01T00:00", "2026-06-30T23:45", "2026-11-07T08:05"]) {
      expect(toMadridInput(madridLocalToDate(s))).toBe(s);
    }
  });
  it("la data de Madrid pot ser diferent de la UTC", () => {
    expect(madridDateKey("2026-11-07T23:30:00Z")).toBe("2026-11-08");
  });
  it("rebutja formats no vàlids", () => {
    expect(() => madridLocalToDate("07/11/2026")).toThrow();
  });
});

describe("calendari", () => {
  it("setmanes comencen en dilluns", () => {
    expect(isoWeekday("2026-11-08")).toBe(7);
    expect(startOfWeek("2026-11-08")).toBe("2026-11-02");
    expect(startOfWeek("2026-11-02")).toBe("2026-11-02");
  });
  it("aritmètica de dies i mesos", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", -1)).toBe("2025-12-01");
  });
});
