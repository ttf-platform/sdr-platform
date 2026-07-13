export type SendingPrefs = {
  defaultSendTime: string;
  sendWindowStart: string;
  sendWindowEnd: string;
  sendDays: number[];
};

export const DEFAULT_SENDING_PREFS: SendingPrefs = {
  defaultSendTime: "09:00",
  sendWindowStart: "08:00",
  sendWindowEnd: "18:00",
  sendDays: [1, 2, 3, 4, 5],
};

// Day-of-week numeric values in user-facing order (Mon-first, Sun last).
// Labels resolved at render via useTranslations('components.sendingPreferences.days').
export const DAY_VALUES = [1, 2, 3, 4, 5, 6, 0] as const;
export type DayValue = typeof DAY_VALUES[number];
