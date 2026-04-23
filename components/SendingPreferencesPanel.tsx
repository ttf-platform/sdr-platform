"use client";
import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { SendingPrefs, DEFAULT_SENDING_PREFS, DAYS } from "@/lib/types/sending-prefs";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function SendingPreferencesPanel({ open, onClose }: Props) {
  const [prefs, setPrefs] = useState<SendingPrefs>(DEFAULT_SENDING_PREFS);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/sending-preferences")
      .then(r => r.json())
      .then(d => { if (d?.prefs) setPrefs(d.prefs); })
      .finally(() => setLoading(false));
  }, [open]);

  const toggleDay = (d: number) => {
    setPrefs(p => ({
      ...p,
      sendDays: p.sendDays.includes(d)
        ? p.sendDays.filter(x => x !== d)
        : [...p.sendDays, d].sort((a, b) => a - b)
    }));
  };

  const save = async () => {
    setSaving(true);
    await fetch("/api/sending-preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prefs })
    });
    setSaving(false);
    onClose();
  };

  const reset = () => setPrefs(DEFAULT_SENDING_PREFS);

  const activeDays = DAYS.filter(d => prefs.sendDays.includes(d.value)).map(d => d.label);
  const daysLabel = activeDays.length === 0
    ? "no days selected"
    : activeDays.length === 7
    ? "every day"
    : activeDays.join(", ");

  if (!open) return null;

  return (
    <div className="bg-white border border-[#e8e3dc] rounded-xl mb-6">
      <div className="flex items-start justify-between p-6 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-[#1a1a2e]">Sending Preferences</h2>
          <p className="text-sm text-[#8a7e6e] mt-1">Control when your emails are delivered to prospects.</p>
        </div>
        <button onClick={onClose} className="text-[#8a7e6e] hover:text-[#1a1a2e]" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="border-t border-[#e8e3dc] px-6 py-5 space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm text-[#1a1a2e] w-36">Default send time</label>
          <input
            type="time"
            value={prefs.defaultSendTime}
            onChange={e => setPrefs(p => ({ ...p, defaultSendTime: e.target.value }))}
            className="px-3 py-1.5 border border-[#e8e3dc] rounded-md text-sm bg-white text-[#1a1a2e]"
          />
          <span className="text-sm text-[#8a7e6e]">recipient’s local time</span>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm text-[#1a1a2e] w-36">Send window</label>
          <input
            type="time"
            value={prefs.sendWindowStart}
            onChange={e => setPrefs(p => ({ ...p, sendWindowStart: e.target.value }))}
            className="px-3 py-1.5 border border-[#e8e3dc] rounded-md text-sm bg-white text-[#1a1a2e]"
          />
          <span className="text-sm text-[#8a7e6e]">to</span>
          <input
            type="time"
            value={prefs.sendWindowEnd}
            onChange={e => setPrefs(p => ({ ...p, sendWindowEnd: e.target.value }))}
            className="px-3 py-1.5 border border-[#e8e3dc] rounded-md text-sm bg-white text-[#1a1a2e]"
          />
        </div>

        <div>
          <label className="text-sm text-[#1a1a2e] block mb-2">Send days</label>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map(d => {
              const active = prefs.sendDays.includes(d.value);
              return (
                <button
                  key={d.value}
                  onClick={() => toggleDay(d.value)}
                  className={
                    "px-4 py-1.5 rounded-full text-sm border transition-colors " +
                    (active
                      ? "border-[#3b6bef] text-[#3b6bef] bg-[#3b6bef]/5"
                      : "border-[#e8e3dc] text-[#8a7e6e] bg-white hover:bg-[#f5f2ee]")
                  }
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="text-sm text-[#8a7e6e] bg-[#f5f2ee] rounded-md px-3 py-2">
          Emails will send {daysLabel} between {prefs.sendWindowStart} and {prefs.sendWindowEnd}, recipient’s local time.
        </div>
      </div>

      <div className="flex justify-end gap-2 px-6 py-4 border-t border-[#e8e3dc]">
        <button
          onClick={reset}
          className="px-4 py-2 text-sm border border-[#e8e3dc] rounded-md text-[#1a1a2e] bg-white hover:bg-[#f5f2ee]"
        >
          Reset
        </button>
        <button
          onClick={save}
          disabled={saving || loading}
          className="px-4 py-2 text-sm bg-[#3b6bef] text-white rounded-md hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save sending preferences"}
        </button>
      </div>
    </div>
  );
}
