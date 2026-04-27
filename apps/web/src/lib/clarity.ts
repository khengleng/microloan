"use client";

type ClarityCall =
  | ['event', string]
  | ['set', string, string | number | boolean]
  | ['identify', string, string?, string?, string?];

declare global {
  interface Window {
    clarity?: (...args: ClarityCall) => void;
  }
}

let initialized = false;

function projectId(): string {
  return (process.env.NEXT_PUBLIC_CLARITY_PROJECT_ID || '').trim();
}

export function isClarityEnabled(): boolean {
  return typeof window !== 'undefined' && !!projectId();
}

export function initClarity() {
  if (!isClarityEnabled() || initialized) return;

  const id = projectId();

  const w = window as Window & { clarity?: ((...args: ClarityCall) => void) & { q?: ClarityCall[] } };
  w.clarity = w.clarity || ((...args: ClarityCall) => {
    w.clarity!.q = w.clarity!.q || [];
    w.clarity!.q!.push(args);
  });

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${id}`;
  const firstScript = document.getElementsByTagName('script')[0] ?? null;
  if (firstScript?.parentNode) {
    firstScript.parentNode.insertBefore(script, firstScript);
  } else {
    document.head.appendChild(script);
  }

  initialized = true;
}

export function clarityEvent(eventName: string) {
  if (!isClarityEnabled() || !eventName) return;
  window.clarity?.('event', eventName);
}

export function claritySetTag(key: string, value: string | number | boolean) {
  if (!isClarityEnabled() || !key) return;
  window.clarity?.('set', key, value);
}

export function clarityIdentify(customId: string, sessionId?: string, pageId?: string, userHint?: string) {
  if (!isClarityEnabled() || !customId) return;
  window.clarity?.('identify', customId, sessionId, pageId, userHint);
}
