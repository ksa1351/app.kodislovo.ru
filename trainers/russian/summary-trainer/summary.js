(function () {
  const STORAGE_PREFIX = "summary-trainer";
  let LAST_TEXT_KEY = `${STORAGE_PREFIX}:last-text`;
  let entryProfile=null;
  const AUTOSAVE_MESSAGE = "Черновик сохранён на этом устройстве";
  const MANUAL_SAVE_MESSAGE = "Черновик сохранён на этом устройстве";
  const RETURN_TO_EDIT_CONFIRM =
    "Вернуться к правке?\n\nИсходный текст снова будет скрыт.\nТекущее изложение сохранится — вы сможете его доработать и отправить обновлённую версию.";
  const OPEN_QUESTIONS_CONFIRM =
    "Перейти к вопросам?\n\nОтветы можно изменить. При необходимости черновик можно пересобрать из ответов на шаге «Изложение».";

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
  const questionsPanel = document.getElementById("questionsPanel");
  const editingPanel = document.getElementById("editingPanel");
  const workspace = document.getElementById("step-workspace");
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
  const comparisonNotice = document.getElementById("comparisonNotice");
  const returnToEditButton = document.getElementById("returnToEdit");
  const openQuestionsFromComparisonButton = document.getElementById("openQuestionsFromComparison");
  const workflowStepper = document.getElementById("workflowStepper");
  const studentBar = document.getElementById("step-student");
  const studentGateHint = document.getElementById("studentGateHint");
  const summaryPage = document.querySelector(".summary-page");

  const stepSaveButton = document.getElementById("stepSave");
  const saveDraftButton = document.getElementById("saveDraft");

  let currentText = null;
  let sending = false;
  let cloudConfigPromise = null;
  let summaryTexts = [];
  let currentPhase = PHASE_QUESTIONS;
  let currentGroupIndex = 0;
  let submissionState = {
    revision: 0,
    lastSubmittedAt: null,
    lastSubmitOk: false,
    comparisonSeenAt: null
  };

  function storageKey(id) {
    return `${STORAGE_PREFIX}:${id}:profile:${StudentEntry.key(entryProfile)}`;
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

  function isStudentProfileComplete() {
    const student = getStudentData();
    return Boolean(student.name && student.className);
  }

  function validateStudentProfile() {
    if (isStudentProfileComplete()) {
      return true;
    }

    window.alert("Заполните ФИО и класс перед началом работы над вопросами.");
    if (studentName) {
      studentName.focus();
    }
    return false;
  }

  function updateStudentGate() {
    const complete = isStudentProfileComplete();

    if (studentGateHint) {
      studentGateHint.hidden = complete;
    }

    document.querySelectorAll(".summary-answer").forEach((input) => {
      input.disabled = !complete;
    });

    if (stepSaveButton && currentPhase === PHASE_QUESTIONS) {
      stepSaveButton.disabled = !complete;
    }

    if (questionsPanel) {
      questionsPanel.classList.toggle("is-locked", !complete && currentPhase === PHASE_QUESTIONS);
    }
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

  function normalizeSubmissionState(data) {
    const raw = data && typeof data === "object" ? data : {};
    const revision = Number.isFinite(raw.revision) ? Math.max(0, raw.revision) : 0;
    return {
      revision,
      lastSubmittedAt: raw.lastSubmittedAt || null,
      lastSubmitOk: Boolean(raw.lastSubmitOk && raw.receipt?.schemaVersion==='kodislovo.summary-receipt.v1'),
      comparisonSeenAt: raw.comparisonSeenAt || null,
      pending: raw.pending || null,
      receipt: raw.receipt || null
    };
  }

  function loadSubmissionState(saved) {
    if (saved && saved.submission) {
      return normalizeSubmissionState(saved.submission);
    }

    if (saved && saved.phase === PHASE_COMPARISON) {
      return normalizeSubmissionState({
        revision: 1,
        lastSubmitOk: true,
        comparisonSeenAt: saved.submission?.comparisonSeenAt || null
      });
    }

    return normalizeSubmissionState(null);
  }

  function resetSubmissionState() {
    submissionState = {
      revision: 0,
      lastSubmittedAt: null,
      lastSubmitOk: false,
      comparisonSeenAt: null
    };
  }

  function getPersistedState() {
    const phase = getSafePhase();
    return {
      draft: canOpenDraft() ? draftText.value : "",
      answers: collectAnswers(),
      student: getStudentData(),
      phase,
      groupIndex: currentGroupIndex,
      submission: submissionState
    };
  }

  function saveWork(options) {
    if (!currentText) {
      return;
    }

    const settings = options || {};
    try {
      localStorage.setItem(storageKey(currentText.id), JSON.stringify(getPersistedState()));
      localStorage.setItem(LAST_TEXT_KEY, currentText.id);
      setSaveStatus(settings.manual ? MANUAL_SAVE_MESSAGE : AUTOSAVE_MESSAGE);
    }catch(error){
      setSaveStatus('Черновик не удалось сохранить на устройстве. Скачайте копию работы.');
      if(settings.strict)throw Error('Не удалось сохранить черновик. Скачайте копию и разрешите хранение данных в браузере.');
    }
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
    let raw = localStorage.getItem(storageKey(currentText.id));
    // Import the old shared draft only for its named owner; leave the original intact.
    if(!raw){try{const legacy=localStorage.getItem(`${STORAGE_PREFIX}:${currentText.id}`),old=JSON.parse(legacy);
      if(old?.student?.name && StudentEntry.key({name:old.student.name,class:old.student.className})===StudentEntry.key(entryProfile))raw=legacy;
    }catch(_){}}
    studentName.value=entryProfile.name;studentClass.value=entryProfile.class;

    draftText.value = "";
    document.querySelectorAll(".summary-answer").forEach((input) => {
      input.value = "";
    });
    currentPhase = PHASE_QUESTIONS;
    currentGroupIndex = 0;
    resetSubmissionState();

    if (!raw) {
      if (studentName) {
        studentName.value = entryProfile.name;
      }
      if (studentClass) {
        studentClass.value = entryProfile.class;
      }
      updateWordCount();
      setSaveStatus(AUTOSAVE_MESSAGE);
      applyPhase();
      return;
    }

    try {
      const data = JSON.parse(raw);

      if (data.student) {
        if (studentName) {
          studentName.value = entryProfile.name;
        }
        if (studentClass) {
          studentClass.value = entryProfile.class;
        }
      }

      restoreAnswers(data);
      submissionState = loadSubmissionState(data);

      const groupCount = getGroupCount();
      const savedGroup = Number.isFinite(data.groupIndex) ? data.groupIndex : 0;
      currentGroupIndex = Math.min(Math.max(savedGroup, 0), Math.max(groupCount - 1, 0));
      resolvePhaseAfterRestore(data.phase);

      if (canOpenDraft() && (currentPhase === PHASE_EDITING || currentPhase === PHASE_COMPARISON)) {
        draftText.value = data.draft || buildDraftFromAnswers();
      } else {
        draftText.value = "";
      }
    } catch (error) {
      setSaveStatus('Не удалось прочитать черновик. Сохранённые данные не удалены.');
      return;
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
    if (!isStudentProfileComplete()) {
      currentPhase = PHASE_QUESTIONS;
      currentGroupIndex = 0;
      return;
    }

    if (!allGroupsComplete()) {
      const incompleteGroup = findFirstIncompleteGroup();
      currentPhase = PHASE_QUESTIONS;
      currentGroupIndex = incompleteGroup >= 0 ? incompleteGroup : 0;
      return;
    }

    if (savedPhase === PHASE_COMPARISON && submissionState.lastSubmitOk) {
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

  function getSafePhase() {
    if (
      (currentPhase === PHASE_EDITING || currentPhase === PHASE_COMPARISON) &&
      !allGroupsComplete()
    ) {
      return PHASE_QUESTIONS;
    }

    if (currentPhase === PHASE_COMPARISON && !submissionState.lastSubmitOk) {
      return canOpenDraft() ? PHASE_EDITING : PHASE_QUESTIONS;
    }

    return currentPhase;
  }

  function canOpenDraft() {
    return allGroupsComplete();
  }

  function openDraftPhase() {
    if (!canOpenDraft()) {
      const incompleteGroup = findFirstIncompleteGroup();
      window.alert("Черновик откроется только после ответов на все вопросы по всем микротемам.");
      currentPhase = PHASE_QUESTIONS;
      currentGroupIndex = incompleteGroup >= 0 ? incompleteGroup : 0;
      applyPhase();
      return false;
    }

    buildDraft();
    currentPhase = PHASE_EDITING;
    applyPhase();
    return true;
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
      phaseHint.textContent = isStudentProfileComplete()
        ? `Абзац ${currentGroupIndex + 1} из ${groupCount} — ответьте на вопросы и нажмите «Сохранить»`
        : "Сначала заполните ФИО и класс ученика";
      return;
    }

    if (currentPhase === PHASE_EDITING) {
      phaseHint.textContent = submissionState.lastSubmitOk
        ? "Исходный текст скрыт. Доработайте изложение и нажмите «Отправить новую редакцию учителю»"
        : "Исходный текст скрыт. Отредактируйте черновик по памяти и нажмите «Отправить учителю»";
      return;
    }

    phaseHint.textContent = "Работа сохранена. Сравните исходный текст и своё изложение";
  }

  function canNavigateToPhase(targetPhase) {
    if (targetPhase === "student") {
      return true;
    }

    if (targetPhase === PHASE_QUESTIONS) {
      return isStudentProfileComplete();
    }

    if (targetPhase === PHASE_EDITING) {
      return canOpenDraft();
    }

    if (targetPhase === PHASE_COMPARISON) {
      return submissionState.lastSubmitOk;
    }

    return false;
  }

  function returnToEditingFromComparison() {
    if (!window.confirm(RETURN_TO_EDIT_CONFIRM)) {
      return false;
    }

    currentPhase = PHASE_EDITING;
    applyPhase();
    return true;
  }

  function openQuestionsFromComparison() {
    if (!window.confirm(OPEN_QUESTIONS_CONFIRM)) {
      return false;
    }

    const incompleteGroup = findFirstIncompleteGroup();
    currentPhase = PHASE_QUESTIONS;
    currentGroupIndex = incompleteGroup >= 0 ? incompleteGroup : 0;
    applyPhase();
    return true;
  }

  function navigateToPhase(targetPhase) {
    if (!canNavigateToPhase(targetPhase)) {
      return;
    }

    if (targetPhase === "student") {
      if (studentBar) {
        studentBar.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    if (targetPhase === PHASE_QUESTIONS) {
      if (currentPhase === PHASE_COMPARISON && !window.confirm(OPEN_QUESTIONS_CONFIRM)) {
        return;
      }
      const incompleteGroup = findFirstIncompleteGroup();
      currentPhase = PHASE_QUESTIONS;
      currentGroupIndex = incompleteGroup >= 0 ? incompleteGroup : 0;
      applyPhase();
      if (workspace) {
        workspace.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }

    if (targetPhase === PHASE_EDITING) {
      if (currentPhase === PHASE_COMPARISON) {
        returnToEditingFromComparison();
        return;
      }
      if (!canOpenDraft()) {
        return;
      }
      if (!draftText.value.trim()) {
        buildDraft();
      }
      currentPhase = PHASE_EDITING;
      applyPhase();
      return;
    }

    if (targetPhase === PHASE_COMPARISON) {
      currentPhase = PHASE_COMPARISON;
      applyPhase();
      if (comparisonSection) {
        comparisonSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  }

  function updateStepper() {
    if (!workflowStepper) {
      return;
    }

    workflowStepper.querySelectorAll("a").forEach((link) => {
      const linkPhase = link.dataset.phase;
      let isActive = linkPhase === currentPhase;

      if (
        linkPhase === "student" &&
        !isStudentProfileComplete() &&
        currentPhase === PHASE_QUESTIONS
      ) {
        isActive = true;
      }

      const allowed = canNavigateToPhase(linkPhase);
      link.classList.toggle("is-active", isActive);
      link.classList.toggle("is-disabled", !allowed);
      link.setAttribute("aria-disabled", allowed ? "false" : "true");
      link.tabIndex = allowed ? 0 : -1;
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
    const readyForDraft = isLastGroup && canOpenDraft();
    stepSaveButton.textContent = readyForDraft ? "Сохранить и открыть черновик" : "Сохранить";
    stepSaveButton.disabled = false;
  }

  function updateComparisonView() {
    const draft = draftText.value.trim();
    comparisonSourceTitle.textContent = currentText.title;
    comparisonSource.textContent = currentText.sourceText;
    comparisonDraft.textContent = draft;
    comparisonWordCount.textContent = `Слов: ${countWords(draft)}`;

    if (comparisonNotice) {
      const revisionLabel = submissionState.revision > 1
        ? ` (версия ${submissionState.revision})`
        : "";
      comparisonNotice.textContent =
        `Работа получена учителем${revisionLabel}. Сохранение в кабинете подтверждено. Сравните исходный текст и ваше изложение.`;
    }
  }

  function setWorkspacePhase(phase) {
    if (workspace) {
      workspace.dataset.phase = phase;
    }
  }

  function applyPhase() {
    if (
      (currentPhase === PHASE_EDITING || currentPhase === PHASE_COMPARISON) &&
      !canOpenDraft()
    ) {
      const incompleteGroup = findFirstIncompleteGroup();
      currentPhase = PHASE_QUESTIONS;
      currentGroupIndex = incompleteGroup >= 0 ? incompleteGroup : 0;
      draftText.value = "";
    }

    if (currentPhase === PHASE_QUESTIONS) {
      workspace.hidden = false;
      comparisonSection.hidden = true;
      setWorkspacePhase("questions");
      workspace.classList.remove("is-editing", "is-comparison");
      if (sourcePanel) {
        sourcePanel.hidden = false;
      }
      if (questionsPanel) {
        questionsPanel.hidden = false;
      }
      if (editingPanel) {
        editingPanel.hidden = true;
      }
      showQuestionGroup(currentGroupIndex);
    } else if (currentPhase === PHASE_EDITING) {
      setSubmitStatus(submissionState.pending?'Подтверждение отправки не получено. Повтори отправку.':'Эта редакция ещё не отправлена учителю.');
      workspace.hidden = false;
      comparisonSection.hidden = true;
      setWorkspacePhase("editing");
      workspace.classList.add("is-editing");
      workspace.classList.remove("is-comparison");
      if (sourcePanel) {
        sourcePanel.hidden = true;
      }
      if (questionsPanel) {
        questionsPanel.hidden = true;
      }
      if (editingPanel) {
        editingPanel.hidden = false;
        editingPanel.scrollTop = 0;
      }
      if (saveDraftButton) {
        saveDraftButton.disabled = false;
        saveDraftButton.textContent = submissionState.lastSubmitOk
          ? "Отправить новую редакцию учителю"
          : "Отправить учителю";
      }
      draftText.focus();
    } else if (currentPhase === PHASE_COMPARISON) {
      if (!submissionState.lastSubmitOk) {
        currentPhase = canOpenDraft() ? PHASE_EDITING : PHASE_QUESTIONS;
        applyPhase();
        return;
      }

      workspace.hidden = true;
      comparisonSection.hidden = false;
      setWorkspacePhase("comparison");
      updateComparisonView();
      submissionState.comparisonSeenAt = submissionState.comparisonSeenAt || nowIso();
      if (summaryPage) {
        summaryPage.classList.add("is-comparison-ready");
      }
    }

    if (currentPhase !== PHASE_COMPARISON && summaryPage) {
      summaryPage.classList.remove("is-comparison-ready");
    }

    updatePhaseHint();
    updateStepper();
    updateStudentGate();
    saveWork();
    updateDeliveryUI();
  }

  function advanceFromQuestions() {
    if (!validateStudentProfile()) {
      return;
    }

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

    openDraftPhase();
  }

  async function advanceFromEditing() {
    if(sending)return;
    const draft = draftText.value.trim();

    if (!draft) {
      window.alert("Сначала составьте или отредактируйте текст изложения.");
      return;
    }

    if (!validateStudentProfile()) {
      return;
    }

    saveWork({ manual: true });
    saveDraftButton.disabled = true;
    setSubmitStatus("Отправляем работу учителю…");

    const nextRevision = submissionState.revision + 1;
    const submitted = await submitToCloud({
      quietSuccess: true,
      revision: nextRevision,
      workflowPhase: nextRevision > 1 ? "resubmit" : "submit"
    });

    if (!submitted) {
      saveDraftButton.disabled = false;
      updateDeliveryUI();
      return;
    }

    submissionState.revision = nextRevision;
    submissionState.lastSubmittedAt = nowIso();
    submissionState.lastSubmitOk = true;
    submissionState.comparisonSeenAt = nowIso();

    const revisionNote = nextRevision > 1 ? ` (версия ${nextRevision})` : "";
    setSubmitStatus(`Работа получена учителем${revisionNote}: ${new Date().toLocaleString("ru-RU")}`);
    currentPhase = PHASE_COMPARISON;
    applyPhase();
  }

  async function loadCloudConfig() {
    if (!cloudConfigPromise) {
      cloudConfigPromise = fetchJson(PUBLIC_API_CONFIG_URL).then(async (config) => {
        const baseUrl = ((config && config.baseUrl) || "").replace(/\/+$/, "");
        if (!baseUrl) {
          throw new Error("В assets/config/public-api.json не задан baseUrl.");
        }

        return {
          submitUrl: `${baseUrl}/api/public/summary-trainer/submit`
        };
      }).catch(error=>{cloudConfigPromise=null;throw error;});
    }

    return cloudConfigPromise;
  }

  function buildSubmissionPayload(options) {
    const settings = options || {};
    const student = getStudentData();
    const revision = Number.isFinite(settings.revision)
      ? settings.revision
      : submissionState.revision + 1;
    const payload = {
      schema: "kodislovo.summary-trainer.result.v1",
      submission_id: crypto.randomUUID(),
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
      revision,
      workflowPhase: settings.workflowPhase || (revision > 1 ? "resubmit" : "submit"),
      submittedFrom: location.href
    };

    if (revision > 1) {
      payload.supersedesRevision = revision - 1;
    }

    return payload;
  }

  async function submitToCloud(options) {
    const settings = options || {};

    if (!currentText) {
      return false;
    }

    const student = getStudentData();
    const draft = draftText.value.trim();

    if (!student.name || !student.className) {
      window.alert("Заполните ФИО и класс перед отправкой.");
      return false;
    }

    if (!draft) {
      window.alert("Сначала составьте готовое изложение.");
      return false;
    }

    setSubmitStatus("Отправляем работу учителю…");

    try {
      if(!submissionState.pending)submissionState.pending=buildSubmissionPayload(settings);
      saveWork({strict:true});
      sending=true;updateDeliveryUI();
      const config = await loadCloudConfig();
      if (!config.submitUrl) {
        throw new Error("Backend submit endpoint не настроен.");
      }

      const receipt=await SummaryDelivery.send(config.submitUrl,submissionState.pending);
      submissionState.receipt=receipt;
      submissionState.pending=null;
      submissionState.revision=receipt.revision;
      submissionState.lastSubmittedAt=nowIso();
      submissionState.lastSubmitOk=true;

      saveWork({ manual: true });

      if (!settings.quietSuccess) {
        setSubmitStatus('Работа получена учителем. Сохранение в кабинете подтверждено.');
      }

      return true;
    } catch (error) {
      if(error.safeToEdit){submissionState.pending=null;saveWork();}
      setSubmitStatus(error.message || 'Не удалось отправить работу. Повторите отправку.');
      return false;
    }finally{sending=false;updateDeliveryUI();}
  }

  function updateDeliveryUI() {
    const locked=!!submissionState.pending || sending;
    for(const input of [studentName,studentClass,textSelect,draftText,...document.querySelectorAll('.summary-answer')])input.disabled=locked || (input.classList.contains('summary-answer')&&!isStudentProfileComplete());
    if(workflowStepper)workflowStepper.inert=locked;
    stepSaveButton.disabled=locked || !isStudentProfileComplete();
    saveDraftButton.disabled=sending;
    if(submissionState.pending)saveDraftButton.textContent=sending?'Отправляем…':'Повторить отправку';
    else saveDraftButton.textContent=submissionState.lastSubmitOk?'Отправить новую редакцию учителю':'Отправить учителю';
  }

  function downloadCopy() {
    const student=getStudentData();
    const text=[currentText?.title,student.name+' · '+student.className,'Изложение',draftText.value,'Ответы на вопросы',...collectAnswers().map(a=>`${a.groupIndex+1}.${a.questionIndex+1}. ${a.value}`)].join('\n\n');
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='izlozhenie.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
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
      if (!isStudentProfileComplete()) {
        return;
      }
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

    updateStudentGate();
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
    document.getElementById('downloadSummary').addEventListener('click',downloadCopy);
    textSelect.addEventListener("change", function () {
      loadText(textSelect.value);
    });

    if (studentName) {
      studentName.addEventListener("input", function () {
        saveWork();
        updateStudentGate();
        updatePhaseHint();
      });
    }

    if (studentClass) {
      studentClass.addEventListener("input", function () {
        saveWork();
        updateStudentGate();
        updatePhaseHint();
      });
    }

    stepSaveButton.addEventListener("click", advanceFromQuestions);
    saveDraftButton.addEventListener("click", function () {
      advanceFromEditing();
    });

    draftText.addEventListener("input", function () {
      updateWordCount();
      saveWork();
    });

    if (returnToEditButton) {
      returnToEditButton.addEventListener("click", returnToEditingFromComparison);
    }

    if (openQuestionsFromComparisonButton) {
      openQuestionsFromComparisonButton.addEventListener("click", openQuestionsFromComparison);
    }

    if (workflowStepper) {
      workflowStepper.addEventListener("click", function (event) {
        const link = event.target.closest("a[data-phase]");
        if (!link) {
          return;
        }
        event.preventDefault();
        navigateToPhase(link.dataset.phase);
      });
    }
  }

  async function init() {
    try{await KodislovoLessonAccess.check();}catch(_){return;}
    entryProfile=await StudentEntry.open({id:'summary-trainer',title:'Сжатое изложение по вопросам',validate:()=>KodislovoLessonAccess.check()});
    StudentEntry.badge(entryProfile);
    studentName.value=entryProfile.name;studentClass.value=entryProfile.class;
    studentName.readOnly=true;studentClass.readOnly=true;
    studentBar.hidden=true;
    studentBar.style.display='none';
    document.querySelector('#workflowStepper a[href="#step-student"]')?.closest('li')?.remove();
    LAST_TEXT_KEY+=':profile:'+StudentEntry.key(entryProfile);
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
