import { describe, expect, it } from "vitest";
import { fullCloseNotes, partialCloseNotes, planClose, remainderNotes } from "@/lib/close";

describe("planClose", () => {
  it("closes the whole position, adding the closing fees to the entry fees", () => {
    const result = planClose({ quantity: "100", fees: "2" }, { closeQuantity: "100", extraFees: "1" });
    expect(result).toEqual({ ok: true, plan: { kind: "full", closed: { quantity: "100", fees: "3" } } });
    expect(planClose({ quantity: "100", fees: "2" }, { closeQuantity: "100.0" })).toEqual({ ok: true, plan: { kind: "full", closed: { quantity: "100", fees: "2" } } });
  });

  it("splits the quantity and prorates the entry fees, so both rows add up to the whole", () => {
    const result = planClose({ quantity: "10", fees: "13" }, { closeQuantity: "6", extraFees: "3.9" });
    expect(result).toEqual({
      ok: true,
      plan: { kind: "partial", closed: { quantity: "6", fees: "11.7" }, remaining: { quantity: "4", fees: "5.2" } },
    });
    const fractional = planClose({ quantity: "0.5", fees: "12" }, { closeQuantity: "0.2" });
    expect(fractional.ok && fractional.plan.kind === "partial" && fractional.plan).toMatchObject({ closed: { quantity: "0.2", fees: "4.8" }, remaining: { quantity: "0.3", fees: "7.2" } });
  });

  it("keeps the split exact when fees do not divide evenly", () => {
    const result = planClose({ quantity: "3", fees: "1" }, { closeQuantity: "1" });
    expect(result.ok && result.plan.kind === "partial" && result.plan.closed.fees).toBe("0.33333333");
    expect(result.ok && result.plan.kind === "partial" && result.plan.remaining.fees).toBe("0.66666667");
  });

  it("refuses nothing, too much and negative fees", () => {
    expect(planClose({ quantity: "10", fees: "0" }, { closeQuantity: "0" })).toMatchObject({ ok: false, field: "closeQuantity" });
    expect(planClose({ quantity: "10", fees: "0" }, { closeQuantity: "-1" })).toMatchObject({ ok: false, field: "closeQuantity" });
    expect(planClose({ quantity: "10", fees: "0" }, { closeQuantity: "11" })).toMatchObject({ ok: false, field: "closeQuantity", error: "Only 10 is open." });
    expect(planClose({ quantity: "10", fees: "0" }, { closeQuantity: "5", extraFees: "-2" })).toMatchObject({ ok: false, field: "extraFees" });
    expect(planClose({ quantity: "0", fees: "0" }, { closeQuantity: "1" })).toMatchObject({ ok: false, field: "closeQuantity" });
  });
});

describe("close notes", () => {
  it("records the split on both rows and appends the exit note to the closed part", () => {
    expect(partialCloseNotes({ notes: "Thesis.", label: "TSLA 250C Oct 3", originalId: "abc", closed: "6", total: "10", exitNote: "Sold into the gap." })).toBe(
      "Thesis.\n\nPartial close of TSLA 250C Oct 3 (abc): closed 6 of 10.\n\nSold into the gap.",
    );
    expect(partialCloseNotes({ notes: "", label: "AAPL", originalId: "abc", closed: "40", total: "100" })).toBe("Partial close of AAPL (abc): closed 40 of 100.");
    expect(remainderNotes({ notes: "Thesis.", closed: "6", total: "10", remaining: "4" })).toBe("Thesis.\n\nClosed 6 of 10; 4 still open.");
  });

  it("leaves the notes alone on a full close without an exit note", () => {
    expect(fullCloseNotes("Thesis.", null)).toBe("Thesis.");
    expect(fullCloseNotes("Thesis.", "  Out at the close.  ")).toBe("Thesis.\n\nOut at the close.");
    expect(fullCloseNotes("", "Out.")).toBe("Out.");
  });
});
