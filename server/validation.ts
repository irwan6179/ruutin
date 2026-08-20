/**
 * Shared server-side data conventions.
 *
 * These functions deliberately accept `unknown` at the boundary.  Route
 * handlers must validate browser input before it reaches a D1 statement; the
 * database checks are a second line of defence, not a substitute for this
 * module.
 */

export const TASK_SCHEDULE_TYPES = ["daily", "weekdays", "one_off"] as const;
export type TaskScheduleType = (typeof TASK_SCHEDULE_TYPES)[number];

export type TaskSchedule =
  | { type: "daily" }
  | { type: "weekdays"; days: Array<1 | 2 | 3 | 4 | 5 | 6 | 7> }
  | { type: "one_off"; localDate: string };

export const AGE_BANDS = [
  "under_13",
  "13_15",
  "16_17",
  "18_plus",
  "not_provided",
] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const HOUSEHOLD_ROLES = ["parent", "caregiver"] as const;
export type HouseholdRole = (typeof HOUSEHOLD_ROLES)[number];

export const AUTH_CHALLENGE_PURPOSES = ["sign_in", "delete_household"] as const;
export type AuthChallengePurpose = (typeof AUTH_CHALLENGE_PURPOSES)[number];

export const TASK_CLAIM_STATUSES = ["pending", "approved", "rejected"] as const;
export type TaskClaimStatus = (typeof TASK_CLAIM_STATUSES)[number];

export const REWARD_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
] as const;
export type RewardRequestStatus = (typeof REWARD_REQUEST_STATUSES)[number];

export const LEDGER_EVENT_TYPES = [
  "task_approved",
  "parent_completed_task",
  "task_reversed",
  "reward_redeemed",
  "manual_adjustment",
] as const;
export type LedgerEventType = (typeof LEDGER_EVENT_TYPES)[number];

export const CLAIM_SUBMITTER_TYPES = ["parent", "companion"] as const;
export type ClaimSubmitterType = (typeof CLAIM_SUBMITTER_TYPES)[number];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export class ValidationError extends Error {
  readonly field: string;

  constructor(field: string, message: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(field, `${field} must be a string`);
  }
  return value;
}

/** Generate a non-sequential identifier safe to expose in URLs. */
export function createId(): string {
  const runtimeCrypto = globalThis.crypto;
  if (!runtimeCrypto?.randomUUID) {
    throw new Error("Secure random UUID generation is unavailable");
  }
  return runtimeCrypto.randomUUID();
}

/** Generate an opaque token.  The raw value must only be returned to a client once. */
export function createOpaqueToken(byteLength = 32): string {
  if (!Number.isInteger(byteLength) || byteLength < 16 || byteLength > 128) {
    throw new ValidationError("byteLength", "opaque token length is out of range");
  }
  const runtimeCrypto = globalThis.crypto;
  if (!runtimeCrypto?.getRandomValues) {
    throw new Error("Secure random token generation is unavailable");
  }
  const bytes = new Uint8Array(byteLength);
  runtimeCrypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

/** Return the one canonical UTC timestamp representation used in D1. */
export function toUtcTimestamp(value: Date | number | string = new Date()): string {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("timestamp", "timestamp must be a valid date");
  }
  return date.toISOString();
}

export function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !UTC_TIMESTAMP_PATTERN.test(value)) return false;
  return toUtcTimestamp(value) === value;
}

export function normalizeEmail(value: unknown): string {
  const email = assertString(value, "email").normalize("NFKC").trim();
  const hasControlCharacter = [...email].some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
  if (email.length === 0 || email.length > 254 || hasControlCharacter) {
    throw new ValidationError("email", "email is invalid");
  }
  const normalized = email.toLocaleLowerCase("en-US");
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new ValidationError("email", "email is invalid");
  }
  return normalized;
}

/** Preserve a user-entered display value while deriving the lookup key. */
export function normalizeEmailFields(value: unknown): {
  email: string;
  emailNormalized: string;
} {
  const email = assertString(value, "email").normalize("NFKC").trim();
  return { email, emailNormalized: normalizeEmail(email) };
}

export function validateIanaTimezone(value: unknown): string {
  const timezone = assertString(value, "timezone").trim();
  if (timezone.length === 0 || timezone.length > 100) {
    throw new ValidationError("timezone", "timezone must be an IANA timezone");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new ValidationError("timezone", "timezone must be an IANA timezone");
  }
  return timezone;
}

export function isValidIanaTimezone(value: unknown): value is string {
  try {
    validateIanaTimezone(value);
    return true;
  } catch {
    return false;
  }
}

