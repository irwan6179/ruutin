import { AGE_BANDS, type AgeBand, validateAgeBand, ValidationError } from "./validation";

/**
 * Launch policy for profile-scoped companion access.
 *
 * The confirmation is deliberately not persisted as a second child field:
 * `companion_access_eligible` is the server authority. A parent must confirm
 * the local digital-consent threshold whenever eligibility is established or
 * an age band is changed. An omitted band is never an implicit yes.
 */
export const COMPANION_CONSENT_COPY =
  "I confirm that the intended companion user meets the digital-consent age where we live.";

export const AGE_BAND_OPTIONS: ReadonlyArray<{
  value: AgeBand;
  label: string;
}> = Object.freeze([
  { value: "under_13", label: "Under 13" },
  { value: "13_15", label: "13–15" },
  { value: "16_17", label: "16–17" },
  { value: "18_plus", label: "18+" },
  { value: "not_provided", label: "Prefer not to say" },
]);

export type EligibilityInput = {
  ageBand: unknown;
  consentConfirmed: unknown;
};

export function companionAccessEligibility(input: EligibilityInput): boolean {
  const ageBand = validateAgeBand(input.ageBand);
  if (ageBand === "under_13") return false;
  // Boolean true is required even when the broad band is omitted/not_provided.
  return input.consentConfirmed === true;
}

export function resolveCompanionEligibility(
  ageBand: unknown,
  consentConfirmed: unknown,
): 0 | 1 {
  return companionAccessEligibility({ ageBand, consentConfirmed }) ? 1 : 0;
}

export function assertEligibilityInput(
  ageBand: unknown,
  consentConfirmed: unknown,
): { ageBand: AgeBand | null; companionAccessEligible: 0 | 1 } {
  const normalizedAgeBand = validateAgeBand(ageBand);
  // Under-13 is always ineligible, so a consent checkbox is not required to
  // record a parent-managed profile. Every other/omitted band requires an
  // explicit boolean confirmation.
  if (normalizedAgeBand !== "under_13" && consentConfirmed !== true && consentConfirmed !== false) {
    throw new ValidationError("consentConfirmed", "consent confirmation is required");
  }
  return {
    ageBand: normalizedAgeBand,
    companionAccessEligible: resolveCompanionEligibility(normalizedAgeBand, consentConfirmed),
  };
}

export function isAgeBand(value: unknown): value is AgeBand {
  return typeof value === "string" && (AGE_BANDS as readonly string[]).includes(value);
}
