(function () {
  "use strict";

  // ========= helpers =========
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

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Не удалось загрузить: ${url} (HTTP ${r.status})`);
    return await r.json();
  }

  async function postJson(url, obj, headers = {}) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(obj),
    });
    const text = await r.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!r.ok) {
      const msg = data?.message || data?.error || `${r.status} ${r.statusText}`;
      throw new Error(msg);
    }
    return data;
  }

  function setStatus(msg) {
    const el = $("statusLine");
    if (el) el.textContent = msg || "";
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

  // ========= paths =========
  // /control/control.html?subject=russian
  // варианты: /control/russian/variants/manifest.json
  function variantsBase(subject) {
    return new URL(`./${encodeURIComponent(subject)}/variants/`, window.location.href).toString();
  }
  // fallback на старую схему, если вдруг
  function variantsBaseLegacy(subject) {
    return new URL(`../controls/${encodeURIComponent(subject)}/variants/`, window.location.href).toString();
  }

  // ========= state =========
  let subject = getParam("subject") || "russian";
  let base = variantsBase(subject);
  let baseLegacy = variantsBaseLegacy(subject);

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

  function clearProgress() {
    try { localStorage.removeItem(lsKey()); } catch {}
  }

  // ========= header =========
  function setHeader() {
    setText("workTitle", variantMeta?.title || "Контрольная работа");
    setText(
      "workSubtitle",
      variantMeta?.subtitle ||
        "Заполните ФИО и класс. Выполняйте задания по одному, переходите кнопками «Предыдущее/Следующее»."
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
    const btnSave = $("btnSave");

    if (btnFinish) {
      btnFinish.textContent = isFinished ? "Завершено" : "Завершить";
      btnFinish.disabled = isFinished;
    }

    // "Сохранить" = отправка в облако. Разрешаем только после завершения.
    if (btnSave) btnSave.disabled = !isFinished;

    const lock = (sel) => document.querySelectorAll(sel).forEach(el => (el.disabled = isFinished));
    lock("#studentName, #studentClass, #variantSelect, #taskAnswer");

    // навигация остаётся доступна даже после завершения? (по желанию)
    // сейчас оставим доступной (чтобы ученик мог посмотреть), но ввод заблокирован.
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
    alert(auto ? "Время вышло. Контрольная завершена автоматически." : "Контрольная завершена. Теперь нажмите «Сохранить» для отправки результата.");
  }

  // ========= TEXTS: показываем блок текста над заданием =========
  function getTextBlocksFromMeta() {
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

  function findTextForTask(blocks, taskId) {
    for (const b of blocks) if (taskId >= b.from && taskId <= b.to) return b;
    return null;
  }

  let textBlocks = [];

  function setTextBoxVisible(visible) {
    const box = $("textBox");
    if (!box) return;
    box.classList.toggle("kd-hidden", !visible);
  }

  // ========= render ONE task =========
  function renderCurrentTask() {
    const tasks = variantData?.tasks || [];
    if (!tasks.length) {
      setText("taskTitle", "Нет заданий");
      setHTML("taskText", "В этом варианте нет заданий.");
      setTextBoxVisible(false);
      return;
    }

    currentTaskIndex = Math.max(0, Math.min(currentTaskIndex, tasks.length - 1));
    const task = tasks[currentTaskIndex];

    // текст над заданием (если есть)
    const block = findTextForTask(textBlocks, Number(task.id));
    if (block) {
      setTextBoxVisible(true);
      setHTML(
        "textContent",
        `<div class="muted" style="margin-bottom:10px;"><b>${block.title}</b> (задания ${block.from}–${block.to})</div>${block.html}`
      );
    } else {
      setTextBoxVisible(false);
      setHTML("textContent", "");
    }

    // само задание
    setText("taskTitle", `Задание ${task.id}`);

    const hintEl = $("taskHint");
    if (hintEl) {
      if (task.hint) {
        hintEl.classList.remove("kd-hidden");
        hintEl.textContent = task.hint;
      } else {
        hintEl.classList.add("kd-hidden");
        hintEl.textContent = "";
      }
    }

    setHTML("taskText", task.text || "");

    // ответ
    const inp = $("taskAnswer");
    if (inp) {
      const saved = answersMap[String(task.id)];
      inp.value = (typeof saved === "string") ? saved : "";
      inp.disabled = isFinished;

      inp.oninput = () => {
        if (isFinished) return;
        answersMap[String(task.id)] = inp.value;
        saveProgress();
      };
    }

    // nav
    const btnPrev = $("btnPrev");
    const btnNext = $("btnNext");

    if (btnPrev) {
      btnPrev.disabled = (currentTaskIndex <= 0);
      btnPrev.onclick = () => {
        if (currentTaskIndex <= 0) return;
        currentTaskIndex--;
        saveProgress();
        renderCurrentTask();
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
    }

    if (btnNext) {
      btnNext.disabled = (currentTaskIndex >= tasks.length - 1);
      btnNext.onclick = () => {
        if (currentTaskIndex >= tasks.length - 1) return;
        currentTaskIndex++;
        saveProgress();
        renderCurrentTask();
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
    }
  }

  // ========= Submit to Yandex Cloud =========
  function submitConfig() {
    // новый формат в manifest.json
    const submitUrl = manifest?.submit_url || manifest?.submit?.url || "";
    const submitToken = manifest?.submit_token || manifest?.submit?.token || "";
    return { submitUrl, submitToken };
  }

  async function sendResultToCloud() {
    const { submitUrl, submitToken } = submitConfig();

    if (!submitUrl) {
      alert("В manifest.json не задан submit_url. Добавьте его и опубликуйте заново.");
      return;
    }
    if (!submitToken) {
      alert("В manifest.json не задан submit_token. Добавьте его и опубликуйте заново.");
      return;
    }

    const payload = buildResultPayload();

    setStatus("Отправка…");
    try {
      const resp = await postJson(submitUrl, payload, { "X-Submit-Token": submitToken });
      setStatus("Отправлено ✅");
      // можно показать key/url если функция возвращает
      if (resp?.key) {
        alert("Результат отправлен ✅\n\nФайл сохранён в облаке.");
      } else {
        alert("Результат отправлен ✅");
      }
    } catch (e) {
      console.error(e);
      setStatus("Ошибка отправки");
      alert("Не удалось отправить результат:\n" + (e.message || e));
    }
  }

  // ========= Reset by code =========
  function resetConfig() {
    // optional: если ты сделаешь публичный consume endpoint (НЕ teacher-token!)
    // например: https://.../reset/consume
    const url = manifest?.reset_consume_url || manifest?.reset?.consume_url || "";
    const token = manifest?.reset_consume_token || manifest?.reset?.consume_token || "";
    return { url, token };
  }

  async function applyResetCode() {
    const code = safeText($("resetCode")?.value);
    if (!code) {
      alert("Введите код сброса.");
      return;
    }

    const fio = safeText($("studentName")?.value);
    const cls = safeText($("studentClass")?.value);

    if (!fio || !cls) {
      alert("Для сброса заполните ФИО и класс (как указывали при выполнении).");
      return;
    }

    if (!currentVariantId) {
      alert("Вариант не выбран.");
      return;
    }

    // 1) Если есть настроенный публичный endpoint — проверяем код на сервере
    const rc = resetConfig();
    if (rc.url) {
      setStatus("Проверка кода…");
      try {
        const headers = {};
        if (rc.token) headers["X-Submit-Token"] = rc.token; // если решишь защищать так же, как submit
        await postJson(rc.url, {
          subject,
          fio,
          cls,
          variant: currentVariantId,
          code
        }, headers);

        // если сервер сказал ok — сбрасываем локально
        setStatus("Сброс…");
        doLocalReset();
        setStatus("Сброшено ✅");
        alert("Код принят ✅\nРабота сброшена, можно выполнять заново.");
        return;
      } catch (e) {
        console.error(e);
        setStatus("Код не принят");
        alert("Код сброса не принят:\n" + (e.message || e));
        return;
      }
    }

    // 2) Если endpoint не задан — делаем локальный сброс (без проверки кода)
    const ok = confirm("Серверная проверка кода не настроена.\n\nСбросить работу локально на этом устройстве?");
    if (!ok) return;
    doLocalReset();
    alert("Работа сброшена локально. Можно выполнять заново.");
  }

  function doLocalReset() {
    clearProgress();
    startedAt = nowIso();
    finishedAt = null;
    isFinished = false;
    answersMap = {};
    currentTaskIndex = 0;
    saveProgress();
    applyFinishedState();
    renderCurrentTask();
    startTimerIfNeeded();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ========= load =========
  function extractVariantMeta(v) {
    return v.meta || {};
  }

  async function loadManifestFrom(baseUrl) {
    return await fetchJson(baseUrl + "manifest.json");
  }

  async function loadVariantFrom(baseUrl, file) {
    return await fetchJson(baseUrl + file);
  }

  async function loadManifest() {
    // пробуем основной путь, если нет — legacy
    try {
      manifest = await loadManifestFrom(base);
    } catch {
      manifest = await loadManifestFrom(baseLegacy);
      base = baseLegacy;
    }

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
    setStatus("Загрузка…");

    variantData = await loadVariantFrom(base, file);
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
    textBlocks = getTextBlocksFromMeta();

    renderCurrentTask();
    applyFinishedState();
    startTimerIfNeeded();

    $("studentName")?.addEventListener("input", () => { if (!isFinished) saveProgress(); });
    $("studentClass")?.addEventListener("input", () => { if (!isFinished) saveProgress(); });

    setStatus("Готово");
  }

  // ========= init =========
  async function init() {
    setTheme(getPreferredTheme());
    $("themeToggle")?.addEventListener("change", (e) => setTheme(e.target.checked ? "light" : "dark"));

    $("btnFinish")?.addEventListener("click", () => finishNow(false));
    $("btnSave")?.addEventListener("click", async () => { await sendResultToCloud(); });

    $("btnResetApply")?.addEventListener("click", async () => { await applyResetCode(); });

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
      `1) путь /control/<subject>/variants/manifest.json\n` +
      `2) что control.html лежит в /control/control.html\n` +
      `3) что подключён CSS: /assets/css/control-ui.css\n`;

    alert("Ошибка загрузки контрольной: " + err.message + "\n\n" + hint);
  });
})();
