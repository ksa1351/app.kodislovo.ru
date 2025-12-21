(function () {
  "use strict";

  // ========= helpers =========
  const THEME_KEY = "kodislovo_theme";
  const LS_PREFIX = "kodislovo_control:";
  const $ = (id) => document.getElementById(id);

  function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
  function getParam(name) { return new URLSearchParams(window.location.search).get(name); }
  function nowIso() { return new Date().toISOString(); }
  function safeText(s) { return (s ?? "").toString().trim(); }
  function normalizeAnswer(s) { return safeText(s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim(); }

  // IMPORTANT: папка /controls/ в корне сайта, а control.html в /control/
  function variantsBase(subject) {
    return new URL(`../controls/${encodeURIComponent(subject)}/variants/`, window.location.href).toString();
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Не удалось загрузить: ${url} (HTTP ${r.status})`);
    return await r.json();
  }

  function downloadJson(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ========= theme =========
  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    return prefersLight ? "light" : "dark";
  }
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    const lab = $("themeLabel");
    if (lab) lab.textContent = theme === "light" ? "Светлая" : "Тёмная";
  }
  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "light" ? "dark" : "light");
  }

  // ========= state =========
  let subject = getParam("subject") || "russian";
  let base = variantsBase(subject);

  let manifest = null;
  let variantMeta = null;
  let variantData = null;
  let currentVariantId = null;
  let currentVariantFile = null;

  let startedAt = null;
  let finishedAt = null;
  let isFinished = false;

  let timeLimitSec = null;
  let timerTick = null;

  let answersMap = {};
  let currentTaskIndex = 0;

  function lsKey() {
    return `${LS_PREFIX}${subject}:${currentVariantId || "variant"}`;
  }

  function saveProgress() {
    if (!currentVariantId) return;
    const payload = {
      schema: "kodislovo.control.v1",
      subject,
      variantId: currentVariantId,
      variantFile: currentVariantFile,
      startedAt,
      finishedAt,
      isFinished,
      student: {
        name: safeText($("studentName")?.value),
        class: safeText($("studentClass")?.value),
      },
      answers: JSON.parse(JSON.stringify(answersMap)),
      currentTaskIndex,
      savedAt: nowIso(),
    };
    localStorage.setItem(lsKey(), JSON.stringify(payload));
  }

  function loadProgress() {
    const raw = localStorage.getItem(lsKey());
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  // ========= header =========
  function setHeader() {
    setText("uiMainTitle", variantMeta?.title || "Контрольная работа");
    setText("uiSubtitle",
      variantMeta?.subtitle ||
      "Заполните данные, выполните задания, нажмите «Завершить», затем «Сохранить»."
    );
  }

  // ========= scoring (для результата) =========
  function checkOne(task, studentAnswerRaw) {
    const acceptable = (task.answers || []).map(normalizeAnswer);
    const a = normalizeAnswer(studentAnswerRaw);
    if (!a) return { ok: false, earned: 0 };
    const ok = acceptable.includes(a);
    return { ok, earned: ok ? Number(task.points ?? 1) : 0 };
  }

  function calcScore() {
    const tasks = variantData?.tasks || [];
    let earned = 0, max = 0;
    const perTask = [];

    for (const task of tasks) {
      const pts = Number(task.points ?? 1);
      max += pts;

      const studentRaw = answersMap[String(task.id)] ?? "";
      const res = checkOne(task, studentRaw);
      earned += res.earned;

      perTask.push({
        id: task.id,
        earned: res.earned,
        max: pts,
        ok: res.ok,
        student: safeText(studentRaw),
        accepted: (task.answers || []).slice(0),
      });
    }

    const percent = max > 0 ? Math.round((earned / max) * 100) : 0;
    return { earned, max, percent, perTask };
  }

  // ========= timer =========
  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function setTimerUI(text) {
    setText("uiTimer", text);
  }

  function startTimerIfNeeded() {
    clearInterval(timerTick);
    timerTick = null;

    if (!timeLimitSec || !startedAt) {
      setTimerUI("без лимита");
      return;
    }

    const startMs = new Date(startedAt).getTime();
    timerTick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const left = timeLimitSec - elapsed;
      setTimerUI(formatTime(left));
      if (!isFinished && left <= 0) finishNow(true);
    }, 250);
  }

  // ========= finish =========
  function applyFinishedState() {
    const btnFinish = $("btnFinish");
    const btnSaveCloud = $("btnSaveCloud");
    const btnReset = $("btnReset");
    const resetCode = $("resetCode");

    if (btnFinish) {
      btnFinish.textContent = isFinished ? "Завершено" : "Завершить";
      btnFinish.disabled = isFinished;
    }
    if (btnSaveCloud) btnSaveCloud.disabled = !isFinished;

    // reset доступен всегда (по коду)
    if (btnReset) btnReset.disabled = false;
    if (resetCode) resetCode.disabled = false;

    const inputs = document.querySelectorAll("#studentName,#studentClass,#variantSelect,#taskOne input");
    inputs.forEach((el) => { el.disabled = isFinished; });
  }

  function buildResultPayload() {
    const score = calcScore();
    return {
      schema: "kodislovo.result.v1",
      createdAt: nowIso(),
      startedAt,
      finishedAt,
      isFinished,
      subject,
      subjectTitle: manifest?.subjectTitle || subject,
      variant: {
        id: currentVariantId,
        file: currentVariantFile,
        title: variantMeta?.title || "",
        subtitle: variantMeta?.subtitle || ""
      },
      grading: {
        maxPoints: score.max,
        earnedPoints: score.earned,
        percent: score.percent
      },
      student: {
        name: safeText($("studentName")?.value),
        class: safeText($("studentClass")?.value)
      },
      answers: JSON.parse(JSON.stringify(answersMap)),
      perTask: score.perTask,
      meta: JSON.parse(JSON.stringify(variantMeta || {})),
      userAgent: navigator.userAgent
    };
  }

  function finishNow(auto = false) {
    if (isFinished) return;
    isFinished = true;
    finishedAt = nowIso();
    saveProgress();
    applyFinishedState();
    alert(auto ? "Время вышло. Контрольная завершена автоматически." : "Контрольная завершена. Теперь нажмите «Сохранить».");
  }

  // ========= sticky texts by range =========
  let stickyCollapsed = false;

  function getTextRangesFromMeta() {
    const texts = variantMeta?.texts || {};
    const blocks = Object.values(texts)
      .map(t => {
        const r = Array.isArray(t.range) ? t.range : null;
        const from = r ? Number(r[0]) : NaN;
        const to = r ? Number(r[1]) : NaN;
        return { title: t.title || "Текст", from, to, html: t.html || "" };
      })
      .filter(b => Number.isFinite(b.from) && Number.isFinite(b.to) && b.html);

    blocks.sort((a, b) => a.from - b.from);
    return blocks;
  }

  function setStickyVisible(visible) {
    const wrap = $("stickyTextWrap");
    if (!wrap) return;
    wrap.classList.toggle("kd-hidden", !visible);
  }

  function setStickyContent(block) {
    const title = $("stickyTextTitle");
    const range = $("stickyTextRange");
    const body = $("stickyTextBody");
    if (!title || !range || !body) return;

    title.textContent = block.title;
    range.textContent = `задания ${block.from}–${block.to}`;
    body.innerHTML = block.html;

    body.style.display = stickyCollapsed ? "none" : "";
    const btn = $("stickyToggle");
    if (btn) btn.textContent = stickyCollapsed ? "Показать" : "Скрыть";
  }

  function findBlockForTask(blocks, taskId) {
    if (!taskId) return null;
    for (const b of blocks) if (taskId >= b.from && taskId <= b.to) return b;
    return null;
  }

  // ========= render ONE task =========
  let stickyBlocks = [];
  function renderCurrentTask() {
    const cont = $("taskOne");
    if (!cont) return;

    const tasks = variantData?.tasks || [];
    if (!tasks.length) {
      cont.innerHTML = "<div class='kd-task'>Нет заданий в варианте.</div>";
      setStickyVisible(false);
      return;
    }

    currentTaskIndex = Math.max(0, Math.min(currentTaskIndex, tasks.length - 1));
    const task = tasks[currentTaskIndex];

    const block = findBlockForTask(stickyBlocks, Number(task.id));
    if (block) {
      setStickyVisible(true);
      setStickyContent(block);
    } else {
      setStickyVisible(false);
    }

    cont.innerHTML = `
      <section class="kd-stage">
        <section class="kd-task" data-task-id="${String(task.id)}">
          <h3>Задание ${task.id}</h3>
          ${task.hint ? `<div class="hint">${task.hint}</div>` : ""}
          <div class="q">${task.text || ""}</div>

          <input class="kd-answer" id="answerInput" type="text" placeholder="Введите ответ…" autocomplete="off" spellcheck="false">

          <div class="kd-nav">
            <button class="kd-btn secondary" id="btnPrev" type="button">← Предыдущее</button>
            <button class="kd-btn secondary" id="btnNext" type="button">Следующее →</button>
          </div>
        </section>
      </section>
    `;

    const inp = $("answerInput");
    const saved = answersMap[String(task.id)];
    if (inp && typeof saved === "string") inp.value = saved;

    inp?.addEventListener("input", () => {
      if (isFinished) return;
      answersMap[String(task.id)] = inp.value;
      saveProgress();
    });

    $("btnPrev")?.addEventListener("click", () => {
      if (currentTaskIndex > 0) {
        currentTaskIndex--;
        saveProgress();
        renderCurrentTask();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    $("btnNext")?.addEventListener("click", () => {
      if (currentTaskIndex < tasks.length - 1) {
        currentTaskIndex++;
        saveProgress();
        renderCurrentTask();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    if (isFinished) {
      inp && (inp.disabled = true);
    }
  }

  // ========= cloud submit =========
  async function submitToCloud(payload) {
    const url = manifest?.submit?.url;
    const token = manifest?.submit?.token;
    if (!url || !token) throw new Error("В manifest.json не задан submit.url или submit.token");

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Submit-Token": token
      },
      body: JSON.stringify(payload)
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* ignore */ }

    if (!r.ok) {
      throw new Error(data?.message || data?.error || `HTTP ${r.status}: ${text}`);
    }
    return data || { ok: true };
  }

  // ========= reset by code =========
  async function consumeResetCode({ subject, variant, cls, fio, code }) {
    const baseUrl = manifest?.teacher?.base_url;
    const token = manifest?.teacher?.token;
    if (!baseUrl || !token) throw new Error("В manifest.json не задан teacher.base_url или teacher.token");

    const url = baseUrl.replace(/\/+$/, "") + "/teacher/reset/consume";
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Teacher-Token": token
      },
      body: JSON.stringify({ subject, variant, cls, fio, code })
    });

    const txt = await r.text();
    let obj = null;
    try { obj = JSON.parse(txt); } catch { /* ignore */ }

    if (!r.ok) throw new Error(obj?.message || obj?.error || `HTTP ${r.status}: ${txt}`);
    if (!obj?.ok) throw new Error(obj?.error || "Сброс не выполнен");
    return obj;
  }

  function clearLocalAttempt() {
    localStorage.removeItem(lsKey());
    answersMap = {};
    currentTaskIndex = 0;
    startedAt = nowIso();
    finishedAt = null;
    isFinished = false;
  }

  // ========= load =========
  function extractVariantMeta(v) {
    return v.meta || {};
  }

  async function loadManifest() {
    manifest = await fetchJson(base + "manifest.json");

    const sel = $("variantSelect");
    if (!sel) throw new Error("В control.html нет <select id='variantSelect'>");

    sel.innerHTML = "";
    (manifest.variants || []).forEach((v, idx) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.title || v.id;
      opt.dataset.file = v.file;
      sel.appendChild(opt);
      if (idx === 0) {
        currentVariantId = v.id;
        currentVariantFile = v.file;
      }
    });

    if (sel.options.length) {
      sel.value = currentVariantId;
      currentVariantFile = sel.options[sel.selectedIndex].dataset.file;
    } else {
      throw new Error("manifest.json: список variants пустой");
    }

    sel.addEventListener("change", async () => {
      if (isFinished) return;
      currentVariantId = sel.value;
      currentVariantFile = sel.options[sel.selectedIndex].dataset.file;
      await loadVariant(currentVariantFile);
    });
  }

  async function loadVariant(file) {
    variantData = await fetchJson(base + file);
    variantMeta = extractVariantMeta(variantData);

    const tlm = Number(variantMeta.time_limit_minutes || 0);
    timeLimitSec = tlm > 0 ? tlm * 60 : null;

    const progress = loadProgress();
    startedAt = progress?.startedAt || nowIso();
    finishedAt = progress?.finishedAt || null;
    isFinished = Boolean(progress?.isFinished);

    if (progress?.student?.name && $("studentName")) $("studentName").value = progress.student.name;
    if (progress?.student?.class && $("studentClass")) $("studentClass").value = progress.student.class;

    answersMap = progress?.answers || {};
    currentTaskIndex = Number.isFinite(progress?.currentTaskIndex) ? progress.currentTaskIndex : 0;

    setHeader();

    stickyBlocks = getTextRangesFromMeta();

    $("stickyToggle")?.addEventListener("click", () => {
      stickyCollapsed = !stickyCollapsed;
      const body = $("stickyTextBody");
      if (body) body.style.display = stickyCollapsed ? "none" : "";
      const btn = $("stickyToggle");
      if (btn) btn.textContent = stickyCollapsed ? "Показать" : "Скрыть";
    });

    renderCurrentTask();
    applyFinishedState();
    startTimerIfNeeded();

    $("studentName")?.addEventListener("input", () => { if (!isFinished) saveProgress(); });
    $("studentClass")?.addEventListener("input", () => { if (!isFinished) saveProgress(); });
  }

  // ========= init =========
  async function init() {
    setTheme(getPreferredTheme());

    // theme by click (no checkbox)
    $("themeBtn")?.addEventListener("click", () => toggleTheme());

    $("btnFinish")?.addEventListener("click", () => finishNow(false));

    $("btnSaveCloud")?.addEventListener("click", async () => {
      if (!isFinished) return;
      const btn = $("btnSaveCloud");
      if (btn) { btn.disabled = true; btn.textContent = "Сохранение…"; }

      try {
        const payload = buildResultPayload();

        // локально тоже сохраним файл (на всякий)
        const n = safeText(payload.student.name).replace(/[^\p{L}\p{N}\s._-]+/gu, "").replace(/\s+/g, "_");
        const c = safeText(payload.student.class).replace(/[^\p{L}\p{N}\s._-]+/gu, "").replace(/\s+/g, "_");
        const fn = `result_${subject}_${currentVariantId}_${c || "class"}_${n || "student"}.json`;
        downloadJson(fn, payload);

        // и в облако
        const res = await submitToCloud(payload);
        alert("Работа сохранена ✅\n" + (res?.key ? `Ключ: ${res.key}` : ""));
      } catch (e) {
        console.error(e);
        alert("Сохранение в облако не удалось ❗\n" + e.message);
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = "Сохранить"; }
      }
    });

    $("btnReset")?.addEventListener("click", async () => {
      const code = safeText($("resetCode")?.value);
      if (!code) { alert("Введите код сброса."); return; }

      const fio = safeText($("studentName")?.value);
      const cls = safeText($("studentClass")?.value);
      if (!fio || !cls) { alert("Для сброса заполните ФИО и класс."); return; }
      if (!currentVariantId) { alert("Не выбран вариант."); return; }

      const yes = confirm("Сбросить попытку на этом устройстве?\nВсе введённые ответы будут удалены.");
      if (!yes) return;

      try {
        await consumeResetCode({
          subject,
          variant: currentVariantId,
          cls,
          fio,
          code
        });

        clearLocalAttempt();
        saveProgress();
        applyFinishedState();
        renderCurrentTask();
        startTimerIfNeeded();

        $("resetCode").value = "";
        alert("Сброс выполнен ✅ Можно проходить заново.");
      } catch (e) {
        console.error(e);
        alert("Сброс не выполнен ❗\n" + e.message);
      }
    });

    await loadManifest();
    await loadVariant(currentVariantFile);
  }

  init().catch((err) => {
    console.error(err);

    const hint =
      `Subject: ${subject}\n` +
      `Ожидаем manifest:\n${base}manifest.json\n` +
      `Ожидаем variant:\n${base}${currentVariantFile || "variant_01.json"}\n\n` +
      `Проверь:\n` +
      `1) что manifest.json лежит в /controls/${subject}/variants/manifest.json\n` +
      `2) что control.html лежит в /control/control.html\n` +
      `3) что подключён CSS: /assets/css/control-ui.css\n`;

    alert("Ошибка загрузки контрольной: " + err.message + "\n\n" + hint);
  });
})();
