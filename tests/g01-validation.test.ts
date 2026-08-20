import assert from "node:assert/strict";
import test from "node:test";
import {
  isTaskDueOnLocalDate,
  localDateFor,
  normalizeEmail,
  scheduleFromStorage,
  scheduleToStorage,
  toUtcTimestamp,
  validateIanaTimezone,
  validateLocalDate,
  validateStars,
  validateTaskSchedule,
} from "../server/validation";

test("email normalization is stable for display-case and Unicode compatibility", () => {
  assert.equal(normalizeEmail("  Parent@Example.TEST  "), "parent@example.test");
  assert.equal(normalizeEmail("ＰＡＲＥＮＴ@example.test"), "parent@example.test");
  assert.throws(() => normalizeEmail("not-an-email"), /invalid/);
  assert.throws(() => normalizeEmail("parent@example.test\nattacker@example.test"), /invalid/);
});

test("IANA timezones derive local dates across midnight and DST boundaries", () => {
  assert.equal(
    localDateFor("2026-03-08T06:59:59.000Z", "America/New_York"),
    "2026-03-08",
  );
  assert.equal(
    localDateFor("2026-03-09T03:59:59.000Z", "America/New_York"),
    "2026-03-08",
  );
  assert.equal(
    localDateFor("2026-03-09T04:00:00.000Z", "America/New_York"),
    "2026-03-09",
  );
  assert.equal(localDateFor("2026-01-01T15:59:59.000Z", "Asia/Kuala_Lumpur"), "2026-01-01");
  assert.equal(localDateFor("2026-01-01T16:00:00.000Z", "Asia/Kuala_Lumpur"), "2026-01-02");
  assert.equal(validateIanaTimezone("UTC"), "UTC");
  assert.throws(() => validateIanaTimezone("Mars/Olympus"), /IANA/);
});

test("UTC and local date values use canonical representations", () => {
  assert.equal(toUtcTimestamp("2026-01-01T00:00:00+08:00"), "2025-12-31T16:00:00.000Z");
  assert.equal(validateLocalDate("2024-02-29"), "2024-02-29");
  assert.throws(() => validateLocalDate("2025-02-29"), /real calendar/);
  assert.throws(() => validateLocalDate("2026-1-1"), /YYYY-MM-DD/);
});

test("schedule validation is strict, canonical, and ISO-weekday based", () => {
  assert.deepEqual(validateTaskSchedule({ type: "daily" }), { type: "daily" });
  assert.deepEqual(validateTaskSchedule({ type: "weekdays", days: [7, 1, 5] }), {
    type: "weekdays",
    days: [1, 5, 7],
  });
  assert.deepEqual(validateTaskSchedule({ type: "one_off", localDate: "2026-04-18" }), {
    type: "one_off",
    localDate: "2026-04-18",
  });
  assert.throws(() => validateTaskSchedule({ type: "daily", interval: 2 }), /unsupported/);
  assert.throws(() => validateTaskSchedule({ type: "weekdays", days: [1, 1] }), /unique/);
  assert.throws(() => validateTaskSchedule({ type: "weekdays", days: [0] }), /1 to 7/);
  assert.throws(() => validateTaskSchedule({ type: "monthly", day: 1 }), /unsupported/);
  assert.throws(() => validateTaskSchedule({ type: "one_off", localDate: "2026-02-29" }), /real/);

  const stored = scheduleToStorage({ type: "weekdays", days: [5, 2] });
  assert.equal(stored.type, "weekdays");
  assert.deepEqual(scheduleFromStorage(stored.type, stored.data), {
    type: "weekdays",
    days: [2, 5],
  });
  assert.throws(() => scheduleFromStorage("daily", stored.data), /does not match/);

  assert.equal(isTaskDueOnLocalDate({ type: "daily" }, "2026-04-18"), true);
  assert.equal(isTaskDueOnLocalDate({ type: "weekdays", days: [6, 7] }, "2026-04-18"), true); // Saturday
  assert.equal(isTaskDueOnLocalDate({ type: "weekdays", days: [6, 7] }, "2026-04-17"), false); // Friday
  assert.equal(isTaskDueOnLocalDate({ type: "one_off", localDate: "2026-04-18" }, "2026-04-19"), false);
});

test("stars and statuses reject unsupported values at the shared boundary", () => {
  assert.equal(validateStars(1), 1);
  assert.equal(validateStars(3), 3);
  assert.throws(() => validateStars(0), /1 to 3/);
  assert.throws(() => validateStars(1.5), /integer/);
});
