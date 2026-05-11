(function () {
  const sections = {
    "grade-7": {
      title: "7 класс",
      lead: "Базовые понятия информатики: информация, данные, кодирование и первые алгоритмы.",
      items: ["Информация и информационные процессы", "Единицы измерения информации", "Кодирование текста и чисел", "Линейные алгоритмы"]
    },
    "grade-8": {
      title: "8 класс",
      lead: "Логика, исполнители, ветвления, циклы и работа с простыми моделями.",
      items: ["Логические операции И, ИЛИ, НЕ", "Истинность выражений", "Исполнители и команды", "Ветвления и циклы"]
    },
    "grade-9": {
      title: "9 класс",
      lead: "Повторение курса основной школы и подготовка к заданиям ОГЭ.",
      items: ["Системы счисления", "Анализ алгоритмов", "Таблицы и базы данных", "Графы и кратчайшие пути"]
    },
    vpr: {
      title: "ВПР",
      lead: "Тренировка типовых заданий ВПР по информатике.",
      items: ["Кодирование информации", "Логические рассуждения", "Алгоритмы и исполнители", "Табличные данные"]
    },
    oge: {
      title: "ОГЭ",
      lead: "Подготовка к ОГЭ по информатике: теория, практика и типовые задачи.",
      items: ["Задание 1. Количественные параметры информационных объектов", "Задания с кратким ответом", "Логика и системы счисления", "Алгоритмы и программы", "Практические задания ОГЭ"],
      links: [
        {
          title: "Открыть тренажер задания 1",
          href: "./oge_task1.html"
        }
      ]
    }
  };

  const params = new URLSearchParams(location.search);
  const key = params.get("section") || "grade-7";
  const section = sections[key] || sections["grade-7"];

  document.title = `${section.title} — Информатика`;
  document.getElementById("sectionTitle").textContent = section.title;
  document.getElementById("sectionLead").textContent = section.lead;

  const list = document.getElementById("sectionItems");
  list.innerHTML = "";
  section.items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });

  const links = document.getElementById("sectionLinks");
  links.innerHTML = "";
  (section.links || []).forEach((link) => {
    const a = document.createElement("a");
    a.className = "kd-button";
    a.href = link.href;
    a.textContent = link.title;
    links.appendChild(a);
  });
}());
