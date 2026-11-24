// Просмотр проектов для клиента: yurtdesign.art/p/<id>.
// Страницы — картинки с водяным знаком (готовит браузер Рената на /proekt/zagruzka/), исходный PDF на сервер не попадает.
// Хранение: Vercel Blob (private). Вход на загрузку — код, который бот присылает владельцу в Telegram.
const crypto = require("crypto");
const { put, get, list, del } = require("@vercel/blob");

const ACCESS = process.env.PROOF_BLOB_ACCESS || "private";
const REPO = process.env.GITHUB_REPO || "abelkz/Yurt-design";
const SECRET = () => process.env.TG_WEBHOOK_SECRET || "";
const ID_RE = /^[a-z0-9]{8}$/;
const DAY = 86400000;

const hmac = s => crypto.createHmac("sha256", SECRET()).update(s).digest("hex");
const codeFor = slot => String(parseInt(hmac("code:" + slot).slice(0, 8), 16) % 1000000).padStart(6, "0");
const slotNow = () => Math.floor(Date.now() / 600000); // окно 10 минут
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

function tokenOk(t) {
  const [exp, sig] = String(t || "").split(".");
  return !!exp && !!sig && +exp > Date.now() && safeEq(sig, hmac("tok:" + exp));
}

let ownerCache = null;
async function ownerChat() {
  if (process.env.TG_LEAD_CHAT) return process.env.TG_LEAD_CHAT;
  if (ownerCache) return ownerCache;
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/data/owner.json?ref=main`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: "application/vnd.github.raw", "User-Agent": "yurt-blog-bot" }
  });
  if (!r.ok) return null;
  ownerCache = String(JSON.parse(await r.text()).chat_id || "") || null;
  return ownerCache;
}
async function tgOwner(text) {
  const chat = await ownerChat();
  if (!chat) throw new Error("owner chat not set");
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true })
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description);
}

const metaPath = id => `proofs/${id}/meta.json`;
const pagePath = (id, n) => `proofs/${id}/p${n}.jpg`;
const commentsPath = id => `proofs/${id}/comments.json`;

async function readBlob(pathname) {
  const res = await get(pathname, { access: ACCESS, useCache: false });
  if (!res) return null;
  return Buffer.from(await new Response(res.stream).arrayBuffer());
}
async function getMeta(id) {
  if (!ID_RE.test(id || "")) return null;
  try { const b = await readBlob(metaPath(id)); return b ? JSON.parse(b.toString("utf8")) : null; }
  catch (e) { if (/not.?found|404/i.test(e.message)) return null; throw e; }
}
const saveMeta = m => put(metaPath(m.id), JSON.stringify(m), {
  access: ACCESS, contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60
});
const state = m => !m ? "notfound" : m.disabled ? "disabled" : m.expires < Date.now() ? "expired" : !m.pages ? "uploading" : "ok";
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);
const fmtDate = t => { const d = new Date(t + 5 * 3600000).toISOString(); return d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4) + " " + d.slice(11, 16); };

async function publicView(req, res) {
  const id = String(req.query.id || "");
  const m = await getMeta(id);
  const st = state(m);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  if (req.query.page !== undefined) {
    const n = parseInt(req.query.page, 10);
    if (st !== "ok" || !(n >= 1 && n <= m.pages)) return res.status(404).send("not found");
    const buf = await readBlob(pagePath(id, n));
    if (!buf) return res.status(404).send("not found");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Content-Disposition", "inline");
    return res.status(200).send(buf);
  }
  if (st !== "ok") return res.status(st === "notfound" ? 404 : 410).json({ status: st });
  const now = Date.now();
  m.views = (m.views || 0) + 1;
  const notify = !m.lastOpen || now - m.lastOpen > 15 * 60000;
  m.lastOpen = now;
  await saveMeta(m).catch(e => console.error("meta:", e.message));
  if (notify && req.query.preview !== "1") {
    const who = m.kind === "example" ? "Кто-то открыл пример" : `${m.client || "Клиент"} открыл(а) проект`;
    await tgOwner(`👀 ${who} «${m.title || "проект"}» (${m.pages} стр.)\nПросмотров всего: ${m.views}\nhttps://yurtdesign.art/p/${m.id}`).catch(e => console.error("notify:", e.message));
  }
  let comments = [];
  if (m.commentsCount) { try { const c = await readBlob(commentsPath(m.id)); if (c) comments = JSON.parse(c.toString("utf8")); } catch (e) {} }
  return res.status(200).json({ status: "ok", kind: m.kind || "client", client: m.client, title: m.title, pages: m.pages, expires: m.expires, v: m.created,
    visible: m.visible || null, price: m.price || 0, payInfo: m.payInfo || "", approved: m.approved || 0, comments });
}

