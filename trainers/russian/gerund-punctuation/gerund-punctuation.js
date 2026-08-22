(function () {
  "use strict";

  const core = window.KodislovoGerundPunctuation;
  const DATA_URL = "./tasks.json";
  const PROFILE_KEY = "kodislovo:russian:gerund-punctuation:profile:v1";
  const STORAGE_PREFIX = "kodislovo:russian:gerund-punctuation:v1:";
  const TASKS_PER_LEVEL = 4;

  let taskBank = [];
  let taskById = new Map();
  let state = null;
  let currentTask = null;

  function $(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return (value ?? "").toString().trim();
  }

  function studentSlug(name) {
    return encodeURIComponent(safeText(name).toLocaleLowerCase("ru-RU") || "student");
  }

  function storageKey(name) {
    return `${STORAGE_PREFIX}${studentSlug(name)}`;
  }

  function getStudentFromUrl() {
    return safeText(new URLSearchParams(location.search).get("student"));
  }

  function loadProfileName() {
    try {
      return safeText(localStorage.getItem(PROFILE_KEY));
    } catch {
      return "";
    }
  }

  function saveProfileName(name) {
    try {
      localStorage.setItem(PROFILE_KEY, name);
    } catch (error) {
      console.warn("Не удалось сохранить имя", error);
    }
  }

  function freshState(name) {
    const session = core.createSession(taskBank, TASKS_PER_LEVEL);
    return {
      schema: "kodislovo.gerund-punctuation.state.v1",
      studentName: name,
      taskIds: session.map((task) => task.id),
      phase: "practice",
      currentIndex: 0,
      drafts: {},
      initialResults: {},
      retryTaskIds: [],
      retryIndex: 0,
      retryResults: {},
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  function loadState(name) {
    try {
      const raw = localStorage.getItem(storageKey(name));
      if (!raw) return null;
      const saved = JSON.parse(raw);
      const validIds = Array.isArray(saved.taskIds) && saved.taskIds.every((id) => taskById.has(id));
      if (!validIds || saved.schema !== "kodislovo.gerund-punctuation.state.v1") return null;
      saved.drafts = saved.drafts && typeof saved.drafts === "object" ? saved.drafts : {};
      return saved;
    } catch {
      return null;
    }
  }

  function saveState() {
    if (!state) return;
    state.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(storageKey(state.studentName), JSON.stringify(state));
    } catch (error) {
      console.warn("Не удалось сохранить прогресс", error);
    }
  }

  function setActiveStep(targetId) {
    document.querySelectorAll(".punctuation-stepper a").forEach((link) => {
      const active = link.getAttribute("href") === `#${targetId}`;
      link.classList.toggle("is-active", active);
      if (active) link.setAttribute("aria-current", "step");
      else link.removeAttribute("aria-current");
    });
  }

  function scrollToSection(id) {
    const section = $(id);
    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveStep(id);
  }

  function currentTaskId() {
    if (!state) return "";
    return state.phase === "retry"
      ? state.retryTaskIds[state.retryIndex]
      : state.taskIds[state.currentIndex];
  }

  function currentResults() {
    return state.phase === "retry" ? state.retryResults : state.initialResults;
  }

  function currentPosition() {
    return state.phase === "retry" ? state.retryIndex : state.currentIndex;
  }

  function currentTaskIds() {
    return state.phase === "retry" ? state.retryTaskIds : state.taskIds;
  }

  function currentSelection() {
    const result = currentResults()[currentTaskId()];
    if (result) return core.normalizeSelection(result.selection);
    return core.normalizeSelection(state.drafts[currentTaskId()]);
  }

  function setCurrentSelection(selection) {
    state.drafts[currentTaskId()] = core.normalizeSelection(selection);
    saveState();
  }

  function updateMobileAction() {
    const action = $("mobileActionBtn");
    if (!state) {
      $("mobileStatus").textContent = "Готов к тренировке";
      action.textContent = "Начать";
      action.dataset.action = "start";
      return;
    }
    if (state.phase === "result") {
      $("mobileStatus").textContent = "Тренировка завершена";
      action.textContent = "К итогу";
      action.dataset.action = "result";
      return;
    }
    const position = currentPosition() + 1;
    const total = currentTaskIds().length;
    $("mobileStatus").textContent = `${state.phase === "retry" ? "Повтор" : "Задание"} ${position} из ${total}`;
    action.textContent = "К заданию";
    action.dataset.action = "practice";
  }

  function renderSentenceEditor() {
    const editor = $("sentenceEditor");
    const selection = new Set(currentSelection());
    const checked = Boolean(currentResults()[currentTask.id]);
    editor.innerHTML = "";

    currentTask.words.forEach((word, index) => {
      const unit = document.createElement("span");
      unit.className = "punctuation-word-unit";
      const wordEl = document.createElement("span");
      wordEl.textContent = word;
      unit.appendChild(wordEl);

      if (index < currentTask.words.length - 1) {
        const gap = document.createElement("button");
        const selected = selection.has(index);
        gap.type = "button";
        gap.className = `punctuation-gap${selected ? " is-selected" : ""}`;
        gap.dataset.index = String(index);
        gap.setAttribute("aria-pressed", String(selected));
        gap.setAttribute("aria-label", `${selected ? "Убрать" : "Поставить"} запятую после слова «${word}»`);
        gap.disabled = checked;
        gap.addEventListener("click", () => toggleComma(index));
        unit.appendChild(gap);
      }
      editor.appendChild(unit);
    });
  }

  function toggleComma(index) {
    if (currentResults()[currentTask.id]) return;
    const selection = new Set(currentSelection());
    if (selection.has(index)) selection.delete(index);
    else selection.add(index);
    setCurrentSelection([...selection]);
    renderSentenceEditor();
  }

  function clearSelection() {
    if (!state || !currentTask || currentResults()[currentTask.id]) return;
    setCurrentSelection([]);
    renderSentenceEditor();
  }

  function showPractice() {
    $("step-practice").hidden = false;
    $("step-result").hidden = true;
    renderTask();
    updateMobileAction();
  }

  function renderTask() {
    const ids = currentTaskIds();
    const position = currentPosition();
    currentTask = taskById.get(ids[position]);
    if (!currentTask) {
      finishPhase();
      return;
    }

    const savedResult = currentResults()[currentTask.id];
    const initialSummary = core.calculateSummary(state.taskIds, state.initialResults);
    const progress = Math.round((position / ids.length) * 100);

    $("taskProgress").textContent = `${state.phase === "retry" ? "Повтор" : "Задание"} ${position + 1} из ${ids.length}`;
    $("studentGreeting").textContent = `${state.studentName}, ${state.phase === "retry" ? "исправляем пунктуацию." : "расставь запятые."}`;
    $("levelPill").textContent = `Уровень ${currentTask.level}`;
    $("scorePill").textContent = `Верно: ${initialSummary.correct}`;
    $("checkBtn").hidden = Boolean(savedResult);
    $("clearBtn").hidden = Boolean(savedResult);
    $("nextBtn").hidden = !savedResult;
    $("nextBtn").textContent = position === ids.length - 1 ? "Завершить" : "Следующее";
    $("feedback").hidden = !savedResult;

    const track = $("progressBar");
    track.style.width = `${progress}%`;
    track.parentElement.setAttribute("aria-valuenow", String(progress));

    renderSentenceEditor();
    if (savedResult) renderFeedback(savedResult.correct);
  }

  function renderFeedback(correct) {
    const box = $("feedback");
    box.hidden = false;
    box.className = `punctuation-feedback ${correct ? "is-correct" : "is-wrong"}`;
    $("feedbackTitle").textContent = correct ? "Верно!" : "Нужно исправить";
    $("feedbackSentence").textContent = currentTask.explanation;
    $("feedbackRule").textContent = currentTask.rule;
  }

  function submitAnswer() {
    if (!state || state.phase === "result" || !currentTask) return;
    const selection = currentSelection();
    const correct = core.checkSelection(currentTask, selection);
    currentResults()[currentTask.id] = {
      selection,
      correct,
      checkedAt: new Date().toISOString(),
    };
    saveState();
    renderTask();
  }

  function goNext() {
    if (!state || !currentResults()[currentTask?.id]) return;
    const ids = currentTaskIds();
    if (currentPosition() >= ids.length - 1) {
      finishPhase();
      return;
    }
    if (state.phase === "retry") state.retryIndex += 1;
    else state.currentIndex += 1;
    saveState();
    renderTask();
    scrollToSection("step-practice");
  }

  function finishPhase() {
    state.phase = "result";
    saveState();
    showResult();
    scrollToSection("step-result");
  }

  function resultMessage(percent) {
    if (percent === 100) return "Отлично: все границы добавочного действия найдены.";
    if (percent >= 80) return "Очень хороший результат. Осталось закрепить несколько случаев.";
    if (percent >= 60) return "Правило в целом понятно. Повтори ошибки и проверь границы оборотов.";
    return "Вернись к памятке и повтори ошибки без спешки.";
  }

  function showResult() {
    const summary = core.calculateSummary(state.taskIds, state.initialResults);
    const initialErrorIds = state.taskIds.filter((id) => !state.initialResults[id]?.correct);
    const resolved = initialErrorIds.filter((id) => state.retryResults[id]?.correct).length;
    const unresolved = initialErrorIds.length - resolved;
    $("step-practice").hidden = true;
    $("step-result").hidden = false;
    $("resultTitle").textContent = `Результат: ${state.studentName}`;
    $("resultPercent").textContent = `${summary.percent}%`;
    $("resultMessage").textContent = initialErrorIds.length > 0 && unresolved === 0
      ? "Все ошибки исправлены. Отличная работа с пунктуацией!"
      : resultMessage(summary.percent);
    $("resultCorrect").textContent = String(summary.correct);
    $("resultErrors").textContent = String(summary.total - summary.correct);
    $("resultResolved").textContent = String(resolved);
    $("retryBtn").hidden = unresolved === 0;
    setActiveStep("step-result");
    updateMobileAction();
  }

  function retryErrors() {
    const errorIds = state.taskIds.filter((id) => !state.initialResults[id]?.correct && !state.retryResults[id]?.correct);
    if (!errorIds.length) return;
    state.phase = "retry";
    state.retryTaskIds = errorIds;
    state.retryIndex = 0;
    errorIds.forEach((id) => {
      delete state.retryResults[id];
      state.drafts[id] = [];
    });
    saveState();
    showPractice();
    scrollToSection("step-practice");
  }

  function startSession(options) {
    const settings = options || {};
    const name = safeText($("studentName").value) || "Ученик";
    $("studentName").value = name;
    saveProfileName(name);
    state = settings.resume ? loadState(name) : null;
    if (!state || settings.fresh) state = freshState(name);
    saveState();
    if (state.phase === "result") {
      showResult();
      scrollToSection("step-result");
    } else {
      showPractice();
      scrollToSection("step-practice");
    }
    updateResumeHint();
  }

  function newSession() {
    state = freshState(state?.studentName || safeText($("studentName").value) || "Ученик");
    saveState();
    showPractice();
    scrollToSection("step-practice");
    updateResumeHint();
  }

  function buildResultPayload() {
    const summary = core.calculateSummary(state.taskIds, state.initialResults);
    return {
      schema: "kodislovo.gerund-punctuation.result.v1",
      createdAt: new Date().toISOString(),
      student: { name: state.studentName },
      trainer: "gerund-punctuation",
      title: "Обособление деепричастий и деепричастных оборотов",
      summary,
      tasks: state.taskIds.map((id) => {
        const task = taskById.get(id);
        return {
          id,
          source: core.buildSentence(task, []),
          expected: task.commaAfter,
          correctSentence: core.buildSentence(task, task.commaAfter),
          selection: state.initialResults[id]?.selection || [],
          correct: Boolean(state.initialResults[id]?.correct),
          retryCorrect: Boolean(state.retryResults[id]?.correct),
        };
      }),
    };
  }

  function downloadResult() {
    if (!state) return;
    const blob = new Blob([JSON.stringify(buildResultPayload(), null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `deeprichastiya_zapyatye_${studentSlug(state.studentName)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function updateResumeHint() {
    const name = safeText($("studentName").value);
    const saved = name ? loadState(name) : null;
    const hint = $("resumeHint");
    if (!saved) {
      hint.hidden = true;
      $("startBtn").textContent = "Начать тренировку";
      return;
    }
    const summary = core.calculateSummary(saved.taskIds, saved.initialResults);
    hint.hidden = false;
    hint.textContent = `Есть сохранённая тренировка: выполнено ${summary.answered} из ${summary.total}. Кнопка продолжит её.`;
    $("startBtn").textContent = "Продолжить тренировку";
  }

  function bindEvents() {
    $("startBtn").addEventListener("click", () => startSession({ resume: true }));
    $("studentName").addEventListener("input", updateResumeHint);
    $("checkBtn").addEventListener("click", submitAnswer);
    $("clearBtn").addEventListener("click", clearSelection);
    $("nextBtn").addEventListener("click", goNext);
    $("retryBtn").addEventListener("click", retryErrors);
    $("newSessionBtn").addEventListener("click", newSession);
    $("downloadBtn").addEventListener("click", downloadResult);
    $("mobileActionBtn").addEventListener("click", () => {
      const action = $("mobileActionBtn").dataset.action;
      if (action === "start") startSession({ resume: true });
      else scrollToSection(action === "result" ? "step-result" : "step-practice");
    });
  }

  async function init() {
    if (!core) throw new Error("Не загружена логика тренажёра.");
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Не удалось загрузить задания (HTTP ${response.status}).`);
    const data = await response.json();
    taskBank = Array.isArray(data.tasks) ? data.tasks : [];
    if (!taskBank.length) throw new Error("Банк заданий пуст.");
    taskById = new Map(taskBank.map((task) => [task.id, task]));

    const initialName = getStudentFromUrl() || loadProfileName();
    $("studentName").value = initialName;
    bindEvents();
    updateResumeHint();
    updateMobileAction();
  }

  init().catch((error) => {
    console.error(error);
    $("startBtn").disabled = true;
    $("resumeHint").hidden = false;
    $("resumeHint").textContent = `Тренажёр не загрузился: ${error.message}`;
  });
})();
