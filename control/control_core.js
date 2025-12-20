(function () {
  "use strict";

  const THEME_KEY = "kodislovo_theme";
  const LS_PREFIX = "kodislovo_control:";
  const $ = (id) => document.getElementById(id);

  function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
  function setHTML(id, html) { const el = $(id); if (el) el.innerHTML = html; }
  function getParam(name) { return new URLSearchParams(window.location.search).get(name); }
  function nowIso() { return new Date().toISOString(); }
  function safeText(s) { return (s ?? "").toString().trim(); }
  function normalizeAnswer(s) {
    return safeText(s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  }

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

  function mailto(to, subject, body) {
    const href = "mailto:" + encodeURIComponent(to)
      + "?subject=" + encodeURIComponent(subject)
      + "&body=" + encodeURIComponent(body);
    window.location.href = href;
  }

  // theme
  function getPreferredTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") return saved;
    const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
    return prefersLight ? "light" : "dark";
  }
  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
    const t = $("themeToggle");
    const lab = $("themeLabel");
    if (t) t.checked = theme === "light";
    if (lab) lab.textContent = theme === "light" ? "Светлая" : "Тёмная";
  }

  // state
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

  function lsKey() { return `${LS_PREFIX}${subject}:${currentVariantId || "variant"}`; }
  function getTasks() { return variantData?.tasks || []; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function taskIndexById(id) {
    const tasks = getTasks();
    const n = Number(id);
    return tasks.findIndex(t => Number(t.id) === n);
  }

  function saveProgress() {
    if (!currentVariantId) return;
    const tasks = getTasks();
    const curTaskId = tasks[currentTaskIndex]?.id ?? null;

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
      currentTaskId: curTaskId,
      savedAt: nowIso(),
    };
    localStorage.setItem(lsKey(), JSON.stringify(payload));
  }

  function loadProgress() {
    const raw = localStorage.getItem(lsKey());
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  // header (НЕ показываем subtitle из meta)
  function setHeader() {
    setText("uiSubject", manifest?.subjectTitle || "Контрольная");
    setText("uiTitle", variantMeta?.title || "Контрольная работа");
    setText("uiMainTitle", variantMeta?.title || "Контрольная работа");

    // нейтрально, без оценивания/баллов/перевода
    setText("uiSubtitle", "Заполните данные ученика и выполняйте задания. Ответы сохраняются автоматически.");
  }

  // texts by range
  function getTextBlocks() {
    const texts = variantMeta?.texts || {};
    const blocks = Object.values(texts)
      .map(t => {
        const r = Array.isArray(t.range) ? t.range : null;
        const from = r ? Number(r[0]) : NaN;
        const to = r ? Number(r[1]) : NaN;
        return { title: t.title || "Текст", from, to, html: t.html || "" };
      })
      .filter(b => Number.isFinite(b.from) && Number.isFinite(b.to) && b.html)
      .sort((a, b) => a.from - b.from);
    return blocks;
  }

  function findTextForTaskId(taskId) {
    const blocks = getTextBlocks();
    for (const b of blocks) {
      if (taskId >= b.from && taskId <= b.to) return b;
    }
    return null;
  }

  // timer
  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${hh}:${mm}:${ss}`;
  }

  function startTimerIfNeeded() {
    clearInterval(timerTick);
    timerTick = null;

    if (!timeLimitSec || !startedAt) {
      setText("uiTimer", "без лимита");
      return;
    }

    const startMs = new Date(startedAt).getTime();
    timerTick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const left = timeLimitSec - elapsed;
      setText("uiTimer", formatTime(left));
      if (!isFinished && left <= 0) finishNow(true);
    }, 250);
  }

  function applyFinishedState() {
    const btnFinish = $("btnFinish");
    const btnDownload = $("btnDownload");
    const btnEmail = $("btnEmail");

    if (btnFinish) {
      btnFinish.textContent = isFinished ? "Завершено" : "Завершить";
      btnFinish.disabled = isFinished;
    }
    if (btnDownload) btnDownload.disabled = !isFinished;
    if (btnEmail) btnEmail.disabled = !isFinished;

    const inputs = document.querySelectorAll("#studentName,#studentClass,#variantSelect");
    inputs.forEach((el) => { el.disabled = isFinished; });
  }

  function buildResultPayload() {
    // данные для проверки/учителя остаются в JSON (это не UI)
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
      student: {
        name: safeText($("studentName")?.value),
        class: safeText($("studentClass")?.value)
      },
      answers: JSON.parse(JSON.stringify(answersMap)),
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
    alert(auto ? "Время вышло. Контрольная завершена автоматически." : "Контрольная завершена. Можно сохранить и отправить результат.");
  }

  function updateNavUI() {
    const tasks = getTasks();
    const total = tasks.length || 0;
    const cur = total ? currentTaskIndex + 1 : 0;

    const meta = document.querySelector("#tasksContainer .navMeta");
    if (meta) meta.textContent = `Задание ${cur} / ${total}`;

    const btnPrev = document.querySelector("#tasksContainer #btnPrevTask");
    const btnNext = document.querySelector("#tasksContainer #btnNextTask");
    if (btnPrev) btnPrev.disabled = isFinished || currentTaskIndex <= 0;
    if (btnNext) btnNext.disabled = isFinished || currentTaskIndex >= total - 1;
  }

  function renderSingleTask() {
    const cont = $("tasksContainer");
    if (!cont) return;

    const tasks = getTasks();
    cont.innerHTML = "";
    if (!tasks.length) return;

    currentTaskIndex = clamp(currentTaskIndex, 0, tasks.length - 1);
    const task = tasks[currentTaskIndex];
    const taskIdNum = Number(task.id);

    // Текст над заданием, если относится
    const textBlock = findTextForTaskId(taskIdNum);
    if (textBlock) {
      const textWrap = document.createElement("div");
      textWrap.className = "textBlock";
      textWrap.innerHTML = `
        <div class="textTop">
          <b>${textBlock.title}</b>
          <span class="badge">задания ${textBlock.from}–${textBlock.to}</span>
        </div>
        <div class="textBody">${textBlock.html}</div>
      `;
      cont.appendChild(textWrap);
    }

    // Задание (БЕЗ баллов/бейджей про баллы)
    const wrap = document.createElement("div");
    wrap.className = "task card";
    wrap.innerHTML = `
      <div class="task-top">
        <h3>Задание ${task.id}</h3>
      </div>
      ${task.hint ? `<div class="hint">${task.hint}</div>` : ""}
      <div class="q">${task.text || ""}</div>
    `;

    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "answer";
    inp.placeholder = "Введите ответ…";
    inp.autocomplete = "off";
    inp.spellcheck = false;

    const saved = answersMap[String(task.id)];
    if (typeof saved === "string") inp.value = saved;

    inp.addEventListener("input", () => {
      if (isFinished) return;
      answersMap[String(task.id)] = inp.value;
      saveProgress();
    });

    wrap.appendChild(inp);

    // Навигация под вводом
    const nav = document.createElement("div");
    nav.innerHTML = `
      <div class="navRow">
        <button id="btnPrevTask" class="btn secondary" type="button">← Предыдущее</button>
        <button id="btnNextTask" class="btn" type="button">Следующее →</button>
      </div>
      <div class="navMeta"></div>
    `;
    wrap.appendChild(nav);

    cont.appendChild(wrap);

    const btnPrev = wrap.querySelector("#btnPrevTask");
    const btnNext = wrap.querySelector("#btnNextTask");

    if (btnPrev) btnPrev.onclick = () => { if (!isFinished) gotoTaskByIndex(currentTaskIndex - 1); };
    if (btnNext) btnNext.onclick = () => { if (!isFinished) gotoTaskByIndex(currentTaskIndex + 1); };

    if (isFinished) {
      inp.disabled = true;
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
    }

    updateNavUI();
    applyFinishedState();
  }

  function gotoTaskByIndex(idx) {
    const tasks = getTasks();
    if (!tasks.length) return;
    currentTaskIndex = clamp(idx, 0, tasks.length - 1);
    saveProgress();
    renderSingleTask();
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

    if (!sel.options.length) throw new Error("manifest.json: список variants пустой");

    sel.value = currentVariantId;
    currentVariantFile = sel.options[sel.selectedIndex].dataset.file;

    sel.addEventListener("change", async () => {
      if (isFinished) return;
      currentVariantId = sel.value;
      currentVariantFile = sel.options[sel.selectedIndex].dataset.file;
      await loadVariant(currentVariantFile);
    });
  }

  async function loadVariant(file) {
    variantData = await fetchJson(base + file);
    variantMeta = variantData?.meta || {};

    const tlm = Number(variantMeta.time_limit_minutes || 0);
    timeLimitSec = tlm > 0 ? tlm * 60 : null;

    const progress = loadProgress();
    startedAt = progress?.startedAt || nowIso();
    finishedAt = progress?.finishedAt || null;
    isFinished = Boolean(progress?.isFinished);

    if (progress?.student?.name && $("studentName")) $("studentName").value = progress.student.name;
    if (progress?.student?.class && $("studentClass")) $("studentClass").value = progress.student.class;

    answersMap = progress?.answers || {};

    const savedTaskId = progress?.currentTaskId;
    if (savedTaskId != null) {
      const idx = taskIndexById(savedTaskId);
      currentTaskIndex = idx >= 0 ? idx : 0;
    } else currentTaskIndex = 0;

    setHeader();
    renderSingleTask();
    startTimerIfNeeded();

    $("studentName")?.addEventListener("input", () => { if (!isFinished) saveProgress(); });
    $("studentClass")?.addEventListener("input", () => { if (!isFinished) saveProgress(); });
  }

  async function init() {
    setTheme(getPreferredTheme());
    $("themeToggle")?.addEventListener("change", (e) => setTheme(e.target.checked ? "light" : "dark"));

    $("btnFinish")?.addEventListener("click", () => finishNow(false));

    $("btnDownload")?.addEventListener("click", () => {
      const payload = buildResultPayload();
      const n = safeText(payload.student.name).replace(/[^\p{L}\p{N}\s._-]+/gu, "").replace(/\s+/g, "_");
      const c = safeText(payload.student.class).replace(/[^\p{L}\p{N}\s._-]+/gu, "").replace(/\s+/g, "_");
      const fn = `result_${subject}_${currentVariantId}_${c || "class"}_${n || "student"}.json`;
      downloadJson(fn, payload);
    });

    $("btnEmail")?.addEventListener("click", () => {
      const to = manifest?.teacherEmail || "";
      if (!to || to.includes("example.com")) {
        alert("В manifest.json не задан teacherEmail. Укажи адрес учителя и опубликуй заново.");
        return;
      }
      const payload = buildResultPayload();
      const subj = `Кодислово: ${payload.subjectTitle} — ${payload.variant.title || payload.variant.id}`;
      const body =
        `ФИО: ${payload.student.name}\n` +
        `Класс: ${payload.student.class}\n` +
        `Вариант: ${payload.variant.title || payload.variant.id}\n` +
        `Начало: ${payload.startedAt}\n` +
        `Окончание: ${payload.finishedAt}\n\n` +
        `Важно: прикрепите к письму скачанный JSON-файл результата.\n`;
      mailto(to, subj, body);
    });

    await loadManifest();
    await loadVariant(currentVariantFile);
  }

  init().catch((err) => {
    console.error(err);
    const hint =
      `Subject: ${subject}\n` +
      `Ожидаем manifest:\n${base}manifest.json\n` +
      `Ожидаем variant:\n${base}${currentVariantFile || "variant_01.json"}\n`;
    alert("Ошибка загрузки контрольной: " + err.message + "\n\n" + hint);
  });
})();