export function validateLocalDate(value: unknown): string {
  const localDate = assertString(value, "localDate");
  if (!LOCAL_DATE_PATTERN.test(localDate)) {
    throw new ValidationError("localDate", "localDate must use YYYY-MM-DD");
  }
  const parsed = new Date(`${localDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== localDate) {
    throw new ValidationError("localDate", "localDate is not a real calendar date");
  }
  return localDate;
}

/** Derive a household-local calendar date without relying on server locale. */
export function localDateFor(
  value: Date | number | string,
  timezone: unknown,
): string {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("timestamp", "timestamp must be a valid date");
  }
  const validTimezone = validateIanaTimezone(timezone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: validTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return validateLocalDate(
    `${values.get("year")}-${values.get("month")}-${values.get("day")}`,
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

export function validateTaskSchedule(value: unknown): TaskSchedule {
  if (!isPlainObject(value) || typeof value.type !== "string") {
    throw new ValidationError("schedule", "schedule is invalid");
  }

  if (value.type === "daily") {
    if (!hasOnlyKeys(value, ["type"])) {
      throw new ValidationError("schedule", "daily schedule has unsupported fields");
    }
    return { type: "daily" };
  }

  if (value.type === "weekdays") {
    if (!hasOnlyKeys(value, ["type", "days"]) || !Array.isArray(value.days)) {
      throw new ValidationError("schedule", "weekdays schedule is invalid");
    }
    if (value.days.length === 0 || value.days.length > 7) {
      throw new ValidationError("schedule.days", "at least one weekday is required");
    }
    const days = value.days.map((day) => {
      if (!Number.isInteger(day) || day < 1 || day > 7) {
        throw new ValidationError("schedule.days", "weekday must be an integer from 1 to 7");
      }
      return day as 1 | 2 | 3 | 4 | 5 | 6 | 7;
    });
    if (new Set(days).size !== days.length) {
      throw new ValidationError("schedule.days", "weekday values must be unique");
    }
    return { type: "weekdays", days: [...days].sort((a, b) => a - b) };
  }

  if (value.type === "one_off") {
    if (!hasOnlyKeys(value, ["type", "localDate"])) {
      throw new ValidationError("schedule", "one-off schedule has unsupported fields");
    }
    return { type: "one_off", localDate: validateLocalDate(value.localDate) };
  }

  throw new ValidationError("schedule.type", "schedule type is unsupported");
}

export function scheduleToStorage(schedule: unknown): {
  type: TaskScheduleType;
  data: string;
} {
  const validated = validateTaskSchedule(schedule);
  return { type: validated.type, data: JSON.stringify(validated) };
}

export function scheduleFromStorage(
  scheduleType: unknown,
  scheduleData: unknown,
): TaskSchedule {
  if (typeof scheduleType !== "string" || typeof scheduleData !== "string") {
    throw new ValidationError("schedule", "stored schedule is invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(scheduleData);
  } catch {
    throw new ValidationError("schedule", "stored schedule is invalid");
  }
  const schedule = validateTaskSchedule(parsed);
  if (schedule.type !== scheduleType) {
    throw new ValidationError("schedule", "stored schedule type does not match");
  }
  return schedule;
}

/** Weekday numbering is ISO: Monday = 1 … Sunday = 7. */
export function isTaskDueOnLocalDate(schedule: unknown, localDate: unknown): boolean {
  const validated = validateTaskSchedule(schedule);
  const date = validateLocalDate(localDate);
  if (validated.type === "daily") return true;
  if (validated.type === "one_off") return validated.localDate === date;
  const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay() || 7;
  return validated.days.includes(weekday as 1 | 2 | 3 | 4 | 5 | 6 | 7);
}

export function validateStars(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 3) {
    throw new ValidationError("stars", "stars must be an integer from 1 to 3");
  }
  return value as number;
}

export function validatePositiveStarCost(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new ValidationError("starCost", "starCost must be a positive integer");
  }
  return value as number;
}

export function validateAgeBand(value: unknown): AgeBand | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !(AGE_BANDS as readonly string[]).includes(value)) {
    throw new ValidationError("ageBand", "age band is unsupported");
  }
  return value as AgeBand;
}

export function validateEnum<T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new ValidationError(field, `${field} is unsupported`);
  }
  return value as T[number];
}

export function validateHouseholdRole(value: unknown): HouseholdRole {
  return validateEnum(value, HOUSEHOLD_ROLES, "role");
}

export function validateAuthChallengePurpose(value: unknown): AuthChallengePurpose {
  return validateEnum(value, AUTH_CHALLENGE_PURPOSES, "purpose");
}

export function validateTaskClaimStatus(value: unknown): TaskClaimStatus {
  return validateEnum(value, TASK_CLAIM_STATUSES, "status");
}

export function validateRewardRequestStatus(value: unknown): RewardRequestStatus {
  return validateEnum(value, REWARD_REQUEST_STATUSES, "status");
}

export function validateLedgerEventType(value: unknown): LedgerEventType {
  return validateEnum(value, LEDGER_EVENT_TYPES, "eventType");
}

export function validateClaimSubmitterType(value: unknown): ClaimSubmitterType {
  return validateEnum(value, CLAIM_SUBMITTER_TYPES, "submittedByType");
}
