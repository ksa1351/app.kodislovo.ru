"use strict";

const $ = (id) => document.getElementById(id);
const status = (msg) => {
  const el = $("statusLine");
  if (el) el.textContent = msg;
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function repoPrefixGuess() {
  const parts = location.pathname.split("/").filter(Boolean);
  return parts.length ? `/${parts[0]}` : "";
}

function applyTheme(themeName) {
  const theme = themeName === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  const toggle = $("themeToggle");
  if (toggle) toggle.checked = theme === "light";
  localStorage.setItem("kd-theme", theme);
}

async function sha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const PIN_HASH_KEY = "kd-teacher-pin-sha256";
const RESET_HISTORY_KEY = "kd-reset-history-v1";

async function ensurePinExists() {
  if (localStorage.getItem(PIN_HASH_KEY)) return;

  let first = prompt("Создайте PIN для учительского раздела (4-12 цифр):", "");
  if (first === null) throw new Error("PIN setup cancelled");
  first = String(first).trim();

  if (!/^\d{4,12}$/.test(first)) {
    alert("PIN должен быть длиной 4-12 цифр.");
    return ensurePinExists();
  }

  let second = prompt("Повторите PIN:", "");
  if (second === null) throw new Error("PIN setup cancelled");
  second = String(second).trim();

  if (first !== second) {
    alert("PIN не совпал. Попробуйте ещё раз.");
    return ensurePinExists();
  }

  localStorage.setItem(PIN_HASH_KEY, await sha256Hex(first));
}

async function pinEnter() {
  const input = $("pinInput");
  const pin = String(input?.value || "").trim();
  if (!pin) return;

  const actual = await sha256Hex(pin);
  const expected = localStorage.getItem(PIN_HASH_KEY) || "";

  if (actual !== expected) {
    $("pinStatus").textContent = "Неверный PIN";
    input.value = "";
    input.focus();
    return;
  }

  $("pinOverlay").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("pinStatus").textContent = "";
  input.value = "";
}

async function pinReset() {
  if (!confirm("Сменить PIN в этом браузере?")) return;
  localStorage.removeItem(PIN_HASH_KEY);
  await ensurePinExists();
  $("pinStatus").textContent = "PIN обновлён";
}

let manifestCache = { subject: null, manifest: null };

async function loadManifest(subject) {
  if (manifestCache.manifest && manifestCache.subject === subject) return manifestCache.manifest;

  const prefix = repoPrefixGuess();
  const primaryUrl = `${prefix}/controls/${subject}/variants/manifest.json`;
  const fallbackUrl = `/controls/${subject}/variants/manifest.json`;

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`manifest.json ${response.status}`);
    return response.json();
  }

  try {
    const manifest = await fetchJson(primaryUrl);
    manifestCache = { subject, manifest };
    return manifest;
  } catch {
    const manifest = await fetchJson(fallbackUrl);
    manifestCache = { subject, manifest };
    return manifest;
  }
}

function getApiFromManifest(manifest) {
  return {
    base: String(manifest?.teacher?.base_url || "").replace(/\/+$/, ""),
    token: String(manifest?.teacher?.token || "")
  };
}

async function apiCall(subject, path, body) {
  const manifest = await loadManifest(subject);
  const { base, token } = getApiFromManifest(manifest);

  if (!base || !token) {
    throw new Error("В manifest.json не заданы teacher.base_url и teacher.token.");
  }

  const response = await fetch(base + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Teacher-Token": token
    },
    body: JSON.stringify(body || {})
  });

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(data.message || data.error || `HTTP ${response.status}`);
  }

  return data;
}

const THRESH_5 = 87;
const THRESH_4 = 67;
const THRESH_3 = 42;

function safeStr(value) {
  return value == null ? "" : String(value);
}

function normalizeVariantDigits(value) {
  const match = String(value || "").trim().match(/(\d+)/);
  if (!match) return "";
  return match[1].length === 1 ? `0${match[1]}` : match[1];
}

