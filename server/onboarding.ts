import type { ParentProfile } from "./profiles";

export const ONBOARDING_STEPS = [
  "household",
  "profile",
  "tasks",
  "review",
  "rewards",
  "pairing",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export type OnboardingCounts = {
  hasHousehold: boolean;
  profileCount: number;
  taskCount: number;
  rewardCount: number;
};

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
 * Durable state is derived from existing household/profile/task/reward rows.
 * There is intentionally no client-controlled onboarding row or browser ID;
 * later task/reward steps can be added without inventing fake persistence.
 */
export function deriveOnboardingState(
  counts: OnboardingCounts,
  options: { requestedStep?: unknown } = {},
): OnboardingState {
  const completed: OnboardingStep[] = [];
  if (counts.hasHousehold) completed.push("household");
  if (counts.profileCount > 0) completed.push("profile");
  if (counts.taskCount > 0) completed.push("tasks");
  if (counts.taskCount > 0) completed.push("review");
  if (counts.rewardCount > 0) completed.push("rewards");

  const firstIncomplete = ONBOARDING_STEPS.findIndex((step) => !completed.includes(step));
  const fallbackIndex = firstIncomplete < 0 ? ONBOARDING_STEPS.length - 1 : firstIncomplete;
  const requestedIndex = typeof options.requestedStep === "string"
    ? ONBOARDING_STEPS.indexOf(options.requestedStep as OnboardingStep)
    : -1;
  // A browser may resume at an already-reached step, but cannot jump past the
  // first incomplete required boundary. Pairing is optional and is never a
  // prerequisite for completion.
  const activeIndex = requestedIndex >= 0 && requestedIndex <= fallbackIndex
    ? requestedIndex
    : fallbackIndex;
  const activeStep = ONBOARDING_STEPS[activeIndex] ?? "household";
  const canSkip = activeStep === "pairing";
  const isComplete = counts.hasHousehold && counts.profileCount > 0 && counts.taskCount > 0 && counts.rewardCount > 0;
  return {
    activeStep,
    completedSteps: completed,
    progressIndex: activeIndex,
    totalSteps: ONBOARDING_STEPS.length,
    canGoBack: activeIndex > 0,
    canSkip,
    isComplete,
  };
}

export function nextOnboardingStep(
  state: OnboardingState,
  options: { pairingEligible?: boolean } = {},
): OnboardingStep {
  if (state.activeStep === "pairing" || (state.activeStep === "rewards" && options.pairingEligible === false)) {
    return "pairing";
  }
  return ONBOARDING_STEPS[Math.min(state.progressIndex + 1, ONBOARDING_STEPS.length - 1)] ?? "pairing";
}

export function onboardingProgressLabel(state: OnboardingState): string {
  return `Step ${Math.min(state.progressIndex + 1, state.totalSteps)} of ${state.totalSteps}`;
}

export function profileCanPair(profile: Pick<ParentProfile, "companionAccessEligible" | "archivedAt">): boolean {
  return profile.archivedAt === null && profile.companionAccessEligible === 1;
}
