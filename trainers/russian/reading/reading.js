(function () {
  "use strict";

  const ORAL_BANK_URL = "../../../controls/russian/oral-bank.json";
  const PUBLIC_API_CONFIG_URL = "../../../assets/config/public-api.json";
  const LS_KEY = "kodislovo:russian:oral-trainer:v1";
  const ERROR_TYPES = ["skip", "replace", "distort", "repeat", "stress", "pause"];

  const $ = (id) => document.getElementById(id);

  let oralTexts = [];
  let selectedText = null;
  let selectedTopic = null;
  let secondsElapsed = 0;
  let timerStartedAt = null;
  let timerInterval = null;
  let lastResult = null;
  let readingFinished = false;
  let errorHistory = [];
  let dialogAnswers = {};
  let errors = createEmptyErrors();
  let backendServicesPromise = null;
  let recordingStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedBlob = null;
  let recordedAudioUrl = "";
  let recordedMimeType = "";
  let audioAnalysisResult = null;

  function createEmptyErrors() {
    return {
      skip: 0,
      replace: 0,
      distort: 0,
      repeat: 0,
      stress: 0,
      pause: 0,
    };
  }

  function safeText(value) {
    return (value ?? "").toString().trim();
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Не удалось загрузить ${url} (HTTP ${response.status})`);
    }
    return await response.json();
  }

  function setRecordingStatus(text) {
    $("recordingStatus").textContent = text;
  }

  function setRecordedAudio(blob) {
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      recordedAudioUrl = "";
    }
    recordedBlob = blob;
    if (blob) {
      recordedAudioUrl = URL.createObjectURL(blob);
      $("recordedAudio").src = recordedAudioUrl;
      setRecordingStatus(`Аудиозапись готова: ${Math.round(blob.size / 1024)} КБ`);
    } else {
      $("recordedAudio").removeAttribute("src");
      $("recordedAudio").load();
      setRecordingStatus("Аудиозапись не создана.");
    }
  }

  async function loadBackendServices() {
    if (!backendServicesPromise) {
      backendServicesPromise = fetchJson(PUBLIC_API_CONFIG_URL).then(async (config) => {
        const baseUrl = safeText(config?.baseUrl).replace(/\/+$/, "");
        if (!baseUrl) {
          throw new Error("В public-api.json не задан baseUrl.");
        }
        const services = await fetchJson(`${baseUrl}/api/public/subjects/russian/services`);
        return {
          baseUrl,
          oralAnalyzeUrl: services.oralAnalyzeUrl
            ? new URL(services.oralAnalyzeUrl, `${baseUrl}/`).toString()
            : "",
        };
      });
    }
    return backendServicesPromise;
  }

  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function countWords(text) {
    const words = safeText(text).match(/[A-Za-zА-Яа-яЁё0-9-]+/g);
    return words ? words.length : 0;
  }

  function sumErrors() {
    return ERROR_TYPES.reduce((sum, key) => sum + Number(errors[key] || 0), 0);
  }

  function getExpressivenessScore() {
    return ["exprPauses", "exprIntonation", "exprPace", "exprStress"]
      .map((id) => Boolean($(id)?.checked))
      .filter(Boolean).length;
  }

  function getReadingText() {
    return safeText(selectedText?.readingText);
  }

  function getReadingTitle() {
    return safeText(selectedText?.title) || "Текст";
  }

  function getTopics() {
    return Array.isArray(selectedText?.monologueTopics) ? selectedText.monologueTopics : [];
  }

  function calculateMetrics() {
    const wordsTotal = countWords(getReadingText());
    const errorsTotal = sumErrors();
    const minutes = secondsElapsed > 0 ? secondsElapsed / 60 : 0;
    const wordsPerMinute = minutes > 0 ? Math.round(wordsTotal / minutes) : 0;
    const accuracyValue = wordsTotal > 0
      ? Math.max(0, Math.round(((wordsTotal - errorsTotal) / wordsTotal) * 100))
      : 0;
    const expressivenessScore = getExpressivenessScore();

    let level = "Нужно доработать";
    if (wordsPerMinute >= 110 && errorsTotal <= 2 && expressivenessScore >= 3) {
      level = "Высокий";
    } else if (wordsPerMinute >= 85 && errorsTotal <= 5) {
      level = "Рабочий";
    } else if (wordsPerMinute >= 65 && errorsTotal <= 8) {
      level = "Базовый";
    }

    return {
      wordsTotal,
      seconds: secondsElapsed,
      wordsPerMinute,
      errorsTotal,
      accuracy: accuracyValue,
      expressivenessScore,
      level,
    };
  }

  function updateStats() {
    const metrics = calculateMetrics();
    $("wordsTotalLabel").textContent = `Слов: ${metrics.wordsTotal}`;
    $("secondsTotal").textContent = String(metrics.seconds);
    $("wpm").textContent = String(metrics.wordsPerMinute);
    $("accuracy").textContent = `${metrics.accuracy}%`;
    $("errorsTotal").textContent = String(metrics.errorsTotal);
    $("levelBadge").textContent = `Предварительный уровень чтения: ${metrics.level}`;
    updateCompletionStatus();
  }

  function updateTimer() {
    $("timerDisplay").textContent = formatTime(secondsElapsed);
  }

  function renderErrors() {
    ERROR_TYPES.forEach((key) => {
      const target = $(`${key}Count`);
      if (target) target.textContent = String(errors[key] || 0);
    });
    updateStats();
    saveState();
  }

  function renderText() {
    $("textTitle").textContent = getReadingTitle();
    $("readingText").textContent = getReadingText();
    $("retellingPrompt").textContent = safeText(selectedText?.retellingTask?.prompt)
      || "Подсказка для пересказа пока не добавлена.";
    renderMonologueTopics();
    updateStats();
  }

  function fillSelect() {
    const select = $("textSelect");
    select.innerHTML = "";

    oralTexts
      .filter((item) => item && item.active !== false)
      .forEach((item) => {
        const option = document.createElement("option");
        option.value = item.id;
        option.textContent = item.title || item.id;
        select.appendChild(option);
      });
  }

  function fillTopicSelect() {
    const select = $("monologueTopicSelect");
    select.innerHTML = "";
    getTopics().forEach((topic) => {
      const option = document.createElement("option");
      option.value = topic.id;
      option.textContent = topic.title || topic.id;
      select.appendChild(option);
    });
  }

  function renderMonologueTopics() {
    fillTopicSelect();
    const firstTopicId = selectedTopic?.id || getTopics()[0]?.id || "";
    selectTopic(firstTopicId);
  }

  function renderMonologuePlan() {
    const list = $("monologuePlan");
    list.innerHTML = "";
    $("monologueTitle").textContent = safeText(selectedTopic?.title) || "Тема";
    (selectedTopic?.plan || []).forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    });
  }

  function renderDialogQuestions() {
    const wrap = $("dialogQuestions");
    wrap.innerHTML = "";
    const questions = Array.isArray(selectedTopic?.dialogQuestions) ? selectedTopic.dialogQuestions : [];

    questions.forEach((question, index) => {
      const key = String(index + 1);
      const card = document.createElement("div");
      card.className = "reading-dialog-card";

      const title = document.createElement("strong");
      title.textContent = `Вопрос ${index + 1}`;
      card.appendChild(title);

      const prompt = document.createElement("p");
      prompt.className = "reading-prompt";
      prompt.textContent = question;
      card.appendChild(prompt);

      const area = document.createElement("textarea");
      area.className = "reading-notes reading-answer";
      area.placeholder = "Запишите ответ ученика на этот вопрос.";
      area.value = safeText(dialogAnswers[key]);
      area.addEventListener("input", () => {
        dialogAnswers[key] = area.value;
        updateCompletionStatus();
        saveState();
      });
      card.appendChild(area);

      wrap.appendChild(card);
    });
  }

  function selectTopic(topicId, options = {}) {
    const preserveAnswers = Boolean(options.preserveAnswers);
    const topics = getTopics();
    selectedTopic = topics.find((item) => item.id === topicId) || topics[0] || null;
    if ($("monologueTopicSelect") && selectedTopic) {
      $("monologueTopicSelect").value = selectedTopic.id;
    }

    if (!preserveAnswers) {
      dialogAnswers = {};
    }
    renderMonologuePlan();
    renderDialogQuestions();
    updateCompletionStatus();
    saveState();
  }

  function selectText(textId, options = {}) {
    const preserveContent = Boolean(options.preserveContent);
    selectedText = oralTexts.find((item) => item.id === textId) || oralTexts[0] || null;
    if (!selectedText) return;
    $("textSelect").value = selectedText.id;
    selectedTopic = null;
    if (!preserveContent) {
      dialogAnswers = {};
      $("retellingText").value = "";
      $("retellingNotes").value = "";
      $("monologueText").value = "";
      $("monologueNotes").value = "";
      $("dialogNotes").value = "";
    }
    renderText();
    $("reportBox").textContent = "Отчёт появится после формирования.";
    if (!preserveContent) {
      lastResult = null;
    }
    updateCompletionStatus();
    saveState();
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  async function startAudioRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Браузер не поддерживает запись с микрофона.");
    }

    recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    const preferredMimeTypes = [
      "audio/ogg;codecs=opus",
      "audio/webm;codecs=opus",
      "audio/webm",
    ];
    const recorderOptions = {};
    const supportedType = preferredMimeTypes.find((mimeType) => MediaRecorder.isTypeSupported?.(mimeType));
    if (supportedType) {
      recorderOptions.mimeType = supportedType;
      recordedMimeType = supportedType;
    } else {
      recordedMimeType = "";
    }

    mediaRecorder = new MediaRecorder(recordingStream, recorderOptions);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    });

    mediaRecorder.addEventListener("stop", () => {
      const mimeType = mediaRecorder.mimeType || recordedMimeType || "audio/webm";
      const blob = new Blob(recordedChunks, { type: mimeType });
      recordedMimeType = mimeType;
      setRecordedAudio(blob);
      if (recordingStream) {
        recordingStream.getTracks().forEach((track) => track.stop());
        recordingStream = null;
      }
      saveState();
    });

    mediaRecorder.start();
    setRecordingStatus("Идёт запись аудио…");
  }

  function stopAudioRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    setRecordingStatus(recordedBlob ? "Аудиозапись уже сохранена." : "Запись не была запущена.");
  }

  async function analyzeAudio() {
    if (!recordedBlob) {
      throw new Error("Сначала запишите аудио.");
    }

    const services = await loadBackendServices();
    if (!services.oralAnalyzeUrl) {
      throw new Error("Backend не вернул oralAnalyzeUrl.");
    }

    const form = new FormData();
    form.append("text_id", selectedText?.id || "");
    form.append("reading_text", getReadingText());
    form.append("student_name", safeText($("studentName").value));
    form.append("student_class", safeText($("studentClass").value));
    const extension = recordedMimeType.includes("ogg") ? "ogg" : "webm";
    form.append("audio", recordedBlob, `oral_${selectedText?.id || "text"}.${extension}`);

    setRecordingStatus("Аудио отправляется на backend…");
    const response = await fetch(services.oralAnalyzeUrl, {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.detail || `HTTP ${response.status}`);
    }

    audioAnalysisResult = data;
    $("audioAnalysisBox").textContent = JSON.stringify(data, null, 2);
    $("transcriptText").value = safeText(data?.transcript?.text || "");
    setRecordingStatus(data?.message || "Аудио проанализировано.");
    saveState();
  }

  function startReading() {
    if (!selectedText || timerInterval) return;
    timerStartedAt = Date.now() - (secondsElapsed * 1000);
    timerInterval = setInterval(() => {
      secondsElapsed = Math.floor((Date.now() - timerStartedAt) / 1000);
      updateTimer();
      updateStats();
      saveState();
    }, 250);
    saveState();
  }

  function finishReading() {
    stopTimer();
    readingFinished = true;
    updateTimer();
    updateStats();
    saveState();
  }

  function resetAll() {
    stopTimer();
    secondsElapsed = 0;
    timerStartedAt = null;
    errors = createEmptyErrors();
    errorHistory = [];
    lastResult = null;
    readingFinished = false;
    dialogAnswers = {};
    audioAnalysisResult = null;
    recordedMimeType = "";

    [
      "exprPauses",
      "exprIntonation",
      "exprPace",
      "exprStress",
    ].forEach((id) => {
      const input = $(id);
      if (input) input.checked = false;
    });

    [
      "teacherNotes",
      "retellingText",
      "retellingNotes",
      "monologueText",
      "monologueNotes",
      "dialogNotes",
    ].forEach((id) => {
      const input = $(id);
      if (input) input.value = "";
    });

    setRecordedAudio(null);
    $("transcriptText").value = "";
    $("audioAnalysisBox").textContent = "Результат аудиоанализа пока не получен.";
    $("reportBox").textContent = "Отчёт появится после формирования.";
    renderDialogQuestions();
    updateTimer();
    renderErrors();
    saveState();
  }

  function addError(type) {
    if (!Object.prototype.hasOwnProperty.call(errors, type)) return;
    errors[type] += 1;
    errorHistory.push(type);
    renderErrors();
  }

  function undoLastError() {
    const last = errorHistory.pop();
    if (!last) return;
    errors[last] = Math.max(0, Number(errors[last] || 0) - 1);
    renderErrors();
  }

  function clearErrors() {
    errors = createEmptyErrors();
    errorHistory = [];
    renderErrors();
  }

  function hasRetelling() {
    return safeText($("retellingText").value).length > 0;
  }

  function hasMonologue() {
    return safeText($("monologueText").value).length > 0;
  }

  function hasDialog() {
    const values = Object.values(dialogAnswers).map(safeText).filter(Boolean);
    const questionsCount = Array.isArray(selectedTopic?.dialogQuestions) ? selectedTopic.dialogQuestions.length : 0;
    return questionsCount > 0 && values.length === questionsCount;
  }

  function updateCompletionStatus() {
    $("statusReading").textContent = readingFinished || secondsElapsed > 0 ? "да" : "нет";
    $("statusRetelling").textContent = hasRetelling() ? "да" : "нет";
    $("statusMonologue").textContent = hasMonologue() ? "да" : "нет";
    $("statusDialog").textContent = hasDialog() ? "да" : "нет";
  }

  function buildResult() {
    const metrics = calculateMetrics();
    return {
      schema: "kodislovo.oral-trainer.v1",
      createdAt: new Date().toISOString(),
      student: safeText($("studentName").value),
      className: safeText($("studentClass").value),
      oralText: {
        id: selectedText?.id || "",
        title: getReadingTitle(),
        readingText: getReadingText(),
      },
      reading: {
        finished: readingFinished,
        wordsTotal: metrics.wordsTotal,
        seconds: metrics.seconds,
        wordsPerMinute: metrics.wordsPerMinute,
        errors: { ...errors },
        errorsTotal: metrics.errorsTotal,
        accuracy: metrics.accuracy,
        expressiveness: {
          pauses: Boolean($("exprPauses").checked),
          intonation: Boolean($("exprIntonation").checked),
          pace: Boolean($("exprPace").checked),
          stress: Boolean($("exprStress").checked),
        },
        expressivenessScore: metrics.expressivenessScore,
        level: metrics.level,
      },
      retelling: {
        prompt: safeText(selectedText?.retellingTask?.prompt),
        text: safeText($("retellingText").value),
        notes: safeText($("retellingNotes").value),
      },
      monologue: {
        topicId: selectedTopic?.id || "",
        title: safeText(selectedTopic?.title),
        plan: Array.isArray(selectedTopic?.plan) ? selectedTopic.plan.slice() : [],
        text: safeText($("monologueText").value),
        notes: safeText($("monologueNotes").value),
      },
      dialog: {
        questions: Array.isArray(selectedTopic?.dialogQuestions) ? selectedTopic.dialogQuestions.slice() : [],
        answers: { ...dialogAnswers },
        notes: safeText($("dialogNotes").value),
      },
      audioAnalysis: audioAnalysisResult,
      transcriptDraft: safeText($("transcriptText").value),
      teacherNotes: safeText($("teacherNotes").value),
      completion: {
        reading: readingFinished || secondsElapsed > 0,
        retelling: hasRetelling(),
        monologue: hasMonologue(),
        dialog: hasDialog(),
      },
    };
  }

  function buildReport() {
    lastResult = buildResult();
    $("reportBox").textContent = JSON.stringify(lastResult, null, 2);
    saveState();
  }

  function downloadJSON() {
    if (!lastResult) {
      buildReport();
    }
    const blob = new Blob([JSON.stringify(lastResult, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const studentSlug = safeText($("studentName").value).replace(/\s+/g, "_") || "student";
    link.href = url;
    link.download = `oral_trainer_${studentSlug}_${selectedText?.id || "text"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function saveState() {
    const payload = {
      studentName: safeText($("studentName")?.value),
      studentClass: safeText($("studentClass")?.value),
      selectedTextId: selectedText?.id || "",
      selectedTopicId: selectedTopic?.id || "",
      secondsElapsed,
      readingFinished,
      errors,
      errorHistory,
      teacherNotes: safeText($("teacherNotes")?.value),
      retellingText: safeText($("retellingText")?.value),
      retellingNotes: safeText($("retellingNotes")?.value),
      monologueText: safeText($("monologueText")?.value),
      monologueNotes: safeText($("monologueNotes")?.value),
      dialogNotes: safeText($("dialogNotes")?.value),
      dialogAnswers: { ...dialogAnswers },
      transcriptText: safeText($("transcriptText")?.value),
      audioAnalysisResult,
      expressiveness: {
        pauses: Boolean($("exprPauses")?.checked),
        intonation: Boolean($("exprIntonation")?.checked),
        pace: Boolean($("exprPace")?.checked),
        stress: Boolean($("exprStress")?.checked),
      },
      lastResult,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  }

  function restoreState() {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function applySavedState(saved) {
    if (!saved) return {};

    $("studentName").value = safeText(saved.studentName);
    $("studentClass").value = safeText(saved.studentClass);
    $("teacherNotes").value = safeText(saved.teacherNotes);
    $("retellingText").value = safeText(saved.retellingText);
    $("retellingNotes").value = safeText(saved.retellingNotes);
    $("monologueText").value = safeText(saved.monologueText);
    $("monologueNotes").value = safeText(saved.monologueNotes);
    $("dialogNotes").value = safeText(saved.dialogNotes);
    $("transcriptText").value = safeText(saved.transcriptText);

    secondsElapsed = Math.max(0, Number(saved.secondsElapsed || 0));
    readingFinished = Boolean(saved.readingFinished);
    errors = { ...createEmptyErrors(), ...(saved.errors || {}) };
    errorHistory = Array.isArray(saved.errorHistory) ? saved.errorHistory.slice() : [];
    dialogAnswers = saved.dialogAnswers && typeof saved.dialogAnswers === "object" ? { ...saved.dialogAnswers } : {};
    audioAnalysisResult = saved.audioAnalysisResult || null;
    lastResult = saved.lastResult || null;

    const expr = saved.expressiveness || {};
    $("exprPauses").checked = Boolean(expr.pauses);
    $("exprIntonation").checked = Boolean(expr.intonation);
    $("exprPace").checked = Boolean(expr.pace);
    $("exprStress").checked = Boolean(expr.stress);

    updateTimer();
    renderErrors();
    if (lastResult) {
      $("reportBox").textContent = JSON.stringify(lastResult, null, 2);
    }
    if (audioAnalysisResult) {
      $("audioAnalysisBox").textContent = JSON.stringify(audioAnalysisResult, null, 2);
      setRecordingStatus(audioAnalysisResult?.message || "Есть сохранённый результат аудиоанализа.");
    }

    return {
      selectedTextId: safeText(saved.selectedTextId),
      selectedTopicId: safeText(saved.selectedTopicId),
    };
  }

  async function loadBank() {
    const response = await fetch(ORAL_BANK_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Не удалось загрузить oral-bank.json (HTTP ${response.status})`);
    }
    oralTexts = await response.json();
  }

  function bindEvents() {
    $("textSelect").addEventListener("change", (event) => {
      selectText(event.target.value);
    });

    $("monologueTopicSelect").addEventListener("change", (event) => {
      selectTopic(event.target.value);
    });

    $("startBtn").addEventListener("click", startReading);
    $("finishBtn").addEventListener("click", finishReading);
    $("buildReportBtn").addEventListener("click", buildReport);
    $("downloadBtn").addEventListener("click", downloadJSON);
    $("resetBtn").addEventListener("click", resetAll);
    $("recordStartBtn").addEventListener("click", async () => {
      try {
        await startAudioRecording();
      } catch (error) {
        console.error(error);
        setRecordingStatus(`Ошибка записи: ${error.message}`);
      }
    });
    $("recordStopBtn").addEventListener("click", stopAudioRecording);
    $("analyzeAudioBtn").addEventListener("click", async () => {
      try {
        await analyzeAudio();
      } catch (error) {
        console.error(error);
        setRecordingStatus(`Ошибка анализа: ${error.message}`);
      }
    });
    $("undoErrorBtn").addEventListener("click", undoLastError);
    $("clearErrorsBtn").addEventListener("click", clearErrors);

    document.querySelectorAll(".reading-error-btn").forEach((button) => {
      button.addEventListener("click", () => addError(button.dataset.error));
    });

    [
      "studentName",
      "studentClass",
      "teacherNotes",
      "retellingText",
      "retellingNotes",
      "monologueText",
      "monologueNotes",
      "dialogNotes",
      "transcriptText",
      "exprPauses",
      "exprIntonation",
      "exprPace",
      "exprStress",
    ].forEach((id) => {
      $(id).addEventListener("input", () => {
        updateCompletionStatus();
        saveState();
      });
      $(id).addEventListener("change", () => {
        updateStats();
        updateCompletionStatus();
        saveState();
      });
    });
  }

  async function init() {
    bindEvents();
    await loadBank();
    fillSelect();

    const params = new URLSearchParams(window.location.search);
    const saved = restoreState();
    const restoredIds = saved ? {
      selectedTextId: safeText(saved.selectedTextId),
      selectedTopicId: safeText(saved.selectedTopicId),
    } : {};
    const initialTextId = params.get("text") || restoredIds.selectedTextId || oralTexts[0]?.id || "";
    selectText(initialTextId, { preserveContent: Boolean(saved) });
    applySavedState(saved);
    if (restoredIds.selectedTopicId) {
      selectTopic(restoredIds.selectedTopicId, { preserveAnswers: true });
    }
    updateTimer();
    updateStats();
    updateCompletionStatus();
    setRecordingStatus(audioAnalysisResult?.message || "Аудиозапись не создана.");
  }

  init().catch((error) => {
    console.error(error);
    $("readingText").textContent = `Ошибка загрузки тренажёра: ${error.message}`;
  });
}());
