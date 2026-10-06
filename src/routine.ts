export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

/** Every schedule compiles to one cron expression; `time` is a local "HH:MM". */
export type Schedule =
  | { kind: "weekly"; time: string; weekdays: Weekday[] }
  | { kind: "monthly"; time: string; day: number }
  | { kind: "cron"; expression: string };
