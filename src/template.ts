export interface TemplateContext {
  /** The occurrence being created, not the wall clock. */
  at: Date;
  routine: string;
}

const two = (value: number) => String(value).padStart(2, "0");
const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const month = new Intl.DateTimeFormat("en-US", { month: "long" });

/** ISO 8601 week number in local time: the week belongs to the year of its Thursday. */
function isoWeek(at: Date): number {
  const thursday = new Date(
    at.getFullYear(),
    at.getMonth(),
    at.getDate() + 3 - ((at.getDay() + 6) % 7),
  );
  // Rounded, since a daylight saving change makes a local day 23 or 25 hours long.
  const dayOfYear = Math.round(
    (thursday.getTime() - new Date(thursday.getFullYear(), 0, 1).getTime()) / 86_400_000,
  );
  return Math.floor(dayOfYear / 7) + 1;
}

const TABLE: Record<string, (context: TemplateContext) => string> = {
  date: ({ at }) => `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`,
  time: ({ at }) => `${two(at.getHours())}:${two(at.getMinutes())}`,
  weekday: ({ at }) => weekday.format(at),
  week: ({ at }) => String(isoWeek(at)),
  month: ({ at }) => month.format(at),
  year: ({ at }) => String(at.getFullYear()),
  routine: ({ routine }) => routine,
};

/** The placeholder names, for the editor's hint. */
export const PLACEHOLDERS = Object.keys(TABLE);

export function render(template: string, context: TemplateContext): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) =>
    Object.hasOwn(TABLE, name) ? TABLE[name](context) : match,
  );
}
