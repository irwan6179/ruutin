/** Client-safe contracts mirrored from server response shapes. */
export const COMPANION_CONSENT_COPY = "I confirm that the intended companion user meets the digital-consent age where we live.";

/** Under-13 profiles are parent-managed and never need a companion-age confirmation. */
export function requiresCompanionConsent(ageBand: string | null | undefined): boolean {
  return ageBand !== "under_13";
}

export const AGE_BAND_OPTIONS = [
  { value: "under_13", label: "Under 13" },
  { value: "13_15", label: "13–15" },
  { value: "16_17", label: "16–17" },
  { value: "18_plus", label: "18+" },
  { value: "not_provided", label: "Prefer not to say" },
] as const;

export type ParentProfile = {
  id: string;
  householdId: string;
  nickname: string;
  emoji: string;
  ageBand: string | null;
  companionAccessEligible: 0 | 1;
  activeRewardId: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type HouseholdRecord = { id: string; name: string; timezone: string; createdAt: string };

export type ParentDevice = {
  id: string;
  profileId: string;
  profileNickname: string;
  profileEmoji: string;
  deviceLabel: string;
  createdAt: string;
  lastSeenAt: string;
  revokedAt: string | null;
};

export type TaskSchedule =
  | { type: "daily" }
  | { type: "weekdays"; days: ReadonlyArray<number> }
  | { type: "one_off"; localDate: string };

export type ParentTask = {
  id: string;
  householdId: string;
  profileId: string;
  title: string;
  emoji: string;
  stars: number;
  schedule: TaskSchedule;
  position: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TaskOccurrence = ParentTask & {
  dueDate: string;
  /** `not_due` is management-view-only; due occurrences use the three task states. */
  state: "todo" | "waiting" | "completed" | "not_due";
  claimId: string | null;
  submittedAt: string | null;
};

export type OnboardingState = {
  activeStep: "household" | "profile" | "tasks";
  completedSteps: readonly string[];
  progressIndex: number;
  totalSteps: number;
  canGoBack: boolean;
  canSkip: boolean;
  isComplete: boolean;
};
