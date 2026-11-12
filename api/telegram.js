// Telegram webhook: posts from the channel «Ремонт без сказок» become pages on yurtdesign.art/blog/.
// Flow: Telegram -> this function -> commit to GitHub (main) -> Vercel redeploys the static site.
// Env: TG_BOT_TOKEN, TG_WEBHOOK_SECRET, TG_CHANNEL (username without @), GITHUB_TOKEN, GITHUB_REPO (owner/name).

const B = require("./_blog.js");

const REPO = process.env.GITHUB_REPO || "abelkz/Yurt-design";
const BRANCH = process.env.GITHUB_BRANCH || "main";
const GH = "https://api.github.com";
const INDEXNOW_KEY = "fc0f64ac2347f30bf9d18c2bf65e7944";

function gh(path, opts = {}) {
  return fetch(GH + path, {
    ...opts,
    headers: {
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      Accept: opts.accept || "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "yurt-blog-bot",
      ...(opts.body ? { "Content-Type": "application/json" } : {})
    }
  });
}

async function ghJson(path, opts) {
  const r = await gh(path, opts);
  if (!r.ok) throw new Error(`GitHub ${opts && opts.method || "GET"} ${path}: ${r.status} ${await r.text()}`);
  return r.json();
}

async function readFile(path) {
  const r = await gh(`/repos/${REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, "/")}?ref=${BRANCH}`, { accept: "application/vnd.github.raw" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub read ${path}: ${r.status}`);
  return r.text();
}

// One commit with many files (text or binary). Fails if main moved meanwhile, caller retries.
async function commitFiles(files, message) {
  const ref = await ghJson(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
  const base = ref.object.sha;
  const baseCommit = await ghJson(`/repos/${REPO}/git/commits/${base}`);
  const tree = [];
  for (const f of files) {
    const blob = await ghJson(`/repos/${REPO}/git/blobs`, {
      method: "POST",
      body: JSON.stringify(f.binary ? { content: f.content.toString("base64"), encoding: "base64" } : { content: f.content, encoding: "utf-8" })
    });
    tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await ghJson(`/repos/${REPO}/git/trees`, { method: "POST", body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }) });
  const commit = await ghJson(`/repos/${REPO}/git/commits`, {
    method: "POST",
    body: JSON.stringify({ message, tree: newTree.sha, parents: [base], author: { name: "YURT Blog Bot", email: "blog-bot@yurtdesign.art" } })
  });
  await ghJson(`/repos/${REPO}/git/refs/heads/${BRANCH}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: false }) });
  return commit.sha;
}

async function tg(method, params) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(params || {})
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${method}: ${j.description}`);
  return j.result;
}

async function downloadPhoto(sizes) {
  // Largest size not wider than 1600px (Telegram usually gives up to 1280).
  const ok = sizes.filter(s => Math.max(s.width, s.height) <= 1600);
  const best = (ok.length ? ok : sizes).slice(-1)[0];
  const file = await tg("getFile", { file_id: best.file_id });
  const r = await fetch(`https://api.telegram.org/file/bot${process.env.TG_BOT_TOKEN}/${file.file_path}`);
  if (!r.ok) throw new Error("photo download " + r.status);
  return { buf: Buffer.from(await r.arrayBuffer()), w: best.width, h: best.height };
}

async function processMessage(msg, isEdit) {
  const text = msg.text || msg.caption || "";
  const entities = msg.entities || msg.caption_entities || [];
  const excluded = B.EXCLUDE_TAG.test(text);

  const raw = await readFile("blog/data/posts.json");
  const posts = raw ? JSON.parse(raw) : [];
  const key = msg.media_group_id ? "g" + msg.media_group_id : "m" + msg.message_id;
  let post = posts.find(p => p.key === key || (p.msgIds || []).includes(msg.message_id));
  if (!post) {
    if (excluded) return "excluded";
    post = { key, id: msg.message_id, date: msg.date, msgIds: [], photos: [], channel: msg.chat.username || "" };
    posts.push(post);
  }
  if (!post.msgIds.includes(msg.message_id)) post.msgIds.push(msg.message_id);

  const files = [];
  if (msg.photo && msg.photo.length && !post.photos.some(p => p.mid === msg.message_id)) {
    const ph = await downloadPhoto(msg.photo);
    const path = `blog/img/${post.id}-${msg.message_id}.jpg`;
    files.push({ path, content: ph.buf, binary: true });
    post.photos.push({ path, w: ph.w, h: ph.h, mid: msg.message_id });
    post.photos.sort((a, b) => a.mid - b.mid);
  }
  if (text.trim()) {
    const parsed = B.parsePost(text, entities);
    post.title = parsed.title; post.bodyHtml = parsed.bodyHtml; post.plain = parsed.plain;
    if (!post.slug) post.slug = B.slugify(parsed.title, post.id);
    if (isEdit) post.edited = msg.edit_date || Math.floor(Date.now() / 1000);
  }
  post.hidden = excluded || !post.title;

  posts.sort((a, b) => b.date - a.date);
  const layout = await readFile("blog/_layout.html");
  if (!layout) throw new Error("blog/_layout.html not found");
  if (!post.hidden) files.push({ path: `blog/${post.slug}/index.html`, content: B.renderPost(layout, post, posts) });
  files.push({ path: "blog/index.html", content: B.renderIndex(layout, posts) });
  files.push({ path: "sitemap-blog.xml", content: B.renderSitemap(posts) });
  files.push({ path: "blog/data/posts.json", content: JSON.stringify(posts, null, 1) + "\n" });

  await commitFiles(files, `Blog: ${post.title || "фото"} (tg ${msg.message_id}${isEdit ? ", edit" : ""})`);
  return post.hidden ? "stored" : "published:" + post.slug;
}

async function pingIndexNow(url) {
  const q = `?url=${encodeURIComponent(url)}&key=${INDEXNOW_KEY}`;
  await Promise.allSettled([
    fetch("https://yandex.com/indexnow" + q, { signal: AbortSignal.timeout(4000) }),
    fetch("https://www.bing.com/indexnow" + q, { signal: AbortSignal.timeout(4000) })
  ]);
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(200).send("YURT blog webhook");
  if (!process.env.TG_WEBHOOK_SECRET || req.headers["x-telegram-bot-api-secret-token"] !== process.env.TG_WEBHOOK_SECRET) {
    return res.status(401).send("unauthorized");
  }
  const update = req.body || {};
  const msg = update.channel_post || update.edited_channel_post;
  const want = (process.env.TG_CHANNEL || "remont_bez_skazok").replace(/^@/, "").toLowerCase();
  if (!msg || !msg.chat || ((msg.chat.username || "").toLowerCase() !== want && String(msg.chat.id) !== want)) {
    return res.status(200).send("ignored");
  }
  let result = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      result = await processMessage(msg, !!update.edited_channel_post);
      break;
    } catch (err) {
      console.error(`attempt ${attempt}:`, err.message);
      if (attempt === 3) return res.status(200).send("error logged"); // 200 so Telegram does not resend forever
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
  if (result.startsWith("published:")) {
    const slug = result.split(":")[1];
    await pingIndexNow(`${B.SITE}/blog/${slug}/`);
  }
  console.log(result);
  return res.status(200).send(result || "ok");
};
