// Квиз «Рассчитать стоимость»: 4 вопроса → примерная сумма → телефон → заявка в Telegram Рената (/api/lead).
(function () {
  var WA = "77000632424";
  var SERVICES = {
    full: { name: "Полный дизайн-проект", price: 11000 },
    tech: { name: "Технический проект", price: 3000, old: 5000 },
    viz: { name: "3D-визуализация", price: 7000 },
    unsure: { name: "Пока не знаю — нужна консультация" }
  };
  var STEPS = [
    { key: "object", q: "Что проектируем?", opts: ["Квартира", "Частный дом", "Коммерческое помещение"] },
    { key: "area", q: "Какая площадь?", area: true },
    { key: "service", q: "Что нужно?", opts: [
      ["full", "Полный дизайн-проект", "планировка, стиль, 3D, все чертежи · 11 000 ₸/м²"],
      ["tech", "Технический проект", "чертежи для бригады без 3D · 5 000 ₸/м²"],
      ["viz", "3D-визуализация", "как будет выглядеть каждая комната · 7 000 ₸/м²"],
      ["unsure", "Пока не знаю", "подскажу, что подойдёт под ваш ремонт"]
    ] },
    { key: "when", q: "Когда планируете ремонт?", opts: ["Уже идёт", "В течение месяца", "Через 1–3 месяца", "Пока присматриваюсь"] }
  ];

  var root, body, bar, state, step, tick;
  var HOLD_MS = 10 * 3600 * 1000, KEY = "yurt_price_hold";
  // Бронь скидки: 10 часов с первого расчёта на этом устройстве. Обновление страницы её не перезапускает.
  function holdUntil() {
    var now = Date.now(), t = 0;
    try { t = +localStorage.getItem(KEY) || 0; } catch (e) {}
    if (!t || now - t > 7 * 24 * 3600 * 1000) { t = now + HOLD_MS; try { localStorage.setItem(KEY, t); } catch (e) {} }
    return t;
  }
  var pad = function (n) { return (n < 10 ? "0" : "") + n; };
  function left(t) { var d = Math.max(0, t - Date.now()), s = Math.floor(d / 1000); return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s / 60) % 60) + ":" + pad(s % 60); }
  function hasDiscount() { return state.service === "tech" || state.service === "unsure"; }
  function holdText() {
    if (!hasDiscount() || !state.hold || state.hold < Date.now()) return "";
    var d = new Date(state.hold);
    return "Бронь цены 3 000 ₸/м² до " + pad(d.getDate()) + "." + pad(d.getMonth() + 1) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  var fmt = function (n) { return Math.round(n).toLocaleString("ru-RU").replace(/ /g, " ") + " ₸"; };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };

  function estimate() {
    var a = state.area || 60;
    if (state.service === "unsure") {
      return { lines: [["Технический проект", a * 3000, a * 5000], ["Полный дизайн-проект", a * 11000]] };
    }
    var s = SERVICES[state.service];
    return { lines: [[s.name, a * s.price, s.old ? a * s.old : 0]] };
  }

  function summary() {
    var est = estimate();
    return [
      "Объект: " + state.object,
      "Площадь: " + state.area + " м²",
      "Услуга: " + SERVICES[state.service].name,
      "Ремонт: " + state.when,
      "Расчёт: " + est.lines.map(function (l) { return l[0] + " ≈ " + fmt(l[1]); }).join("; "),
      holdText()
    ].filter(Boolean);
  }

  function waLink(extra) {
    var t = "Здравствуйте! Посчитал стоимость на сайте.\n" + summary().join("\n") + (extra ? "\n" + extra : "");
    return "https://wa.me/" + WA + "?text=" + encodeURIComponent(t);
  }

  function track(name, params) { try { window.gtag && gtag("event", name, params || {}); } catch (e) {} }

  function render() {
    clearInterval(tick);
    bar.style.width = Math.min(100, (step / (STEPS.length + 1)) * 100 + 8) + "%";
    var back = step > 0 && step <= STEPS.length ? '<button type="button" class="qz-back" data-back>← Назад</button>' : "";
    if (step < STEPS.length) {
      var s = STEPS[step], h = '<p class="qz-step">Шаг ' + (step + 1) + " из " + STEPS.length + "</p><h3>" + s.q + "</h3>";
      if (s.area) {
        var v = state.area || 60;
        h += '<div class="qz-area"><input type="range" min="20" max="300" step="1" value="' + v + '" data-range aria-label="Площадь, м²">' +
          '<label class="qz-num"><input type="number" inputmode="numeric" min="10" max="2000" value="' + v + '" data-num aria-label="Площадь в м²"><span>м²</span></label></div>' +
          '<button type="button" class="btn btn-primary qz-next" data-next>Дальше</button>';
      } else {
        h += '<div class="qz-opts">' + s.opts.map(function (o) {
          var val = Array.isArray(o) ? o[0] : o, title = Array.isArray(o) ? o[1] : o, sub = Array.isArray(o) ? o[2] : "";
          var on = state[s.key] === val ? " on" : "";
          return '<button type="button" class="qz-opt' + on + '" data-val="' + esc(val) + '"><b>' + esc(title) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</button>";
        }).join("") + "</div>";
      }
      body.innerHTML = h + back;
      return;
    }
    if (step === STEPS.length) {
      var est = estimate();
      var rows = est.lines.map(function (l) {
        return '<div class="qz-sum"><span>' + esc(l[0]) + " · " + state.area + ' м²</span><b>≈ ' + fmt(l[1]) + (l[2] ? " <s>" + fmt(l[2]) + "</s>" : "") + "</b></div>";
      }).join("");
      var timer = "";
      if (hasDiscount()) {
        state.hold = holdUntil();
        if (state.hold > Date.now()) timer = '<div class="qz-timer"><span>Скидка 40 % на технический проект закреплена за вами ещё</span><b data-left>' + left(state.hold) + "</b></div>";
      }
      body.innerHTML = '<p class="qz-step">Ваш расчёт</p><h3>Предварительная стоимость</h3>' + rows + timer +
        '<p class="qz-note">Точную сумму и сроки назову после пары уточнений. Оставьте номер — перезвоню или напишу в WhatsApp в течение 15 минут (с 9:00 до 21:00).</p>' +
        '<form class="qz-form" novalidate>' +
        '<input name="name" autocomplete="name" placeholder="Как к вам обращаться" maxlength="60">' +
        '<input name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 7__ ___ __ __" required maxlength="20">' +
        '<input name="company" tabindex="-1" autocomplete="off" class="qz-hp" aria-hidden="true">' +
        '<p class="qz-err" hidden></p>' +
        '<button class="btn btn-primary" type="submit">Получить точный расчёт</button>' +
        '<p class="qz-small">Нажимая кнопку, вы соглашаетесь, что я свяжусь с вами по этому номеру. Без рассылок.</p>' +
        "</form>" + back;
      track("quiz_result", { service: state.service, area: state.area });
      if (timer) tick = setInterval(function () {
        var el = body.querySelector("[data-left]"); if (!el) return clearInterval(tick);
        el.textContent = left(state.hold);
        if (state.hold <= Date.now()) { clearInterval(tick); el.parentNode.remove(); }
      }, 1000);
      return;
    }
    body.innerHTML = '<div class="qz-done"><p class="qz-step">Заявка отправлена</p><h3>Спасибо' + (state.name ? ", " + esc(state.name) : "") + "!</h3>" +
      "<p>Свяжусь с вами в течение 15 минут в рабочее время. Если удобнее — напишите сразу, ответы квиза уже в сообщении:</p>" +
      '<a class="btn btn-wa" href="' + waLink() + '" target="_blank" rel="noopener">Написать в WhatsApp</a></div>';
  }

  function open(preset) {
    state = { area: 60 };
    step = 0;
    if (preset && SERVICES[preset]) state.service = preset;
    render();
    root.hidden = false;
    document.documentElement.classList.add("qz-lock");
    track("quiz_open", { preset: preset || "" });
    setTimeout(function () { var b = root.querySelector(".qz-opt, input"); b && b.focus(); }, 30);
  }
  function close() { clearInterval(tick); root.hidden = true; document.documentElement.classList.remove("qz-lock"); }

  function next() {
    // если услугу выбрали заранее (с кнопки на странице техпроекта) — шаг «что нужно» пропускаем
    step++;
    if (step < STEPS.length && STEPS[step].key === "service" && state.preset) step++;
    render();
  }

  function submit(form) {
    var err = form.querySelector(".qz-err");
    var phone = form.phone.value.trim(), digits = phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 12) { err.textContent = "Проверьте номер телефона"; err.hidden = false; form.phone.focus(); return; }
    state.name = form.name.value.trim();
    var btn = form.querySelector("button[type=submit]");
    btn.disabled = true; btn.textContent = "Отправляю…";
    fetch("/api/lead", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: state.name, phone: phone, company: form.company.value, lines: summary(), page: location.pathname, ref: document.referrer.slice(0, 200) })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      track("generate_lead", { method: "quiz", service: state.service, area: state.area });
      track("conversion", { send_to: "AW-18561818704/nrLmCKvd-LMdENDA-5JF" });
      step = STEPS.length + 1; render();
    }).catch(function () {
      err.innerHTML = 'Не получилось отправить. <a href="' + waLink("Мой номер: " + phone) + '" target="_blank" rel="noopener">Отправьте расчёт в WhatsApp</a> — отвечу так же быстро.';
      err.hidden = false; btn.disabled = false; btn.textContent = "Получить точный расчёт";
    });
  }

  function init() {
    root = document.getElementById("quiz");
    if (!root) return;
    body = root.querySelector(".qz-body");
    bar = root.querySelector(".qz-bar i");
    document.addEventListener("click", function (ev) {
      var t = ev.target.closest && ev.target.closest("[data-quiz]");
      if (t) { ev.preventDefault(); open(t.getAttribute("data-quiz")); if (state.service) state.preset = true; render(); }
    });
    root.addEventListener("click", function (ev) {
      if (ev.target === root || ev.target.closest("[data-close]")) return close();
      if (ev.target.closest("[data-back]")) { step--; if (STEPS[step] && STEPS[step].key === "service" && state.preset) step--; return render(); }
      var o = ev.target.closest(".qz-opt");
      if (o) { state[STEPS[step].key] = o.getAttribute("data-val"); return next(); }
      if (ev.target.closest("[data-next]")) {
        var n = parseInt(root.querySelector("[data-num]").value, 10);
        state.area = isFinite(n) && n >= 10 ? Math.min(n, 2000) : 60;
        return next();
      }
    });
    root.addEventListener("input", function (ev) {
      if (ev.target.matches("[data-range]")) root.querySelector("[data-num]").value = ev.target.value;
      if (ev.target.matches("[data-num]")) { var r = root.querySelector("[data-range]"); r.value = Math.min(300, ev.target.value || 0); }
    });
    root.addEventListener("submit", function (ev) { ev.preventDefault(); submit(ev.target); });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !root.hidden) close(); });
    if (location.hash === "#raschet") open();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
