/**
 * content.js
 * - чекає #words (SPA)
 * - слухає .word.active/.word.current
 * - просить bg.js переклад, показує бульбашку над словом
 * - має кеш, дебаунс, затримку та "зависання" на екрані
 */

const LOG = "[MT cs]";
const DEFAULTS = {
  from: "en",
  to: "uk",
  minWordLen: 2,
  showDelayMs: 150,
  debounceMs: 150,
  lingerMs: 6000 
};

// кеш: слово→результат
const cache = new Map();

let cfg = { ...DEFAULTS };
let tip, tipTimer, hideTimer;
let lastWord = "";

init().catch(console.error);

async function init() {
  console.log(LOG, "init");
  tip = ensureTip();
  const wordsRoot = await waitForWordsRoot();
  console.log(LOG, "got #words:", !!wordsRoot);

  // MutationObserver для активного слова
  const obs = new MutationObserver(debounce(handleActiveChange, cfg.debounceMs));
  obs.observe(wordsRoot, { attributes: true, subtree: true, attributeFilter: ["class"] });

  handleActiveChange();
}

/* ---------------- DOM helpers ---------------- */

function ensureTip() {
  let el = document.getElementById("mt-tt");
  if (el) return el;
  el = document.createElement("div");
  el.id = "mt-tt";
  document.documentElement.appendChild(el);
  return el;
}

function waitForWordsRoot() {
  return new Promise((resolve) => {
    const check = () => {
      const el = document.querySelector("#words");
      if (el) return resolve(el);
      requestAnimationFrame(check);
    };
    check();
  });
}

function getActiveWordEl() {
  return (
    document.querySelector("#words .word.active") ||
    document.querySelector("#words .word.current") ||
    null
  );
}

function getWordText(el) {
  if (!el) return "";
  // у Monkeytype букви в <letter>, склеюємо
  const letters = Array.from(el.querySelectorAll("letter"));
  if (letters.length) return letters.map(l => l.textContent || "").join("");
  return (el.textContent || "").trim();
}

/* ---------------- logic ---------------- */

async function handleActiveChange() {
  const el = getActiveWordEl();
  if (!el) return;

  const raw = getWordText(el);
  if (!raw || raw.length < cfg.minWordLen) return;

  const word = normalizeWord(raw);
  if (lastWord === word) {
    console.log(LOG, "skip (same word)", word);
    return;
  }
  lastWord = word;

  const t0 = performance.now();

  // якщо в кеші — показуємо миттєво
  if (cache.has(word)) {
    const cached = cache.get(word);
    showBubble(el, formatResult(word, cached), performance.now() - t0);
    return;
  }

  // невелика затримка перед запитом (щоб не спамити на кожен символ)
  await sleep(cfg.showDelayMs);

  console.log(LOG, "ask bg ▶", { q: word });
  const ans = await askBackground(word);
  console.log(LOG, "ask bg ◀", ans);

  cache.set(word, ans);
  showBubble(el, formatResult(word, ans), performance.now() - t0);
}

function formatResult(word, ans) {
  if (!ans || !ans.ok) return `${word} → (—)`;
  if (ans.text) return `${word} → ${ans.text}`;
  if (ans.gloss || ans.ipa) {
    let s = `${word} — ${ans.gloss || "(def.)"}`;
    if (ans.ipa) s += `  /${ans.ipa}/`;
    return s;
  }
  return `${word} → (—)`;
}

function showBubble(targetEl, text, ms = 0) {
  if (!tip) tip = ensureTip();

  tip.textContent = text;

  // маленький бейдж ms (для дебагу)
  const small = document.createElement("small");
  small.textContent = `${Math.round(ms)}ms`;
  tip.appendChild(small);

  // позиціонування над словом
  const r = targetEl.getBoundingClientRect();
  const top = window.scrollY + r.top - 12;   
  const left = window.scrollX + r.left;

  tip.style.top = `${Math.max(0, top - tip.offsetHeight)}px`;
  tip.style.left = `${left}px`;

  // показ/сховати з "зависанням"
  clearTimeout(hideTimer);
  tip.classList.add("mt-show");
  hideTimer = setTimeout(() => {
    tip.classList.remove("mt-show");
  }, cfg.lingerMs);
}

/* ---------------- bg messaging ---------------- */

function askBackground(q) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "translate", q, cfg: { from: cfg.from, to: cfg.to } }, // api НЕ передаємо
      (response) => {
        // захист від lastError
        const res = response || { ok: false, error: chrome.runtime.lastError?.message || "no response" };
        resolve(res);
      }
    );
  });
}

/* ---------------- utils ---------------- */

function normalizeWord(w) {
  // прості евристики для monkeytype
  const s = w.toLowerCase();
  if (s.endsWith("ing") && s.length > 5) return s.slice(0, -3);
  if (s.endsWith("ed")  && s.length > 4) return s.slice(0, -2);
  if (s.endsWith("ies") && s.length > 4) return s.slice(0, -3) + "y";
  if (s.endsWith("es")  && s.length > 3) return s.slice(0, -2);
  if (s.endsWith("s")   && s.length > 3) return s.slice(0, -1);
  return s;
}

function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
