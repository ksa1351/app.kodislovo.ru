"use strict";

(() => {
  const grid = document.getElementById("publishedControls");
  if (!grid) return;

  const subjectLabels = {
    russian: "Русский язык",
    literature: "Литература",
    informatics: "Информатика",
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function plural(value, forms) {
    const number = Math.abs(Number(value) || 0) % 100;
    const last = number % 10;
    if (number > 10 && number < 20) return forms[2];
    if (last === 1) return forms[0];
    if (last > 1 && last < 5) return forms[1];
    return forms[2];
  }

  function dueLabel(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return `до ${new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date)}`;
  }

  function renderCard(item) {
    const id = String(item?.id || "").trim();
    if (!id) return null;

    const link = element("a", "kd-card kd-card-live kd-card-control");
    const target = new URL("./control.html", window.location.href);
    target.searchParams.set("assignment", id);
    link.href = target.toString();

    const head = element("div", "kd-card-head");
    const subject = subjectLabels[String(item.subject || "").toLowerCase()] || item.subject || "Контрольная";
    const format = String(item.examFormat || "").toUpperCase();
    head.append(
      element("span", "kd-kicker", format ? `${subject} · ${format}` : subject),
      element("span", "kd-status kd-status-live", "Доступно")
    );

    const details = [];
    const textCount = Number(item.textCount || 0);
    const taskCount = Number(item.taskCount || 0);
    const minutes = Number(item.timeLimitMinutes || 0);
    if (item.class) details.push(`класс: ${item.class}`);
    if (textCount > 0) details.push(`${textCount} ${plural(textCount, ["текст", "текста", "текстов"])}`);
    if (taskCount > 0) details.push(`${taskCount} ${plural(taskCount, ["задание", "задания", "заданий"])}`);
    if (minutes > 0) details.push(`${minutes} мин`);
    const due = dueLabel(item.dueAt);
    if (due) details.push(due);

    link.append(
      head,
      element("strong", "", item.title || "Контрольная работа"),
      element("small", "", details.join(" · ") || "Откройте работу, чтобы приступить к выполнению.")
    );
    return link;
  }

  function renderMessage(title, message, retry = false) {
    grid.replaceChildren();
    const panel = element("div", "kd-panel");
    panel.append(element("strong", "", title));
    if (message) panel.append(element("p", "", message));
    if (retry) {
      const button = element("button", "kd-button", "Обновить список");
      button.type = "button";
      button.addEventListener("click", load);
      panel.append(button);
    }
    grid.append(panel);
    grid.setAttribute("aria-busy", "false");
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function load() {
    grid.setAttribute("aria-busy", "true");
    renderMessage("Загружаем опубликованные работы…", "");
    grid.setAttribute("aria-busy", "true");
    try {
      const configUrl = new URL("../assets/config/public-api.json", window.location.href);
      const config = await fetchJson(configUrl);
      const apiBase = String(config?.baseUrl || "").replace(/\/+$/, "");
      if (!apiBase.startsWith("https://")) throw new Error("API не настроен");
      const catalog = await fetchJson(`${apiBase}/api/public/assignments`);
      const cards = (Array.isArray(catalog?.items) ? catalog.items : [])
        .map(renderCard)
        .filter(Boolean);
      if (!cards.length) {
        renderMessage("Сейчас нет опубликованных работ", "Новые контрольные появятся здесь после публикации учителем.");
        return;
      }
      grid.replaceChildren(...cards);
      grid.setAttribute("aria-busy", "false");
    } catch (error) {
      console.error("published controls catalog", error);
      renderMessage(
        "Не удалось загрузить контрольные",
        "Проверьте подключение к интернету и попробуйте ещё раз.",
        true
      );
    }
  }

  load();
})();