function normalizeText(value) {
  return safeStr(value)
    .trim()
    .toLowerCase()
    .replaceAll("ё", "е")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ");
}

function normalizeNumbers(value) {
  return normalizeText(value).replace(/[^0-9]/g, "").split("").sort().join("");
}

function isNumericKeyStr(value) {
  return /^[0-9]+$/.test(String(value || ""));
}

function checkOne(userValue, keyValues) {
  const user = normalizeText(userValue);
  if (!user) return false;

  const keys = Array.isArray(keyValues) ? keyValues : [keyValues];
  if (keys.some(isNumericKeyStr)) {
    const normalizedUser = normalizeNumbers(userValue);
    return keys.map((item) => normalizeNumbers(item)).includes(normalizedUser);
  }

  const normalizedUser = user.replace(/\s/g, "");
  return keys.map((item) => normalizeText(item).replace(/\s/g, "")).includes(normalizedUser);
}

function gradeFromPercent(percent) {
  if (percent >= THRESH_5) return 5;
  if (percent >= THRESH_4) return 4;
  if (percent >= THRESH_3) return 3;
  return 2;
}

function countWords(text) {
  const trimmed = safeStr(text).trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function isSummaryVariant(value) {
  return /^summary_/i.test(String(value || "").trim());
}

function isSummaryTrainerResult(result, meta) {
  return result?.schema === "kodislovo.summary-trainer.result.v1"
    || result?.trainer === "summary-trainer"
    || isSummaryVariant(result?.variant)
    || isSummaryVariant(meta?.variant);
}

function getSelectedKeys() {
  return Array.from(document.querySelectorAll(".pick:checked"))
    .map((checkbox) => checkbox.getAttribute("data-key"))
    .filter(Boolean);
}

function getListMetaByKey(key) {
  return listItems.find((item) => item.key === key) || null;
}

function getSelectionState() {
  const keys = getSelectedKeys();
  const metas = keys.map(getListMetaByKey).filter(Boolean);
  const hasSummary = metas.some((item) => isSummaryVariant(item.variant));
  const hasClassic = metas.some((item) => !isSummaryVariant(item.variant));
  const canProcess = keys.length > 0 && (!hasClassic || !!keyObj);

  return { keys, metas, hasSummary, hasClassic, canProcess };
}

function extractStudentAnswers(result) {
  const answerMap = {};

  if (Array.isArray(result?.answers)) {
    result.answers.forEach((entry) => {
      if (entry?.id != null) answerMap[String(entry.id)] = entry.value ?? entry.answer ?? "";
    });
  } else if (result?.answers && typeof result.answers === "object") {
    Object.entries(result.answers).forEach(([key, value]) => {
      answerMap[String(key)] = value?.value ?? value ?? "";
    });
  } else if (result?.userAnswers && typeof result.userAnswers === "object") {
    Object.entries(result.userAnswers).forEach(([key, value]) => {
      answerMap[String(key)] = value ?? "";
    });
  }

  return {
    fio: result?.identity?.fio || result?.student?.name || "",
    cls: result?.identity?.cls || result?.student?.class || "",
    answerMap
  };
}

function buildControlReport(keyData, result, meta) {
  const answerKey = keyData?.answers || keyData?.ANSWER_KEY?.answers || {};
  const pointKey = keyData?.points || {};
  const questionIds = Object.keys(answerKey).sort((a, b) => Number(a) - Number(b));
  const student = extractStudentAnswers(result);

  let correct = 0;
  let points = 0;
  let maxPoints = 0;
  let empty = 0;

  const items = questionIds.map((questionId) => {
    const rawUser = student.answerMap[questionId] ?? "";
    const hasUserAnswer = normalizeText(rawUser) !== "";
    const isCorrect = hasUserAnswer ? checkOne(rawUser, answerKey[questionId]) : false;
    const questionPoints = Number(pointKey[questionId] ?? 1);

    if (!hasUserAnswer) empty += 1;
    if (isCorrect) correct += 1;

    points += isCorrect ? questionPoints : 0;
    maxPoints += questionPoints;

    return {
      n: questionId,
      user: rawUser,
      right: Array.isArray(answerKey[questionId]) ? answerKey[questionId] : [answerKey[questionId]],
      ok: isCorrect
    };
  });

  const percent = maxPoints ? (points / maxPoints) * 100 : 0;

  return {
    type: "control",
    key: meta?.key || "",
    createdAt: meta?.createdAt || result?.createdAt || "",
    variant: meta?.variant || result?.variant || "",
    title: meta?.variant || result?.variant || "",
    fio: student.fio,
    cls: student.cls,
    keyTitle: keyData?.title || keyData?.meta?.title || keyData?.set || "",
    total: questionIds.length,
    correct,
    empty,
    points,
    maxPoints,
    percent,
    grade: gradeFromPercent(percent),
    items
  };
}

function buildSummaryTrainerReport(result, meta) {
  const answers = Array.isArray(result?.answers) ? result.answers : [];
  const draft = safeStr(result?.draft).trim();
  const title = result?.variantTitle || result?.text?.title || meta?.variant || result?.variant || "Изложение";

  return {
    type: "summary-trainer",
    key: meta?.key || "",
    createdAt: meta?.createdAt || result?.createdAt || "",
    variant: result?.variant || meta?.variant || "",
    title,
    fio: result?.identity?.fio || result?.student?.name || "",
    cls: result?.identity?.cls || result?.student?.class || "",
    words: countWords(draft),
    answerCount: answers.length,
    draft,
    sourceText: safeStr(result?.sourceText).trim(),
    submittedFrom: safeStr(result?.submittedFrom),
    answers: answers.map((entry) => ({
      label: `Микротема ${Number(entry?.groupIndex || 0) + 1}, вопрос ${Number(entry?.questionIndex || 0) + 1}`,
      value: safeStr(entry?.value).trim()
    })).filter((entry) => entry.value)
  };
}

function makeCSV(rows) {
  const escapeCell = (value) => `"${safeStr(value).replaceAll('"', '""')}"`;
  return rows.map((row) => row.map(escapeCell).join(";")).join("\n");
}

function downloadText(text, filename, mimeType) {
  const blob = new Blob([text], { type: mimeType || "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

function buildPrintHtml() {
  if (!reports.length) return "<h2>Нет данных для печати</h2>";

  const header = `<h1>Отчёт учительской панели</h1><div style="margin:6px 0 18px;color:#555">Работ: ${reports.length}</div>`;
  const body = reports.map((report) => {
    if (report.type === "summary-trainer") {
      const answersHtml = report.answers.length
        ? `
          <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
            <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #999">Блок</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #999">Ответ</th></tr></thead>
            <tbody>
              ${report.answers.map((answer) => `
                <tr>
                  <td style="padding:6px 8px;border-bottom:1px solid #ddd">${escapeHtml(answer.label)}</td>
                  <td style="padding:6px 8px;border-bottom:1px solid #ddd">${escapeHtml(answer.value)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        `
        : `<div style="margin-top:10px;color:#666">Ответы по микротемам не сохранены.</div>`;

      return `
        <div style="page-break-inside:avoid;border:1px solid #ddd;border-radius:12px;padding:12px;margin:0 0 14px">
          <div style="font-weight:800">${escapeHtml(report.fio || "—")} (${escapeHtml(report.cls || "—")})</div>
          <div style="color:#555;margin-top:4px">Изложение: <b>${escapeHtml(report.title)}</b> • слов: <b>${report.words}</b> • ответов: <b>${report.answerCount}</b></div>
          <div style="color:#555;margin-top:4px">S3: ${escapeHtml(report.key || "—")}</div>
          <h3 style="margin:14px 0 8px">Готовое изложение</h3>
          <pre>${escapeHtml(report.draft || "Текст не найден.")}</pre>
          ${answersHtml}
        </div>
      `;
    }

    return `
      <div style="page-break-inside:avoid;border:1px solid #ddd;border-radius:12px;padding:12px;margin:0 0 14px">
        <div style="font-weight:800">${escapeHtml(report.fio || "—")} (${escapeHtml(report.cls || "—")})</div>
        <div style="color:#555;margin-top:4px">Баллы: <b>${report.points}/${report.maxPoints}</b> • ${report.percent.toFixed(1)}% • оценка <b>${report.grade}</b> • вариант: ${escapeHtml(report.variant || "")}</div>
        <table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:12px">
          <thead><tr><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #999;width:46px">№</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #999">Ответ</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #999">Ключ</th><th style="text-align:left;padding:6px 8px;border-bottom:2px solid #999;width:70px">Статус</th></tr></thead>
          <tbody>
            ${report.items.map((item) => `
              <tr>
                <td style="padding:6px 8px;border-bottom:1px solid #ddd"><b>${escapeHtml(item.n)}</b></td>
                <td style="padding:6px 8px;border-bottom:1px solid #ddd">${escapeHtml(normalizeText(item.user) ? item.user : "—")}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #ddd;color:#555">${escapeHtml((item.right || []).join(" / "))}</td>
                <td style="padding:6px 8px;border-bottom:1px solid #ddd">${item.ok ? "верно" : "ошибка"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }).join("");

  return header + body;
}

function printReports() {
  const popup = window.open("", "_blank");
  if (!popup) {
    alert("Браузер заблокировал окно печати.");
    return;
  }

  popup.document.open();
  popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Печать</title><style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111}h1{margin:0 0 8px}@media print{body{margin:10mm}}</style></head><body>${buildPrintHtml()}</body></html>`);
  popup.document.close();
  popup.focus();
  popup.print();
}

let keyObj = null;
let listItems = [];
let visibleItems = [];
let reports = [];
let lastCSV = null;

function applyFilters(items) {
  const query = safeStr($("fioSearch")?.value).trim().toLowerCase();
  if (!query) return items.slice();

  return items.filter((item) => (`${item.fio || ""} ${item.cls || ""} ${item.variant || ""} ${item.key || ""}`).toLowerCase().includes(query));
}

function getWorkKindLabel(item) {
  return isSummaryVariant(item?.variant) ? "Изложение" : "Тест";
}

function renderList() {
  const wrap = $("listWrap");
  if (!visibleItems.length) {
    wrap.innerHTML = '<div class="sub">Пока нет работ по этим фильтрам.</div>';
    return;
  }

  const rows = visibleItems.map((item) => {
    const created = safeStr(item.createdAt).replace("T", " ").slice(0, 16);
    return `
      <tr>
        <td style="width:44px"><input type="checkbox" class="pick" data-key="${escapeHtml(item.key)}"></td>
        <td><b>${escapeHtml(item.fio || "—")}</b><div class="sub">${escapeHtml(item.cls || "")}</div></td>
        <td>${escapeHtml(getWorkKindLabel(item))}</td>
        <td>${escapeHtml(item.variant || "—")}</td>
        <td>${escapeHtml(created)}</td>
        <td class="sub"><code>${escapeHtml(item.key)}</code></td>
      </tr>
    `;
  }).join("");

  wrap.innerHTML = `
    <table>
      <thead><tr><th></th><th>Ученик</th><th>Формат</th><th>Работа</th><th>Дата</th><th>Ключ (S3)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function updateButtons() {
  const selection = getSelectionState();
  const checkButton = $("btnCheckSelected");
  const csvButton = $("btnCSV");
  const printButton = $("btnPrint");

  if (checkButton) {
    checkButton.disabled = !selection.canProcess;
    checkButton.textContent = selection.hasClassic ? "Проверить выбранные" : "Открыть выбранные";
    if (selection.keys.length && selection.hasClassic && !keyObj) {
      checkButton.title = "Для тестовых работ сначала загрузите ключ.";
    } else {
      checkButton.removeAttribute("title");
    }
  }

  if (csvButton) csvButton.disabled = !(lastCSV && lastCSV.length);
  if (printButton) printButton.disabled = !reports.length;
}

async function loadKey() {
  const file = $("keyFile").files?.[0];
  keyObj = null;

  if (!file) {
    status("Выберите JSON-файл ключа.");
    updateButtons();
    return;
  }

  try {
    keyObj = JSON.parse(await file.text());
    const variant = keyObj?.variant || keyObj?.meta?.variant || "";
    const subject = keyObj?.subject || keyObj?.meta?.subject || "";
    $("keyInfo").innerHTML = `Загружен ключ: <b>${escapeHtml(variant || "—")}</b> • предмет: <b>${escapeHtml(subject || "—")}</b>`;
    status("Ключ загружен.");
  } catch (error) {
    alert(`Не удалось прочитать ключ.\n\n${error.message}`);
    $("keyFile").value = "";
    $("keyInfo").textContent = "";
    keyObj = null;
  }

  updateButtons();
}

async function loadList() {
  status("Загрузка списка...");

  const subject = $("subjectSelect").value || "russian";
  const variantDigits = normalizeVariantDigits($("variantFilter").value);
  const cls = safeStr($("classFilter").value).trim();

  const data = await apiCall(subject, "/teacher/list", {
    variant: variantDigits,
    cls,
    limit: 200
  });

  listItems = Array.isArray(data.items) ? data.items : [];
  visibleItems = applyFilters(listItems);
  renderList();

  $("checkAll").checked = false;
  updateButtons();
  status(`Загружено работ: ${visibleItems.length}`);
}

function renderSummary() {
  const wrap = $("summary");
  if (!reports.length) {
    wrap.innerHTML = "Пока нет результатов.";
    return;
  }

  const controlReports = reports.filter((report) => report.type === "control");
  const summaryReports = reports.filter((report) => report.type === "summary-trainer");
  const pills = [];

  pills.push(`<div class="pill">Всего работ: <b>${reports.length}</b></div>`);

  if (controlReports.length) {
    const averagePercent = controlReports.reduce((sum, report) => sum + report.percent, 0) / controlReports.length;
    pills.push(`<div class="pill">Тестов: <b>${controlReports.length}</b></div>`);
    pills.push(`<div class="pill">Средний %: <b>${averagePercent.toFixed(1)}%</b></div>`);
    pills.push(`<div class="pill">Средняя оценка: <b>${gradeFromPercent(averagePercent)}</b></div>`);
  }

  if (summaryReports.length) {
    const averageWords = Math.round(summaryReports.reduce((sum, report) => sum + report.words, 0) / summaryReports.length);
    pills.push(`<div class="pill">Изложений: <b>${summaryReports.length}</b></div>`);
    pills.push(`<div class="pill">Средний объём: <b>${averageWords}</b> слов</div>`);
  }

  wrap.innerHTML = `<div class="row" style="gap:12px">${pills.join("")}</div>`;
}

function renderControlDetails(report) {
  const header = `${safeStr(report.fio) || "—"} (${safeStr(report.cls) || "—"}) — ${report.points}/${report.maxPoints} • ${report.percent.toFixed(1)}% • оценка ${report.grade}`;
  const rows = report.items.map((item) => `
    <tr>
      <td><b>${escapeHtml(item.n)}</b></td>
      <td>${escapeHtml(normalizeText(item.user) ? item.user : "—")}</td>
      <td class="sub">${escapeHtml((item.right || []).join(" / "))}</td>
      <td>${item.ok ? '<span class="ok">верно</span>' : '<span class="bad">ошибка</span>'}</td>
    </tr>
  `).join("");

  return `
    <details>
      <summary>${escapeHtml(header)}</summary>
      <div class="sub" style="margin-top:8px">Вариант: <b>${escapeHtml(report.variant || "—")}</b> • S3: <code>${escapeHtml(report.key)}</code></div>
      <table style="margin-top:10px">
        <thead><tr><th style="width:60px">№</th><th>Ответ</th><th>Ключ</th><th style="width:110px">Статус</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </details>
  `;
}

function renderSummaryDetails(report) {
  const answersHtml = report.answers.length
    ? `
      <table style="margin-top:10px">
        <thead><tr><th style="width:220px">Блок</th><th>Ответ ученика</th></tr></thead>
        <tbody>
          ${report.answers.map((answer) => `
            <tr>
              <td><b>${escapeHtml(answer.label)}</b></td>
              <td>${escapeHtml(answer.value)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `
    : `<div class="sub" style="margin-top:10px">Развёрнутые ответы по микротемам не сохранены.</div>`;

  const sourceBlock = report.sourceText
    ? `
      <div style="margin-top:12px;font-weight:800">Исходный текст</div>
      <pre>${escapeHtml(report.sourceText)}</pre>
    `
    : "";

  return `
    <details>
      <summary>${escapeHtml(`${safeStr(report.fio) || "—"} (${safeStr(report.cls) || "—"}) — ${report.title} • ${report.words} слов`)}</summary>
      <div class="sub" style="margin-top:8px">S3: <code>${escapeHtml(report.key)}</code></div>
      <div class="sub" style="margin-top:4px">Вариант: <b>${escapeHtml(report.variant || "—")}</b> • ответов по микротемам: <b>${report.answerCount}</b></div>
      <div style="margin-top:12px;font-weight:800">Готовое изложение</div>
      <pre>${escapeHtml(report.draft || "Текст не найден.")}</pre>
      ${answersHtml}
      ${sourceBlock}
    </details>
  `;
}

function renderDetails() {
  const wrap = $("detailsWrap");
  if (!reports.length) {
    wrap.innerHTML = '<div class="sub">Пока нет результатов.</div>';
    return;
  }

  wrap.innerHTML = reports.map((report) => (
    report.type === "summary-trainer" ? renderSummaryDetails(report) : renderControlDetails(report)
  )).join("");
}

function buildCSV() {
  const rows = [[
    "Тип",
    "ФИО",
    "Класс",
    "Работа",
    "Вариант",
    "Слов",
    "Ответов по микротемам",
    "Баллы",
    "Макс",
    "Процент",
    "Оценка",
    "Верно",
    "Всего",
    "Пусто",
    "Дата",
    "Ключ S3"
  ]];

  reports.forEach((report) => {
    rows.push([
      report.type === "summary-trainer" ? "Изложение" : "Тест",
      safeStr(report.fio),
      safeStr(report.cls),
      safeStr(report.title),
      safeStr(report.variant),
      report.type === "summary-trainer" ? report.words : "",
      report.type === "summary-trainer" ? report.answerCount : "",
      report.type === "control" ? report.points : "",
      report.type === "control" ? report.maxPoints : "",
      report.type === "control" ? report.percent.toFixed(1) : "",
      report.type === "control" ? report.grade : "",
      report.type === "control" ? report.correct : "",
      report.type === "control" ? report.total : "",
      report.type === "control" ? report.empty : "",
      safeStr(report.createdAt),
      safeStr(report.key)
    ]);
  });

  return makeCSV(rows);
}

async function checkSelected() {
  const subject = $("subjectSelect").value || "russian";
  const selection = getSelectionState();

  if (!selection.keys.length) {
    status("Ничего не выбрано.");
    return;
  }

  if (selection.hasClassic && !keyObj) {
    status("Для тестовых работ сначала загрузите ключ.");
    return;
  }

  reports = [];
  status(selection.hasClassic ? `Проверка ${selection.keys.length} работ...` : `Открытие ${selection.keys.length} работ...`);

  for (const key of selection.keys) {
    const meta = getListMetaByKey(key) || { key };

    try {
      const result = await apiCall(subject, "/teacher/get", { key });

      if (isSummaryTrainerResult(result, meta)) {
        reports.push(buildSummaryTrainerReport(result, meta));
      } else {
        reports.push(buildControlReport(keyObj, result, meta));
      }
    } catch (error) {
      reports.push({
        type: isSummaryVariant(meta.variant) ? "summary-trainer" : "control",
        key,
        createdAt: meta.createdAt || "",
        variant: meta.variant || "",
        title: meta.variant || "Ошибка загрузки",
        fio: meta.fio || "",
        cls: meta.cls || "",
        words: 0,
        answerCount: 0,
        draft: `Не удалось загрузить работу: ${error.message}`,
        sourceText: "",
        answers: [],
        total: 0,
        correct: 0,
        empty: 0,
        points: 0,
        maxPoints: 0,
        percent: 0,
        grade: 2,
        items: []
      });
    }
  }

  reports.sort((left, right) => (
    safeStr(left.cls).localeCompare(safeStr(right.cls), "ru")
    || safeStr(left.fio).localeCompare(safeStr(right.fio), "ru")
  ));

  renderSummary();
  renderDetails();
  lastCSV = buildCSV();
  updateButtons();

  status(selection.hasClassic ? `Проверено работ: ${reports.length}` : `Открыто работ: ${reports.length}`);
}

function onCSV() {
  if (!lastCSV) return;
  const subject = $("subjectSelect").value || "subject";
  const datePart = new Date().toISOString().slice(0, 10);
  downloadText(lastCSV, `teacher_report_${subject}_${datePart}.csv`, "text/csv;charset=utf-8");
}

function clearCheck() {
  listItems = [];
  visibleItems = [];
  reports = [];
  lastCSV = null;

  $("variantFilter").value = "";
  $("classFilter").value = "";
  $("fioSearch").value = "";
  $("checkAll").checked = false;

  $("listWrap").innerHTML = "";
  $("summary").innerHTML = "";
  $("detailsWrap").innerHTML = "";

  updateButtons();
  status("Очищено.");
}

function getResetHistory() {
  try {
    return JSON.parse(localStorage.getItem(RESET_HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}

function setResetHistory(items) {
  localStorage.setItem(RESET_HISTORY_KEY, JSON.stringify(items.slice(0, 50)));
}

function renderResetHistory() {
  const history = getResetHistory();
  if (!history.length) {
    $("resetHistory").innerHTML = "<span class='sub'>Пока пусто.</span>";
    return;
  }

  $("resetHistory").innerHTML = history.map((entry) => {
    const created = safeStr(entry.createdAt).replace("T", " ").slice(0, 16);
    return `
      <div style="padding:8px 0;border-top:1px solid rgba(255,255,255,.08)">
        <b>${escapeHtml(entry.fio || "—")}</b> <span class="sub">${escapeHtml(entry.cls || "")}</span>
        <div class="sub">вариант: <b>${escapeHtml(entry.variant || "")}</b> • ${escapeHtml(entry.subject || "")} • ${escapeHtml(created)}</div>
        <div class="sub">код: <code>${escapeHtml(entry.code || "")}</code></div>
      </div>
    `;
  }).join("");
}

function controlLink(subject, variant, code) {
  return `${location.origin}${repoPrefixGuess()}/control/control.html?subject=${encodeURIComponent(subject)}&variant=${encodeURIComponent(variant)}&reset=${encodeURIComponent(code)}`;
}

let lastReset = null;

async function makeReset() {
  const subject = $("resetSubject").value || "russian";
  const variant = safeStr($("resetVariant").value).trim();
  const cls = safeStr($("resetClass").value).trim();
  const fio = safeStr($("resetFio").value).trim();

  if (!subject || !variant || !cls || !fio) {
    $("resetOut").innerHTML = "<span class='bad'>Заполните предмет, вариант, класс и ФИО.</span>";
    return;
  }

  $("resetOut").textContent = "Создание кода...";
  const result = await apiCall(subject, "/teacher/reset", { subject, variant, cls, fio });

  lastReset = {
    subject,
    variant,
    cls,
    fio,
    code: result.code,
    expiresAt: result.expiresAt,
    key: result.key,
    createdAt: new Date().toISOString()
  };

  const link = controlLink(subject, variant, result.code);

  $("resetOut").innerHTML = `
    <div class="pill">Код: <b>${escapeHtml(result.code)}</b></div>
    <div class="sub" style="margin-top:8px">Действует до: <b>${escapeHtml(result.expiresAt || "")}</b></div>
    <div class="sub" style="margin-top:6px">S3: <code>${escapeHtml(result.key || "")}</code></div>
    <div class="sub" style="margin-top:6px">Ссылка: <code>${escapeHtml(link)}</code></div>
  `;

  $("btnCopyReset").disabled = false;
  $("btnCopyResetLink").disabled = false;

  const history = getResetHistory();
  history.unshift(lastReset);
  setResetHistory(history);
  renderResetHistory();

  try {
    await navigator.clipboard.writeText(result.code);
  } catch {}
}

async function copyReset() {
  if (!lastReset?.code) return;
  try {
    await navigator.clipboard.writeText(lastReset.code);
  } catch {}
}

async function copyResetLink() {
  if (!lastReset?.code) return;
  try {
    await navigator.clipboard.writeText(controlLink(lastReset.subject, lastReset.variant, lastReset.code));
  } catch {}
}

function clearResetHistory() {
  if (!confirm("Очистить локальный журнал reset-кодов?")) return;
  localStorage.removeItem(RESET_HISTORY_KEY);
  renderResetHistory();
}

function setTab(name) {
  const showCheck = name === "check";
  $("tabCheck").setAttribute("aria-selected", showCheck ? "true" : "false");
  $("tabReset").setAttribute("aria-selected", showCheck ? "false" : "true");
  $("panelCheck").classList.toggle("hidden", !showCheck);
  $("panelReset").classList.toggle("hidden", showCheck);

  if (!showCheck) {
    $("resetSubject").value = $("subjectSelect").value || "russian";
  }
}

async function init() {
  applyTheme(localStorage.getItem("kd-theme") || "dark");
  $("themeToggle").addEventListener("change", (event) => applyTheme(event.target.checked ? "light" : "dark"));

  $("tabCheck").addEventListener("click", () => setTab("check"));
  $("tabReset").addEventListener("click", () => setTab("reset"));

  $("btnLoadKey").addEventListener("click", () => loadKey().catch((error) => status(`Ошибка ключа: ${error.message}`)));
  $("btnLoadList").addEventListener("click", () => loadList().catch((error) => status(`Ошибка списка: ${error.message}`)));
  $("btnCheckSelected").addEventListener("click", () => checkSelected().catch((error) => status(`Ошибка проверки: ${error.message}`)));
  $("btnCSV").addEventListener("click", onCSV);
  $("btnClearCheck").addEventListener("click", clearCheck);
  $("btnPrint").addEventListener("click", printReports);

  $("fioSearch").addEventListener("input", () => {
    visibleItems = applyFilters(listItems);
    renderList();
    $("checkAll").checked = false;
    updateButtons();
  });

  $("checkAll").addEventListener("change", (event) => {
    document.querySelectorAll(".pick").forEach((checkbox) => {
      checkbox.checked = event.target.checked;
    });
    updateButtons();
  });

  document.addEventListener("change", (event) => {
    if (event.target && event.target.classList.contains("pick")) {
      updateButtons();
    }
  });

  $("btnMakeReset").addEventListener("click", () => makeReset().catch((error) => {
    $("resetOut").innerHTML = `<span class='bad'>Ошибка: ${escapeHtml(error.message)}</span>`;
  }));
  $("btnCopyReset").addEventListener("click", copyReset);
  $("btnCopyResetLink").addEventListener("click", copyResetLink);
  $("btnResetHistoryClear").addEventListener("click", clearResetHistory);

  renderResetHistory();

  await ensurePinExists();
  $("btnPinEnter").addEventListener("click", () => pinEnter().catch(() => {}));
  $("btnPinReset").addEventListener("click", () => pinReset().catch(() => {}));
  $("pinInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") $("btnPinEnter").click();
  });
  $("pinInput").focus();

  setTab("check");
  updateButtons();
  status("Готово. Для тестов загрузите ключ, для изложений можно сразу открывать работы.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => init().catch(console.error));
} else {
  init().catch(console.error);
}
