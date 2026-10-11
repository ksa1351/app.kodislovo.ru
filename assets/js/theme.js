// Keep the published Tilda navigation in sync with the assignments catalog.
(function(){
  if (!["xn--b1admghpdbx.xn--p1ai", "www.xn--b1admghpdbx.xn--p1ai"].includes(location.hostname)) return;
  const url = "https://ksa1351.github.io/app.kodislovo.ru/assignments/";
  function addAssignments(){
    const nav = document.querySelector(".subnav");
    if (nav && !nav.querySelector('a[href="' + url + '"]')) {
      const link = document.createElement("a");
      link.href = url;
      link.textContent = "Задания";
      nav.prepend(link);
    }
    if (!["/", "/index.html"].includes(location.pathname)) return;
    const cards = document.querySelector(".cards");
    if (cards && !cards.querySelector('a[href="' + url + '"]')) {
      const card = document.createElement("a");
      card.className = "card live card-russian";
      card.href = url;
      card.innerHTML = '<div class="card-head"><span class="chip">5А · 5Б · 7Б · 9В · 11А</span><span class="status live">Доступно</span></div><h3>Задания</h3><p>Выбери свой класс, дату и открой нужное задание.</p>';
      cards.prepend(card);
    }
    const gerundsUrl = "https://ksa1351.github.io/app.kodislovo.ru/trainers/russian/gerund-phrases/";
    if (cards && !cards.querySelector('a[href="' + gerundsUrl + '"]')) {
      const card = document.createElement("a");card.className = "card live card-russian";card.href = gerundsUrl;
      card.innerHTML = '<div class="card-head"><span class="chip">Русский язык · 11 класс</span><span class="status live">Доступно</span></div><h3>Деепричастные обороты</h3><p>«Лес и степь»: исполнитель и связь действий, редактура и собственный рассказ.</p>';
      cards.prepend(card);
    }
    const participlesUrl = "https://ksa1351.github.io/app.kodislovo.ru/trainers/russian/participial-phrases/";
    if (cards && !cards.querySelector('a[href="' + participlesUrl + '"]')) {
      const card = document.createElement("a");
      card.className = "card live card-russian";
      card.href = participlesUrl;
      card.innerHTML = '<div class="card-head"><span class="chip">Русский язык · 11 класс</span><span class="status live">Доступно</span></div><h3>Причастные обороты</h3><p>«Лес и степь»: разметка текста, вопросы, формы причастий и редактирование предложений.</p>';
      cards.prepend(card);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addAssignments, {once:true});
  else addAssignments();
}());

(function(){
  const key = "kodislovo_theme";
  const root = document.documentElement;
  const saved = localStorage.getItem(key);
  const initial = saved || root.getAttribute("data-theme") || "dark";

  function apply(theme){
    root.setAttribute("data-theme", theme);
    localStorage.setItem(key, theme);
    document.querySelectorAll("#themeToggle,[data-theme-toggle]").forEach(function(toggle){
      if ("checked" in toggle) toggle.checked = theme === "light";
    });
  }

  apply(initial);

  document.querySelectorAll("#themeToggle,[data-theme-toggle]").forEach(function(toggle){
    toggle.addEventListener("change", function(){
      apply(toggle.checked ? "light" : "dark");
    });
  });
}());
