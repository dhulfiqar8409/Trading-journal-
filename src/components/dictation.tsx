"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type RecognitionCtor = new () => RecognitionLike;

function ctor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const subscribe = () => () => {};

/**
 * Dictate into a textarea through the Web Speech API. Renders nothing when
 * the browser has no speech recognition, so the form is unchanged elsewhere.
 */
export function DictationButton({ targetId, lang }: { targetId: string; lang?: string }) {
  const supported = useSyncExternalStore(subscribe, () => ctor() !== null, () => false);
  const [listening, setListening] = useState(false);
  const recognition = useRef<RecognitionLike | null>(null);

  useEffect(() => () => recognition.current?.stop(), []);

  if (!supported) return null;

  function toggle() {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = ctor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = lang ?? navigator.language ?? "en-US";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event) => {
      const target = document.getElementById(targetId) as HTMLTextAreaElement | HTMLInputElement | null;
      if (!target) return;
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) text += result[0].transcript;
      }
      if (!text.trim()) return;
      const separator = target.value && !/\s$/.test(target.value) ? " " : "";
      target.value = `${target.value}${separator}${text.trim()}`;
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recognition.current = rec;
    rec.start();
    setListening(true);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={listening}
      className={`btn btn-sm ${listening ? "border-signature text-signature" : ""}`}
      title="Dictate"
    >
      <span className={`h-2 w-2 rounded-full ${listening ? "animate-pulse bg-loss-mark" : "bg-muted"}`} aria-hidden />
      {listening ? "Stop" : "Dictate"}
    </button>
  );
}
