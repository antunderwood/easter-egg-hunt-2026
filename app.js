(function () {
  "use strict";

  const TSV_URL = "questions.tsv";
  const CELEBRATE_MS = 1200;
  const STORAGE_KEY = "quizProgressTsvV1";

  const questionEl = document.getElementById("question");
  const answerInput = document.getElementById("answer");
  const form = document.getElementById("quiz-form");
  const statusEl = document.getElementById("status");
  const celebrationEl = document.getElementById("celebration");
  const finaleOverlay = document.getElementById("finale-overlay");
  const submitBtn = form.querySelector(".submit");
  const progressBarWrap = document.getElementById("progress-bar-wrap");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");
  const resetProgressBtn = document.getElementById("reset-progress");

  /** @type {{ question: string, answer: string }[]} */
  let items = [];
  /** Reveal text from last TSV row when answer column is empty (not a quiz question). */
  let finaleReveal = null;
  let index = 0;
  let busy = false;
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }

  function playTaDa() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    const peak = 0.38;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + i * 0.12);
      gain.gain.setValueAtTime(0, now + i * 0.12);
      gain.gain.linearRampToValueAtTime(peak, now + i * 0.12 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.4);
    });
  }

  /**
   * Three-note “sad trombone” (wah-wah-waaaah); last slide ends on the same low pitch
   * as the previous four-slide version (~58 Hz). Synthesized.
   */
  function playBuzzer() {
    const ctx = getAudioContext();
    let t = ctx.currentTime;
    const peak = 0.4;
    const lowNoteHz = 58;
    /** @type {{ start: number, end: number, dur: number, gap: number, final?: boolean }} */
    const slides = [
      { start: 505, end: 340, dur: 0.5, gap: 0.06 },
      { start: 395, end: 265, dur: 0.48, gap: 0.06 },
      { start: 315, end: lowNoteHz, dur: 2.05, gap: 0, final: true },
    ];

    slides.forEach((s) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = "sawtooth";
      filter.type = "lowpass";
      filter.Q.value = 0.7;

      const fEnd = Math.max(s.end, 55);
      osc.frequency.setValueAtTime(s.start, t);
      osc.frequency.exponentialRampToValueAtTime(fEnd, t + s.dur);

      const openHz = s.final ? 4200 : 3400;
      const shutHz = s.final ? 520 : 650;
      filter.frequency.setValueAtTime(openHz, t);
      filter.frequency.exponentialRampToValueAtTime(shutHz, t + s.dur * 0.72);

      const attack = s.final ? 0.08 : 0.055;
      const mid = s.final ? peak * 0.82 : peak * 0.92;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + attack);
      gain.gain.linearRampToValueAtTime(mid, t + s.dur * (s.final ? 0.35 : 0.42));
      gain.gain.exponentialRampToValueAtTime(0.001, t + s.dur);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + s.dur + 0.04);
      t += s.dur + s.gap;
    });
  }

  function playBrassHit(ctx, t0, freq, dur, peak) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = "sawtooth";
    filter.type = "lowpass";
    filter.Q.value = 0.8;
    filter.frequency.setValueAtTime(2600, t0);
    filter.frequency.exponentialRampToValueAtTime(550, t0 + dur * 0.65);
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.035);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.03);
  }

  /** Triumphant fanfare when the treasure location is revealed. */
  function playFanfare() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const peak = 0.3;
    const melody = [
      { t: 0, f: 392, d: 0.22 },
      { t: 0.2, f: 493.88, d: 0.22 },
      { t: 0.4, f: 587.33, d: 0.24 },
      { t: 0.62, f: 783.99, d: 0.38 },
      { t: 1.05, f: 1046.5, d: 0.5 },
    ];
    melody.forEach((m) => playBrassHit(ctx, now + m.t, m.f, m.d, peak));
    const chordT = now + 1.55;
    const chordPeak = peak * 0.42;
    [392, 493.88, 587.33, 783.99].forEach((f) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const filt = ctx.createBiquadFilter();
      osc.type = "triangle";
      filt.type = "lowpass";
      filt.frequency.setValueAtTime(3200, chordT);
      filt.frequency.exponentialRampToValueAtTime(900, chordT + 1.1);
      osc.frequency.setValueAtTime(f, chordT);
      g.gain.setValueAtTime(0, chordT);
      g.gain.linearRampToValueAtTime(chordPeak, chordT + 0.06);
      g.gain.exponentialRampToValueAtTime(0.001, chordT + 1.55);
      osc.connect(filt);
      filt.connect(g);
      g.connect(ctx.destination);
      osc.start(chordT);
      osc.stop(chordT + 1.6);
    });
  }

  function clearFinaleOverlay() {
    finaleOverlay.classList.remove("is-active");
    finaleOverlay.innerHTML = "";
    finaleOverlay.hidden = true;
    finaleOverlay.setAttribute("aria-hidden", "true");
  }

  function spawnFireworkBurst() {
    const xPct = 8 + Math.random() * 84;
    const yPct = 15 + Math.random() * 45;
    const cx = (xPct / 100) * window.innerWidth;
    const cy = (yPct / 100) * window.innerHeight;
    const baseHue = Math.random() * 360;
    const sparkCount = 20;
    for (let s = 0; s < sparkCount; s++) {
      const sp = document.createElement("div");
      sp.className = "finale-spark";
      sp.style.left = `${cx}px`;
      sp.style.top = `${cy}px`;
      const ang = (s / sparkCount) * Math.PI * 2 + Math.random() * 0.25;
      const dist = 45 + Math.random() * 75;
      sp.style.background = `hsl(${(baseHue + s * 14) % 360}, 92%, 62%)`;
      sp.style.boxShadow = `0 0 6px ${sp.style.background}`;
      sp.style.setProperty(
        "--spark-drift",
        `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist}px)`
      );
      sp.style.animationDelay = `${Math.random() * 0.06}s`;
      finaleOverlay.appendChild(sp);
      window.setTimeout(() => sp.remove(), 950);
    }
  }

  function startFinaleVisuals() {
    const reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    finaleOverlay.hidden = false;
    finaleOverlay.classList.add("is-active");
    finaleOverlay.setAttribute("aria-hidden", "false");
    finaleOverlay.innerHTML = "";
    if (reduced) {
      window.setTimeout(clearFinaleOverlay, 2800);
      return;
    }
    const colors = [
      "#f472b6",
      "#60a5fa",
      "#fbbf24",
      "#a78bfa",
      "#34d399",
      "#f87171",
      "#fde047",
      "#fff",
      "#22d3ee",
      "#fb923c",
    ];
    for (let i = 0; i < 60; i++) {
      const el = document.createElement("div");
      el.className = "finale-ticker-piece";
      el.style.left = `${Math.random() * 100}%`;
      el.style.background = colors[i % colors.length];
      el.style.animationDuration = `${4 + Math.random() * 5.5}s`;
      el.style.animationDelay = `${Math.random() * 2.2}s`;
      finaleOverlay.appendChild(el);
    }
    let bursts = 0;
    const maxBursts = 16;
    const timer = window.setInterval(() => {
      if (bursts++ >= maxBursts) {
        window.clearInterval(timer);
        window.setTimeout(clearFinaleOverlay, 4000);
        return;
      }
      spawnFireworkBurst();
    }, 300);
  }

  /**
   * Parse TSV text; tab separates columns. Quoted fields may contain tabs/commas; "" is escaped quote.
   * @param {string} text
   * @returns {string[][]}
   */
  function parseTsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let i = 0;
    let inQuotes = false;

    while (i < text.length) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === "\t") {
        row.push(field);
        field = "";
        i++;
        continue;
      }
      if (c === "\r") {
        i++;
        continue;
      }
      if (c === "\n") {
        row.push(field);
        if (row.some((cell) => cell.length > 0)) {
          rows.push(row);
        }
        row = [];
        field = "";
        i++;
        continue;
      }
      field += c;
      i++;
    }
    row.push(field);
    if (row.some((cell) => cell.length > 0)) {
      rows.push(row);
    }
    return rows;
  }

  /** Trim, collapse spaces, lowercase — text answers are matched case-insensitively. */
  function normalizeAnswer(s) {
    return s.trim().replace(/\s+/g, " ").toLowerCase();
  }

  /** Split on commas; drop duplicates that only differ by letter case (or spacing). */
  function splitAnswerAlternatives(answerCell) {
    const raw = answerCell
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const seenText = new Set();
    const seenRange = new Set();
    const out = [];
    for (const alt of raw) {
      const range = parseNumericRange(alt);
      if (range) {
        const key = `${range.min},${range.max}`;
        if (seenRange.has(key)) continue;
        seenRange.add(key);
        out.push(alt);
        continue;
      }
      const textKey = normalizeAnswer(alt);
      if (seenText.has(textKey)) continue;
      seenText.add(textKey);
      out.push(alt);
    }
    return out;
  }

  /**
   * If this alternative is two numbers separated by -, –, or —, treat as an inclusive numeric range.
   * Example: "1-10", "3.5 – 4.5"
   * @param {string} answerTrimmed expected alternative, already .trim()
   * @returns {{ min: number, max: number } | null}
   */
  function parseNumericRange(answerTrimmed) {
    const m = answerTrimmed.match(
      /^(-?\d+(?:\.\d+)?)\s*[-\u2013\u2014]\s*(-?\d+(?:\.\d+)?)$/
    );
    if (!m) return null;
    const a = parseFloat(m[1]);
    const b = parseFloat(m[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }

  /** Strict single number for user input when the expected answer is a range. */
  function parseStrictUserNumber(s) {
    const u = s.trim();
    if (!/^[-+]?(?:\d+\.?\d*|\.\d+)$/.test(u)) return NaN;
    const n = parseFloat(u);
    return Number.isFinite(n) ? n : NaN;
  }

  function answerMatchesSingleAlternative(altTrimmed, userRaw) {
    if (!altTrimmed) return false;
    const range = parseNumericRange(altTrimmed);
    if (range) {
      const n = parseStrictUserNumber(userRaw);
      if (Number.isNaN(n)) return false;
      return n >= range.min && n <= range.max;
    }
    return normalizeAnswer(altTrimmed) === normalizeAnswer(userRaw);
  }

  /** Any comma-separated alternative can be correct (range or text match). */
  function answerMatches(expectedRaw, userRaw) {
    const alts = splitAnswerAlternatives(expectedRaw);
    if (alts.length === 0) return false;
    return alts.some((alt) => answerMatchesSingleAlternative(alt, userRaw));
  }

  /** Fingerprint quiz content (and optional finale line) for sessionStorage. */
  function quizSignature(list, finale) {
    let h = 5381;
    const body = list.map((i) => i.question + "\t" + i.answer).join("\n");
    const fin = finale ? "\n@@FINALE@@\t" + finale : "";
    const s = body + fin;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) ^ s.charCodeAt(i);
    }
    return list.length + ":" + (h >>> 0).toString(36);
  }

  function finaleFxStorageKey() {
    return STORAGE_KEY + ":finaleFx:" + quizSignature(items, finaleReveal || "");
  }

  function loadSavedProgress(sig) {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.sig === sig && typeof data.index === "number") {
        return data.index;
      }
    } catch (_) {}
    return null;
  }

  function persistProgress() {
    if (items.length === 0) return;
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          sig: quizSignature(items, finaleReveal || ""),
          index: index,
        })
      );
    } catch (_) {}
  }

  function clearSavedProgress() {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }

  function progressPercent() {
    if (items.length === 0) return 0;
    if (index >= items.length) return 100;
    return Math.round((index / items.length) * 100);
  }

  function updateProgressUI() {
    if (items.length === 0) {
      progressBarWrap.hidden = true;
      resetProgressBtn.hidden = true;
      return;
    }
    progressBarWrap.hidden = false;
    resetProgressBtn.hidden = false;
    const pct = progressPercent();
    progressFill.style.width = pct + "%";
    progressTrack.setAttribute("aria-valuenow", String(pct));
    progressTrack.setAttribute(
      "aria-valuetext",
      index >= items.length
        ? "Quiz complete"
        : `${pct}% complete, question ${index + 1} of ${items.length}`
    );
  }

  function showCelebration() {
    const reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    celebrationEl.innerHTML = "";
    const ring = document.createElement("div");
    ring.className = "celebration-ring";
    celebrationEl.appendChild(ring);

    if (!reduced) {
      const colors = ["#6ee7b7", "#34d399", "#fbbf24", "#f472b6", "#60a5fa", "#a78bfa"];
      const n = 28;
      for (let p = 0; p < n; p++) {
        const dot = document.createElement("span");
        dot.className = "particle";
        const angle = (p / n) * Math.PI * 2;
        const dist = 80 + Math.random() * 100;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        dot.style.background = colors[p % colors.length];
        dot.style.left = "50%";
        dot.style.top = "50%";
        dot.style.marginLeft = "-5px";
        dot.style.marginTop = "-5px";
        dot.style.setProperty("--tx", `translate(${tx}px, ${ty}px)`);
        dot.style.animationDelay = `${p * 0.02}s`;
        celebrationEl.appendChild(dot);
      }
    }

    celebrationEl.classList.add("is-active");
    const onEnd = () => {
      celebrationEl.classList.remove("is-active");
      celebrationEl.removeEventListener("animationend", onEnd);
    };
    celebrationEl.addEventListener("animationend", onEnd, { once: true });
  }

  function shakePage() {
    document.body.classList.remove("shake");
    void document.body.offsetWidth;
    document.body.classList.add("shake");
    const done = () => {
      document.body.classList.remove("shake");
      document.body.removeEventListener("animationend", done);
    };
    document.body.addEventListener("animationend", done, { once: true });
  }

  function updateStatus() {
    if (items.length === 0) {
      statusEl.textContent = "";
      return;
    }
    if (index >= items.length) {
      statusEl.textContent = "All done!";
      return;
    }
    statusEl.textContent = `Question ${index + 1} of ${items.length}`;
  }

  resetProgressBtn.addEventListener("click", () => {
    if (items.length === 0) return;
    clearSavedProgress();
    try {
      sessionStorage.removeItem(finaleFxStorageKey());
    } catch (_) {}
    index = 0;
    busy = false;
    clearFinaleOverlay();
    showCurrentQuestion();
  });

  function showCurrentQuestion() {
    if (index >= items.length) {
      form.hidden = true;
      answerInput.value = "";
      answerInput.disabled = true;
      submitBtn.disabled = true;
      questionEl.classList.remove("finale-location");
      if (finaleReveal) {
        questionEl.textContent = finaleReveal;
        questionEl.classList.add("finale-location");
        statusEl.textContent = "You found it!";
        const fxKey = finaleFxStorageKey();
        let played = false;
        try {
          played = sessionStorage.getItem(fxKey) === "1";
        } catch (_) {}
        if (!played) {
          try {
            sessionStorage.setItem(fxKey, "1");
          } catch (_) {}
          const reducedMotion =
            window.matchMedia &&
            window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (!reducedMotion) {
            void (async () => {
              try {
                await getAudioContext().resume();
              } catch (_) {}
              playFanfare();
            })();
          }
          startFinaleVisuals();
        }
      } else {
        questionEl.textContent = "Great job — you finished every question.";
        statusEl.textContent = "All done!";
        clearFinaleOverlay();
      }
      updateProgressUI();
      persistProgress();
      return;
    }
    form.hidden = false;
    questionEl.textContent = items[index].question;
    questionEl.classList.remove("finale-location");
    answerInput.value = "";
    answerInput.disabled = false;
    submitBtn.disabled = false;
    updateStatus();
    updateProgressUI();
    persistProgress();
    answerInput.focus();
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || index >= items.length) return;

    const raw = answerInput.value;
    if (!answerMatches(items[index].answer, raw)) {
      try {
        await getAudioContext().resume();
      } catch (_) {}
      playBuzzer();
      shakePage();
      answerInput.focus();
      answerInput.select();
      return;
    }

    busy = true;
    answerInput.disabled = true;
    submitBtn.disabled = true;

    try {
      await getAudioContext().resume();
    } catch (_) {}
    playTaDa();
    showCelebration();

    window.setTimeout(() => {
      index += 1;
      busy = false;
      showCurrentQuestion();
    }, CELEBRATE_MS);
  });

  async function init() {
    try {
      const res = await fetch(TSV_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const rows = parseTsv(text);
      if (rows.length < 2) {
        throw new Error("TSV needs a header row and at least one question.");
      }
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const qIdx = header.indexOf("question");
      const aIdx = header.indexOf("answer");
      if (qIdx === -1 || aIdx === -1) {
        throw new Error('TSV must have columns named "question" and "answer" (tab-separated).');
      }
      items = [];
      finaleReveal = null;
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const q = (row[qIdx] ?? "").trim();
        const a = (row[aIdx] ?? "").trim();
        if (!q && !a) continue;
        items.push({ question: q, answer: a });
      }
      if (items.length > 0) {
        const last = items[items.length - 1];
        if (last.answer.trim() === "" && last.question.trim() !== "") {
          finaleReveal = last.question.trim();
          items.pop();
        }
      }
      if (items.length === 0) {
        throw new Error("No questions found in TSV (finale-only file is not enough).");
      }
      const sig = quizSignature(items, finaleReveal || "");
      const saved = loadSavedProgress(sig);
      if (saved !== null && saved >= 0 && saved <= items.length) {
        index = saved;
      } else {
        index = 0;
        if (saved !== null) clearSavedProgress();
      }
      showCurrentQuestion();
    } catch (err) {
      questionEl.textContent = "Could not load questions.";
      statusEl.textContent = err instanceof Error ? err.message : String(err);
      progressBarWrap.hidden = true;
      resetProgressBtn.hidden = true;
      form.hidden = false;
      answerInput.disabled = true;
      submitBtn.disabled = true;
    }
  }

  init();
})();