async function admin(req, res, b) {
  const a = b.action;
  if (a === "code") {
    await tgOwner(`🔐 Код для входа на страницу загрузки проектов: ${codeFor(slotNow())}\nДействует 10 минут. Если это не вы — просто проигнорируйте.`);
    return res.json({ ok: true });
  }
  if (a === "login") {
    const c = String(b.code || "").replace(/\D/g, "");
    if (c.length !== 6 || !(safeEq(c, codeFor(slotNow())) || safeEq(c, codeFor(slotNow() - 1)))) return res.status(401).json({ ok: false, error: "code" });
    const exp = Date.now() + 30 * DAY;
    return res.json({ ok: true, token: exp + "." + hmac("tok:" + exp) });
  }
  if (a === "approve" || a === "comment") {
    const m = await getMeta(b.id);
    if (state(m) !== "ok" || m.kind === "example") return res.status(410).json({ ok: false });
    if (a === "approve") {
      if (!m.approved) {
        m.approved = Date.now();
        await saveMeta(m);
        await tgOwner(`✅ ${m.client || "Клиент"} утвердил(а) проект «${m.title}» — ${fmtDate(m.approved)}\nhttps://yurtdesign.art/p/${m.id}`).catch(e => console.error("notify:", e.message));
      }
      return res.json({ ok: true, approved: m.approved });
    }
    const page = parseInt(b.page, 10), x = +b.x, y = +b.y, text = clean(b.text, 500);
    if (!(page >= 1 && page <= m.pages) || !(x >= 0 && x <= 1) || !(y >= 0 && y <= 1) || !text) return res.status(400).json({ ok: false });
    let list = [];
    if (m.commentsCount) { try { const c = await readBlob(commentsPath(m.id)); if (c) list = JSON.parse(c.toString("utf8")); } catch (e) {} }
    if (list.length >= 200) return res.status(429).json({ ok: false });
    const item = { n: list.length + 1, page, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000, text, at: Date.now() };
    list.push(item);
    await put(commentsPath(m.id), JSON.stringify(list), { access: ACCESS, contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
    m.commentsCount = list.length;
    await saveMeta(m);
    await tgOwner(`✏️ Правка №${item.n} от ${m.client || "клиента"} · лист ${page}\n«${text}»\n(точка: ${Math.round(x * 100)}% слева, ${Math.round(y * 100)}% сверху)\nhttps://yurtdesign.art/p/${m.id}#list-${page}`).catch(e => console.error("notify:", e.message));
    return res.json({ ok: true, comment: item });
  }
  if (!tokenOk(req.headers["x-proof-token"])) return res.status(401).json({ ok: false, error: "auth" });

  if (a === "create") {
    const id = crypto.randomBytes(8).toString("base64").replace(/[^a-z0-9]/gi, "").toLowerCase().padEnd(8, "x").slice(0, 8);
    const example = b.kind === "example";
    const days = example ? 3650 : Math.min(Math.max(parseInt(b.days, 10) || 7, 1), 90);
    const visible = Array.isArray(b.visible) ? b.visible.map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= 200).slice(0, 200) : null;
    const m = { id, kind: example ? "example" : "client", client: example ? "" : clean(b.client, 60), title: clean(b.title, 80), created: Date.now(), expires: Date.now() + days * DAY,
      pages: 0, disabled: false, views: 0, lastOpen: 0, visible: visible && visible.length ? visible : null,
      price: example ? 0 : Math.max(0, Math.min(parseInt(b.price, 10) || 0, 1e9)), payInfo: example ? "" : clean(String(b.payInfo || "").replace(/\n/g, " ¶ "), 400).replace(/ ¶ /g, "\n"),
      approved: 0, commentsCount: 0 };
    await saveMeta(m);
    return res.json({ ok: true, id });
  }
  if (a === "page") {
    const m = await getMeta(b.id);
    const n = parseInt(b.n, 10);
    if (!m || !(n >= 1 && n <= 200)) return res.status(400).json({ ok: false });
    const buf = Buffer.from(String(b.data || "").replace(/^data:image\/jpeg;base64,/, ""), "base64");
    if (buf.length < 100 || buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(400).json({ ok: false, error: "jpeg" });
    await put(pagePath(m.id, n), buf, { access: ACCESS, contentType: "image/jpeg", addRandomSuffix: false, allowOverwrite: true });
    return res.json({ ok: true });
  }
  if (a === "finish" || a === "update") {
    const m = await getMeta(b.id);
    if (!m) return res.status(404).json({ ok: false });
    if (a === "finish") m.pages = Math.min(parseInt(b.pages, 10) || 0, 200);
    if (b.disabled !== undefined) m.disabled = !!b.disabled;
    if (b.days) m.expires = Date.now() + Math.min(Math.max(parseInt(b.days, 10), 1), 90) * DAY;
    await saveMeta(m);
    return res.json({ ok: true, meta: m });
  }
  if (a === "delete") {
    if (!ID_RE.test(b.id || "")) return res.status(400).json({ ok: false });
    const { blobs } = await list({ prefix: `proofs/${b.id}/` });
    if (blobs.length) await del(blobs.map(x => x.url));
    return res.json({ ok: true });
  }
  if (a === "list") {
    const out = [];
    let cursor;
    do {
      const r = await list({ prefix: "proofs/", cursor });
      for (const x of r.blobs) if (x.pathname.endsWith("/meta.json")) out.push(x.pathname.split("/")[1]);
      cursor = r.hasMore ? r.cursor : undefined;
    } while (cursor);
    const metas = (await Promise.all(out.map(getMeta))).filter(Boolean)
      .map(m => ({ ...m, state: state(m), expiresText: fmtDate(m.expires), lastOpenText: m.lastOpen ? fmtDate(m.lastOpen) : "" }))
      .sort((x, y) => y.created - x.created);
    return res.json({ ok: true, items: metas });
  }
  return res.status(400).json({ ok: false, error: "action" });
}

module.exports = async (req, res) => {
  try {
    if (!SECRET()) return res.status(500).json({ ok: false, error: "secret not configured" });
    if (req.method === "GET") return await publicView(req, res);
    if (req.method !== "POST") return res.status(405).send("method");
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    return await admin(req, res, b);
  } catch (e) {
    console.error("proof:", e.message);
    const noStore = /BLOB_READ_WRITE_TOKEN|No token found|store/i.test(e.message);
    return res.status(500).json({ ok: false, error: noStore ? "storage" : "server" });
  }
};
