import { getParentPageContext } from "../page-context";
import { getD1 } from "../../../db";
import { listProfilesForParent } from "../../../server/profiles";
import { listDevicesForParent } from "../../../server/devices";
import { listTasksForParent } from "../../../server/tasks";
import { getParentHousehold } from "../../../server/households";
import { localDateFor } from "../../../server/validation";
import { OnboardingPrompt } from "../onboarding/OnboardingPrompt";
import { FamilyManager } from "./FamilyManager";

export const dynamic = "force-dynamic";

export default async function FamilyPage() {
  const { parent } = await getParentPageContext();
  if (!parent) return <OnboardingPrompt />;
  const db = getD1();
  const [profiles, devices, household] = await Promise.all([listProfilesForParent(db, parent), listDevicesForParent(db, parent), getParentHousehold(db, parent)]);
  const firstProfile = profiles.find((profile) => !profile.archivedAt);
  const tasks = firstProfile ? await listTasksForParent(db, parent, firstProfile.id) : [];
  return <FamilyManager initialProfiles={profiles} initialDevices={devices} initialTasks={tasks} initialLocalDate={localDateFor(new Date(), household.timezone)} initialTimezone={household.timezone} />;
}
