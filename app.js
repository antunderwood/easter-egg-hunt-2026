(function () {
  "use strict";

  const CSV_URL = "questions.csv";
  const CELEBRATE_MS = 1200;
  const STORAGE_KEY = "csvQuizProgressV1";

  const questionEl = document.getElementById("question");
  const answerInput = document.getElementById("answer");
  const form = document.getElementById("quiz-form");
  const statusEl = document.getElementById("status");
  const celebrationEl = document.getElementById("celebration");
  const submitBtn = form.querySelector(".submit");
  const progressBarWrap = document.getElementById("progress-bar-wrap");
  const progressTrack = document.getElementById("progress-track");
  const progressFill = document.getElementById("progress-fill");
  const resetProgressBtn = document.getElementById("reset-progress");

  /** @type {{ question: string, answer: string }[]} */
  let items = [];
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

  /** Three descending “wah” sweeps (sad trombone style). */
  function playBuzzer() {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const wahCount = 3;
    const wahDuration = 0.48;
    const gap = 0.08;
    const peak = 0.42;
    const fHi = 420;
    const fLo = 85;

    for (let w = 0; w < wahCount; w++) {
      const t0 = now + w * (wahDuration + gap);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.setValueAtTime(fHi, t0);
      osc.frequency.exponentialRampToValueAtTime(fLo, t0 + wahDuration);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peak, t0 + 0.05);
      gain.gain.linearRampToValueAtTime(peak * 0.88, t0 + wahDuration * 0.45);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + wahDuration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + wahDuration + 0.03);
    }
  }

  /**
   * Parse CSV text; handles quoted fields with commas and escaped quotes.
   * @param {string} text
   * @returns {string[][]}
   */
  function parseCsv(text) {
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
      if (c === ",") {
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

  function normalizeAnswer(s) {
    return s.trim().replace(/\s+/g, " ").toLowerCase();
  }

  /**
   * If the CSV answer is two numbers separated by -, –, or —, treat as an inclusive numeric range.
   * Example: "1-10", "3.5 – 4.5"
   * @param {string} answerTrimmed expected answer, already .trim()
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

  function answerMatches(expectedRaw, userRaw) {
    const trimmedExpected = expectedRaw.trim();
    const range = parseNumericRange(trimmedExpected);
    if (range) {
      const n = parseStrictUserNumber(userRaw);
      if (Number.isNaN(n)) return false;
      return n >= range.min && n <= range.max;
    }
    return normalizeAnswer(expectedRaw) === normalizeAnswer(userRaw);
  }

  /** Fingerprint quiz content so we do not restore the wrong index after CSV edits. */
  function quizSignature(list) {
    let h = 5381;
    const s = list.map((i) => i.question + "\t" + i.answer).join("\n");
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) ^ s.charCodeAt(i);
    }
    return list.length + ":" + (h >>> 0).toString(36);
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
          sig: quizSignature(items),
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
    resetProgressBtn.hidden = index >= items.length;
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
    index = 0;
    busy = false;
    showCurrentQuestion();
  });

  function showCurrentQuestion() {
    if (index >= items.length) {
      questionEl.textContent = "Great job — you finished every question.";
      answerInput.value = "";
      answerInput.disabled = true;
      submitBtn.disabled = true;
      updateStatus();
      updateProgressUI();
      persistProgress();
      return;
    }
    questionEl.textContent = items[index].question;
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
      const res = await fetch(CSV_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const rows = parseCsv(text);
      if (rows.length < 2) {
        throw new Error("CSV needs a header row and at least one question.");
      }
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const qIdx = header.indexOf("question");
      const aIdx = header.indexOf("answer");
      if (qIdx === -1 || aIdx === -1) {
        throw new Error('CSV must have columns named "question" and "answer".');
      }
      items = [];
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const q = (row[qIdx] ?? "").trim();
        const a = (row[aIdx] ?? "").trim();
        if (!q && !a) continue;
        items.push({ question: q, answer: a });
      }
      if (items.length === 0) {
        throw new Error("No questions found in CSV.");
      }
      const sig = quizSignature(items);
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
      answerInput.disabled = true;
      submitBtn.disabled = true;
    }
  }

  init();
})();
