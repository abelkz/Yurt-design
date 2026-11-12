// One-time setup: open https://yurtdesign.art/api/tg-setup?key=<TG_WEBHOOK_SECRET> in a browser.
// Registers the webhook and checks that the bot is an admin of the channel. Never prints the bot token.

module.exports = async (req, res) => {
  const secret = process.env.TG_WEBHOOK_SECRET;
  if (!secret || req.query.key !== secret) return res.status(401).send("unauthorized");
  const missing = ["TG_BOT_TOKEN", "TG_WEBHOOK_SECRET", "GITHUB_TOKEN"].filter(k => !process.env[k]);
  const call = async (method, params) => {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/${method}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params || {})
    });
    return r.json();
  };
  const channel = "@" + (process.env.TG_CHANNEL || "remont_bez_skazok").replace(/^@/, "");
  const out = { missing_env: missing };
  try {
    const me = await call("getMe");
    out.bot = me.ok ? "@" + me.result.username : me.description;
    out.webhook = await call("setWebhook", {
      url: "https://yurtdesign.art/api/telegram",
      secret_token: secret,
      allowed_updates: ["channel_post", "edited_channel_post"],
      max_connections: 1
    });
    if (me.ok) {
      const m = await call("getChatMember", { chat_id: channel, user_id: me.result.id });
      out.channel = channel;
      out.bot_status_in_channel = m.ok ? m.result.status : m.description;
    }
    const gh = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPO || "abelkz/Yurt-design"}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "User-Agent": "yurt-blog-bot" }
    });
    const ghj = await gh.json();
    out.github_repo_access = gh.ok ? (ghj.permissions && ghj.permissions.push ? "push ok" : "read only — нужен доступ Contents: Read and write") : ghj.message;
  } catch (e) {
    out.error = e.message;
  }
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.status(200).send(JSON.stringify(out, null, 2));
};
