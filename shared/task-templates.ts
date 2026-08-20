/**
 * Version-controlled routine suggestions. These are application content, not
 * D1 rows: selecting a suggestion copies it into the parent's editable task
 * list through the normal task API.
 */

export type TemplateSchedule =
  | { type: "daily" }
  | { type: "weekdays"; days: ReadonlyArray<1 | 2 | 3 | 4 | 5 | 6 | 7> }
  | { type: "one_off"; localDate: string };

export type TaskTemplate = {
  id: string;
  title: string;
  emoji: string;
  stars: 1 | 2 | 3;
  schedule: TemplateSchedule;
  /** The source brief requires the parent to choose these weekdays explicitly. */
  scheduleMode?: "parent_selected_days";
};

export type RoutineCategory = {
  id: string;
  label: string;
  emoji: string;
  description: string;
  templates: readonly TaskTemplate[];
};

const WEEKDAYS = [1, 2, 3, 4, 5] as const;
const WEEKEND = [6, 7] as const;

export const ROUTINE_CATEGORIES = [
  {
    id: "morning",
    label: "Morning routine",
    emoji: "🌤️",
    description: "A gentle start before the day gets busy.",
    templates: [
      { id: "morning-make-bed", title: "Make the bed", emoji: "🛏️", stars: 1, schedule: { type: "weekdays", days: WEEKDAYS } },
      { id: "morning-brush-teeth", title: "Brush teeth", emoji: "🪥", stars: 1, schedule: { type: "daily" } },
      { id: "morning-get-dressed", title: "Get dressed", emoji: "👕", stars: 1, schedule: { type: "weekdays", days: WEEKDAYS } },
      { id: "morning-pack-water", title: "Pack water bottle", emoji: "🚰", stars: 1, schedule: { type: "weekdays", days: WEEKDAYS } },
      { id: "morning-ready", title: "Be ready by the agreed time", emoji: "⏰", stars: 2, schedule: { type: "weekdays", days: WEEKDAYS } },
    ],
  },
  {
    id: "school-preparation",
    label: "School preparation",
    emoji: "🎒",
    description: "Small checks that make tomorrow feel lighter.",
    templates: [
      { id: "school-pack-bag", title: "Pack school bag", emoji: "🎒", stars: 1, schedule: { type: "weekdays", days: WEEKDAYS } },
      { id: "school-timetable", title: "Check tomorrow’s timetable", emoji: "🗓️", stars: 1, schedule: { type: "weekdays", days: WEEKDAYS } },
      { id: "school-clothes", title: "Prepare school clothes", emoji: "👚", stars: 1, schedule: { type: "weekdays", days: WEEKDAYS } },
      { id: "school-work", title: "Put completed work in the bag", emoji: "📚", stars: 2, schedule: { type: "weekdays", days: WEEKDAYS } },
    ],
  },
  {
    id: "homework-reading",
    label: "Homework and reading",
    emoji: "📖",
    description: "Focused time with a soft landing at the end.",
    templates: [
      { id: "homework-finish", title: "Finish assigned homework", emoji: "✏️", stars: 2, schedule: { type: "weekdays", days: WEEKDAYS } },
      { id: "homework-read", title: "Read for 15 minutes", emoji: "📖", stars: 2, schedule: { type: "daily" } },
      { id: "homework-review", title: "Review today’s lesson", emoji: "🔎", stars: 2, schedule: { type: "weekdays", days: WEEKDAYS } },
      { id: "homework-away", title: "Put books away after studying", emoji: "📚", stars: 1, schedule: { type: "weekdays", days: WEEKDAYS } },
    ],
  },
  {
    id: "personal-care",
    label: "Personal care",
    emoji: "🧴",
    description: "Add the care rituals that fit your family.",
    templates: [],
  },
  {
    id: "helping-at-home",
    label: "Helping at home",
    emoji: "🏡",
    description: "Shared jobs that help everyone breathe easier.",
    templates: [
      { id: "home-clear-plate", title: "Clear plate after eating", emoji: "🍽️", stars: 1, schedule: { type: "daily" } },
      { id: "home-laundry-basket", title: "Put clothes in the laundry basket", emoji: "🧺", stars: 1, schedule: { type: "daily" } },
      { id: "home-table", title: "Help set or clear the table", emoji: "🍴", stars: 2, schedule: { type: "weekdays", days: WEEKEND }, scheduleMode: "parent_selected_days" },
      { id: "home-fold-laundry", title: "Help fold laundry", emoji: "🧺", stars: 2, schedule: { type: "weekdays", days: WEEKEND }, scheduleMode: "parent_selected_days" },
      { id: "home-rubbish", title: "Take out household rubbish", emoji: "♻️", stars: 2, schedule: { type: "weekdays", days: WEEKEND }, scheduleMode: "parent_selected_days" },
    ],
  },
  {
    id: "bedroom-belongings",
    label: "Bedroom and belongings",
    emoji: "🧸",
    description: "Make space for the things that matter.",
    templates: [
      { id: "bedroom-away", title: "Put belongings away", emoji: "🧸", stars: 1, schedule: { type: "daily" } },
      { id: "bedroom-clothes", title: "Put dirty clothes in the basket", emoji: "👚", stars: 1, schedule: { type: "daily" } },
      { id: "bedroom-table", title: "Clear the study table", emoji: "🖇️", stars: 1, schedule: { type: "daily" } },
      { id: "bedroom-tidy", title: "Tidy the bedroom", emoji: "🧹", stars: 3, schedule: { type: "weekdays", days: WEEKEND } },
    ],
  },
  {
    id: "bedtime",
    label: "Bedtime routine",
    emoji: "🌙",
    description: "A predictable close to the day.",
    templates: [
      { id: "bedtime-shower-teeth", title: "Shower and brush teeth", emoji: "🛁", stars: 1, schedule: { type: "daily" } },
      { id: "bedtime-clothes", title: "Prepare clothes for tomorrow", emoji: "👕", stars: 1, schedule: { type: "weekdays", days: WEEKDAYS } },
      { id: "bedtime-devices", title: "Put devices away at the agreed time", emoji: "📵", stars: 2, schedule: { type: "daily" } },
      { id: "bedtime-bed", title: "Be in bed by the agreed time", emoji: "🌙", stars: 2, schedule: { type: "daily" } },
    ],
  },
  {
    id: "weekend-responsibilities",
    label: "Weekend responsibilities",
    emoji: "🌿",
    description: "Keep weekends kind, useful, and unhurried.",
    templates: [],
  },
] as const satisfies readonly RoutineCategory[];

export const ROUTINE_CATEGORY_IDS = ROUTINE_CATEGORIES.map((category) => category.id);

export function templateById(templateId: string): TaskTemplate | null {
  for (const category of ROUTINE_CATEGORIES) {
    const found = category.templates.find((template) => template.id === templateId);
    if (found) return found;
  }
  return null;
}
