(function () {
  const STORAGE_PREFIX = "summary-trainer";
  const LAST_TEXT_KEY = `${STORAGE_PREFIX}:last-text`;
  const AUTOSAVE_MESSAGE = "Изменения сохраняются автоматически";
  const MANUAL_SAVE_MESSAGE = "Сохранено";

  const textSelect = document.getElementById("textSelect");
  const sourceTitle = document.getElementById("sourceTitle");
  const sourceText = document.getElementById("sourceText");
  const questionsArea = document.getElementById("questionsArea");
  const draftText = document.getElementById("draftText");
  const wordCount = document.getElementById("wordCount");
  const saveStatus = document.getElementById("saveStatus");

  const buildDraftButton = document.getElementById("buildDraft");
  const saveWorkButton = document.getElementById("saveWork");
  const downloadTxtButton = document.getElementById("downloadTxt");
  const clearWorkButton = document.getElementById("clearWork");

  let currentText = null;

  function storageKey(id) {
    return `${STORAGE_PREFIX}:${id}`;
  }

  function setSaveStatus(message) {
    saveStatus.textContent = message;
  }

  function updateWordCount() {
    const trimmed = draftText.value.trim();
    const total = trimmed ? trimmed.split(/\s+/).length : 0;
    wordCount.textContent = `Слов: ${total}`;
  }

  function collectAnswers() {
    return Array.from(document.querySelectorAll(".summary-answer")).map((input) => ({
      groupIndex: Number(input.dataset.groupIndex),
      questionIndex: Number(input.dataset.questionIndex),
      value: input.value
    }));
  }

  function saveWork(options) {
    if (!currentText) {
      return;
    }

    const settings = options || {};
    const data = {
      draft: draftText.value,
      answers: collectAnswers()
    };

    localStorage.setItem(storageKey(currentText.id), JSON.stringify(data));
    localStorage.setItem(LAST_TEXT_KEY, currentText.id);
    setSaveStatus(settings.manual ? MANUAL_SAVE_MESSAGE : AUTOSAVE_MESSAGE);
  }

  function restoreWork() {
    const raw = localStorage.getItem(storageKey(currentText.id));

    draftText.value = "";
    document.querySelectorAll(".summary-answer").forEach((input) => {
      input.value = "";
    });

    if (!raw) {
      updateWordCount();
      setSaveStatus(AUTOSAVE_MESSAGE);
      return;
    }

    try {
      const data = JSON.parse(raw);
      draftText.value = data.draft || "";

      if (Array.isArray(data.answers)) {
        data.answers.forEach((answer) => {
          const selector = `.summary-answer[data-group-index="${answer.groupIndex}"][data-question-index="${answer.questionIndex}"]`;
          const input = document.querySelector(selector);

          if (input) {
            input.value = answer.value || "";
          }
        });
      }
    } catch (error) {
      localStorage.removeItem(storageKey(currentText.id));
    }

    updateWordCount();
    setSaveStatus(AUTOSAVE_MESSAGE);
  }

  function buildDraft() {
    if (!currentText) {
      return;
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

    draftText.value = paragraphs.join("\n\n");
    updateWordCount();
    saveWork();
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

    const confirmed = window.confirm("Очистить ответы и черновик для текущего текста?");
    if (!confirmed) {
      return;
    }

    localStorage.removeItem(storageKey(currentText.id));
    document.querySelectorAll(".summary-answer").forEach((input) => {
      input.value = "";
    });
    draftText.value = "";
    updateWordCount();
    setSaveStatus(AUTOSAVE_MESSAGE);
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
    input.className = "summary-answer";
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
      section.className = "kd-panel summary-group";

      const inner = document.createElement("div");
      inner.className = "summary-group-inner";

      const heading = document.createElement("h3");
      heading.textContent = `Микротема ${groupIndex + 1}`;

      const description = document.createElement("p");
      description.textContent = "Ответьте на вопросы полно, а затем соберите абзац для этой микротемы.";

      const list = document.createElement("div");
      list.className = "summary-question-list";

      group.questions.forEach((question, questionIndex) => {
        list.appendChild(createQuestion(groupIndex, questionIndex, question));
      });

      inner.appendChild(heading);
      inner.appendChild(description);
      inner.appendChild(list);
      section.appendChild(inner);
      questionsArea.appendChild(section);
    });
  }

  function loadText(id) {
    currentText = SUMMARY_TEXTS.find((item) => item.id === id) || SUMMARY_TEXTS[0] || null;

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
    SUMMARY_TEXTS.forEach((item) => {
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

    buildDraftButton.addEventListener("click", buildDraft);
    saveWorkButton.addEventListener("click", function () {
      saveWork({ manual: true });
    });
    downloadTxtButton.addEventListener("click", downloadTxt);
    clearWorkButton.addEventListener("click", clearWork);
    draftText.addEventListener("input", function () {
      updateWordCount();
      saveWork();
    });
  }

  function init() {
    if (!Array.isArray(window.SUMMARY_TEXTS) || window.SUMMARY_TEXTS.length === 0) {
      textSelect.disabled = true;
      sourceTitle.textContent = "Тексты не загружены";
      sourceText.textContent = "Добавьте данные в файл data/texts.js.";
      setSaveStatus("Нет данных для работы");
      return;
    }

    populateSelect();
    bindEvents();

    const lastTextId = localStorage.getItem(LAST_TEXT_KEY);
    const defaultText = SUMMARY_TEXTS.some((item) => item.id === lastTextId)
      ? lastTextId
      : SUMMARY_TEXTS[0].id;

    loadText(defaultText);
  }

  init();
}());
