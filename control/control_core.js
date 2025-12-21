(function () {
  "use strict";

  // ================= helpers =================
  const THEME_KEY = "kodislovo_theme";
  const LS_PREFIX = "kodislovo_control:";
  const $ = (id) => document.getElementById(id);

  function setText(id, text) { const el = $(id); if (el) el.textContent = text ?? ""; }
  function setHTML(id, html) { const el = $(id); if (el) el.innerHTML = html ?? ""; }
  function getParam(name) { return new URLSearchParams(window.location.search).get(name); }
  function nowIso() { return new Date().toISOString(); }
  function safeText(s) { return (s ?? "").toString().trim(); }
  function normalizeAnswer(s) {
    return safeText(s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  }

  // Путь к вариантам: /control/control.html -> ../controls/<subject>/variants/
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

  // ================= state =================
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
  let currentTaskIndex = 0; // <-- главное: индекс текущего задания

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

  // ================= header/UI =================
  function setHeader() {
    setText("uiMainTitle", variantMeta?.title || "Контрольная работа");
    setText("uiSubtitle",
      variantMeta?.subtitle ||
      "Заполните данные, выполните задания, затем сохраните и отправьте результат."
    );
  }

  // ================= timer =================
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

  // ================= scoring (оставляем, но НЕ показываем в UI) =================
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

    for (const task of tasks) {
      const pts = Number(task.points ?? 1);
      max += pts;
      const studentRaw = answersMap[String(task.id)] ?? "";
      const res = checkOne(task, studentRaw);
      earned += res.earned;
    }
    const percent = max > 0 ? Math.round((earned / max) * 100) : 0;
    return { earned, max, percent };
  }

  // ================= finish =================
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

    const inputs = document.querySelectorAll("#studentName,#studentClass,#variantSelect,.answerInput");
    inputs.forEach((el) => { el.disabled = isFinished; });

    // навигация тоже блокируется
    const p = $("navPrev"), n = $("navNext");
    if (p) p.disabled = isFinished || currentTaskIndex <= 0;
    if (n) n.disabled = isFinished || currentTaskIndex >= (variantData?.tasks?.length || 1) - 1;
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
        percent: score.percent,
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

  // ================= TEXT BLOCKS: показываем по текущему заданию =================
  function getTextBlocks() {
    // meta.texts: { t1:{title,html,range:[1,3]}, t2:{...} }
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

  function findBlockForTaskId(blocks, taskId) {
    if (!taskId) return null;
    for (const b of blocks) {
      if (taskId >= b.from && taskId <= b.to) return b;
    }
    return null;
  }

  function renderTextForTask(taskId) {
    const wrap = $("textBlock");
    if (!wrap) return;

    const blocks = getTextBlocks();
    const block = findBlockForTaskId(blocks, taskId);

    if (!block) {
      wrap.style.display = "none";
      setText("textTitle", "");
      setHTML("textBody", "");
      return;
    }

    wrap.style.display = "";
    setText("textTitle", block.title);
    setHTML("textBody", block.html);
  }

  // ================= ONE TASK VIEW + NAV =================
  function renderCurrentTask() {
    const cont = $("taskSingle");
    if (!cont) return;

    const tasks = variantData?.tasks || [];
    if (!tasks.length) {
      cont.innerHTML = "<div>Нет заданий</div>";
      return;
    }

    // clamp
    currentTaskIndex = Math.max(0, Math.min(currentTaskIndex, tasks.length - 1));
    const task = tasks[currentTaskIndex];

    // ТЕКСТ над заданием — именно по ID задания
    renderTextForTask(Number(task.id));

    const saved = answersMap[String(task.id)] ?? "";

    cont.innerHTML = `
      <div class="task-top" style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <h3 style="margin:0;">Задание ${task.id}</h3>
      </div>
      ${task.hint ? `<div class="hint">${task.hint}</div>` : ""}
      <div class="q">${task.text || ""}</div>

      <input id="answerInput" class="answer answerInput" type="text" placeholder="Введите ответ…" autocomplete="off" spellcheck="false" />

      <div class="navRow">
        <button id="navPrev" class="btn ghost">← Предыдущее</button>
        <button id="navNext" class="btn ghost">Следующее →</button>
      </div>
    `;

    const inp = $("answerInput");
    if (inp) {
      inp.value = typeof saved === "string" ? saved : "";
      inp.disabled = isFinished;

      inp.addEventListener("input", () => {
        if (isFinished) return;
        answersMap[String(task.id)] = inp.value;
        saveProgress();
      });
    }

    $("navPrev")?.addEventListener("click", () => {
      if (isFinished) return;
      if (currentTaskIndex > 0) {
        currentTaskIndex--;
        saveProgress();
        renderCurrentTask();
        applyFinishedState();
      }
    });

    $("navNext")?.addEventListener("click", () => {
      if (isFinished) return;
      if (currentTaskIndex < tasks.length - 1) {
        currentTaskIndex++;
        saveProgress();
        renderCurrentTask();
        applyFinishedState();
      }
    });

    applyFinishedState();
  }

  // ================= load =================
  function extractVariantMeta(v) { return v.meta || {}; }

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
    variantMeta = extractVariantMeta(variantData);

    // таймер (из meta.time_limit_minutes)
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
    renderCurrentTask();
    startTimerIfNeeded();

    $("studentName")?.addEventListener("input", () => { if (!isFinished) saveProgress(); });
    $("studentClass")?.addEventListener("input", () => { if (!isFinished) saveProgress(); });
  }

  // ================= init =================
  async function init() {
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
      const s = payload.grading;
      const subj = `Кодислово: ${payload.subjectTitle} — ${payload.variant.title || payload.variant.id}`;
      const body =
        `ФИО: ${payload.student.name}\n` +
        `Класс: ${payload.student.class}\n` +
        `Баллы: ${s.earnedPoints}/${s.maxPoints}\n` +
        `Процент: ${s.percent}%\n` +
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
    alert("Ошибка загрузки контрольной: " + err.message);
  });

})();
