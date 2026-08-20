import { getParentPageContext } from "../page-context";
import { getD1 } from "../../../db";
import { getParentSettings } from "../../../server/settings";
import { OnboardingPrompt } from "../onboarding/OnboardingPrompt";
import { SettingsManager } from "./SettingsManager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { parent } = await getParentPageContext();
  if (!parent) return <OnboardingPrompt />;
  const settings = await getParentSettings(getD1(), parent);
  return <SettingsManager initialSettings={settings} />;
}
