(function () {
  const STORAGE_PREFIX = "summary-trainer";
  const LAST_TEXT_KEY = `${STORAGE_PREFIX}:last-text`;
  const AUTOSAVE_MESSAGE = "Изменения сохраняются автоматически";
  const MANUAL_SAVE_MESSAGE = "Сохранено";

  const PHASE_QUESTIONS = "questions";
  const PHASE_EDITING = "editing";
  const PHASE_COMPARISON = "comparison";

  const PUBLIC_API_CONFIG_URL = "../../../assets/config/public-api.json";
  const SUMMARY_BANK_URL = "../../../controls/russian/summary-bank.json";

  const textSelect = document.getElementById("textSelect");
  const studentName = document.getElementById("studentName");
  const studentClass = document.getElementById("studentClass");
  const sourceTitle = document.getElementById("sourceTitle");
  const sourceText = document.getElementById("sourceText");
  const sourcePanel = document.getElementById("sourcePanel");
  const workspace = document.getElementById("step-workspace");
  const questionsView = document.getElementById("questionsView");
  const editingView = document.getElementById("editingView");
  const questionsArea = document.getElementById("questionsArea");
  const questionsHeading = document.getElementById("questionsHeading");
  const questionsHint = document.getElementById("questionsHint");
  const phaseHint = document.getElementById("phaseHint");
  const draftText = document.getElementById("draftText");
  const wordCount = document.getElementById("wordCount");
  const saveStatus = document.getElementById("saveStatus");
  const submitStatus = document.getElementById("submitStatus");
  const comparisonSection = document.getElementById("step-comparison");
  const comparisonSourceTitle = document.getElementById("comparisonSourceTitle");
  const comparisonSource = document.getElementById("comparisonSource");
  const comparisonDraft = document.getElementById("comparisonDraft");
  const comparisonWordCount = document.getElementById("comparisonWordCount");
  const workflowStepper = document.getElementById("workflowStepper");
  const studentBar = document.getElementById("step-student");
  const summaryPage = document.querySelector(".summary-page");

  const stepSaveButton = document.getElementById("stepSave");
  const saveDraftButton = document.getElementById("saveDraft");
  const backToQuestionsButton = document.getElementById("backToQuestions");
  const backToEditButton = document.getElementById("backToEdit");
  const downloadTxtButton = document.getElementById("downloadTxt");
  const clearWorkButton = document.getElementById("clearWork");
  const submitCloudButton = document.getElementById("submitCloud");

  let currentText = null;
  let cloudConfigPromise = null;
  let summaryTexts = [];
  let currentPhase = PHASE_QUESTIONS;
  let currentGroupIndex = 0;

  function storageKey(id) {
    return `${STORAGE_PREFIX}:${id}`;
  }

  function setSaveStatus(message) {
    if (saveStatus) {
      saveStatus.textContent = message;
    }
  }

  function setSubmitStatus(message) {
    if (submitStatus) {
      submitStatus.textContent = message;
    }
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function countWords(text) {
    const trimmed = (text || "").trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  }

  function getRequestedTextId() {
    const params = new URLSearchParams(window.location.search);
    return (params.get("text") || params.get("textId") || "").trim();
  }

  async function loadSummaryBank() {
    const data = await fetchJson(SUMMARY_BANK_URL);
    if (!Array.isArray(data)) {
      throw new Error("Банк текстов изложений имеет неверный формат.");
    }
    summaryTexts = data;
  }

  async function postJson(url, body, headers) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(headers || {})
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (error) {
      data = null;
    }

    if (!response.ok) {
      throw new Error((data && (data.message || data.error)) || text || `HTTP ${response.status}`);
    }

    return data;
  }

  function getStudentData() {
    return {
      name: studentName ? studentName.value.trim() : "",
      className: studentClass ? studentClass.value.trim() : ""
    };
  }

  function getGroupCount() {
    return currentText && Array.isArray(currentText.groups) ? currentText.groups.length : 0;
  }

  function updateWordCount() {
    const total = countWords(draftText.value);
    wordCount.textContent = `Слов: ${total}`;
  }

  function collectAnswers() {
    return Array.from(document.querySelectorAll(".summary-answer")).map((input) => ({
      groupIndex: Number(input.dataset.groupIndex),
      questionIndex: Number(input.dataset.questionIndex),
      value: input.value
    }));
  }

  function getPersistedState() {
    return {
      draft: draftText.value,
      answers: collectAnswers(),
      student: getStudentData(),
      phase: currentPhase,
      groupIndex: currentGroupIndex
    };
  }

  function saveWork(options) {
    if (!currentText) {
      return;
    }

    const settings = options || {};
    localStorage.setItem(storageKey(currentText.id), JSON.stringify(getPersistedState()));
    localStorage.setItem(LAST_TEXT_KEY, currentText.id);
    setSaveStatus(settings.manual ? MANUAL_SAVE_MESSAGE : AUTOSAVE_MESSAGE);
  }

  function restoreAnswers(data) {
    if (!Array.isArray(data.answers)) {
      return;
    }

    data.answers.forEach((answer) => {
      const selector = `.summary-answer[data-group-index="${answer.groupIndex}"][data-question-index="${answer.questionIndex}"]`;
      const input = document.querySelector(selector);
      if (input) {
        input.value = answer.value || "";
      }
    });
  }

  function restoreWork() {
    const raw = localStorage.getItem(storageKey(currentText.id));

    draftText.value = "";
    document.querySelectorAll(".summary-answer").forEach((input) => {
      input.value = "";
    });
    currentPhase = PHASE_QUESTIONS;
    currentGroupIndex = 0;

    if (!raw) {
      if (studentName) {
        studentName.value = "";
      }
      if (studentClass) {
        studentClass.value = "";
      }
      updateWordCount();
      setSaveStatus(AUTOSAVE_MESSAGE);
      applyPhase();
      return;
    }

    try {
      const data = JSON.parse(raw);
      draftText.value = data.draft || "";

      if (data.student) {
        if (studentName) {
          studentName.value = data.student.name || "";
        }
        if (studentClass) {
          studentClass.value = data.student.className || "";
        }
      }

      restoreAnswers(data);

      const groupCount = getGroupCount();
      const savedGroup = Number.isFinite(data.groupIndex) ? data.groupIndex : 0;
      currentGroupIndex = Math.min(Math.max(savedGroup, 0), Math.max(groupCount - 1, 0));
      resolvePhaseAfterRestore(data.phase);
    } catch (error) {
      localStorage.removeItem(storageKey(currentText.id));
    }

    updateWordCount();
    setSaveStatus(AUTOSAVE_MESSAGE);
    applyPhase();
  }

  function buildDraftFromAnswers() {
    if (!currentText) {
      return "";
    }

    const paragraphs = currentText.groups
      .map((group, groupIndex) => {
        const answers = Array.from(
          document.querySelectorAll(`.summary-answer[data-group-index="${groupIndex}"]`)
        )
          .map((input) => input.value.replace(/\s+/g, " ").trim())
          .filter(Boolean);

        return answers.join(" ").trim();
      })
      .filter(Boolean);

    return paragraphs.join("\n\n");
  }

  function buildDraft() {
    draftText.value = buildDraftFromAnswers();
    updateWordCount();
    saveWork();
  }

  function getGroupInputs(groupIndex) {
    return Array.from(
      document.querySelectorAll(`.summary-answer[data-group-index="${groupIndex}"]`)
    );
  }

  function getEmptyAnswersInGroup(groupIndex) {
    return getGroupInputs(groupIndex).filter((input) => !input.value.trim());
  }

  function groupIsComplete(groupIndex) {
    return getEmptyAnswersInGroup(groupIndex).length === 0;
  }

  function allGroupsComplete() {
    const groupCount = getGroupCount();
    for (let index = 0; index < groupCount; index += 1) {
      if (!groupIsComplete(index)) {
        return false;
      }
    }
    return true;
  }

  function findFirstIncompleteGroup() {
    const groupCount = getGroupCount();
    for (let index = 0; index < groupCount; index += 1) {
      if (!groupIsComplete(index)) {
        return index;
      }
    }
    return -1;
  }

  function resolvePhaseAfterRestore(savedPhase) {
    if (!allGroupsComplete()) {
      const incompleteGroup = findFirstIncompleteGroup();
      currentPhase = PHASE_QUESTIONS;
      currentGroupIndex = incompleteGroup >= 0 ? incompleteGroup : 0;
      return;
    }

    if (savedPhase === PHASE_COMPARISON) {
      currentPhase = PHASE_COMPARISON;
      return;
    }

    if (savedPhase === PHASE_EDITING) {
      currentPhase = PHASE_EDITING;
      return;
    }

    currentPhase = PHASE_QUESTIONS;
    currentGroupIndex = getGroupCount() - 1;
  }

  function validateCurrentGroupAnswers() {
    const emptyAnswers = getEmptyAnswersInGroup(currentGroupIndex);

    if (!emptyAnswers.length) {
      return true;
    }

    window.alert(
      `Ответьте на все вопросы по ${currentGroupIndex + 1}-му абзацу. Осталось: ${emptyAnswers.length}.`
    );
    emptyAnswers[0].focus();
    return false;
  }

  function updatePhaseHint() {
    const groupCount = getGroupCount();

    if (currentPhase === PHASE_QUESTIONS) {
      phaseHint.textContent = `Абзац ${currentGroupIndex + 1} из ${groupCount} — ответьте на вопросы и нажмите «Сохранить»`;
      return;
    }

    if (currentPhase === PHASE_EDITING) {
      phaseHint.textContent = "Отредактируйте черновик изложения и нажмите «Сохранить и перейти к сравнению»";
      return;
    }

    phaseHint.textContent = "Сравните исходный текст и своё изложение, затем отправьте работу на проверку";
  }

  function updateStepper() {
    if (!workflowStepper) {
      return;
    }

    workflowStepper.querySelectorAll("a").forEach((link) => {
      const linkPhase = link.dataset.phase;
      const isActive = linkPhase === currentPhase;
      link.classList.toggle("is-active", isActive);
    });
  }

  function showQuestionGroup(groupIndex) {
    document.querySelectorAll(".summary-group").forEach((section) => {
      section.hidden = Number(section.dataset.groupIndex) !== groupIndex;
    });

    const groupCount = getGroupCount();
    questionsHeading.textContent = `Микротема ${groupIndex + 1}`;
    questionsHint.textContent = `Ответьте на все вопросы по ${groupIndex + 1}-му абзацу. ${
      groupIndex < groupCount - 1
        ? "После сохранения появятся вопросы по следующему абзацу."
        : "Когда будут заполнены все вопросы по всем микротемам, откроется черновик изложения."
    }`;

    const isLastGroup = groupIndex >= groupCount - 1;
    stepSaveButton.textContent = isLastGroup ? "Сохранить и открыть черновик" : "Сохранить";
  }

  function updateComparisonView() {
    const draft = draftText.value.trim();
    comparisonSourceTitle.textContent = currentText.title;
    comparisonSource.textContent = currentText.sourceText;
    comparisonDraft.textContent = draft;
    comparisonWordCount.textContent = `Слов: ${countWords(draft)}`;
  }

  function applyPhase() {
    if (currentPhase === PHASE_QUESTIONS) {
      workspace.hidden = false;
      comparisonSection.hidden = true;
      sourcePanel.hidden = false;
      workspace.classList.remove("is-editing", "is-comparison");
      questionsView.hidden = false;
      editingView.hidden = true;
      showQuestionGroup(currentGroupIndex);
      if (studentBar) {
        studentBar.hidden = true;
      }
      if (submitCloudButton) {
        submitCloudButton.hidden = true;
      }
    } else if (currentPhase === PHASE_EDITING) {
      workspace.hidden = false;
      comparisonSection.hidden = true;
      sourcePanel.hidden = true;
      workspace.classList.add("is-editing");
      workspace.classList.remove("is-comparison");
      questionsView.hidden = true;
      editingView.hidden = false;
      if (studentBar) {
        studentBar.hidden = true;
      }
      if (submitCloudButton) {
        submitCloudButton.hidden = true;
      }
    } else if (currentPhase === PHASE_COMPARISON) {
      workspace.hidden = true;
      comparisonSection.hidden = false;
      updateComparisonView();
      if (studentBar) {
        studentBar.hidden = false;
      }
      if (summaryPage) {
        summaryPage.classList.add("is-comparison-ready");
      }
      if (submitCloudButton) {
        submitCloudButton.hidden = false;
      }
    }

    if (currentPhase !== PHASE_COMPARISON && summaryPage) {
      summaryPage.classList.remove("is-comparison-ready");
    }

    updatePhaseHint();
    updateStepper();
    saveWork();
  }

  function advanceFromQuestions() {
    if (!validateCurrentGroupAnswers()) {
      return;
    }

    saveWork({ manual: true });

    const lastGroupIndex = getGroupCount() - 1;

    if (currentGroupIndex < lastGroupIndex) {
      currentGroupIndex += 1;
      currentPhase = PHASE_QUESTIONS;
      applyPhase();
      return;
    }

    if (!allGroupsComplete()) {
      const incompleteGroup = findFirstIncompleteGroup();
      window.alert("Ответьте на все вопросы по всем микротемам — только после этого откроется черновик.");
      if (incompleteGroup >= 0) {
        currentGroupIndex = incompleteGroup;
        currentPhase = PHASE_QUESTIONS;
        applyPhase();
      }
      return;
    }

    buildDraft();
    currentPhase = PHASE_EDITING;
    applyPhase();
  }

  function advanceFromEditing() {
    const draft = draftText.value.trim();

    if (!draft) {
      window.alert("Сначала составьте или отредактируйте текст изложения.");
      return;
    }

    saveWork({ manual: true });
    currentPhase = PHASE_COMPARISON;
    applyPhase();
  }

  function goToQuestions() {
    currentPhase = PHASE_QUESTIONS;
    currentGroupIndex = 0;
    applyPhase();
  }

  function goToEditing() {
    currentPhase = PHASE_EDITING;
    applyPhase();
  }

  function downloadTxt() {
    const text = draftText.value.trim();

    if (!text) {
      window.alert("Итоговый текст пуст.");
      return;
    }

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${currentText.title}.txt`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function clearWork() {
    if (!currentText) {
      return;
    }

    const confirmed = window.confirm("Очистить ответы и черновик для текущего текста и начать заново?");
    if (!confirmed) {
      return;
    }

    localStorage.removeItem(storageKey(currentText.id));
    document.querySelectorAll(".summary-answer").forEach((input) => {
      input.value = "";
    });
    draftText.value = "";
    currentPhase = PHASE_QUESTIONS;
    currentGroupIndex = 0;
    updateWordCount();
    setSaveStatus(AUTOSAVE_MESSAGE);
    setSubmitStatus("Работа не отправлена");
    applyPhase();
  }

  async function loadCloudConfig() {
    if (!cloudConfigPromise) {
      cloudConfigPromise = fetchJson(PUBLIC_API_CONFIG_URL).then(async (config) => {
        const baseUrl = ((config && config.baseUrl) || "").replace(/\/+$/, "");
        if (!baseUrl) {
          throw new Error("В assets/config/public-api.json не задан baseUrl.");
        }

        const services = await fetchJson(`${baseUrl}/api/public/subjects/russian/services`);
        return {
          submitUrl: new URL(services.submitUrl, `${baseUrl}/`).toString()
        };
      });
    }

    return cloudConfigPromise;
  }

  function buildSubmissionPayload() {
    const student = getStudentData();

    return {
      schema: "kodislovo.summary-trainer.result.v1",
      createdAt: nowIso(),
      subject: "russian",
      subjectTitle: "Русский язык",
      trainer: "summary-trainer",
      variant: `summary_${currentText.id}`,
      variantTitle: currentText.title,
      identity: {
        fio: student.name,
        cls: student.className
      },
      student: {
        name: student.name,
        class: student.className
      },
      text: {
        id: currentText.id,
        title: currentText.title
      },
      draft: draftText.value.trim(),
      sourceText: currentText.sourceText,
      answers: collectAnswers(),
      submittedFrom: location.href
    };
  }

  async function submitToCloud() {
    if (!currentText) {
      return;
    }

    const student = getStudentData();
    const draft = draftText.value.trim();

    if (!student.name || !student.className) {
      window.alert("Заполните ФИО и класс перед отправкой.");
      return;
    }

    if (!draft) {
      window.alert("Сначала составьте готовое изложение.");
      return;
    }

    submitCloudButton.disabled = true;
    setSubmitStatus("Идёт отправка...");

    try {
      const config = await loadCloudConfig();
      if (!config.submitUrl) {
        throw new Error("Backend submit endpoint не настроен.");
      }

      await postJson(config.submitUrl, buildSubmissionPayload());

      saveWork({ manual: true });
      setSubmitStatus(`Отправлено: ${new Date().toLocaleString("ru-RU")}`);
      window.alert("Изложение успешно отправлено на проверку.");
    } catch (error) {
      setSubmitStatus("Ошибка отправки");
      window.alert(`Не удалось отправить работу.\n\n${error.message || error}`);
    } finally {
      submitCloudButton.disabled = false;
    }
  }

  function createQuestion(groupIndex, questionIndex, question) {
    const item = document.createElement("div");
    item.className = "summary-question-item";

    const label = document.createElement("label");
    label.className = "summary-question-label";
    label.htmlFor = `answer-${groupIndex}-${questionIndex}`;
    label.textContent = `${questionIndex + 1}. ${question}`;

    const input = document.createElement("textarea");
    input.id = label.htmlFor;
    input.className = "summary-answer input";
    input.dataset.groupIndex = String(groupIndex);
    input.dataset.questionIndex = String(questionIndex);
    input.placeholder = "Введите развёрнутый ответ";
    input.addEventListener("input", function () {
      saveWork();
    });

    item.appendChild(label);
    item.appendChild(input);
    return item;
  }

  function renderQuestions() {
    questionsArea.innerHTML = "";

    currentText.groups.forEach((group, groupIndex) => {
      const section = document.createElement("section");
      section.className = "summary-group";
      section.dataset.groupIndex = String(groupIndex);

      const list = document.createElement("div");
      list.className = "summary-question-list";

      group.questions.forEach((question, questionIndex) => {
        list.appendChild(createQuestion(groupIndex, questionIndex, question));
      });

      section.appendChild(list);
      questionsArea.appendChild(section);
    });
  }

  function loadText(id) {
    currentText = summaryTexts.find((item) => item.id === id) || summaryTexts[0] || null;

    if (!currentText) {
      return;
    }

    sourceTitle.textContent = currentText.title;
    sourceText.textContent = currentText.sourceText;
    renderQuestions();
    restoreWork();
    textSelect.value = currentText.id;
  }

  function populateSelect() {
    textSelect.innerHTML = "";
    summaryTexts.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.title;
      textSelect.appendChild(option);
    });
  }

  function bindEvents() {
    textSelect.addEventListener("change", function () {
      loadText(textSelect.value);
    });

    if (studentName) {
      studentName.addEventListener("input", function () {
        saveWork();
      });
    }

    if (studentClass) {
      studentClass.addEventListener("input", function () {
        saveWork();
      });
    }

    stepSaveButton.addEventListener("click", advanceFromQuestions);
    saveDraftButton.addEventListener("click", advanceFromEditing);
    backToQuestionsButton.addEventListener("click", goToQuestions);
    backToEditButton.addEventListener("click", goToEditing);
    downloadTxtButton.addEventListener("click", downloadTxt);
    clearWorkButton.addEventListener("click", clearWork);

    if (submitCloudButton) {
      submitCloudButton.addEventListener("click", function () {
        submitToCloud();
      });
    }

    draftText.addEventListener("input", function () {
      updateWordCount();
      saveWork();
    });
  }

  async function init() {
    try {
      await loadSummaryBank();
    } catch (error) {
      textSelect.disabled = true;
      sourceTitle.textContent = "Тексты не загружены";
      sourceText.textContent = "Не удалось загрузить общий банк текстов изложений.";
      setSaveStatus("Нет данных для работы");
      console.error(error);
      return;
    }

    if (!summaryTexts.length) {
      textSelect.disabled = true;
      sourceTitle.textContent = "Тексты не загружены";
      sourceText.textContent = "Общий банк текстов пока пуст.";
      setSaveStatus("Нет данных для работы");
      return;
    }

    populateSelect();
    bindEvents();

    const requestedTextId = getRequestedTextId();
    const lastTextId = localStorage.getItem(LAST_TEXT_KEY);
    const defaultText = summaryTexts.some((item) => item.id === requestedTextId)
      ? requestedTextId
      : summaryTexts.some((item) => item.id === lastTextId)
        ? lastTextId
        : summaryTexts[0].id;

    loadText(defaultText);
  }

  init();
}());
