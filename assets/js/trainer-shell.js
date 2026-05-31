(function () {
  "use strict";

  function initStepper() {
    const stepper = document.querySelector(".trainer-stepper");
    if (!stepper) return;

    const links = Array.from(stepper.querySelectorAll('a[href^="#"]'));
    if (!links.length) return;

    const sections = links
      .map((link) => {
        const id = link.getAttribute("href").slice(1);
        const el = document.getElementById(id);
        return el ? { link, el } : null;
      })
      .filter(Boolean);

    if (!sections.length) return;

    function setActive(targetId) {
      links.forEach((link) => {
        const isActive = link.getAttribute("href") === `#${targetId}`;
        link.classList.toggle("is-active", isActive);
        if (isActive) link.setAttribute("aria-current", "step");
        else link.removeAttribute("aria-current");
      });
    }

    links.forEach((link) => {
      link.addEventListener("click", (event) => {
        const id = link.getAttribute("href").slice(1);
        const section = document.getElementById(id);
        if (!section) return;
        event.preventDefault();
        section.scrollIntoView({ behavior: "smooth", block: "start" });
        setActive(id);
      });
    });

    if (!("IntersectionObserver" in window)) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible?.target?.id) setActive(visible.target.id);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0.12, 0.35, 0.6] }
    );

    sections.forEach(({ el }) => observer.observe(el));
  }

  document.addEventListener("DOMContentLoaded", initStepper);
})();
