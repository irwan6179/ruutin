import type { ParentProfile } from "./profiles";

export const ONBOARDING_STEPS = [
  "household",
  "profile",
  "tasks",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/**
 * These names were used by the first version of onboarding. They remain
 * recognised as invalid/legacy destinations so a stale link can never open a
 * screen that is no longer part of the required setup journey.
 */
const LEGACY_ONBOARDING_STEPS = new Set(["review", "rewards", "pairing"]);

export type OnboardingCounts = {
  hasHousehold: boolean;
  profileCount: number;
  taskCount: number;
  /** Kept in the read contract for callers that already count reward rows. */
  rewardCount?: number;
};

export const ONBOARDING_ROUTINE_TARGET = 3;

export type OnboardingState = {
  activeStep: OnboardingStep;
  completedSteps: readonly OnboardingStep[];
  progressIndex: number;
  totalSteps: number;
  canGoBack: boolean;
  canSkip: boolean;
  isComplete: boolean;
};

/**
 * Durable state is derived from existing household/profile/task rows. Rewards
 * and companion pairing are intentionally not setup prerequisites: both are
 * useful follow-up actions once Today has something to work with.
 *
 * There is intentionally no client-controlled onboarding row or browser ID.
 * Existing rows remain the resume source, so a refresh cannot send a parent
 * back to a completed boundary or strand them at a removed one.
 */
export function deriveOnboardingState(
  counts: OnboardingCounts,
  options: { requestedStep?: unknown } = {},
): OnboardingState {
  const completed: OnboardingStep[] = [];
  if (counts.hasHousehold) completed.push("household");
  // Treat the milestones as a sequence even if a caller supplies malformed
  // counts. That prevents a contradictory state such as “tasks complete” for
  // a parent who has no household or profile yet.
  if (counts.hasHousehold && counts.profileCount > 0) completed.push("profile");
  if (
    counts.hasHousehold &&
    counts.profileCount > 0 &&
    counts.taskCount >= ONBOARDING_ROUTINE_TARGET
  ) completed.push("tasks");

  const firstIncomplete = ONBOARDING_STEPS.findIndex((step) => !completed.includes(step));
  const fallbackIndex = firstIncomplete < 0 ? ONBOARDING_STEPS.length - 1 : firstIncomplete;
  const requestedStep = typeof options.requestedStep === "string" ? options.requestedStep : "";
  const requestedIndex = LEGACY_ONBOARDING_STEPS.has(requestedStep)
    ? -1
    : ONBOARDING_STEPS.indexOf(requestedStep as OnboardingStep);
  // A browser may resume at an already-reached core step, but cannot jump past
  // the first incomplete boundary. Legacy reward/pairing links resolve to the
  // first incomplete core step instead of exposing a contradictory screen.
  const activeIndex = requestedIndex >= 0 && requestedIndex <= fallbackIndex
    ? requestedIndex
    : fallbackIndex;
  const activeStep = ONBOARDING_STEPS[activeIndex] ?? "household";
  const isComplete = completed.includes("tasks");
  return {
    activeStep,
    completedSteps: completed,
    progressIndex: activeIndex,
    totalSteps: ONBOARDING_STEPS.length,
    canGoBack: activeIndex > 0,
    // There is no safe “skip” action before household/profile/routines are
    // present. Follow-up rewards and pairing have their own contextual entry
    // points after setup, rather than being represented as skippable steps.
    canSkip: false,
    isComplete,
  };
}

export function nextOnboardingStep(
  state: OnboardingState,
  options: { pairingEligible?: boolean } = {},
): OnboardingStep {
  // Keep the optional argument source-compatible with callers from the
  // previous pairing-aware flow. Pairing no longer changes core progression.
  void options;
  return ONBOARDING_STEPS[Math.min(state.progressIndex + 1, ONBOARDING_STEPS.length - 1)] ?? "tasks";
}

export function onboardingProgressLabel(state: OnboardingState): string {
  return `Step ${Math.min(state.progressIndex + 1, state.totalSteps)} of ${state.totalSteps}`;
}

export function profileCanPair(profile: Pick<ParentProfile, "companionAccessEligible" | "archivedAt">): boolean {
  return profile.archivedAt === null && profile.companionAccessEligible === 1;
}
