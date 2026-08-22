(function () {
  "use strict";

  const core = window.KodislovoGerundFormation;
  const DATA_URL = "./tasks.json";
  const PROFILE_KEY = "kodislovo:russian:gerund-formation:profile:v1";
  const STORAGE_PREFIX = "kodislovo:russian:gerund-formation:v1:";
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
    return encodeURIComponent(core.normalizeAnswer(name) || "student");
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
      schema: "kodislovo.gerund-formation.state.v1",
      studentName: name,
      taskIds: session.map((task) => task.id),
      phase: "practice",
      currentIndex: 0,
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
      if (!validIds || saved.schema !== "kodislovo.gerund-formation.state.v1") return null;
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
    document.querySelectorAll(".gerund-stepper a").forEach((link) => {
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

    const results = currentResults();
    const savedResult = results[currentTask.id];
    const initialSummary = core.calculateSummary(state.taskIds, state.initialResults);
    const progress = Math.round((position / ids.length) * 100);

    $("taskProgress").textContent = `${state.phase === "retry" ? "Повтор" : "Задание"} ${position + 1} из ${ids.length}`;
    $("studentGreeting").textContent = `${state.studentName}, ${state.phase === "retry" ? "исправляем ошибку." : "работаем внимательно."}`;
    $("levelPill").textContent = `Уровень ${currentTask.level}`;
    $("scorePill").textContent = `Верно: ${initialSummary.correct}`;
    $("aspectBadge").textContent = currentTask.aspect;
    $("verbWord").textContent = currentTask.verb;
    $("answerInput").value = savedResult?.answer || "";
    $("answerInput").disabled = Boolean(savedResult);
    $("checkBtn").hidden = Boolean(savedResult);
    $("nextBtn").hidden = !savedResult;
    $("nextBtn").textContent = position === ids.length - 1 ? "Завершить" : "Следующее";
    $("feedback").hidden = !savedResult;

    const track = $("progressBar");
    track.style.width = `${progress}%`;
    track.parentElement.setAttribute("aria-valuenow", String(progress));

    if (savedResult) renderFeedback(savedResult.correct, savedResult.answer);
    else window.setTimeout(() => $("answerInput").focus(), 60);
  }

  function renderFeedback(correct, answer) {
    const box = $("feedback");
    box.hidden = false;
    box.className = `gerund-feedback ${correct ? "is-correct" : "is-wrong"}`;
    $("feedbackTitle").textContent = correct ? "Верно!" : "Пока неверно";
    $("feedbackAnswer").textContent = correct
      ? currentTask.explanation
      : `Твой ответ: ${answer}. Правильная форма: ${currentTask.answers.join(" или ")}.`;
    $("feedbackRule").textContent = currentTask.rule;
  }

  function submitAnswer() {
    if (!state || state.phase === "result" || !currentTask) return;
    const answer = safeText($("answerInput").value);
    if (!answer) {
      $("feedback").hidden = false;
      $("feedback").className = "gerund-feedback is-wrong";
      $("feedbackTitle").textContent = "Нужен ответ";
      $("feedbackAnswer").textContent = "Напиши деепричастие одним словом.";
      $("feedbackRule").textContent = "Сначала определи вид исходного глагола.";
      $("answerInput").focus();
      return;
    }

    const correct = core.checkAnswer(currentTask, answer);
    currentResults()[currentTask.id] = {
      answer,
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
    if (percent === 100) return "Отлично: все формы образованы верно.";
    if (percent >= 80) return "Очень хороший результат. Осталось закрепить несколько форм.";
    if (percent >= 60) return "Основа понятна. Повтори ошибки и обрати внимание на суффиксы.";
    return "Не спеши: вернись к правилу и обязательно повтори ошибки.";
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
      ? "Все ошибки исправлены. Отличная работа над трудными формами!"
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
    state.retryResults = {};
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
      schema: "kodislovo.gerund-formation.result.v1",
      createdAt: new Date().toISOString(),
      student: { name: state.studentName },
      trainer: "gerund-formation",
      title: "Образование деепричастий",
      summary,
      tasks: state.taskIds.map((id) => {
        const task = taskById.get(id);
        return {
          id,
          verb: task.verb,
          expected: task.answers,
          answer: state.initialResults[id]?.answer || "",
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
    link.download = `deeprichastiya_${studentSlug(state.studentName)}.json`;
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
    $("nextBtn").addEventListener("click", goNext);
    $("answerInput").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (currentResults()[currentTask?.id]) goNext();
      else submitAnswer();
    });
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
