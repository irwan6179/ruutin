/**
 * Parent-facing reward suggestions. These are application data, not D1 rows:
 * selecting one creates an editable household reward through the parent API.
 */
export type RewardTemplate = Readonly<{
  id: string;
  title: string;
  emoji: string;
  starCost: number;
}>;

export const REWARD_TEMPLATES = [
  {
    id: "choose-family-movie",
    title: "Choose the family movie",
    emoji: "🎬",
    starCost: 10,
  },
  {
    id: "choose-dessert",
    title: "Choose dessert",
    emoji: "🍰",
    starCost: 10,
  },
  {
    id: "extra-leisure-time",
    title: "Extra leisure time",
    emoji: "⏰",
    starCost: 20,
  },
  {
    id: "choose-weekend-activity",
    title: "Choose a weekend activity",
    emoji: "🌳",
    starCost: 30,
  },
  {
    id: "special-family-outing",
    title: "Special family outing",
    emoji: "🎉",
    starCost: 50,
  },
] as const satisfies readonly RewardTemplate[];

export function rewardTemplateById(templateId: string): RewardTemplate | null {
  return REWARD_TEMPLATES.find((template) => template.id === templateId) ?? null;
}
