"use client";

import { useEffect, useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

/**
 * Tells the service worker the session is over so nothing it kept during it
 * survives on a shared device. Safe to call without a service worker.
 */
export function forgetServiceWorkerSession(): void {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: "logout" });
  } catch {
    // No service worker or messaging: nothing was kept.
  }
}

/** Registers the service worker and shows a clear banner while the device is offline. */
export function Pwa() {
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration is best effort; the app works without it.
    });
  }, []);
  if (online) return null;
  return (
    <div role="status" className="fixed inset-x-0 top-0 z-50 bg-warn px-4 py-1.5 text-center text-xs font-semibold text-canvas">
      You are offline. Showing what was loaded last; saving needs a connection.
    </div>
  );
}
