(function () {
  "use strict";

  // ========= helpers =========
  const THEME_KEY = "kodislovo_theme";
  const LS_PREFIX = "kodislovo_control:";
  const SERVICE_UNAVAILABLE_MESSAGE = "Работа временно недоступна. Попробуйте открыть её позднее";
  const $ = (id) => document.getElementById(id);
  /** Браузер: globalThis/window; Node: global — не использовать голый global в браузере. */
  const root = typeof globalThis !== "undefined" ? globalThis : window;
  const controlNavigation = root.KodislovoControlNavigation;

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }
  function setHTML(id, html) {
    const el = $(id);
    if (el) el.innerHTML = html;
  }
  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }
  function nowIso() {
    return new Date().toISOString();
  }
  function safeText(s) {
    return (s ?? "").toString().trim();
  }
  function escapeHtml(s) {
    return safeText(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  // Варианты лежат в /controls/<subject>/variants/ (controls в корне сайта)
  function projectRoot() {
  // GitHub Pages: первый сегмент пути — это папка проекта (например "app.kodislovo.ru")
  const seg = (location.pathname.split("/").filter(Boolean)[0] || "");
  return seg ? `/${seg}/` : "/";
  }

  function variantsBase(subject) {
    return `${location.origin}${projectRoot()}controls/${encodeURIComponent(subject)}/variants/`;
  }

  function controlsBase(subject) {
    return `${location.origin}${projectRoot()}controls/${encodeURIComponent(subject)}/`;
  }

  /** Пути ../bank/… из manifest — в канонический URL без «..» (стабильнее на статике). */
  function resolveVariantSourceUrl(file) {
    const rel = safeText(file);
    if (!rel) throw new Error("Не задан путь к файлу банка заданий.");
    if (rel.startsWith("bank:")) {
      return `${controlsBase(subject)}bank/${encodeURIComponent(rel.slice(5))}`;
    }
    const bankRel = rel.match(/^\.\.\/bank\/(.+)$/);
    if (bankRel) {
      return `${controlsBase(subject)}bank/${bankRel[1].split("/").map(encodeURIComponent).join("/")}`;
    }
    try {
      return new URL(rel, base).href;
    } catch {
      return base + rel;
    }
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Не удалось загрузить: ${url} (HTTP ${r.status})`);
    return await r.json();
  }

  async function postJson(url, body, headers = {}) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    const text = await r.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    if (!r.ok) {
      const msg = (json && (json.message || json.error)) ? (json.message || json.error) : text || `HTTP ${r.status}`;
      const e = new Error(msg);
      e.status = r.status;
      e.body = json || text;
      throw e;
    }
    return json ?? { ok: true };
  }

  async function loadBackendServices() {
    if (!backendServicesPromise) {
      const configUrl = `${location.origin}${projectRoot()}assets/config/public-api.json`;
      backendServicesPromise = fetchJson(configUrl).then(async (config) => {
        const baseUrl = safeText(config?.baseUrl).replace(/\/+$/, "");
        if (!baseUrl) {
          throw new Error("В assets/config/public-api.json не задан baseUrl.");
        }

        const services = await fetchJson(`${baseUrl}/api/public/subjects/${encodeURIComponent(subject)}/services`);
        return {
          submitUrl: new URL(services.submitUrl, `${baseUrl}/`).toString(),
          resetConsumeUrl: new URL(services.resetConsumeUrl, `${baseUrl}/`).toString(),
          timerConfigUrl: services.timerConfigUrl
            ? new URL(services.timerConfigUrl, `${baseUrl}/`).toString()
            : "",
          manifestUrl: services.manifestUrl
            ? new URL(services.manifestUrl, `${baseUrl}/`).toString()
            : "",
          variantBaseUrl: services.variantBaseUrl
            ? new URL(services.variantBaseUrl, `${baseUrl}/`).toString()
            : "",
          contentSource: safeText(services.contentSource),
        };
      });
    }

    return backendServicesPromise;
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Таймаут ${label} (${ms / 1000} с)`)), ms);
      }),
    ]);
  }

  async function loadTimerConfig(variantId) {
    try {
      const services = await withTimeout(loadBackendServices(), 8000, "настроек API");
      if (!services.timerConfigUrl) return null;

      const url = new URL(services.timerConfigUrl);
      if (variantId) url.searchParams.set("variant", variantId);

      return await withTimeout(fetchJson(url.toString()), 6000, "таймера");
    } catch (error) {
      console.warn("timer config load failed", error);
      return null;
    }
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

    const t = $("themeToggle");
    if (t && "checked" in t) t.checked = theme === "light";
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    setTheme(cur === "light" ? "dark" : "light");
  }

  // ========= state =========
  let subject = getParam("subject") || "russian";
  let base = variantsBase(subject);
  const assignmentPublicId = safeText(getParam("assignment"));
  let assignmentConfig = null;
  let lastSubmissionId = "";

  let manifest = null;
  let variantMeta = null;
  let variantData = null;
  let currentVariantId = null;
  let currentVariantFile = null;
  let currentVariantEntry = null;

  let startedAt = null;
  let finishedAt = null;
  let isFinished = false;

  let timeLimitSec = null;
  let timerTick = null;

  let answersMap = {};
  let currentTaskIndex = 0;
  let backendServicesPromise = null;
  const variantSourceCache = new Map();
  let summaryBankPromise = null;
  let variantLoadError = null;
  let variantLoading = false;

  // Production-контент и проверка всегда идут с сервера; небезопасного static fallback нет.
  const apiContent = { enabled: false, manifestUrl: "", variantBaseUrl: "" };

  async function loadAssignmentMode() {
    if (!assignmentPublicId) return false;
    const configUrl = `${location.origin}${projectRoot()}assets/config/public-api.json`;
    const config = await fetchJson(configUrl);
    const apiBase = safeText(config?.baseUrl).replace(/\/+$/, "");
    if (!apiBase) throw new Error("Не задан адрес API для назначения.");
    assignmentConfig = await fetchJson(
      `${apiBase}/api/public/assignments/${encodeURIComponent(assignmentPublicId)}`
    );
    lastSubmissionId = localStorage.getItem(`kodislovo_last_submission:${assignmentPublicId}`) || "";
    subject = assignmentConfig.subject || subject;
    base = variantsBase(subject);
    const publicVariant = assignmentConfig.variant || {};
    const meta = publicVariant.meta || {};
    const variantId = safeText(assignmentConfig.variantSlug || meta.id || meta.slug || publicVariant.id || "assignment-variant");
    manifest = {
      subjectTitle: assignmentConfig.title || subject,
      variants: [{ id: variantId, title: meta.title || assignmentConfig.title, examFormat: meta.examFormat }]
    };
    currentVariantEntry = manifest.variants[0];
    currentVariantId = variantId;
    currentVariantFile = `assignment:${assignmentPublicId}`;
    apiContent.enabled = true;
    backendServicesPromise = Promise.resolve({
      submitUrl: assignmentConfig.submitUrl,
      resetConsumeUrl: assignmentConfig.resetConsumeUrl,
      timerConfigUrl: "",
      contentSource: "assignment"
    });
    const select = $("variantSelect");
    if (select) {
      select.innerHTML = `<option value="${escapeHtml(variantId)}">${escapeHtml(currentVariantEntry.title || variantId)}</option>`;
      select.disabled = true;
    }
    if (assignmentConfig.class && $("studentClass")) {
      $("studentClass").value = assignmentConfig.class;
      $("studentClass").readOnly = true;
    }
    return true;
  }

  async function detectContentMode() {
    try {
      const services = await withTimeout(loadBackendServices(), 8000, "настроек API");
      if (services && services.contentSource === "db" && services.manifestUrl && services.variantBaseUrl) {
        apiContent.enabled = true;
        apiContent.manifestUrl = services.manifestUrl;
        apiContent.variantBaseUrl = services.variantBaseUrl;
        return;
      }
      throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
    } catch (error) {
      console.warn("content mode detection failed", error);
      throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
    }
  }

  async function loadVariantFromApi(variantId) {
    const url = apiContent.variantBaseUrl + encodeURIComponent(variantId);
    return await fetchJson(url);
  }

  function lsKey() {
    return `${LS_PREFIX}${subject}:${currentVariantId || "variant"}`;
  }

  function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getManifestVariantById(id) {
    return (manifest?.variants || []).find((variant) => variant.id === id) || null;
  }

  async function loadVariantSource(file) {
    const url = resolveVariantSourceUrl(file);
    if (!variantSourceCache.has(file)) {
      variantSourceCache.set(
        file,
        fetchJson(url).catch((err) => {
          variantSourceCache.delete(file);
          throw err;
        })
      );
    }
    return deepClone(await variantSourceCache.get(file));
  }

  async function loadSummaryBank() {
    if (!summaryBankPromise) {
      summaryBankPromise = fetchJson(`${location.origin}${projectRoot()}controls/russian/summary-bank.json`);
    }
    return deepClone(await summaryBankPromise);
  }

  function findTextKeyForTaskId(texts, taskId) {
    for (const [textKey, textInfo] of Object.entries(texts || {})) {
      const range = Array.isArray(textInfo?.range) ? textInfo.range : null;
      const from = range ? Number(range[0]) : NaN;
      const to = range ? Number(range[1]) : NaN;
      if (Number.isFinite(from) && Number.isFinite(to) && taskId >= from && taskId <= to) {
        return textKey;
      }
    }
    return null;
  }

  async function buildComposedVariant(entry) {
    const compose = entry?.compose || {};
    const sources = Array.isArray(compose.sources) ? compose.sources : [];
    if (!sources.length) {
      throw new Error(`Вариант "${entry?.id || "compose"}" не содержит sources.`);
    }

    const selectedTasks = [];

    for (const source of sources) {
      const sourceFile = safeText(source?.file);
      if (!sourceFile) {
        throw new Error(`В compose-источнике варианта "${entry.id}" не задан file.`);
      }

      const sourceData = await loadVariantSource(sourceFile);
      const sourceMeta = sourceData?.meta || {};
      const sourceTasks = Array.isArray(sourceData?.tasks) ? sourceData.tasks : [];
      const taskIds = Array.isArray(source?.taskIds) && source.taskIds.length
        ? source.taskIds.map((id) => Number(id)).filter((id) => Number.isFinite(id))
        : sourceTasks.map((task) => Number(task.id)).filter((id) => Number.isFinite(id));

      for (const sourceTaskId of taskIds) {
        const sourceTask = sourceTasks.find((task) => Number(task.id) === sourceTaskId);
        if (!sourceTask) {
          throw new Error(`В файле "${sourceFile}" не найдено задание ${sourceTaskId}.`);
        }

        selectedTasks.push({
          task: deepClone(sourceTask),
          sourceFile,
          sourceTaskId,
          textKey: findTextKeyForTaskId(sourceMeta.texts, sourceTaskId),
          texts: deepClone(sourceMeta.texts || {}),
        });
      }
    }

    if (!selectedTasks.length) {
      throw new Error(`Вариант "${entry.id}" не содержит выбранных заданий.`);
    }

    const textRanges = {};
    const finalTasks = selectedTasks.map((item, index) => {
      const task = item.task;
      const nextId = index + 1;
      task.id = nextId;
      task.source = {
        file: item.sourceFile,
        taskId: item.sourceTaskId,
      };

      if (item.textKey && item.texts[item.textKey]) {
        const rangeKey = `${item.sourceFile}::${item.textKey}`;
        if (!textRanges[rangeKey]) {
          const kimRange = Array.isArray(item.texts[item.textKey].range)
            ? item.texts[item.textKey].range.map((n) => Number(n))
            : null;
          textRanges[rangeKey] = {
            title: item.texts[item.textKey].title || "Текст",
            html: item.texts[item.textKey].html || "",
            rangeKim: kimRange,
            from: nextId,
            to: nextId,
          };
        } else {
          textRanges[rangeKey].to = nextId;
        }
      }

      return task;
    });

    const finalTexts = {};
    Object.values(textRanges).forEach((block, index) => {
      finalTexts[`T${index + 1}`] = {
        title: block.title,
        range: [block.from, block.to],
        rangeKim: Array.isArray(block.rangeKim) ? block.rangeKim.slice() : null,
        html: block.html,
      };
    });

    const maxPoints = finalTasks.reduce((sum, task) => sum + Number(task.points || 0), 0);
    const firstSourceMeta = (await loadVariantSource(safeText(sources[0]?.file)))?.meta || {};
    const meta = deepClone(firstSourceMeta);

    meta.title = compose.title || entry.title || meta.title || entry.id;
    meta.subtitle = compose.subtitle || meta.subtitle || "";
    meta.texts = finalTexts;
    meta.maxPoints = Number(compose.maxPoints || maxPoints || meta.maxPoints || 0);
    if (compose.examFormat) meta.examFormat = compose.examFormat;
    if (compose.gradeLevel) meta.gradeLevel = compose.gradeLevel;
    if (compose.grading) meta.grading = deepClone(compose.grading);
    if (Number.isFinite(Number(compose.time_limit_minutes))) {
      meta.time_limit_minutes = Number(compose.time_limit_minutes);
    }
    if (compose.summaryTextId) {
      const summaryBank = await loadSummaryBank();
      const summaryText = summaryBank.find((item) => item.id === compose.summaryTextId);
      if (!summaryText) {
        throw new Error(`В банке изложений не найден text id "${compose.summaryTextId}".`);
      }
      meta.summary = {
        id: summaryText.id,
        title: summaryText.title,
        sourceText: summaryText.sourceText,
        groups: deepClone(summaryText.groups || []),
        trainerUrl: `${location.origin}${projectRoot()}trainers/russian/summary-trainer/index.html?text=${encodeURIComponent(summaryText.id)}`,
      };
    }

    meta.composed = true;
    meta.composeSources = sources.map((source) => ({
      file: source.file,
      taskIds: Array.isArray(source.taskIds) ? source.taskIds.slice() : [],
    }));

    return {
      meta,
      tasks: finalTasks,
    };
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
    try {
      localStorage.setItem(lsKey(), JSON.stringify(payload));
    } catch (e) {
      console.warn("localStorage write failed", e);
    }
  }

  function loadProgress() {
    const raw = localStorage.getItem(lsKey());
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  function clearLocalProgress() {
    try {
      localStorage.removeItem(lsKey());
    } catch (e) {
      console.warn("localStorage remove failed", e);
    }
  }

  // ========= header =========
  function setHeader() {
    const format = safeText(variantMeta?.examFormat || currentVariantEntry?.examFormat).toLowerCase();
    const formatPrefix = format === "oge" ? "ОГЭ · " : format === "ege" ? "ЕГЭ · " : "";
    setText("uiMainTitle", `${formatPrefix}${variantMeta?.title || "Контрольная работа"}`);
    const gradingHint = root.KodislovoControlGrading
      ? root.KodislovoControlGrading.formatGradingHint(variantMeta, currentVariantEntry)
      : "";
    setText(
      "uiSubtitle",
      [variantMeta?.subtitle, gradingHint].filter(Boolean).join(" ") ||
        "Заполните данные ученика, выполните задания, завершите и отправьте результат."
    );
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
    const mirror = $("uiTimerMirror");
    if (mirror) mirror.value = text;
    setText("timerBarValue", text);
  }

  function setTimerBarVisible(visible) {
    const bar = $("timerBar");
    if (!bar) return;
    bar.classList.toggle("kd-hidden", !visible);
  }

  function setTimerWarning(active) {
    const bar = $("timerBar");
    if (bar) bar.classList.toggle("is-warning", Boolean(active));
  }

  function getFormatFilter() {
    const format = safeText(getParam("format")).toLowerCase();
    return format === "oge" || format === "ege" ? format : "";
  }

  function getExamFormatLabel(format) {
    if (format === "oge") return "ОГЭ · 9 класс";
    if (format === "ege") return "ЕГЭ · 11 класс";
    return "";
  }

  function findManifestSection(entry) {
    const sectionId = safeText(entry?.sectionId || entry?.section);
    if (!sectionId) return null;
    return (manifest?.sections || []).find((section) => section.id === sectionId) || null;
  }

  function countComposeTasks(entry) {
    const sources = entry?.compose?.sources;
    if (!Array.isArray(sources)) return 0;
    return sources.reduce((sum, source) => {
      const ids = source?.taskIds;
      return sum + (Array.isArray(ids) ? ids.length : 0);
    }, 0);
  }

  function getVariantCardBadges(entry, meta) {
    const badges = [];
    const section = findManifestSection(entry);
    const examFormat = safeText(meta?.examFormat || entry?.examFormat).toLowerCase();
    const minutes = Number(
      meta?.time_limit_minutes || entry?.compose?.time_limit_minutes || entry?.timeLimitMinutes || section?.time || 0
    );
    const maxPoints = Number(meta?.maxPoints || meta?.max_points || section?.max_score || 0);
    const gradeLevel = Number(meta?.gradeLevel || entry?.gradeLevel || section?.grade || 0);
    const taskCount =
      entry.id === currentVariantId && Array.isArray(variantData?.tasks)
        ? variantData.tasks.length
        : countComposeTasks(entry);

    if (examFormat === "oge") badges.push({ className: "format-oge", text: "ОГЭ" });
    else if (examFormat === "ege") badges.push({ className: "format-ege", text: "ЕГЭ" });
    if (gradeLevel > 0) badges.push({ className: "grade", text: `${gradeLevel} класс` });
    if (taskCount > 0) badges.push({ className: "score", text: `${taskCount} зад.` });
    else if (maxPoints > 0) badges.push({ className: "score", text: `${maxPoints} б.` });
    if (minutes > 0) badges.push({ className: "time", text: `${minutes} мин` });
    if (entry?.compose?.summaryTextId || entry?.summaryTextId) badges.push({ className: "summary", text: "+ изложение" });
    return badges;
  }

  function getFilteredVariants() {
    const format = getFormatFilter();
    return (manifest?.variants || []).filter((entry) => {
      if (!format) return true;
      return safeText(entry.examFormat).toLowerCase() === format;
    });
  }

  function renderVariantCards() {
    const grid = $("variantCards");
    const sel = $("variantSelect");
    if (!grid || !manifest) return;

    grid.innerHTML = "";
    const variants = getFilteredVariants();
    const metaForBadges = variantMeta || {};

    if (!variants.length) {
      grid.innerHTML = '<p class="kd-subtitle">Нет вариантов для выбранного формата. Вернитесь к списку контрольных.</p>';
      return;
    }

    variants.forEach((entry) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "kd-variant-card";
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", entry.id === currentVariantId ? "true" : "false");
      if (entry.id === currentVariantId) btn.classList.add("is-active");
      if (variantLoading && entry.id === currentVariantId) btn.classList.add("is-loading");
      if (isFinished || variantLoading) btn.disabled = true;

      const badges = getVariantCardBadges(
        entry,
        entry.id === currentVariantId ? metaForBadges : {}
      );
      const badgeHtml = badges.length
        ? `<div class="kd-variant-badges">${badges.map((b) => `<span class="kd-variant-badge ${b.className}">${escapeHtml(b.text)}</span>`).join("")}</div>`
        : `<div class="kd-variant-badges"><span class="kd-variant-badge">открыть вариант</span></div>`;

      const subtitle = safeText(entry?.compose?.subtitle || entry?.subtitle);
      const formatLabel = getExamFormatLabel(safeText(entry.examFormat).toLowerCase());
      btn.innerHTML = `
        ${formatLabel ? `<span class="kd-variant-format-label">${escapeHtml(formatLabel)}</span>` : ""}
        <strong>${escapeHtml(entry.title || entry.id)}</strong>
        ${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}
        ${badgeHtml}
      `;

      btn.addEventListener("click", () => {
        if (isFinished) return;
        selectVariant(entry, { force: entry.id === currentVariantId }).catch((err) => {
          console.error(err);
          alert("Не удалось загрузить вариант: " + (err.message || err));
        });
      });

      grid.appendChild(btn);
    });
  }

  function showSubmitSuccessOverlay(score) {
    const overlay = $("submitSuccessOverlay");
    if (!overlay) {
      alert("Работа успешно отправлена.");
      return;
    }

    const payload = buildResultPayload();
    setText("successStudent", `${safeText(payload.student?.name) || "—"} · ${safeText(payload.student?.class) || "—"}`);
    setText("successVariant", payload.variant?.title || payload.variant?.id || "—");
    const markText = score.mark != null ? ` · отметка ${score.mark}` : "";
    setText(
      "successScore",
      score.max > 0
        ? `${score.earned} из ${score.max} баллов (${score.percent}%)${markText}`
        : "Отправлено"
    );

    const back = $("successBackBtn");
    if (back) back.href = "./index.html";

    overlay.classList.remove("kd-hidden");
  }

  function hideSubmitSuccessOverlay() {
    $("submitSuccessOverlay")?.classList.add("kd-hidden");
  }

  function startTimerIfNeeded() {
    clearInterval(timerTick);
    timerTick = null;

    if (!timeLimitSec || !startedAt) {
      setTimerUI("без лимита");
      setTimerBarVisible(false);
      setTimerWarning(false);
      return;
    }

    setTimerBarVisible(true);
    const startMs = new Date(startedAt).getTime();
    timerTick = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      const left = timeLimitSec - elapsed;
      setTimerUI(formatTime(left));
      setTimerWarning(!isFinished && left > 0 && left <= 300);
      if (!isFinished && left <= 0) finishNow(true);
    }, 250);
  }

  // ========= finish =========
  function applyFinishedState() {
    const btnFinish = $("btnFinish");
    const btnSubmit = $("btnSubmit") || $("btnSaveCloud");
    const btnReset = $("btnReset");

    if (btnFinish) {
      btnFinish.textContent = isFinished ? "Завершено" : "Завершить";
      btnFinish.disabled = isFinished;
    }
    if (btnSubmit) btnSubmit.disabled = !isFinished;
    if (btnReset) btnReset.disabled = false;

    const inputs = document.querySelectorAll("#studentName,#studentClass,#variantSelect,#taskOne input");
    inputs.forEach((el) => { el.disabled = isFinished; });
  }

  function buildResultPayload() {
    // Балл и детализацию всегда считает сервер; клиент отправляет только ответы ученика.
    const score = { max: 0, earned: 0, percent: 0, mark: null, perTask: [] };
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
        subtitle: variantMeta?.subtitle || "",
        examFormat: variantMeta?.examFormat || currentVariantEntry?.examFormat || "",
        gradeLevel: variantMeta?.gradeLevel || currentVariantEntry?.gradeLevel || null,
      },
      grading: {
        maxPoints: score.max,
        earnedPoints: score.earned,
        percent: score.percent,
        mark: score.mark,
        scale: variantMeta?.grading || null,
      },
      student: {
        name: safeText($("studentName")?.value),
        class: safeText($("studentClass")?.value),
      },
      answers: JSON.parse(JSON.stringify(answersMap)),
      perTask: score.perTask,
      meta: JSON.parse(JSON.stringify(variantMeta || {})),
      userAgent: navigator.userAgent,
    };
  }

  function finishNow(auto = false) {
    if (isFinished) return;
    isFinished = true;
    finishedAt = nowIso();
    saveProgress();
    applyFinishedState();
    alert(auto ? "Время вышло. Контрольная завершена автоматически." : "Контрольная завершена. Нажмите «Отправить».");
  }

  // ========= texts by range =========
  let stickyCollapsed = false;
  let currentStickyBlockKey = "";

  function getTextRangesFromMeta() {
    return controlNavigation?.getTextRanges(variantMeta) || [];
  }

  function setStickyVisible(visible) {
    const wrap = $("stickyTextWrap");
    if (!wrap) return;
    wrap.classList.toggle("kd-hidden", !visible);
  }

  function getStickyBlockKey(block) {
    if (!block) return "";
    const kim = Array.isArray(block.rangeKim) ? block.rangeKim.join("-") : "";
    return `${block.title}|${kim || `${block.from}-${block.to}`}`;
  }

  function updateStickyToggleUi() {
    const body = $("stickyTextBody");
    const btn = $("stickyToggle");
    if (body) {
      body.classList.toggle("kd-hidden", stickyCollapsed);
      body.setAttribute("aria-hidden", stickyCollapsed ? "true" : "false");
    }
    if (btn) {
      btn.textContent = stickyCollapsed ? "Показать" : "Скрыть";
      btn.setAttribute("aria-expanded", stickyCollapsed ? "false" : "true");
    }
  }

  function setStickyContent(block, textPosition = null) {
    const title = $("stickyTextTitle");
    const range = $("stickyTextRange");
    const body = $("stickyTextBody");
    if (!title || !range || !body) return;

    title.textContent = block.title;
    range.textContent = textPosition
      ? `Текст ${textPosition.current} из ${textPosition.total}`
      : formatTaskRangeLabel(block);
    body.innerHTML = block.html;
    updateStickyToggleUi();
  }

  function setSummaryVisible(visible) {
    const wrap = $("summaryTextWrap");
    if (!wrap) return;
    wrap.classList.toggle("kd-hidden", !visible);
  }

  function formatSummaryText(text) {
    return safeText(text)
      .split(/\n{2,}/)
      .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  function setSummaryContent(summary) {
    const title = $("summaryTextTitle");
    const meta = $("summaryTextMeta");
    const body = $("summaryTextBody");
    const openBtn = $("summaryOpenBtn");
    if (!title || !meta || !body || !openBtn) return;

    const groupsCount = Array.isArray(summary?.groups) ? summary.groups.length : 0;
    title.textContent = safeText(summary?.title) || "Текст изложения";
    meta.textContent = groupsCount > 0
      ? `Связанный текст изложения: ${groupsCount} микротем`
      : "Связанный текст изложения для варианта ОГЭ";
    body.innerHTML = formatSummaryText(summary?.sourceText);

    const trainerUrl = safeText(summary?.trainerUrl);
    openBtn.disabled = !trainerUrl;
    openBtn.onclick = trainerUrl
      ? () => { window.location.href = trainerUrl; }
      : null;
  }

  function getTaskKimId(task) {
    return controlNavigation?.getTaskKimId(task) ?? Number(task?.id);
  }

  function findBlockForTask(blocks, task) {
    return controlNavigation?.findBlockForTask(blocks, task) || null;
  }

  function refreshStickyBlocks() {
    stickyBlocks = getTextRangesFromMeta();
  }

  function formatTaskRangeLabel(block) {
    const kim = Array.isArray(block?.rangeKim) ? block.rangeKim : null;
    if (kim && kim.length === 2) {
      return `задания КИМ ${kim[0]}–${kim[1]}`;
    }
    return `задания ${block.from}–${block.to}`;
  }

  // ========= render ONE task =========
  let stickyBlocks = [];

  function renderTaskLoadState() {
    const cont = $("taskOne");
    const navigation = $("taskNavigation");
    if (!cont) return;
    if (navigation) navigation.innerHTML = "";
    if (variantLoading) {
      cont.innerHTML = "<div class='kd-task'>Загрузка заданий…</div>";
      setStickyVisible(false);
      return;
    }
    if (variantLoadError) {
      cont.innerHTML = `<div class='kd-task'><p>Не удалось загрузить задания.</p><p class="kd-subtitle">${escapeHtml(variantLoadError)}</p><p class="kd-subtitle">Нажмите на карточку варианта ещё раз или обновите страницу.</p></div>`;
      setStickyVisible(false);
      return;
    }
    const tasks = variantData?.tasks || [];
    if (!tasks.length) {
      cont.innerHTML = "<div class='kd-task'>Нет заданий в варианте. Выберите другую карточку или обновите страницу.</div>";
      setStickyVisible(false);
    }
  }

  function renderTaskCard(task, taskIndex, textPractice, tasksCount) {
    const displayNumber = textPractice ? getTaskKimId(task) : task.id;
    const progress = textPractice
      ? ""
      : ` <span class="kd-subtitle kd-task-progress">(${taskIndex + 1} из ${tasksCount})</span>`;
    const taskId = escapeHtml(String(task.id));
    return `
      <section class="kd-task" data-task-id="${taskId}">
        <h3 class="kd-task-heading">Задание ${escapeHtml(String(displayNumber))}${progress}</h3>
        ${task.hint ? `<div class="hint">${task.hint}</div>` : ""}
        <div class="q">${task.text || ""}</div>
        <label class="kd-answer-label" for="answerInput-${taskId}">Ответ</label>
        <input class="kd-answer" id="answerInput-${taskId}" data-task-id="${taskId}" type="text"
          placeholder="Введите ответ…" autocomplete="off" spellcheck="false">
      </section>
    `;
  }

  function renderTaskNavigation(units, activeUnitIndex, tasks, textPractice) {
    const navigation = $("taskNavigation");
    if (!navigation) return;
    const activeLabel = textPractice ? "Текст" : "Задание";
    const pills = units.map((unit, index) => {
      const answerState = controlNavigation?.getUnitAnswerState(unit, tasks, answersMap) || "empty";
      const classes = ["kd-task-pill"];
      if (index === activeUnitIndex) classes.push("is-active");
      if (answerState === "answered") classes.push("is-answered");
      if (answerState === "partial") classes.push("is-partial");
      return `<button type="button" class="${classes.join(" ")}" data-unit-index="${index}" aria-label="${escapeHtml(unit.ariaLabel)}">${escapeHtml(unit.label)}</button>`;
    }).join("");

    navigation.className = `kd-task-navigation${textPractice ? " is-text-practice" : ""}`;
    navigation.setAttribute("aria-label", textPractice ? "Навигация по текстам" : "Номера заданий");
    navigation.innerHTML = `
      <div class="kd-task-navigation-head">
        <strong>${textPractice ? "Тексты" : "Задания"}</strong>
        <span>${activeLabel} ${activeUnitIndex + 1} из ${units.length}</span>
      </div>
      <div class="kd-task-pills">${pills}</div>
    `;

    const pillStrip = navigation.querySelector(".kd-task-pills");
    const activePill = navigation.querySelector(".kd-task-pill.is-active");
    if (textPractice && pillStrip && activePill) {
      pillStrip.scrollLeft = Math.max(
        0,
        activePill.offsetLeft - (pillStrip.clientWidth - activePill.offsetWidth) / 2
      );
    }

    navigation.querySelectorAll(".kd-task-pill").forEach((pill) => {
      pill.addEventListener("click", () => {
        const unitIndex = Number(pill.getAttribute("data-unit-index"));
        if (!Number.isFinite(unitIndex) || unitIndex === activeUnitIndex) return;
        currentTaskIndex = units[unitIndex]?.taskIndices?.[0] ?? currentTaskIndex;
        saveProgress();
        renderCurrentTask();
        const target = textPractice ? $("stickyTextWrap") : $("taskOne");
        if (target) window.scrollTo({ top: target.offsetTop - 80, behavior: "smooth" });
      });
    });
  }

  function renderCurrentTask() {
    const cont = $("taskOne");
    if (!cont) return;

    if (variantLoading || variantLoadError) {
      renderTaskLoadState();
      return;
    }

    const tasks = variantData?.tasks || [];
    if (!tasks.length) {
      renderTaskLoadState();
      return;
    }

    currentTaskIndex = Math.max(0, Math.min(currentTaskIndex, tasks.length - 1));
    refreshStickyBlocks();
    const textPractice = Boolean(
      controlNavigation?.isTextPracticeMode(variantData, variantMeta, stickyBlocks, tasks)
    );
    const units = controlNavigation?.buildNavigationUnits(tasks, stickyBlocks, textPractice) || [];
    const activeUnitIndex = controlNavigation?.findUnitIndex(units, currentTaskIndex) || 0;
    const activeUnit = units[activeUnitIndex];
    const taskIndices = activeUnit?.taskIndices?.length ? activeUnit.taskIndices : [currentTaskIndex];
    const task = tasks[taskIndices[0]];
    const block = textPractice ? activeUnit?.block : findBlockForTask(stickyBlocks, task);

    renderTaskNavigation(units, activeUnitIndex, tasks, textPractice);
    if (block) {
      const blockKey = getStickyBlockKey(block);
      if (blockKey !== currentStickyBlockKey) {
        currentStickyBlockKey = blockKey;
        stickyCollapsed = false;
      }
      setStickyVisible(true);
      setStickyContent(
        block,
        textPractice ? { current: activeUnitIndex + 1, total: units.length } : null
      );
    } else {
      currentStickyBlockKey = "";
      setStickyVisible(false);
    }

    cont.innerHTML = `
      <div class="kd-task-group${textPractice ? " is-text-practice" : ""}">
        ${taskIndices.map((taskIndex) => renderTaskCard(tasks[taskIndex], taskIndex, textPractice, tasks.length)).join("")}
      </div>
      <div class="kd-nav">
        <button class="kd-btn secondary" id="btnPrev" type="button" ${activeUnitIndex === 0 ? "disabled" : ""}>← Предыдущее</button>
        <button class="kd-btn secondary" id="btnNext" type="button" ${activeUnitIndex >= units.length - 1 ? "disabled" : ""}>Следующее →</button>
      </div>
    `;

    cont.querySelectorAll(".kd-answer[data-task-id]").forEach((input) => {
      const taskId = safeText(input.getAttribute("data-task-id"));
      const saved = answersMap[taskId];
      if (typeof saved === "string") input.value = saved;
      input.disabled = isFinished;
      input.addEventListener("input", () => {
        if (isFinished) return;
        answersMap[taskId] = input.value;
        saveProgress();
        renderTaskNavigation(units, activeUnitIndex, tasks, textPractice);
      });
    });

    $("btnPrev")?.addEventListener("click", () => {
      if (activeUnitIndex > 0) {
        currentTaskIndex = units[activeUnitIndex - 1].taskIndices[0];
        saveProgress();
        renderCurrentTask();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

    $("btnNext")?.addEventListener("click", () => {
      if (activeUnitIndex < units.length - 1) {
        currentTaskIndex = units[activeUnitIndex + 1].taskIndices[0];
        saveProgress();
        renderCurrentTask();
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    });

  }

  // ========= load =========
  function extractVariantMeta(v) {
    return v.meta || {};
  }

  async function loadManifest() {
    manifest = apiContent.enabled
      ? await fetchJson(apiContent.manifestUrl)
      : await fetchJson(base + "manifest.json");

    const sel = $("variantSelect");
    if (!sel) throw new Error("В control.html нет <select id='variantSelect'>");

    sel.innerHTML = "";
    const variants = getFilteredVariants();
    if (!variants.length) {
      throw new Error("manifest.json: нет вариантов для выбранного формата (проверьте ?format=oge или ?format=ege).");
    }

    const preferredId = safeText(getParam("variant"));
    variants.forEach((v, idx) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.title || v.id;
      sel.appendChild(opt);
      const isPreferred = preferredId && v.id === preferredId;
      const isFirst = idx === 0;
      if (isPreferred || (!preferredId && isFirst)) {
        currentVariantId = v.id;
        currentVariantEntry = v;
        currentVariantFile = v.file || `compose:${v.id}`;
      }
    });

    sel.value = currentVariantId;
    currentVariantEntry = getManifestVariantById(sel.value) || variants[0];
    currentVariantFile = currentVariantEntry?.file || `compose:${currentVariantId}`;

    sel.addEventListener("change", () => {
      if (isFinished) return;
      const entry = getManifestVariantById(sel.value);
      if (!entry) return;
      selectVariant(entry).catch((err) => {
        console.error(err);
        alert("Не удалось загрузить вариант: " + (err.message || err));
      });
    });
  }

  async function selectVariant(entry, options = {}) {
    const force = Boolean(options.force);
    if (!entry || isFinished) return;
    if (!force && entry.id === currentVariantId && Array.isArray(variantData?.tasks) && variantData.tasks.length) {
      return;
    }

    const sel = $("variantSelect");
    if (sel) sel.value = entry.id;
    currentVariantId = entry.id;
    currentVariantEntry = entry;
    currentVariantFile = entry.file || `compose:${entry.id}`;

    variantLoading = true;
    variantLoadError = null;
    renderTaskLoadState();
    renderVariantCards();

    try {
      await loadVariant(entry);
      variantLoadError = null;
    } catch (err) {
      variantLoadError = safeText(err.message || err);
      variantData = null;
      variantMeta = null;
      throw err;
    } finally {
      variantLoading = false;
      renderVariantCards();
      if (variantLoadError || !Array.isArray(variantData?.tasks) || !variantData.tasks.length) {
        renderTaskLoadState();
      } else {
        refreshStickyBlocks();
        if (variantMeta?.summary?.sourceText) {
          setSummaryVisible(true);
          setSummaryContent(variantMeta.summary);
        } else {
          setSummaryVisible(false);
        }
        renderCurrentTask();
        applyFinishedState();
        startTimerIfNeeded();
      }
    }
  }

  async function loadVariant(entryOrFile) {
    const entry = typeof entryOrFile === "string"
      ? { id: currentVariantId || safeText(entryOrFile), file: entryOrFile }
      : entryOrFile;

    if (!entry) {
      throw new Error("Не удалось определить вариант для загрузки.");
    }

    currentVariantEntry = entry;
    currentVariantId = entry.id || currentVariantId;
    currentVariantFile = entry.file || `compose:${currentVariantId}`;
    stickyCollapsed = false;
    currentStickyBlockKey = "";

    if (assignmentConfig) {
      variantData = deepClone(assignmentConfig.variant || {});
    } else if (apiContent.enabled) {
      // Сервер отдаёт собранный вариант БЕЗ правильных ответов; проверка — на сервере.
      variantData = await loadVariantFromApi(currentVariantId);
    } else if (entry.compose) {
      variantData = await buildComposedVariant(entry);
    } else if (entry.file) {
      variantData = await fetchJson(base + entry.file);
    } else {
      throw new Error(`Вариант "${currentVariantId}" не содержит file или compose.`);
    }

    variantMeta = extractVariantMeta(variantData);

    // time limit from variant meta (если задано в варианте)
    const remoteTimerConfig = await loadTimerConfig(currentVariantId);
    const tlmRemote = Number(remoteTimerConfig?.time_limit_minutes || 0);
    const tlmLocal = Number(variantMeta.time_limit_minutes || 0);
    const timerMinutes = tlmRemote > 0 ? tlmRemote : tlmLocal;
    timeLimitSec = timerMinutes > 0 ? timerMinutes * 60 : null;

    const progress = loadProgress();
    startedAt = progress?.startedAt || nowIso();
    finishedAt = progress?.finishedAt || null;
    isFinished = Boolean(progress?.isFinished);

    if (progress?.student?.name && $("studentName")) $("studentName").value = progress.student.name;
    if (progress?.student?.class && $("studentClass")) $("studentClass").value = progress.student.class;

    answersMap = progress?.answers || {};
    currentTaskIndex = Number.isFinite(progress?.currentTaskIndex) ? progress.currentTaskIndex : 0;

    setHeader();

    refreshStickyBlocks();
    if (variantMeta?.summary?.sourceText) {
      setSummaryVisible(true);
      setSummaryContent(variantMeta.summary);
    } else {
      setSummaryVisible(false);
    }

    // sticky collapse btn
    const stBtn = $("stickyToggle");
    if (stBtn && !stBtn._kdBound) {
      stBtn._kdBound = true;
      stBtn.addEventListener("click", () => {
        stickyCollapsed = !stickyCollapsed;
        updateStickyToggleUi();
      });
    }

    // Отрисовка — в selectVariant() после variantLoading = false (иначе остаётся «Загрузка заданий…»).

    const sn = $("studentName");
    const sc = $("studentClass");
    if (sn && !sn._kdBound) {
      sn._kdBound = true;
      sn.addEventListener("input", () => { if (!isFinished) saveProgress(); });
    }
    if (sc && !sc._kdBound) {
      sc._kdBound = true;
      sc.addEventListener("input", () => { if (!isFinished) saveProgress(); });
    }
  }

  // ========= submit to Yandex Cloud =========
  async function submitResultToCloud() {
    if (!isFinished) {
      alert("Сначала нажмите «Завершить».");
      return;
    }

    const btn = $("btnSubmit");
    const prevText = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Отправляется…"; }

    try {
      const payload = buildResultPayload();
      const services = await loadBackendServices();
      const keyName = `kodislovo_submission_key:${assignmentPublicId || subject}:${currentVariantId}`;
      let idempotencyKey = localStorage.getItem(keyName) || "";
      if (!idempotencyKey) {
        idempotencyKey = root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        localStorage.setItem(keyName, idempotencyKey);
      }
      const response = await postJson(
        services.submitUrl,
        payload,
        assignmentConfig ? { "Idempotency-Key": idempotencyKey } : {}
      );
      if (assignmentConfig && response?.submissionId) {
        lastSubmissionId = response.submissionId;
        localStorage.setItem(`kodislovo_last_submission:${assignmentPublicId}`, lastSubmissionId);
        localStorage.removeItem(keyName);
      }

      // ✅ после успешной отправки — удаляем временное автосохранение
      clearLocalProgress();

      // оставляем экран в состоянии "завершено" (в памяти)
      applyFinishedState();

      const serverGrading = response && response.gradedBy === "server" ? response.grading : null;
      const earned = Number(serverGrading?.earnedPoints);
      const maximum = Number(serverGrading?.maxPoints);
      if (!serverGrading || !Number.isFinite(earned) || !Number.isFinite(maximum)) {
        throw new Error(SERVICE_UNAVAILABLE_MESSAGE);
      }
      const score = {
        earned,
        max: maximum,
        percent: maximum > 0 ? Math.round((earned / maximum) * 100) : 0,
        mark: null,
      };
      showSubmitSuccessOverlay(score);
    } catch (err) {
      console.error(err);
      alert(SERVICE_UNAVAILABLE_MESSAGE);
      if (btn) { btn.disabled = false; }
    } finally {
      if (btn) btn.textContent = prevText || "Отправить";
    }
  }

  // ========= reset consume (код сброса) =========
  async function consumeResetCode() {
    const input = $("resetCode");
    let raw = String(input?.value ?? "");
    let code = raw.trim().toLowerCase();

    if (!code) {
      const prompted = window.prompt("Введите код сброса:", "");
      if (prompted === null) return;
      code = String(prompted).trim().toLowerCase();
      if (input) input.value = code;
    }

    if (!code) {
      alert("Введите код сброса.");
      return;
    }

    // Код генерируется как hex(6 bytes) => 12 символов
    if (!/^[0-9a-f]{12}$/.test(code)) {
      alert(
        "Код сброса должен быть из 12 символов (0-9, a-f).\n" +
        "Сейчас: " + code.length + " символов.\n\n" +
        "Скопируйте код полностью из учительской панели."
      );
      return;
    }

    const fio = safeText($("studentName")?.value);
    const cls = safeText($("studentClass")?.value);
    if (!fio || !cls) {
      alert("Заполните ФИО и класс, чтобы применить код сброса.");
      return;
    }

    const btn = $("btnReset");
    const prevText = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Проверка…"; }

    try {
      const services = await loadBackendServices();
      await postJson(services.resetConsumeUrl, {
        subject,
        fio,
        cls,
        variant: currentVariantId,
        code,
        submissionId: lastSubmissionId,
      });
      if (assignmentConfig) {
        localStorage.removeItem(`kodislovo_last_submission:${assignmentPublicId}`);
        lastSubmissionId = "";
      }

      // ✅ сброс: очищаем локальный прогресс и стартуем заново
      clearLocalProgress();

      // сбрасываем состояние в памяти
      answersMap = {};
      currentTaskIndex = 0;
      isFinished = false;
      finishedAt = null;
      startedAt = nowIso();

      // очистка поля кода
      if ($("resetCode")) $("resetCode").value = "";

      saveProgress();
      renderCurrentTask();
      applyFinishedState();
      startTimerIfNeeded();
      renderVariantCards();

      alert("Сброс применён. Можно выполнять работу заново.");
    } catch (err) {
      console.error(err);
      alert("Код сброса не принят.\n\n" + String(err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText || "Сброс"; }
    }
  }

  
  // Совместимость: если в HTML осталась кнопка "Сохранить", переименуем в "Отправить"
  try {
    const b = $("btnSubmit") || $("btnSaveCloud");
    if (b && /сохран/i.test(b.textContent || "")) b.textContent = "Отправить";
  } catch {}
// ========= init =========
  async function init() {
    // theme init + toggle
    setTheme(getPreferredTheme());
    const themeToggle = $("themeToggle");
    if (themeToggle && !themeToggle._kdBound) {
      themeToggle._kdBound = true;
      themeToggle.addEventListener("change", (e) => {
        setTheme(e.target.checked ? "light" : "dark");
      });
    }

    const themeWrap = $("themeWrap");
    if (themeWrap && !themeWrap._kdBound) {
      themeWrap._kdBound = true;
      themeWrap.addEventListener("click", (e) => {
        if (e.target.closest("label") || e.target === themeToggle) return;
        toggleTheme();
      });
    }

    // finish / submit / reset
    const bf = $("btnFinish");
    if (bf && !bf._kdBound) {
      bf._kdBound = true;
      bf.addEventListener("click", () => finishNow(false));
    }

    const bs = $("btnSubmit") || $("btnSaveCloud");
    if (bs && !bs._kdBound) {
      bs._kdBound = true;
      bs.addEventListener("click", submitResultToCloud);
    }

    const br = $("btnReset");
    if (br && !br._kdBound) {
      br._kdBound = true;
      br.addEventListener("click", consumeResetCode);
    }

    // Enter in resetCode triggers reset
    const rc = $("resetCode");
    if (rc && !rc._kdBound) {
      rc._kdBound = true;
      rc.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          consumeResetCode();
        }
      });
    }

    const backLink = $("controlBackLink");
    if (backLink) backLink.href = "./index.html";

    const format = getFormatFilter();
    const formatNavWrap = $("controlFormatNav");
    if (formatNavWrap) {
      formatNavWrap.classList.toggle("kd-hidden", subject !== "russian");
    }
    const formatNav = document.querySelectorAll("[data-format-nav]");
    formatNav.forEach((link) => {
      const linkFormat = safeText(link.getAttribute("data-format-nav")).toLowerCase();
      link.href = `control.html?subject=${encodeURIComponent(subject)}&format=${linkFormat}`;
      link.classList.toggle("is-active", linkFormat === format);
      if (linkFormat === format) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    const formatTitle = $("controlFormatTitle");
    if (formatTitle) {
      if (format === "oge") {
        formatTitle.textContent =
          "ОГЭ 2026 (демо ФИПИ): тренажёр — часть 2, задания 2–12 (11 б.). Отметка по шкале под заголовком.";
      } else if (format === "ege") {
        formatTitle.textContent =
          "ЕГЭ 2026 (демо ФИПИ): тренажёр — часть 1, задания 1–26 (28 перв. б., №8 и №22 — по 2 б.). Отметка по %.";
      } else if (subject === "russian") {
        formatTitle.textContent = "Выберите формат выше (ОГЭ или ЕГЭ), затем карточку варианта.";
      }
    }

    $("successCloseBtn")?.addEventListener("click", hideSubmitSuccessOverlay);
    $("submitSuccessOverlay")?.addEventListener("click", (event) => {
      if (event.target === $("submitSuccessOverlay")) hideSubmitSuccessOverlay();
    });

    const isAssignment = await loadAssignmentMode();
    if (!isAssignment) {
      await detectContentMode();
      await loadManifest();
    }
    renderVariantCards();
    if (currentVariantEntry) {
      await selectVariant(currentVariantEntry, { force: true });
    } else {
      throw new Error("Не выбран вариант в manifest.json.");
    }

  }

  init().catch((err) => {
    console.error(err);
    if (assignmentPublicId || safeText(err?.message) === SERVICE_UNAVAILABLE_MESSAGE) {
      alert(SERVICE_UNAVAILABLE_MESSAGE);
      return;
    }
    const hint =
      `Subject: ${subject}\n` +
      `Ожидаем manifest:\n${base}manifest.json\n` +
      `Ожидаем variant:\n${base}${currentVariantFile || "variant_01.json"}\n\n` +
      `Проверь:\n` +
      `1) /controls/<subject>/variants/manifest.json (controls в корне)\n` +
      `2) что control.html лежит в /control/control.html\n` +
      `3) что подключён CSS: /assets/css/control-ui.css\n`;
    alert("Ошибка загрузки контрольной: " + err.message + "\n\n" + hint);
  });
})();
