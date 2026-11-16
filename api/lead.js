// Заявка из квиза → сообщение Ренату в Telegram (через того же бота, что ведёт блог).
// Куда слать: env TG_LEAD_CHAT, иначе chat id из data/owner.json (его записывает бот, когда владелец жмёт /start).
const REPO = process.env.GITHUB_REPO || "abelkz/Yurt-design";
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

const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, n);

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("POST only");
  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (b.company) return res.status(200).json({ ok: true }); // скрытое поле: так заполняют только боты
  const phone = clean(b.phone, 20), digits = phone.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 12) return res.status(400).json({ ok: false, error: "phone" });
  const lines = (Array.isArray(b.lines) ? b.lines : []).slice(0, 8).map(l => clean(l, 200));
  const name = clean(b.name, 60);
  let wa = digits;
  if (wa.length === 11 && wa[0] === "8") wa = "7" + wa.slice(1);
  if (wa.length === 10) wa = "7" + wa;

  const text = [
    "🔥 Заявка с сайта — квиз",
    "",
    `Имя: ${name || "—"}`,
    `Телефон: +${wa}`,
    "",
    ...lines,
    "",
    `Страница: ${clean(b.page, 120) || "/"}`,
    b.ref ? `Откуда: ${clean(b.ref, 160)}` : "",
    "",
    `WhatsApp: https://wa.me/${wa}`
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");

  try {
    const chat = await ownerChat();
    if (!chat) throw new Error("owner chat not set — нажмите /start в боте");
    const r = await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text, disable_web_page_preview: true })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.description);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("lead:", e.message, "|", text.replace(/\n/g, " / "));
    return res.status(502).json({ ok: false });
  }
};
