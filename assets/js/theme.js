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
      card.innerHTML = '<div class="card-head"><span class="chip">5А · 5Б · 9В · 11А</span><span class="status live">Доступно</span></div><h3>Задания</h3><p>Выбери свой класс, выполни работу и отправь ответы учителю.</p>';
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
