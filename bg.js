// bg.js — шле запит лише на твій Cloudflare Worker
const TAG = "[MT bg]";
console.log(TAG, "up at", new Date().toISOString());

// ⬇️ ПІДСТАВ СЮДИ СВІЙ URL ВОРКЕРА
const WORKER_API = "https://mt-translate-proxy.eclipses-ukr.workers.dev";

const DEFAULTS = {
  api: WORKER_API,
  from: "en",
  to: "uk",
  timeoutMs: 6000
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "translate") return;

  const started = performance.now();
  const q = (msg.q || "").trim();
  const cfg = { ...DEFAULTS, ...(msg.cfg || {}) };

  if (!q) {
    sendResponse({ ok: false, error: "empty q" });
    return;
  }

  console.log(TAG, "req ▶", { q, api: cfg.api, from: cfg.from, to: cfg.to });

  translateViaWorker(q, cfg)
    .then((res) => {
      const dur = Math.round(performance.now() - started);
      console.log(TAG, "res ◀", { q, ok: res.ok, dur, used: res.used || null });
      sendResponse(res);
    })
    .catch((err) => {
      const dur = Math.round(performance.now() - started);
      console.warn(TAG, "res ◀ ERR", { q, err: String(err), dur });
      sendResponse({ ok: false, error: String(err) });
    });

  return true; // async
});

async function translateViaWorker(q, cfg) {
  // mock-режим: постав api: "mock:" у content.js для діагностики
  if ((cfg.api || "").startsWith("mock:")) {
    await sleep(150);
    return { ok: true, text: `[mock] ${q}`, used: { api: "mock" } };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort("timeout"), cfg.timeoutMs || 6000);

  try {
    const res = await fetch(cfg.api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, source: cfg.from, target: cfg.to }),
      signal: ctrl.signal
    });

    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json().catch(() => ({}));

    // Пріоритет: переклад → (якщо немає) коротке визначення/IPA → порожньо.
    const text = (data.translatedText || "").trim();
    const gloss = (data.gloss || "").trim();
    const ipa = (data.ipa || "").trim();
    const used = data.used || null;

    if (text) return { ok: true, text, used };
    if (gloss || ipa) return { ok: true, gloss, ipa, used };
    return { ok: false, error: "empty", used };
  } finally {
    clearTimeout(t);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
