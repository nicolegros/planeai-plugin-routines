/** How often run times are re-read and relative times like "in 3 minutes" redrawn. */
export const REFRESH_MS = 30_000;

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 86_400],
  ["month", 30 * 86_400],
  ["week", 7 * 86_400],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];
const relativeFormat = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });
const absoluteFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "in 3 hours", "tomorrow", "2 days ago". */
export function relative(target: Date, now: Date): string {
  const seconds = Math.round((target.getTime() - now.getTime()) / 1000);
  const unit = UNITS.find(([, size]) => Math.abs(seconds) >= size);
  if (!unit) return seconds >= 0 ? "in under a minute" : "just now";
  return relativeFormat.format(Math.round(seconds / unit[1]), unit[0]);
}

/** "Tue, Oct 6, 09:00", in the machine's time zone like the schedules. */
export function absolute(date: Date): string {
  return absoluteFormat.format(date);
}
