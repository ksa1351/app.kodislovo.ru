(function () {
  const sections = {
    "grade-5": {
      title: "5 класс",
      lead: "Базовая орфография, части речи, словарная работа и первые синтаксические темы.",
      items: ["Безударные гласные в корне", "Проверяемые согласные", "Имя существительное", "Простое предложение"],
      status: "soon"
    },
    "grade-6": {
      title: "6 класс",
      lead: "Морфология, словообразование и правописание самостоятельных частей речи.",
      items: ["Морфемика", "Словообразование", "Имя прилагательное", "Глагол"],
      status: "soon"
    },
    "grade-7": {
      title: "7 класс",
      lead: "Причастия, деепричастия, наречия, служебные части речи и пунктуация.",
      items: ["Причастный оборот", "Деепричастный оборот", "Наречие", "Предлоги, союзы, частицы"],
      status: "soon"
    },
    "grade-8": {
      title: "8 класс",
      lead: "Синтаксис простого предложения и повторение пунктуации.",
      items: ["Двусоставное предложение", "Односоставное предложение", "Однородные члены", "Обособленные члены предложения"],
      status: "soon"
    },
    "grade-9": {
      title: "9 класс",
      lead: "Повторение курса основной школы и подготовка к ОГЭ.",
      items: ["Сложное предложение", "Пунктуационный анализ", "Изложение", "Сочинение ОГЭ"],
      status: "soon"
    },
    "grade-10": {
      title: "10 класс",
      lead: "Системное повторение орфографии, пунктуации и культуры речи.",
      items: ["Орфографические нормы", "Пунктуационные нормы", "Лексические нормы", "Работа с текстом"],
      status: "soon"
    },
    "grade-11": {
      title: "11 класс",
      lead: "Итоговое повторение и подготовка к заданиям ЕГЭ.",
      items: ["Задания ЕГЭ 1-8", "Задания ЕГЭ 9-15", "Задания ЕГЭ 16-26", "Сочинение ЕГЭ"],
      status: "soon"
    },
    vpr: {
      title: "ВПР",
      lead: "Тренировка типовых заданий ВПР по русскому языку.",
      items: ["Орфография", "Пунктуация", "Грамматические признаки", "Работа с текстом"],
      status: "soon"
    },
    oge: {
      title: "ОГЭ",
      lead: "Подготовка к заданиям ОГЭ: тестовая часть, изложение и сочинение.",
      items: ["Изложение", "Тестовые задания", "Сочинение 9.1-9.3", "Языковой анализ"],
      status: "partial",
      callout: "Сейчас доступен тренажер сжатого изложения и контрольные. Тестовая часть и сочинение готовятся."
    },
    ege: {
      title: "ЕГЭ",
      lead: "Подготовка к ЕГЭ по русскому языку.",
      items: ["Задания 1-26", "Проблема текста", "Комментарий", "Аргументация и сочинение"],
      status: "soon"
    }
  };

  const params = new URLSearchParams(location.search);
  const key = params.get("section") || "grade-5";
  const section = sections[key] || sections["grade-5"];

  document.title = `${section.title} — Русский язык`;
  document.getElementById("sectionTitle").textContent = section.title;
  document.getElementById("sectionLead").textContent = section.lead;

  const sectionPrimaryLink = document.getElementById("sectionPrimaryLink");
  const summaryTrainerLink = document.getElementById("summaryTrainerLink");
  const readingTrainerLink = document.getElementById("readingTrainerLink");
  const sectionCallout = document.getElementById("sectionCallout");
  const sectionCalloutText = document.getElementById("sectionCalloutText");

  const list = document.getElementById("sectionItems");
  list.innerHTML = "";
  section.items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    list.appendChild(li);
  });

  const isSoon = section.status === "soon";
  const isPartial = section.status === "partial";

  if (isSoon || isPartial) {
    sectionCallout.hidden = false;
    sectionCalloutText.textContent = section.callout || "Интерактивные задания для этого раздела пока готовятся. Ниже — план тем, которые появятся позже.";
  }

  if (isSoon) {
    sectionPrimaryLink.hidden = true;
  } else if (key === "oge") {
    sectionPrimaryLink.textContent = "Открыть контрольную ОГЭ";
    summaryTrainerLink.hidden = false;
    readingTrainerLink.hidden = false;
  } else {
    sectionPrimaryLink.textContent = "Открыть контрольную";
  }
}());
