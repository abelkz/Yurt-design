// Обратный отсчёт до конца акции на технический проект (дата — в data-deadline, задаётся в build.py).
(function () {
  var els = document.querySelectorAll("[data-deadline]");
  if (!els.length) return;
  var end = Date.parse(els[0].getAttribute("data-deadline"));
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  var flt = document.querySelector(".promo-float");
  function tick() {
    var s = Math.floor((end - Date.now()) / 1000);
    if (!(s > 0)) { els.forEach(function (e) { e.remove(); }); clearInterval(t); return; }
    var d = Math.floor(s / 86400), txt = (d ? d + " д " : "") + pad(Math.floor(s / 3600) % 24) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60);
    document.querySelectorAll("[data-cd]").forEach(function (e) { e.textContent = txt; });
    els.forEach(function (e) { e.classList.add("ready"); });
  }
  var t = setInterval(tick, 1000); tick();
  if (flt) { var u = function () { flt.classList.toggle("show", scrollY > 560); }; addEventListener("scroll", u, { passive: true }); u(); }
})();
