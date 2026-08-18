import { getParentPageContext } from "../page-context";
import { getD1 } from "../../../db";
import { listProfilesForParent } from "../../../server/profiles";
import { listDevicesForParent } from "../../../server/devices";
import { OnboardingPrompt } from "../onboarding/OnboardingPrompt";
import { FamilyManager } from "./FamilyManager";

export const dynamic = "force-dynamic";

export default async function FamilyPage() {
  const { parent } = await getParentPageContext();
  if (!parent) return <OnboardingPrompt />;
  const db = getD1();
  const [profiles, devices] = await Promise.all([listProfilesForParent(db, parent), listDevicesForParent(db, parent)]);
  return <FamilyManager initialProfiles={profiles} initialDevices={devices} />;
}
