"use strict";

/* ========= CONFIG ========= */
const API_BASE = "https://d5d17sjh01l20fnemocv.3zvepvee.apigw.yandexcloud.net";
const TEACHER_TOKEN = "42095b52-9d18-423d-a8c2-bfa56e5cd03b1b9d15ca-bbba-49f9-a545-f545b3e16c1f"; // ← ВСТАВЬ ТОКЕН или подгрузи из manifest/config

/* ========= HELPERS ========= */
const $ = id => document.getElementById(id);
const status = msg => $("statusLine").textContent = msg;

async function api(path, body) {
  const res = await fetch(API_BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Teacher-Token": TEACHER_TOKEN
    },
    body: JSON.stringify(body || {})
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "API error");
  return data;
}

/* ========= THEME ========= */
const themeToggle = $("themeToggle");
const themeLabel = $("themeLabel");

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  themeToggle.checked = (t === "light");
  themeLabel.textContent = t === "light" ? "Светлая" : "Тёмная";
  localStorage.setItem("kd-theme", t);
}

applyTheme(localStorage.getItem("kd-theme") || "dark");

themeToggle.addEventListener("change", () => {
  applyTheme(themeToggle.checked ? "light" : "dark");
});

/* ========= LIST ========= */
async function loadList() {
  status("Загрузка списка…");

  const variant = $("variantFilter").value.replace(/^variant_/, "");
  const cls = $("classFilter").value;

  const data = await api("/teacher/list", {
    variant,
    cls,
    limit: 100
  });

  const tbody = $("resultsTbody");
  tbody.innerHTML = "";

  for (const it of data.items) {
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><input type="checkbox" data-key="${it.key}"></td>
      <td>${it.fio}<br><span style="color:var(--muted)">${it.cls}</span></td>
      <td>${it.variant}</td>
      <td>${(it.createdAt || "").replace("T", " ").slice(0,16)}</td>
      <td style="font-size:12px">${it.key}</td>
      <td>
        <button class="kd-btn secondary" data-get="${it.key}">JSON</button>
      </td>
    `;

    tbody.appendChild(tr);
  }

  status(`Загружено: ${data.items.length}`);
}

$("btnList").onclick = () => loadList();

/* ========= GET ========= */
$("resultsTbody").onclick = async e => {
  const btn = e.target.closest("button[data-get]");
  if (!btn) return;

  const key = btn.dataset.get;
  const data = await api("/teacher/get", { key });
  $("jsonViewer").value = JSON.stringify(data, null, 2);
};

/* ========= RESET ========= */
$("btnResetMake").onclick = async () => {
  status("Создание reset-кода…");

  const subject = $("subjectSelect").value;
  const variant = $("resetVariant").value.replace(/^variant_/, "");
  const cls = $("resetClass").value;
  const fio = $("resetFio").value;

  const r = await api("/teacher/reset", {
    subject,
    variant,
    cls,
    fio
  });

  navigator.clipboard.writeText(r.code);
  status(`Reset-код: ${r.code} (скопирован)`);
};

/* ========= TIMER ========= */
$("btnTimerLoad").onclick = async () => {
  status("Загрузка таймера…");
  const r = await api("/teacher/config/get", {
    subject: $("subjectSelect").value
  });
  $("timerMinutes").value = r.time_limit_minutes || 0;
  status("Таймер загружен");
};

$("btnTimerSave").onclick = async () => {
  status("Сохранение таймера…");
  await api("/teacher/config/set", {
    subject: $("subjectSelect").value,
    time_limit_minutes: Number($("timerMinutes").value || 0)
  });
  status("Таймер сохранён");
};
