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

export const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];
