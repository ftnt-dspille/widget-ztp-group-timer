"use strict";
// Unit tests for the pure timer logic -- no Angular, no clock. Every "now" is
// a value the test controls, never Date.now(), so these are deterministic.
//
//   make test-unit WIDGET=ztpGroupTimer

const R = require("../widget/widgetAssets/js/ztpGroupTimer.js");

describe("computeWindow", () => {
  test("idle: no step has a start yet", () => {
    const w = R.computeWindow([{ stepStartTimestamp: null, stepStopTimestamp: null }]);
    expect(w).toEqual({ start: null, stop: null });
  });

  test("running: the earliest start is picked, and any step not yet DONE holds stop at null", () => {
    const w = R.computeWindow([
      { stepStartTimestamp: 100, stepStopTimestamp: 110, stepDone: true },
      { stepStartTimestamp: 90, stepStopTimestamp: null, stepDone: false },   // still in flight
      { stepStartTimestamp: 105, stepStopTimestamp: 120, stepDone: true }
    ]);
    expect(w.start).toBe(90);
    expect(w.stop).toBeNull();
  });

  test("stopped: every step in the group is DONE -- stop is the LATEST stop timestamp", () => {
    const w = R.computeWindow([
      { stepStartTimestamp: 100, stepStopTimestamp: 110, stepDone: true },
      { stepStartTimestamp: 90, stepStopTimestamp: 130, stepDone: true },
      { stepStartTimestamp: 105, stepStopTimestamp: 120, stepDone: true }
    ]);
    expect(w.start).toBe(90);
    expect(w.stop).toBe(130);
  });

  // Regression guard: a step queued but never dispatched carries no start at
  // all, which must not count as "the run has begun" on its own -- but it
  // DOES still hold the group open (stepDone is false), see the next test.
  test("a queued step with neither timestamp does not count as a start", () => {
    const w = R.computeWindow([
      { stepStartTimestamp: null, stepStopTimestamp: null, stepDone: false },
      { stepStartTimestamp: 200, stepStopTimestamp: 210, stepDone: true }
    ]);
    expect(w).toEqual({ start: 200, stop: null });
  });

  // Found live: a step's own `status` can still read "Running" while it
  // ALREADY carries a stepStopTimestamp -- the platform stamps that field on
  // an attempt boundary, not only on the step's true finish. Trusting
  // "has a stop timestamp" as "this step is over" froze the clock at 12m46s
  // with a Running step and a Queued step still behind it. `stepDone` is the
  // one field ztpRunReport already trusts for the same reason (see its
  // stepFacts comment on "in flight").
  test("a stop timestamp on a step that is not yet stepDone does not stop the run", () => {
    const w = R.computeWindow([
      { stepStartTimestamp: 100, stepStopTimestamp: 200, stepDone: false }, // status still "Running"
      { stepStartTimestamp: null, stepStopTimestamp: null, stepDone: false }, // Queued behind it
      { stepStartTimestamp: 50, stepStopTimestamp: 90, stepDone: true }
    ]);
    expect(w.start).toBe(50);
    expect(w.stop).toBeNull();
  });

  test("a fully-done run with only finished steps still reads stopped", () => {
    const w = R.computeWindow([
      { stepStartTimestamp: 10, stepStopTimestamp: 20, stepDone: true },
      { stepStartTimestamp: 20, stepStopTimestamp: 35, stepDone: true }
    ]);
    expect(w).toEqual({ start: 10, stop: 35 });
  });

  test("no steps at all is idle, not a thrown error", () => {
    expect(R.computeWindow([])).toEqual({ start: null, stop: null });
    expect(R.computeWindow(null)).toEqual({ start: null, stop: null });
  });
});

describe("timerState", () => {
  test("idle / running / stopped map onto the three window shapes", () => {
    expect(R.timerState({ start: null, stop: null })).toBe("idle");
    expect(R.timerState({ start: 100, stop: null })).toBe("running");
    expect(R.timerState({ start: 100, stop: 150 })).toBe("stopped");
  });
});

describe("elapsedSeconds", () => {
  test("idle reads zero regardless of the clock", () => {
    expect(R.elapsedSeconds({ start: null, stop: null }, 99999)).toBe(0);
  });

  test("running counts against the caller's OWN clock, never an internal one", () => {
    expect(R.elapsedSeconds({ start: 100, stop: null }, 145)).toBe(45);
  });

  test("stopped is frozen at stop - start, and ignores `now` entirely", () => {
    expect(R.elapsedSeconds({ start: 100, stop: 160 }, 999999)).toBe(60);
  });

  test("never negative, even if the clock arrives before start (clock skew)", () => {
    expect(R.elapsedSeconds({ start: 500, stop: null }, 100)).toBe(0);
  });
});

describe("formatClock", () => {
  test("zero-pads to HH:MM:SS", () => {
    expect(R.formatClock(5)).toBe("00:00:05");
    expect(R.formatClock(65)).toBe("00:01:05");
    expect(R.formatClock(3661)).toBe("01:01:01");
  });

  // A run that spans a night must read AS a long run, not wrap back to a
  // 24-hour clock the way a wall clock would.
  test("hours are not capped at 24 -- an overnight run keeps counting up", () => {
    expect(R.formatClock(26 * 3600 + 4 * 60 + 11)).toBe("26:04:11");
  });
});

describe("formatCompact", () => {
  test("only the units that matter at this magnitude", () => {
    expect(R.formatCompact(45)).toBe("45s");
    expect(R.formatCompact(125)).toBe("2m 5s");
    expect(R.formatCompact(120)).toBe("2m");
    expect(R.formatCompact(3 * 3600 + 5 * 60)).toBe("3h 5m");
  });
});

describe("digitParts", () => {
  test("zero-padded string pairs for a digit/flip display", () => {
    expect(R.digitParts(3661)).toEqual({ h: "01", m: "01", s: "01" });
    expect(R.digitParts(5)).toEqual({ h: "00", m: "00", s: "05" });
  });
});

describe("THEMES", () => {
  test("every theme has a stable id and a human label", () => {
    expect(R.THEMES.length).toBeGreaterThanOrEqual(4);
    R.THEMES.forEach((t) => {
      expect(typeof t.id).toBe("string");
      expect(typeof t.label).toBe("string");
    });
    // Ids must be unique -- they are the config value stored on the widget.
    expect(new Set(R.THEMES.map((t) => t.id)).size).toBe(R.THEMES.length);
  });
});
