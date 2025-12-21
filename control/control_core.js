(function () {
  "use strict";

  const THEME_KEY = "kodislovo_theme";
  const LS_PREFIX = "kodislovo_control:";
  const $ = (id) => document.getElementById(id);

  function setText(id, text) { const el = $(id); if (el) el.textContent = text; }
  function getParam(name) { return new URLSearchParams(window.location.search).get(name); }
  function nowIso() { return new Date().toISOString(); }
  function safeText(s) { return (s ?? "").toString().trim(); }
  function normalizeAnswer(s) { return safeText(s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim(); }

  // ✅ железобетонная база относительно control.html
  function variantsBase(subject) {
    // control/control.html -> control/controls/<subject>/variants/
    return new URL(`./controls/${encodeURIComponent(subject)}/variants/`, window.location.href).toString();
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Не удалось загрузить: ${url} (HTTP ${r.status})`);
    return await r.json();
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
    const t = $("themeToggle");
    const lab = $("themeLabel");
    if (t) t.checked = theme === "light";
    if (lab) lab.textContent = theme === "light" ? "Светлая" : "Тёмная";
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
    setText(
      "uiSubtitle",
      variantMeta?.subtitle ||
      "Заполните данные, выполните задания, нажмите «Завершить», затем «Сохранить»."
    );
  }

  // ========= scoring =========
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
    const btnSave = $("btnSave");

    if (btnFinish) {
      btnFinish.textContent = isFinished ? "Завершено" : "Завершить";
      btnFinish.disabled = isFinished;
    }
    if (btnSave) btnSave.disabled = !isFinished;

    const inputs = document.querySelectorAll("#studentName,#studentClass,#variantSelect,#answerInput");
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

  // ========= sticky text =========
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

  // ========= render one task =========
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
    if (block) { setStickyVisible(true); setStickyContent(block); }
    else { setStickyVisible(false); }

    cont.innerHTML = `
      <section class="kd-task" data-task-id="${String(task.id)}">
        <h3>Задание ${task.id}</h3>
        ${task.hint ? `<div class="hint">${task.hint}</div>` : ""}
        <div class="q">${task.text || ""}</div>

        <input class="kd-answer" id="answerInput" type="text"
          placeholder="Введите ответ…" autocomplete="off" spellcheck="false">

        <div class="kd-nav">
          <button class="kd-btn secondary" id="btnPrev" type="button">← Предыдущее</button>
          <button class="kd-btn secondary" id="btnNext" type="button">Следующее →</button>
        </div>
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

    if (isFinished && inp) inp.disabled = true;
  }

  // ========= cloud submit =========
  async function submitResultToCloud() {
    const submitUrl = String(manifest?.submit?.url || "").trim();
    const submitToken = String(manifest?.submit?.token || "").trim();

    if (!submitUrl) { alert("В manifest.json не задан submit.url."); return; }
    if (!submitToken) { alert("В manifest.json не задан submit.token."); return; }

    const payload = buildResultPayload();
    if (!safeText(payload.student.name) || !safeText(payload.student.class) || !safeText(payload.variant.id)) {
      alert("Заполните ФИО, класс и выберите вариант.");
      return;
    }

    const btn = $("btnSave");
    if (btn) btn.disabled = true;

    try {
      const r = await fetch(submitUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Submit-Token": submitToken },
        body: JSON.stringify(payload)
      });
      const text = await r.text();
      let data = null; try { data = JSON.parse(text); } catch {}

      if (!r.ok) throw new Error((data && (data.message || data.error)) ? `${data.error || "error"}: ${data.message || ""}` : text);
      alert("Работа сохранена ✅\nОтправлено в облако ✅");
    } catch (e) {
      console.error(e);
      alert("Работа сохранена ✅\nНо в облако не отправилась ❗\n" + (e?.message || e));
    } finally {
      if (btn) btn.disabled = !isFinished;
    }
  }

  // ========= reset consume =========
  async function applyResetCode(codeRaw) {
    const teacherBase = String(manifest?.teacher?.base_url || "").replace(/\/+$/, "");
    const teacherToken = String(manifest?.teacher?.token || "").trim();
    const code = safeText(codeRaw);

    if (!teacherBase) { alert("В manifest.json не задан teacher.base_url."); return; }
    if (!teacherToken) { alert("В manifest.json не задан teacher.token."); return; }

    const fio = safeText($("studentName")?.value);
    const cls = safeText($("studentClass")?.value);
    const variant = safeText(currentVariantId);

    if (!fio || !cls || !variant) {
      alert("Заполните ФИО, класс и выберите вариант, затем введите код сброса.");
      return;
    }

    const url = `${teacherBase}/teacher/reset/consume`;
    const btn = $("btnResetApply");
    if (btn) btn.disabled = true;

    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Teacher-Token": teacherToken },
        body: JSON.stringify({ subject, fio, cls, variant, code })
      });

      const text = await r.text();
      let data = null; try { data = JSON.parse(text); } catch {}
      if (!r.ok || !data?.ok) throw new Error((data && (data.message || data.error)) ? `${data.error || "error"}: ${data.message || ""}` : text);

      localStorage.removeItem(lsKey());
      answersMap = {};
      currentTaskIndex = 0;
      isFinished = false;
      finishedAt = null;
      startedAt = nowIso();

      saveProgress();
      applyFinishedState();
      renderCurrentTask();
      startTimerIfNeeded();

      if ($("resetCode")) $("resetCode").value = "";
      alert("Сброс выполнен ✅\nМожно начинать заново.");
    } catch (e) {
      console.error(e);
      alert("Сброс не выполнен ❗\n" + (e?.message || e));
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ========= load =========
  function extractVariantMeta(v) { return v.meta || {}; }

  async function loadManifest() {
    // если subject кривой — сразу видно базу
    manifest = await fetchJson(base + "manifest.json");

    const sel = $("variantSelect");
    if (!sel) throw new Error("В control.html нет <select id='variantSelect'>");

    sel.innerHTML = "";
    const vars = Array.isArray(manifest.variants) ? manifest.variants : [];

    if (!vars.length) throw new Error("manifest.json: список variants пустой");

    vars.forEach((v, idx) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.title || v.id;
      opt.dataset.file = v.file;
      sel.appendChild(opt);
      if (idx === 0) { currentVariantId = v.id; currentVariantFile = v.file; }
    });

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

  async function init() {
    setTheme(getPreferredTheme());
    $("themeToggle")?.addEventListener("change", (e) => setTheme(e.target.checked ? "light" : "dark"));

    $("btnFinish")?.addEventListener("click", () => finishNow(false));
    $("btnSave")?.addEventListener("click", async () => {
      if (!isFinished) { alert("Сначала нажмите «Завершить»."); return; }
      await submitResultToCloud();
    });

    $("btnResetApply")?.addEventListener("click", async () => {
      const code = safeText($("resetCode")?.value);
      if (!code) { alert("Введите код сброса."); return; }
      await applyResetCode(code);
    });

    await loadManifest();
    await loadVariant(currentVariantFile);
  }

  init().catch((err) => {
    console.error(err);
    alert(
      "Ошибка загрузки контрольной: " + err.message + "\n\n" +
      "Проверь пути:\n" +
      `manifest: ${base}manifest.json\n` +
      `variant:   ${base}(variant_XX.json)\n` +
      "И что control.html лежит в /control/control.html"
    );
  });
})();
