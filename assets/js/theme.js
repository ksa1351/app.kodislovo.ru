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
