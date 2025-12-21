(function () {
  "use strict";

  // ========= helpers =========
  const THEME_KEY = "kodislovo_theme";
  const LS_PREFIX = "kodislovo_control:";
  const $ = (id) => document.getElementById(id);

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
  function nowIso() { return new Date().toISOString(); }
  function safeText(s) { return (s ?? "").toString().trim(); }
  function normalizeAnswer(s) {
    return safeText(s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  }

  // Где лежат JSON-варианты относительно /control/control.html
  // -> ../controls/<subject>/variants/
  function variantsBase(subject) {
    return new URL(`../controls/${encodeURIComponent(subject)}/variants/`, window.location.href).toString();
  }
    // ===== Reset API (student-side) =====
  // Учитель выдаёт reset-код, ученик открывает ссылку с ?reset=CODE
  const RESET_API_BASE = "https://d5d17sjh01l20fnemocv.3zvepvee.apigw.yandexcloud.net";

  function resetLsKey(subject, variantId) {
    return `${LS_PREFIX}${subject}:${variantId || "variant"}`;
  }

  function clearAttemptLocal(subject, variantId) {
    // очищаем сохранённую попытку
    localStorage.removeItem(resetLsKey(subject, variantId));
  }

  async function consumeResetCode(code, subject, variantId) {
    // Не отправляем teacher_token в браузер. Код сам по себе служит "пропуском".
    const url = RESET_API_BASE.replace(/\/+$/,"") + "/teacher/reset/consume";
    const payload = { code, subject, variant: variantId };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }

    if (!r.ok) {
      const msg = data?.error || data?.message || txt || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return data || { ok: true };
  }

  function stripResetFromUrl() {
    const u = new URL(window.location.href);
    if (!u.searchParams.has("reset")) return;
    u.searchParams.delete("reset");
    // чтобы не "съедать" back, используем replaceState
    history.replaceState(null, "", u.toString());
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

  function computeMark(percent, grading) {
    const p = Number(percent) || 0;
    const pairs = Object.entries(grading || {})
      .map(([k, v]) => [k, Number(v)])
      .sort((a, b) => b[1] - a[1]);
    for (const [mark, minP] of pairs) if (p >= minP) return mark;
    return "2";
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
      savedAt: nowIso(),
    };
    localStorage.setItem(lsKey(), JSON.stringify(payload));
  }

  function loadProgress() {
    const raw = localStorage.getItem(lsKey());
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  // ========= UI =========
  function setHeader() {
    setText("uiSubject", manifest?.subjectTitle || "Контрольная");
    setText("uiTitle", variantMeta?.title || "Контрольная работа");
    setText("uiMainTitle", variantMeta?.title || "Контрольная работа");

    setText("uiSubtitle",
      variantMeta?.subtitle ||
      "Заполните данные ученика, выполните задания, затем скачайте и отправьте результат."
    );

    setHTML("uiInstr",
      variantMeta?.instructions ||
      variantMeta?.subtitle ||
      "Выполните задания. Ответы сохраняются автоматически."
    );
  }

  // ========= render tasks (БЕЗ вставки текстов — тексты показывает sticky) =========
  function renderTasks() {
    const cont = $("tasksContainer");
    if (!cont) return;

    const tasks = variantData?.tasks || [];
    cont.innerHTML = "";

    for (const task of tasks) {
      const wrap = document.createElement("div");
      wrap.className = "task";
      wrap.dataset.taskId = String(task.id);       // data-task-id
      wrap.dataset.taskIdNum = String(task.id);    // data-task-id-num (для sticky)

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
        refreshScorePreview();
      });

      wrap.appendChild(inp);

      // Навигация по заданиям (если кнопки существуют в HTML — подключим)
      // Кнопки должны быть ВНУТРИ карточки задания под вводом ответа (как у тебя сейчас)
      const nav = document.createElement("div");
      nav.className = "task-nav";
      nav.innerHTML = `
        <button type="button" class="navbtn" data-nav="prev">← Предыдущее</button>
        <button type="button" class="navbtn" data-nav="next">Следующее →</button>
      `;
      nav.addEventListener("click", (e) => {
        const btn = e.target?.closest?.("button[data-nav]");
        if (!btn) return;
        if (btn.dataset.nav === "prev") showPrevTask();
        if (btn.dataset.nav === "next") showNextTask();
      });
      wrap.appendChild(nav);

      cont.appendChild(wrap);
    }

    applyFinishedState();
    // после отрисовки — покажем первое задание
    collectTaskList();
    showTaskByIndex(0);
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
    const mark = computeMark(percent, variantMeta?.grading);
    return { earned, max, percent, mark, perTask };
  }

  function refreshScorePreview() {
    // KPI в интерфейсе вы убрали — оставляем расчёт, но не показываем, если элементов нет
    const { earned, max, percent, mark } = calcScore();
    setText("kpiPoints", `${earned} / ${max}`);
    setText("kpiPercent", `${percent}%`);
    setText("kpiMark", mark);
  }

  // ========= timer =========
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

  // ========= finish =========
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

    const inputs = document.querySelectorAll("#studentName,#studentClass,#variantSelect,.task input.answer");
    inputs.forEach((el) => { el.disabled = isFinished; });

    // навкнопки тоже блокируем
    const navBtns = document.querySelectorAll(".task .navbtn");
    navBtns.forEach((b) => { b.disabled = isFinished; });
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
        mark: score.mark,
        thresholds: variantMeta?.grading || null
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
    refreshScorePreview();
    applyFinishedState();
    alert(auto ? "Время вышло. Контрольная завершена автоматически." : "Контрольная завершена. Можно сохранить и отправить результат.");
  }

  // ========= Yandex Cloud submit =========
  async function uploadToYandexCloud(resultPayload) {
    // URL API Gateway /submit
    const url = (manifest && manifest.cloudSubmitUrl)
      ? manifest.cloudSubmitUrl
      : "https://d5d0f59tbhjp00vl8vt4.8wihnuyr.apigw.yandexcloud.net/submit";

    // токен (понимай: в браузере он виден, но для базовой защиты подходит)
    const token = (manifest && manifest.submitToken) ? String(manifest.submitToken) : "";

    const fio = safeText(resultPayload?.student?.name);
    const cls = safeText(resultPayload?.student?.class);
    const variant = String(resultPayload?.variant?.id || resultPayload?.variantId || currentVariantId || "");

    // Обёртка под твою Cloud Function
    const submitBody = {
      identity: {
        fio: fio,
        name: fio,
        cls: cls,
        class: cls
      },
      meta: {
        variant: variant
      },
      subject: resultPayload.subject,
      subjectTitle: resultPayload.subjectTitle,
      result: resultPayload
    };

    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Submit-Token": token
      },
      body: JSON.stringify(submitBody)
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      throw new Error(`Cloud submit HTTP ${r.status}: ${t}`);
    }
    return await r.json().catch(() => ({ ok: true }));
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
      // ===== Reset API (student-side) =====
  // Учитель выдаёт reset-код, ученик открывает ссылку с ?reset=CODE
  const RESET_API_BASE = "https://d5d17sjh01l20fnemocv.3zvepvee.apigw.yandexcloud.net";

  function resetLsKey(subject, variantId) {
    return `${LS_PREFIX}${subject}:${variantId || "variant"}`;
  }

  function clearAttemptLocal(subject, variantId) {
    // очищаем сохранённую попытку
    localStorage.removeItem(resetLsKey(subject, variantId));
  }

  async function consumeResetCode(code, subject, variantId) {
    // Не отправляем teacher_token в браузер. Код сам по себе служит "пропуском".
    const url = RESET_API_BASE.replace(/\/+$/,"") + "/teacher/reset/consume";
    const payload = { code, subject, variant: variantId };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const txt = await r.text();
    let data = null;
    try { data = txt ? JSON.parse(txt) : null; } catch { data = { raw: txt }; }

    if (!r.ok) {
      const msg = data?.error || data?.message || txt || `HTTP ${r.status}`;
      throw new Error(msg);
    }
    return data || { ok: true };
  }

  function stripResetFromUrl() {
    const u = new URL(window.location.href);
    if (!u.searchParams.has("reset")) return;
    u.searchParams.delete("reset");
    // чтобы не "съедать" back, используем replaceState
    history.replaceState(null, "", u.toString());
  }


    const progress = loadProgress();
    startedAt = progress?.startedAt || nowIso();
    finishedAt = progress?.finishedAt || null;
    isFinished = Boolean(progress?.isFinished);

    if (progress?.student?.name && $("studentName")) $("studentName").value = progress.student.name;
    if (progress?.student?.class && $("studentClass")) $("studentClass").value = progress.student.class;

    answersMap = progress?.answers || {};

    setHeader();
    renderTasks();
    stickyInitOrRefresh(); // sticky после отрисовки заданий
    refreshScorePreview();
    startTimerIfNeeded();

    $("studentName")?.addEventListener("input", () => { if (!isFinished) saveProgress(); });
    $("studentClass")?.addEventListener("input", () => { if (!isFinished) saveProgress(); });
  }

  // ========= init =========
  async function init() {
    setTheme(getPreferredTheme());
    $("themeToggle")?.addEventListener("change", (e) => setTheme(e.target.checked ? "light" : "dark"));

    // Кнопки верхней панели (у тебя они в одном ряду и одинаковой ширины)
    $("btnFinish")?.addEventListener("click", () => finishNow(false));

    // "Сохранить работу" -> скачивание + (если настроено) отправка в YC
    $("btnDownload")?.addEventListener("click", async () => {
      const payload = buildResultPayload();
      const n = safeText(payload.student.name).replace(/[^\p{L}\p{N}\s._-]+/gu, "").replace(/\s+/g, "_");
      const c = safeText(payload.student.class).replace(/[^\p{L}\p{N}\s._-]+/gu, "").replace(/\s+/g, "_");
      const fn = `result_${subject}_${currentVariantId}_${c || "class"}_${n || "student"}.json`;

      // 1) скачиваем ученику
      downloadJson(fn, payload);

      // 2) пробуем отправить в Yandex Cloud (только если задан токен/URL)
      try {
        const hasToken = manifest?.submitToken && String(manifest.submitToken).length > 0;
        const hasUrl = manifest?.cloudSubmitUrl && String(manifest.cloudSubmitUrl).length > 0;

        // если ты не хочешь требовать токен — убери hasToken из условия
        if (hasUrl && hasToken) {
          const res = await uploadToYandexCloud(payload);
          console.log("Cloud submit:", res);
          alert("Работа сохранена и отправлена в облако ✅");
        } else {
          // если не настроено — просто молча
          console.log("Cloud submit skipped: cloudSubmitUrl/submitToken not set in manifest.json");
        }
      } catch (e) {
        console.warn(e);
        alert("Работа сохранена ✅\nНо в облако не отправилась ❗\n" + (e.message || e));
      }
    });

    // Email (как было)
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
        `Отметка: ${s.mark}\n` +
        `Вариант: ${payload.variant.title || payload.variant.id}\n` +
        `Начало: ${payload.startedAt}\n` +
        `Окончание: ${payload.finishedAt}\n\n` +
        `Важно: прикрепите к письму скачанный JSON-файл результата.\n`;
      mailto(to, subj, body);
    });

    await loadManifest();
    await loadVariant(currentVariantFile);
  }

  // ===== Sticky Text: показываем текст только для диапазонов =====
  let stickyCollapsed = false;

  function getTextRangesFromMeta() {
    const texts = variantMeta?.texts || {};
    const blocks = Object.values(texts)
      .map(t => {
        const r = Array.isArray(t.range) ? t.range : null;
        const from = r ? Number(r[0]) : NaN;
        const to = r ? Number(r[1]) : NaN;
        return {
          title: t.title || "Текст",
          from,
          to,
          html: t.html || ""
        };
      })
      .filter(b => Number.isFinite(b.from) && Number.isFinite(b.to) && b.html);

    blocks.sort((a, b) => a.from - b.from);
    return blocks;
  }

  function setStickyVisible(visible) {
    const wrap = $("stickyTextWrap");
    if (!wrap) return;
    wrap.style.display = visible ? "" : "none";
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
    for (const b of blocks) {
      if (taskId >= b.from && taskId <= b.to) return b;
    }
    return null; // вне диапазонов — скрыть sticky
  }

  let stickyBlocks = [];
  let stickyActiveKey = "";

  function stickyInitOrRefresh() {
    const wrap = $("stickyTextWrap");
    const btn = $("stickyToggle");

    stickyBlocks = getTextRangesFromMeta();
    stickyActiveKey = "";

    if (!wrap || stickyBlocks.length === 0) {
      setStickyVisible(false);
      return;
    }

    if (btn) {
      btn.onclick = () => {
        stickyCollapsed = !stickyCollapsed;
        const body = $("stickyTextBody");
        if (body) body.style.display = stickyCollapsed ? "none" : "";
        btn.textContent = stickyCollapsed ? "Показать" : "Скрыть";
      };
    }

    // при навигации по заданиям мы будем вызывать stickyUpdateForTask(taskId)
    const firstId = getVisibleTaskId();
    stickyUpdateForTask(firstId);
  }

  function stickyUpdateForTask(taskId) {
    const block = findBlockForTask(stickyBlocks, taskId);
    if (!block) {
      setStickyVisible(false);
      return;
    }
    setStickyVisible(true);
    const key = `${block.from}-${block.to}-${block.title}`;
    if (key !== stickyActiveKey) {
      stickyActiveKey = key;
      setStickyContent(block);
    }
  }

  // ===== Навигация: показываем только одно задание на экране =====
  let taskEls = [];
  let taskIndex = 0;

  function collectTaskList() {
    taskEls = Array.from(document.querySelectorAll("#tasksContainer .task"));
    // проставим индекс, если его нет
    taskEls.forEach((el, i) => (el.dataset._idx = String(i)));
    taskIndex = 0;
  }

  function getTaskIdByEl(el) {
    const raw = el?.dataset?.taskIdNum || el?.dataset?.taskId;
    const id = Number(raw);
    return Number.isFinite(id) ? id : null;
  }

  function showTaskByIndex(idx) {
    if (!taskEls.length) return;
    const n = taskEls.length;
    taskIndex = Math.max(0, Math.min(n - 1, idx));

    taskEls.forEach((el, i) => {
      el.style.display = (i === taskIndex) ? "" : "none";
    });

    const currentEl = taskEls[taskIndex];
    const currentId = getTaskIdByEl(currentEl);
    stickyUpdateForTask(currentId);

    // фокус в поле ответа
    const inp = currentEl?.querySelector?.("input.answer");
    if (inp) setTimeout(() => inp.focus(), 0);
  }

  function showPrevTask() { showTaskByIndex(taskIndex - 1); }
  function showNextTask() { showTaskByIndex(taskIndex + 1); }

  function getVisibleTaskId() {
    const el = taskEls[taskIndex];
    return getTaskIdByEl(el);
  }

  init().catch((err) => {
    console.error(err);

    const hint =
      `Subject: ${subject}\n` +
      `Ожидаем manifest:\n${base}manifest.json\n` +
      `Ожидаем variant:\n${base}${currentVariantFile || "variant_01.json"}\n\n` +
      `Проверь:\n` +
      `1) путь /controls/<subject>/variants/manifest.json\n` +
      `2) путь /control/control.html (а не /controls)\n` +
      `3) что control.html содержит элементы: variantSelect, tasksContainer, btnFinish, btnDownload, btnEmail, stickyTextWrap.\n`;

    alert("Ошибка загрузки контрольной: " + err.message + "\n\n" + hint);
  });
})();
