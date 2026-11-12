import { describe, it, expect } from "vitest";
import { compareHittingForm, formSample, formatFormDelta } from "./hittingForm";

describe("formSample", () => {
  it("reads on-base from hits, walks and hit-by-pitches", () => {
    expect(formSample([{ pa: 5, ab: 3, h: 1, bb: 1, hbp: 1 }], "obp")).toEqual({
      rate: 3 / 5,
      trips: 5,
    });
  });

  it("won't read on-base from a line that can't say how often the kid walked", () => {
    // Hits over plate appearances would undercount a kid who walks.
    expect(formSample([{ pa: 5, ab: 4, h: 2 }], "obp")).toBeNull();
  });

  it("needs every game in the run to carry the measure", () => {
    expect(
      formSample(
        [
          { pa: 4, ab: 4, h: 1, bb: 0 },
          { pa: 4, ab: 4, h: 1 },
        ],
        "obp",
      ),
    ).toBeNull();
    expect(
      formSample(
        [
          { pa: 4, ab: 4, h: 1, bb: 0 },
          { pa: 4, ab: 4, h: 1 },
        ],
        "avg",
      ),
    ).toEqual({ rate: 0.25, trips: 8 });
  });

  it("lets a game the kid didn't bat in through without counting it", () => {
    expect(
      formSample(
        [
          { pa: 0, ab: 0 },
          { pa: 4, ab: 4, h: 2, bb: 0 },
        ],
        "obp",
      ),
    ).toEqual({ rate: 0.5, trips: 4 });
  });
});

describe("compareHittingForm", () => {
  it("drops to batting average for both sides when one side can't give on-base", () => {
    const form = compareHittingForm(
      [{ pa: 12, ab: 12, h: 2 }],
      [{ pa: 12, ab: 6, h: 2, bb: 6 }],
    );
    expect(form.basis).toBe("avg");
  });

  it("holds off a call until each side has enough trips", () => {
    const form = compareHittingForm(
      [{ pa: 9, ab: 9, h: 3, bb: 0 }],
      [{ pa: 12, ab: 12, h: 9, bb: 0 }],
    );
    expect(form).toMatchObject({
      class: "insufficient",
      basis: "obp",
      earlierTrips: 9,
    });
  });

  it("doesn't call one hit after an 0-for-12 a breakout", () => {
    // Near zero the luck swing shrinks toward nothing, so any single hit would
    // clear it. The pooled rate is held at .050 or more, which keeps 0-for-12
    // then 1-for-12 steady (0-for-12 then 2-for-12 is a real move).
    const before = [{ pa: 12, ab: 12, h: 0, bb: 0 }];
    expect(
      compareHittingForm(before, [{ pa: 12, ab: 12, h: 1, bb: 0 }]).class,
    ).toBe("steady");
    expect(
      compareHittingForm(before, [{ pa: 12, ab: 12, h: 2, bb: 0 }]).class,
    ).toBe("improving");
  });
});

describe("formatFormDelta", () => {
  it("reads on-base moves as rate points and QAB moves as percent", () => {
    expect(formatFormDelta(0.125, "obp")).toBe("+.125");
    expect(formatFormDelta(-0.05, "avg")).toBe("-.050");
    expect(formatFormDelta(0.06, "qab")).toBe("+6.0%");
  });
});
