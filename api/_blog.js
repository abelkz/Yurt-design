// Rendering helpers for the Telegram channel -> yurtdesign.art/blog/ pipeline.
// Shared by api/telegram.js (runs on Vercel) and scripts/blog-local.js (local preview).

const SITE = "https://yurtdesign.art";
const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const EXCLUDE_TAG = /#безсайта/i;

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const TR = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya", ә: "a", ғ: "g", қ: "k", ң: "n", ө: "o", ұ: "u", ү: "u", һ: "h", і: "i" };

function slugify(title, id) {
  const base = String(title || "").toLowerCase().split("").map(c => (TR[c] !== undefined ? TR[c] : c)).join("")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
  return (base || "post") + "-" + id;
}

function dateRu(unix) {
  const d = new Date((unix + 5 * 3600) * 1000); // Astana, UTC+5
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function isoDate(unix) {
  return new Date(unix * 1000).toISOString();
}

// Telegram text + entities (UTF-16 offsets, same as JS strings) -> safe inline HTML.
function entitiesToHtml(text, entities) {
  text = text || "";
  const opens = {}, closes = {};
  for (const en of entities || []) {
    let o = null, c = null;
    if (en.type === "bold") { o = "<b>"; c = "</b>"; }
    else if (en.type === "italic") { o = "<i>"; c = "</i>"; }
    else if (en.type === "underline") { o = "<u>"; c = "</u>"; }
    else if (en.type === "strikethrough") { o = "<s>"; c = "</s>"; }
    else if (en.type === "code") { o = "<code>"; c = "</code>"; }
    else if (en.type === "text_link" && /^https?:\/\//.test(en.url || "")) {
      o = `<a href="${esc(en.url)}" rel="nofollow noopener" target="_blank">`; c = "</a>";
    } else if (en.type === "url") {
      const u = text.substr(en.offset, en.length);
      const href = /^https?:\/\//.test(u) ? u : "https://" + u;
      o = `<a href="${esc(href)}" rel="nofollow noopener" target="_blank">`; c = "</a>";
    }
    if (!o) continue;
    (opens[en.offset] = opens[en.offset] || []).push(o);
    (closes[en.offset + en.length] = closes[en.offset + en.length] || []).unshift(c);
  }
  let out = "";
  for (let i = 0; i <= text.length; i++) {
    if (closes[i]) out += closes[i].join("");
    if (opens[i]) out += opens[i].join("");
    if (i < text.length) out += esc(text[i]);
  }
  return out;
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

// Split a post into title / body paragraphs. Title = first line (or first sentence if the line is long).
function parsePost(text, entities) {
  const html = entitiesToHtml(text, entities);
  const lines = html.split("\n");
  let first = "", i = 0;
  while (i < lines.length && !stripTags(lines[i]).trim()) i++;
  first = lines[i] || ""; i++;
  let title = stripTags(first).replace(/#[\p{L}\p{N}_]+/gu, "").replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/\s+/g, " ").trim();
  let rest = lines.slice(i).join("\n");
  if (title.length > 110) {
    const m = title.match(/^(.{20,100}?[.!?])\s/);
    title = m ? m[1] : title.slice(0, 90).replace(/\s+\S*$/, "") + "…";
    rest = first + "\n" + rest; // keep the full first paragraph in the body
  }
  const paragraphs = rest.replace(/(^|\s)#[\p{L}\p{N}_]+/gu, "$1").split(/\n\s*\n/).map(p => p.trim()).filter(p => stripTags(p).trim());
  const bodyHtml = paragraphs.map(p => "<p>" + p.replace(/\n/g, "<br>") + "</p>").join("\n");
  const plain = stripTags(paragraphs.join(" ")).replace(/\s+/g, " ").trim();
  return { title: title || "Заметка дизайнера", bodyHtml, plain };
}

function fill(layout, map) {
  return layout.replace(/@@([A-Z]+)@@/g, (m, k) => (map[k] !== undefined ? map[k] : m));
}

function photoTags(post, from = 0, to) {
  return (post.photos || []).slice(from, to).map((p, i) => [p, i + from]).map(([p, n]) =>
    `<figure class="post-fig"><img src="/${p.path}" width="${p.w || 1280}" height="${p.h || 960}" alt="${esc(post.title)}${n ? " — фото " + (n + 1) : ""}" loading="${n ? "lazy" : "eager"}"></figure>`
  ).join("\n");
}

function renderPost(layout, post, posts) {
  const path = `/blog/${post.slug}/`;
  const desc = (post.plain || post.title).slice(0, 155);
  const cover = post.photos && post.photos[0] ? `${SITE}/${post.photos[0].path}` : `${SITE}/img/og-cover.jpg`;
  const ld = {
    "@context": "https://schema.org", "@type": "BlogPosting", headline: post.title.slice(0, 110), description: desc,
    datePublished: isoDate(post.date), dateModified: isoDate(post.edited || post.date), inLanguage: "ru",
    url: SITE + path, mainEntityOfPage: SITE + path, image: cover,
    author: { "@id": SITE + "/#renat" }, publisher: { "@id": SITE + "/#studio" }
  };
  const others = posts.filter(p => p.slug !== post.slug && !p.hidden).slice(0, 4)
    .map(p => `<a href="/blog/${p.slug}/"><b>${esc(p.title)}</b><span>${dateRu(p.date)}</span></a>`).join("");
  const content = `<article>
<section class="page-hero">
  <div class="wrap">
    <nav class="crumbs" aria-label="Навигация"><a href="/">Главная</a> / <a href="/blog/">Блог</a></nav>
    <p class="eyebrow">Блог · ${dateRu(post.date)}</p>
    <h1 class="post-title">${esc(post.title)}</h1>
    <p class="lead">Ренат Абельдинов, дизайнер интерьера, YURT Design Studio · из канала <a href="https://t.me/${esc(post.channel || "remont_bez_skazok")}" rel="noopener" target="_blank">«Ремонт без сказок»</a></p>
  </div>
</section>
<section style="padding-top:0">
  <div class="wrap"><div class="art post">
${photoTags(post, 0, 1)}
${post.bodyHtml}
${photoTags(post, 1)}
  </div></div>
</section>
<script type="application/ld+json">${JSON.stringify(ld)}</script>
</article>
${others ? `<section style="padding-top:0"><div class="wrap"><div class="sec-head"><p class="eyebrow">Ещё в блоге</p><h2>Читать дальше</h2></div><div class="related">${others}</div></div></section>` : ""}`;
  const t = post.title.length > 52 ? post.title.slice(0, 52).replace(/\s+\S*$/, "") + "…" : post.title;
  return fill(layout, { TITLE: esc(t + " | Блог YURT"), DESC: esc(desc), PATH: path, OG: cover, OGTYPE: "article", CONTENT: content });
}

function renderIndex(layout, posts) {
  const vis = posts.filter(p => !p.hidden);
  const cards = vis.map(p => {
    const img = p.photos && p.photos[0] ? `<img src="/${p.photos[0].path}" alt="${esc(p.title)}" loading="lazy" width="${p.photos[0].w || 1280}" height="${p.photos[0].h || 960}">` : `<div class="blog-noimg">YURT</div>`;
    return `<a class="blog-card" href="/blog/${p.slug}/">${img}<span class="blog-date">${dateRu(p.date)}</span><b>${esc(p.title)}</b><span class="blog-ex">${esc((p.plain || "").slice(0, 140))}${(p.plain || "").length > 140 ? "…" : ""}</span></a>`;
  }).join("\n");
  const content = `<section class="page-hero">
  <div class="wrap">
    <nav class="crumbs" aria-label="Навигация"><a href="/">Главная</a> / Блог</nav>
    <p class="eyebrow">Блог дизайнера</p>
    <h1>Ремонт и дизайн <em>без сказок</em></h1>
    <p class="lead">Заметки Рената Абельдинова: объекты в работе, цены, ошибки ремонта и новости студии YURT Design в Астане. Подписывайтесь на канал <a href="https://t.me/remont_bez_skazok" rel="noopener" target="_blank">«Ремонт без сказок»</a>.</p>
  </div>
</section>
<section style="padding-top:0"><div class="wrap">${vis.length ? `<div class="blog-grid">${cards}</div>` : `<p class="lead">Первые записи появятся совсем скоро.</p>`}</div></section>`;
  return fill(layout, {
    TITLE: "Блог дизайнера интерьера в Астане | YURT",
    DESC: "Блог Рената Абельдинова, YURT Design Studio: объекты в работе, цены на дизайн и ремонт в Астане, советы и новости студии.",
    PATH: "/blog/", OG: `${SITE}/img/og-cover.jpg`, OGTYPE: "website", CONTENT: content
  });
}

function renderSitemap(posts) {
  const rows = [`  <url><loc>${SITE}/blog/</loc><changefreq>weekly</changefreq><priority>0.6</priority></url>`]
    .concat(posts.filter(p => !p.hidden).map(p =>
      `  <url><loc>${SITE}/blog/${p.slug}/</loc><lastmod>${isoDate(p.edited || p.date).slice(0, 10)}</lastmod><priority>0.6</priority></url>`));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

module.exports = { SITE, EXCLUDE_TAG, esc, slugify, dateRu, entitiesToHtml, parsePost, renderPost, renderIndex, renderSitemap };
