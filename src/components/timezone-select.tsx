"use client";

import { useSyncExternalStore } from "react";

const FALLBACK = ["UTC"];

let cachedZones: string[] | null = null;
let cachedDetected: string | null = null;

function zonesSnapshot(): string[] {
  if (!cachedZones) {
    try {
      const zones = Intl.supportedValuesOf("timeZone");
      cachedZones = zones.includes("UTC") ? zones : ["UTC", ...zones];
    } catch {
      cachedZones = FALLBACK;
    }
  }
  return cachedZones;
}

function detectedSnapshot(): string {
  if (cachedDetected === null) {
    try {
      cachedDetected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      cachedDetected = "UTC";
    }
  }
  return cachedDetected;
}

const subscribe = () => () => {};

/**
 * Time zone picker. Without an explicit value it defaults to the browser's
 * zone once hydrated, so the first-run form starts where the owner actually is.
 */
export function TimeZoneSelect({ name, defaultValue, id }: { name: string; defaultValue?: string; id?: string }) {
  const zones = useSyncExternalStore(subscribe, zonesSnapshot, () => FALLBACK);
  const detected = useSyncExternalStore(subscribe, detectedSnapshot, () => "UTC");
  const initial = defaultValue ?? detected;
  const options = zones.includes(initial) ? zones : [initial, ...zones];
  return (
    <select key={initial} id={id} name={name} className="input" defaultValue={initial}>
      {options.map((z) => (
        <option key={z} value={z}>
          {z.replace(/_/g, " ")}
        </option>
      ))}
    </select>
  );
}
