(function () {
  "use strict";

  const LS_PREFIX = "kodislovo_route:";

  const SUBJECT_LABELS = {
    russian: "Русский язык",
    literature: "Литература",
  };

  const ZUN_LABELS = {
    knowledge: "Знаю",
    skill: "Умею",
    habit: "Отрабатываю навык",
  };

  const STEP_TYPE_LABELS = {
    theory: "Теория",
    practice: "Практика",
    trainer: "Тренажёр",
    control: "Контроль",
    reflection: "Рефлексия",
  };

  const STATUS = {
    NOT_STARTED: "not_started",
    IN_PROGRESS: "in_progress",
    COMPLETED: "completed",
    NEEDS_RETRY: "needs_retry",
  };

  const STATUS_LABELS = {
    not_started: "Не начато",
    in_progress: "В процессе",
    completed: "Выполнено",
    needs_retry: "Требуется повторение",
  };

  function $(id) {
    return document.getElementById(id);
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

  function getParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function projectRoot() {
    const seg = (location.pathname.split("/").filter(Boolean)[0] || "");
    return seg ? `/${seg}/` : "/";
  }

  function routesBase() {
    return `${location.origin}${projectRoot()}routes/`;
  }

  async function fetchJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`Не удалось загрузить: ${url} (HTTP ${r.status})`);
    return await r.json();
  }

  function lsKey(routeId) {
    return `${LS_PREFIX}${routeId}`;
  }

  function loadProgress(routeId) {
    try {
      const raw = localStorage.getItem(lsKey(routeId));
      if (!raw) return defaultProgress();
      const data = JSON.parse(raw);
      return {
        steps: data.steps && typeof data.steps === "object" ? data.steps : {},
        reflection: data.reflection || { strengths: "", difficulties: "" },
        updatedAt: data.updatedAt || null,
      };
    } catch {
      return defaultProgress();
    }
  }

  function defaultProgress() {
    return { steps: {}, reflection: { strengths: "", difficulties: "" }, updatedAt: null };
  }

  function saveProgress(routeId, progress) {
    progress.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(lsKey(routeId), JSON.stringify(progress));
    } catch (e) {
      console.warn("localStorage write failed", e);
    }
  }

  function getStepProgress(progress, stepId) {
    return progress.steps[stepId] || { status: STATUS.NOT_STARTED, score: null, note: "" };
  }

  function setStepStatus(progress, stepId, status) {
    const cur = getStepProgress(progress, stepId);
    progress.steps[stepId] = { ...cur, status, updatedAt: new Date().toISOString() };
  }

  function calcPercent(route, progress) {
    const required = route.steps.filter((s) => s.required !== false);
    if (!required.length) return 0;
    const done = required.filter((s) => {
      const st = getStepProgress(progress, s.id).status;
      return st === STATUS.COMPLETED;
    });
    return Math.round((done.length / required.length) * 100);
  }

  function resolveResourceUrl(resource) {
    const rel = safeText(resource);
    if (!rel) return "";
    if (/^https?:\/\//i.test(rel)) return rel;
    const root = projectRoot();
    const path = rel.startsWith("/") ? rel.slice(1) : rel;
    return `${location.origin}${root}${path}`;
  }

  function subjectClass(subject) {
    if (subject === "literature") return "rt-subject-literature";
    return "rt-subject-russian";
  }

  function statusClass(status) {
    return `rt-status-${status}`;
  }

  function renderZunBadge(zun) {
    if (!zun || !ZUN_LABELS[zun]) return "";
    return `<span class="rt-zun rt-zun-${escapeHtml(zun)}">${escapeHtml(ZUN_LABELS[zun])}</span>`;
  }

  // ========= index page =========

  async function initIndex() {
    const listEl = $("routesList");
    const emptyEl = $("routesEmpty");
    const errorEl = $("routesError");
    if (!listEl) return;

    try {
      const manifest = await fetchJson(`${routesBase()}manifest.json`);
      const files = Array.isArray(manifest.routes) ? manifest.routes : [];
      if (!files.length) {
        if (emptyEl) emptyEl.hidden = false;
        return;
      }

      const routes = await Promise.all(
        files.map(async (entry) => {
          const file = typeof entry === "string" ? entry : entry.file;
          const route = await fetchJson(`${routesBase()}${file}`);
          return { ...route, _file: file };
        })
      );

      routes.sort((a, b) => {
        const sub = (SUBJECT_LABELS[a.subject] || a.subject).localeCompare(SUBJECT_LABELS[b.subject] || b.subject, "ru");
        if (sub !== 0) return sub;
        return (a.grade || 0) - (b.grade || 0) || a.title.localeCompare(b.title, "ru");
      });

      const bySubject = {};
      routes.forEach((r) => {
        const key = r.subject || "other";
        if (!bySubject[key]) bySubject[key] = [];
        bySubject[key].push(r);
      });

      let html = "";
      Object.keys(bySubject).sort().forEach((subject) => {
        const label = SUBJECT_LABELS[subject] || subject;
        html += `<section class="rt-index-group" aria-labelledby="rt-subj-${escapeHtml(subject)}">`;
        html += `<div class="kd-section-head"><h2 id="rt-subj-${escapeHtml(subject)}">${escapeHtml(label)}</h2></div>`;
        html += `<div class="kd-card-grid kd-card-grid-compact">`;
        bySubject[subject].forEach((route) => {
          const pct = calcPercent(route, loadProgress(route.id));
          const stepsCount = route.steps?.length || 0;
          html += `<a class="kd-card rt-route-card ${subjectClass(route.subject)}" href="route.html?id=${encodeURIComponent(route.id)}">`;
          html += `<div class="kd-card-head">`;
          html += `<span class="kd-kicker">${escapeHtml(String(route.grade))} класс</span>`;
          html += `<span class="kd-status kd-status-live">${pct}%</span>`;
          html += `</div>`;
          html += `<strong>${escapeHtml(route.title)}</strong>`;
          html += `<small>${escapeHtml(route.description || "")}</small>`;
          html += `<span class="rt-card-meta">${stepsCount} шагов · ${escapeHtml(route.id)}</span>`;
          html += `</a>`;
        });
        html += `</div></section>`;
      });

      listEl.innerHTML = html;
    } catch (e) {
      console.error(e);
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = `Не удалось загрузить список маршрутов: ${e.message}`;
      }
    }
  }

  // ========= route page =========

  let currentRoute = null;
  let currentProgress = null;

  async function loadRouteById(id) {
    const manifest = await fetchJson(`${routesBase()}manifest.json`);
    const files = Array.isArray(manifest.routes) ? manifest.routes : [];
    for (const entry of files) {
      const file = typeof entry === "string" ? entry : entry.file;
      const route = await fetchJson(`${routesBase()}${file}`);
      if (route.id === id) return route;
    }
    throw new Error(`Маршрут «${id}» не найден.`);
  }

  function renderRouteHeader(route, progress) {
    const pct = calcPercent(route, progress);
    setText("routeSubject", SUBJECT_LABELS[route.subject] || route.subject);
    setText("routeGrade", `${route.grade} класс`);
    setText("routeTitle", route.title);
    setText("routeDescription", route.description || "");
    setText("routeId", route.id);
    setText("routePercent", `${pct}%`);
    setText("routePercentLabel", pct === 100 ? "Маршрут пройден" : "Выполнено обязательных шагов");

    const bar = $("routeProgressBar");
    if (bar) bar.style.width = `${pct}%`;
    const track = bar?.parentElement;
    if (track) {
      track.setAttribute("aria-valuenow", String(pct));
      track.setAttribute("aria-valuetext", `${pct}%`);
    }

    const subjEl = $("routeSubjectBadge");
    if (subjEl) {
      subjEl.className = `rt-subject-badge ${subjectClass(route.subject)}`;
    }
  }

  function setText(id, text) {
    const el = $(id);
    if (el) el.textContent = text;
  }

  function renderSteps(route, progress) {
    const listEl = $("routeSteps");
    if (!listEl || !route.steps) return;

    let html = "";
    route.steps.forEach((step, index) => {
      const sp = getStepProgress(progress, step.id);
      const status = sp.status || STATUS.NOT_STARTED;
      const typeLabel = STEP_TYPE_LABELS[step.type] || step.type;
      const resourceUrl = resolveResourceUrl(step.resource);

      html += `<article class="rt-step ${statusClass(status)}" data-step-id="${escapeHtml(step.id)}">`;
      html += `<div class="rt-step-head">`;
      html += `<span class="rt-step-num" aria-hidden="true">${index + 1}</span>`;
      html += `<div class="rt-step-titles">`;
      html += `<h3>${escapeHtml(step.title)}</h3>`;
      html += `<div class="rt-step-badges">`;
      html += `<span class="rt-type">${escapeHtml(typeLabel)}</span>`;
      html += renderZunBadge(step.zun);
      if (step.required === false) html += `<span class="rt-optional">Необязательно</span>`;
      html += `</div></div>`;
      html += `<span class="rt-step-status ${statusClass(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span>`;
      html += `</div>`;

      html += `<p class="rt-step-instruction">${escapeHtml(step.instruction || "")}</p>`;

      if (step.minScore) {
        html += `<p class="rt-step-hint">Минимальный результат: <strong>${step.minScore}%</strong></p>`;
      }

      if (sp.score != null && sp.score !== "") {
        html += `<p class="rt-step-score">Результат: <strong>${escapeHtml(String(sp.score))}%</strong></p>`;
      }

      html += `<div class="rt-step-actions">`;
      if (resourceUrl) {
        html += `<a class="kd-button rt-open-resource" href="${escapeHtml(resourceUrl)}" target="_blank" rel="noopener">Открыть материал</a>`;
      }
      html += `<button type="button" class="kd-button kd-button-secondary rt-btn-status" data-status="${STATUS.IN_PROGRESS}">В процессе</button>`;
      html += `<button type="button" class="kd-button rt-btn-status" data-status="${STATUS.COMPLETED}">Выполнено</button>`;
      html += `<button type="button" class="kd-button kd-button-secondary rt-btn-status rt-btn-retry" data-status="${STATUS.NEEDS_RETRY}">Повторить</button>`;
      html += `<button type="button" class="kd-button kd-button-secondary rt-btn-reset">Сбросить</button>`;
      html += `</div>`;

      if (step.type === "reflection") {
        html += `<div class="rt-reflection-fields">`;
        html += `<label class="field"><span class="label">Что получилось</span>`;
        html += `<textarea class="rt-reflection-input" data-field="strengths" rows="2" placeholder="Например: запомнил правило, правильно выделяю оборот">${escapeHtml(sp.strengths || progress.reflection?.strengths || "")}</textarea></label>`;
        html += `<label class="field"><span class="label">Что вызвало трудности</span>`;
        html += `<textarea class="rt-reflection-input" data-field="difficulties" rows="2" placeholder="Например: путаю запятые при однородных членах">${escapeHtml(sp.difficulties || progress.reflection?.difficulties || "")}</textarea></label>`;
        html += `</div>`;
      }

      html += `</article>`;
    });

    listEl.innerHTML = html;

    listEl.querySelectorAll(".rt-btn-status").forEach((btn) => {
      btn.addEventListener("click", () => {
        const article = btn.closest(".rt-step");
        const stepId = article?.dataset.stepId;
        const status = btn.dataset.status;
        if (!stepId || !status) return;
        setStepStatus(currentProgress, stepId, status);
        saveProgress(currentRoute.id, currentProgress);
        renderRoutePage();
      });
    });

    listEl.querySelectorAll(".rt-btn-reset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const article = btn.closest(".rt-step");
        const stepId = article?.dataset.stepId;
        if (!stepId) return;
        delete currentProgress.steps[stepId];
        saveProgress(currentRoute.id, currentProgress);
        renderRoutePage();
      });
    });

    listEl.querySelectorAll(".rt-reflection-input").forEach((input) => {
      input.addEventListener("change", () => {
        const article = input.closest(".rt-step");
        const stepId = article?.dataset.stepId;
        const field = input.dataset.field;
        if (!stepId || !field) return;
        const sp = getStepProgress(currentProgress, stepId);
        sp[field] = input.value;
        currentProgress.reflection[field] = input.value;
        if (sp.status === STATUS.NOT_STARTED && input.value.trim()) {
          sp.status = STATUS.IN_PROGRESS;
        }
        currentProgress.steps[stepId] = sp;
        saveProgress(currentRoute.id, currentProgress);
      });
    });
  }

  function renderZunSummary(route) {
    const el = $("routeZunSummary");
    if (!el) return;
    const counts = { knowledge: 0, skill: 0, habit: 0 };
    route.steps.forEach((s) => {
      if (s.zun && counts[s.zun] != null) counts[s.zun]++;
    });
    let html = "";
    Object.keys(ZUN_LABELS).forEach((key) => {
      if (!counts[key]) return;
      html += `<div class="rt-zun-block rt-zun-${key}">`;
      html += `<span class="rt-zun-title">${escapeHtml(ZUN_LABELS[key])}</span>`;
      html += `<span class="rt-zun-count">${counts[key]} шаг.</span>`;
      html += `</div>`;
    });
    el.innerHTML = html || '<p class="rt-muted">ЗУН не указаны для шагов маршрута.</p>';
  }

  function renderRoutePage() {
    if (!currentRoute) return;
    renderRouteHeader(currentRoute, currentProgress);
    renderZunSummary(currentRoute);
    renderSteps(currentRoute, currentProgress);
  }

  async function initRoute() {
    const id = safeText(getParam("id"));
    const loadingEl = $("routeLoading");
    const contentEl = $("routeContent");
    const errorEl = $("routeError");

    if (!id) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = "Не указан идентификатор маршрута. Вернитесь к списку.";
      }
      if (loadingEl) loadingEl.hidden = true;
      return;
    }

    try {
      currentRoute = await loadRouteById(id);
      currentProgress = loadProgress(id);
      document.title = `${currentRoute.title} — маршрутный лист`;
      if (loadingEl) loadingEl.hidden = true;
      if (contentEl) contentEl.hidden = false;
      renderRoutePage();
    } catch (e) {
      console.error(e);
      if (loadingEl) loadingEl.hidden = true;
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent = e.message;
      }
    }
  }

  // ========= boot =========

  const page = document.body?.dataset?.page;
  if (page === "index") initIndex();
  else if (page === "route") initRoute();

  window.RoutesCore = {
    STATUS,
    calcPercent,
    loadProgress,
    saveProgress,
  };
})();
