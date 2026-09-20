(function () {
  function revealHash() {
    const id = location.hash.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (!target) return;
    const day = target.closest('.assignment-day');
    if (!day) return;
    document.querySelectorAll('.assignment-day').forEach(function (item) {
      item.open = item === day;
    });
    requestAnimationFrame(function () {
      target.scrollIntoView({ block: 'start' });
    });
  }

  window.addEventListener('hashchange', revealHash);
  document.querySelectorAll('.kd-subnav a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function () {
      // Reopen the day even when the user clicks the current class again.
      if (link.hash === location.hash) revealHash();
    });
  });
  revealHash();
}());
