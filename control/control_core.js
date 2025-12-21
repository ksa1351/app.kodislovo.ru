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
  function nowIso() {
    return new Date().toISOString();
  }
  function safeText(s) {
    return (s ?? "").toString().trim();
  }
  function normalizeAnswer(s) {
    return safeText(s).toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  }

  // Варианты лежат в /controls/<subject>/variants/ (controls в корне сайта)
  function variantsBase(subject) {
    return new URL(`/controls/${encodeURIComponent(subject)}/variants/`, window.location.origin).toString();
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

  // ========= theme (переключение кликом, без checkbox) =========
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

    // если вдруг остался checkbox — не ломаем, просто синхронизируем
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
    setText("uiMainTitle", variantMeta?.title || "Контрольная работа");
    setText(
      "uiSubtitle",
      variantMeta?.subtitle ||
        "Заполните данные ученика, выполните задания, завершите и отправьте результат."
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
    const mirror = $("uiTimerMirror");
    if (mirror) mirror.value = text;
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
    const btnSubmit = $("btnSubmit");
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
        subtitle: variantMeta?.subtitle || "",
      },
      grading: {
        maxPoints: score.max,
        earnedPoints: score.earned,
        percent: score.percent,
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

  function getTextRangesFromMeta() {
    const texts = variantMeta?.texts || {};
    const blocks = Object.values(texts)
      .map((t) => {
        const r = Array.isArray(t.range) ? t.range : null;
        const from = r ? Number(r[0]) : NaN;
        const to = r ? Number(r[1]) : NaN;
        return { title: t.title || "Текст", from, to, html: t.html || "" };
      })
      .filter((b) => Number.isFinite(b.from) && Number.isFinite(b.to) && b.html);

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

    // time limit from variant meta (если задано в варианте)
    const tlmLocal = Number(variantMeta.time_limit_minutes || 0);
    timeLimitSec = tlmLocal > 0 ? tlmLocal * 60 : null;

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

    // sticky collapse btn
    const stBtn = $("stickyToggle");
    if (stBtn && !stBtn._kdBound) {
      stBtn._kdBound = true;
      stBtn.addEventListener("click", () => {
        stickyCollapsed = !stickyCollapsed;
        const body = $("stickyTextBody");
        if (body) body.style.display = stickyCollapsed ? "none" : "";
        stBtn.textContent = stickyCollapsed ? "Показать" : "Скрыть";
      });
    }

    renderCurrentTask();
    applyFinishedState();
    startTimerIfNeeded();

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
    if (!manifest?.submit?.url || !manifest?.submit?.token) {
      alert("В manifest.json не задан submit.url / submit.token.");
      return;
    }
    if (!isFinished) {
      alert("Сначала нажмите «Завершить».");
      return;
    }

    const btn = $("btnSubmit");
    const prevText = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Отправляется…"; }

    try {
      const payload = buildResultPayload();

      await postJson(manifest.submit.url, payload, {
        "X-Submit-Token": manifest.submit.token,
      });

      // ✅ после успешной отправки — удаляем временное автосохранение
      clearLocalProgress();

      // оставляем экран в состоянии "завершено" (в памяти)
      applyFinishedState();

      alert("Работа успешно отправлена.");
    } catch (err) {
      console.error(err);
      alert("Не удалось отправить работу. Проверьте интернет и попробуйте ещё раз.\n\n" + String(err.message || err));
      if (btn) { btn.disabled = false; }
    } finally {
      if (btn) btn.textContent = prevText || "Отправить";
    }
  }

  // ========= reset consume (код сброса) =========
  async function consumeResetCode() {
    const code = safeText($("resetCode")?.value);
    if (!code) {
      alert("Введите код сброса.");
      return;
    }
    if (!manifest?.teacher?.base_url || !manifest?.teacher?.token) {
      alert("В manifest.json не задан teacher.base_url / teacher.token.");
      return;
    }

    const fio = safeText($("studentName")?.value);
    const cls = safeText($("studentClass")?.value);
    if (!fio || !cls) {
      alert("Заполните ФИО и класс, чтобы применить код сброса.");
      return;
    }

    const url = String(manifest.teacher.base_url).replace(/\/+$/, "") + "/teacher/reset/consume";

    const btn = $("btnReset");
    const prevText = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Проверка…"; }

    try {
      await postJson(url, {
        subject,
        fio,
        cls,
        variant: currentVariantId,
        code,
      }, {
        "X-Teacher-Token": manifest.teacher.token,
      });

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

      alert("Сброс применён. Можно выполнять работу заново.");
    } catch (err) {
      console.error(err);
      alert("Код сброса не принят.\n\n" + String(err.message || err));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = prevText || "Сброс"; }
    }
  }

  // ========= init =========
  async function init() {
    // theme init + toggle by click
    setTheme(getPreferredTheme());
    const themeBtn = $("themeToggle") || $("themeWrap") || $("themeSwitch") || null;
    if (themeBtn && !themeBtn._kdBound) {
      themeBtn._kdBound = true;
      themeBtn.addEventListener("click", (e) => {
        // чтобы не срабатывало на клике по input внутри, если он вдруг есть
        e.preventDefault();
        toggleTheme();
      });
    }

    // finish / submit / reset
    const bf = $("btnFinish");
    if (bf && !bf._kdBound) {
      bf._kdBound = true;
      bf.addEventListener("click", () => finishNow(false));
    }

    const bs = $("btnSubmit");
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
      `1) /controls/<subject>/variants/manifest.json (controls в корне)\n` +
      `2) что control.html лежит в /control/control.html\n` +
      `3) что подключён CSS: /assets/css/control-ui.css\n`;
    alert("Ошибка загрузки контрольной: " + err.message + "\n\n" + hint);
  });
})();
