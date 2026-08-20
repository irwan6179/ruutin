import { getD1 } from "../../../db";
import { getCompanionRewards, getCompanionToday } from "../../../server/companion";
import { getServerConfig } from "../../../server/config";
import { getCompanionPageContext } from "../page-context";
import { ExperiencePing } from "../../components/ExperiencePing";
import { CompanionTodayManager } from "./CompanionTodayManager";

export const dynamic = "force-dynamic";

export default async function CompanionTodayPage() {
  const context = await getCompanionPageContext();
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  const db = getD1();
  const [today, rewards] = await Promise.all([getCompanionToday(db, context), getCompanionRewards(db, context)]);
  return <><ExperiencePing eventName="companion_today_opened" /><CompanionTodayManager initialToday={{ ...today, balance: rewards.balance, activeReward: rewards.activeReward ? { title: rewards.activeReward.title, emoji: rewards.activeReward.emoji, starCost: rewards.activeReward.starCost } : null }} /></>;
}
