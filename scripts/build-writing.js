// Builds the writing archive from the LinkedIn post archive, so the writing section is something
// people read on the site rather than a list of links out to LinkedIn.
//
// Reads (read-only):
//   linkedin-posts/posts.json    the archive: title, date, type, topic, point, themes, chapters, full text, engagement
//   linkedin-posts/topics.json   the topic groups and their one-line descriptions
//   ts-handbook/README.md        chapter titles and one-line descriptions, for the "In the handbook" cards
//
// Writes, all under stevenmacchia.github.io/writing/:
//   index.html            "Start here" (up to 8 posts), then every topic with its posts
//   <topic-slug>/index.html   one page per topic: its two-line intro, then its posts
//   <post-slug>/index.html    one page per post: full text, chapters it informs, related posts
//   feed.xml               Atom feed of the 30 newest posts, with full text
//   slugs.json              the post-id/topic -> slug map. Slugs are never changed once assigned.
//
// Run: node scripts/build-writing.js (from this repo), or node stevenmacchia.github.io/scripts/build-writing.js
// from the portfolio root (how the daily-post skill's sync-posts.js calls it).
const fs = require("fs"), path = require("path");
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const SITE = path.resolve(__dirname, "..");
const ROOT = path.resolve(SITE, "..");
const P = (...p) => path.join(ROOT, ...p);
const readJSON = f => JSON.parse(fs.readFileSync(f, "utf8"));

const HOME = "https://stevenmacchia.com";
const WRITING = `${HOME}/writing/`;
const HB = `${HOME}/ts-handbook/`;
const NAME = "Steven Macchia";
const EMAIL = "stevenamacchia@gmail.com";
const LINKEDIN = "https://www.linkedin.com/in/stevenmacchia";
const SEARCH_INDEX_URL = `${HOME}/ts-handbook/search.json`; // cross-site index, built by the handbook

/* ---------- Share cards: writing/<slug>/card.png, 1200x630, from scripts/og-post.html ---------- */
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OG_TEMPLATE = path.join(__dirname, "og-post.html");
function titleHash(title) { return crypto.createHash("sha1").update(title).digest("hex").slice(0, 12); }

const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtDate = s => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric", timeZone: "UTC"});
const isoOf = p => p.published_at || (p.date + "T12:00:00Z");

/* ---------- Load the archive ---------- */
const posts = readJSON(P("linkedin-posts", "posts.json"));
const topicDefs = readJSON(P("linkedin-posts", "topics.json")); // [{topic, about}]

/* ---------- Chapter titles and one-liners, from the handbook's own contents table ---------- */
const hbReadme = fs.readFileSync(P("ts-handbook", "README.md"), "utf8");
const chapterInfo = {}; // slug -> {n, title, about}
for (const m of hbReadme.matchAll(/^\|\s*(\d+)\s*\|\s*\[([^\]]+)\]\(chapters\/(\d\d)-([a-z0-9-]+)\.md\)\s*\|\s*([^|]+?)\s*\|\s*\w+\s*\|$/gm)) {
  chapterInfo[m[4]] = {n: +m[1], title: m[2].trim(), about: m[5].trim()};
}

/* ---------- Slugs: stable, derived from the title the first time a post/topic is seen, never changed after ---------- */
const SLUGS_PATH = path.join(SITE, "writing", "slugs.json");
const slugsStore = fs.existsSync(SLUGS_PATH) ? readJSON(SLUGS_PATH) : {posts: {}, topics: {}};
if (!slugsStore.posts) slugsStore.posts = {};
if (!slugsStore.topics) slugsStore.topics = {};
const usedSlugs = new Set([...Object.values(slugsStore.posts), ...Object.values(slugsStore.topics)]);
function slugify(s) {
  return String(s).toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "post";
}
function assignSlug(store, key, text) {
  if (store[key]) return store[key];
  const base = slugify(text);
  let slug = base, i = 2;
  while (usedSlugs.has(slug)) slug = `${base}-${i++}`;
  store[key] = slug; usedSlugs.add(slug);
  return slug;
}
posts.forEach(p => assignSlug(slugsStore.posts, p.id, p.slug || p.title));
topicDefs.forEach(t => assignSlug(slugsStore.topics, t.topic, t.topic));
fs.mkdirSync(path.join(SITE, "writing"), {recursive: true});
fs.writeFileSync(SLUGS_PATH, JSON.stringify(slugsStore, null, 2) + "\n");
const postSlug = p => slugsStore.posts[p.id];
const topicSlug = t => slugsStore.topics[t];
const postHref = p => `${WRITING}${postSlug(p)}/`;
const topicHref = t => `${WRITING}${topicSlug(t)}/`;

/* ---------- Reuse the site's own head, header and footer markup, read from the writing page as it stands today ---------- */
const existing = fs.readFileSync(path.join(SITE, "writing", "index.html"), "utf8");
const grab = (re, fallback = "") => (existing.match(re) || [fallback])[0];
const SHARED_STYLE = (existing.match(/<style>\n([\s\S]*?)\n<\/style>/) || [, ""])[1];
const NAV = grab(/<nav class="top">[\s\S]*?<\/nav>/);
const FONT_LINKS = grab(/<link rel="preconnect"[\s\S]*?display=swap">/);
const ANALYTICS = grab(/<script defer src="https:\/\/static\.cloudflareinsights\.com[\s\S]*?<\/script>/);
const ICON = grab(/<link rel="icon"[^>]*>/);
const FOOTER = grab(/<footer>[\s\S]*?<\/footer>/);

/* ---------- Extra CSS for archive-only pieces: the Start Here panel, the post measure, chapter cards ---------- */
const EXTRA_CSS = `
.hb .starthere-note{margin:2px 0 0;font-size:13px;color:var(--muted)}
.hb .starthere-list{list-style:none;margin:10px 0 0;padding:0;display:grid;gap:10px;border-top:1px solid var(--line);padding-top:12px}
.hb .starthere-list li{display:grid;grid-template-columns:92px minmax(0,1fr);gap:16px;align-items:baseline}
.hb .starthere-list time{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12.5px;color:var(--muted);white-space:nowrap}
.hb .starthere-list h3{font-size:15.5px;font-weight:600;letter-spacing:-.01em}
.hb .starthere-list h3 a{color:var(--ink);text-decoration:underline;text-decoration-color:var(--strong);text-underline-offset:3px}
.hb .starthere-list h3 a:hover{text-decoration-color:var(--blue)}
.hb .starthere-list p{margin:2px 0 0;color:var(--muted);font-size:14px}
.post-body{max-width:70ch;font-size:18px;line-height:1.75}
.post-body p{margin:0 0 22px}
.post-body p:last-child{margin-bottom:0}
.post-body a{word-break:break-word}
.post-meta{display:flex;gap:14px;flex-wrap:wrap;margin-top:14px;font-size:14.5px;color:var(--muted)}
.post-meta a{color:var(--blue)}
.chapters-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:14px;margin-top:4px}
.chapter-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;box-shadow:var(--shadow);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.chapter-card a{text-decoration:none;color:var(--ink);display:block}
.chapter-card b{display:block;font-size:15px;line-height:1.3;margin-bottom:4px}
.chapter-card span{display:block;color:var(--muted);font-size:13.5px;line-height:1.4}
.sec-h.tight{padding-top:0;border-top:none;margin-bottom:16px}
@media (max-width:900px){.hb .starthere-list li{grid-template-columns:1fr;gap:2px}.hb .starthere-list time{padding-top:0}.post-body{font-size:17px}}
`;

/* ---------- Page shell ---------- */
function shell({title, description, canonical, bodyClass, jsonLd, body}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="author" content="${NAME}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}"><meta property="og:image" content="${HOME}/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${HOME}/og-image.png">
<meta name="theme-color" content="#6D5DF6">
${ICON}
${ANALYTICS}
${FONT_LINKS}
<style>
${SHARED_STYLE}
${EXTRA_CSS}
.page-h{max-width:1152px;margin:0 auto;padding:44px 32px 20px}
@media (max-width:900px){.page-h{padding:30px 20px 12px}}
</style>
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>\n` : ""}</head>
<body>
<header><div class="wrap">
  ${NAV}
</div></header>
<main${bodyClass ? ` class="${bodyClass}"` : ""}>
${body}
</main>
${FOOTER}
</body>
</html>
`;
}

/* ---------- Post body: full text as paragraphs, bare URLs linked ---------- */
function linkify(escapedText) {
  return escapedText.replace(/https?:\/\/[^\s<]+/g, m => {
    let trail = "";
    while (/[.,;:!?)\]]$/.test(m)) { trail = m.slice(-1) + trail; m = m.slice(0, -1); }
    return `<a href="${m}">${m}</a>${trail}`;
  });
}
function renderBody(body) {
  return body.split(/\n+/).map(s => s.trim()).filter(Boolean).map(p => `<p>${linkify(esc(p))}</p>`).join("\n");
}
function wordCount(body) { return body.split(/\s+/).filter(Boolean).length; }
function readingMin(body) { return Math.max(1, Math.round(wordCount(body) / 220)); }

/* ---------- Related posts: most shared themes, then same topic, then most recent ---------- */
function related(p) {
  const themes = new Set(p.themes || []);
  return posts.filter(o => o.id !== p.id)
    .map(o => ({o, score: (o.themes || []).filter(t => themes.has(t)).length * 2 + (o.topic === p.topic ? 1 : 0)}))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || b.o.date.localeCompare(a.o.date))
    .slice(0, 3).map(x => x.o);
}

/* ---------- A post as a list row (used on the index, topic pages and "Related") ---------- */
function postRow(p, {meta = true} = {}) {
  const t = topicDefs.some(t => t.topic === p.topic) ? p.topic : null;
  const metaBits = [`${readingMin(p.body)} min read`, p.type, t ? `<a href="${topicHref(t)}">${esc(t)}</a>` : null].filter(Boolean);
  return `      <li><time>${fmtDate(p.date)}</time><div><h3><a href="${postHref(p)}">${esc(p.title)}</a></h3><p>${esc(p.point)}</p>${meta ? `<p class="meta">${metaBits.join(" · ")}</p>` : ""}</div></li>`;
}

/* ---------- Start here: start_here:true posts if any are flagged, else the 8 highest-engagement posts ---------- */
const flagged = posts.filter(p => p.start_here);
const startHereRule = flagged.length ? "hand-picked (start_here: true in posts.json)" : "the 8 highest-engagement posts (likes + comments)";
const startHere = (flagged.length ? flagged : posts.slice().sort((a, b) => ((b.likes || 0) + (b.comments || 0)) - ((a.likes || 0) + (a.comments || 0))))
  .slice(0, 8).sort((a, b) => b.date.localeCompare(a.date));
const startHereNote = flagged.length ? "Hand-picked by Steven." : "The eight posts readers have engaged with most.";

/* ---------- writing/index.html ---------- */
const newest = posts.slice().sort((a, b) => isoOf(b).localeCompare(isoOf(a)));
const wdesc = `What changed in Trust & Safety and why it matters: ${NAME} on child safety, age assurance, automation and platform compliance. An archive to read, not just a list of links.`;
const indexBody = `  <div class="page-h">
    <p class="lbl" style="margin:0">Writing</p>
    <h1 style="margin-top:18px">What changed in Trust &amp; Safety, and why it matters</h1>
    <p class="sub" style="max-width:62ch">Posts on child safety, age assurance, automation and platform compliance, from someone who does the work, kept here as a readable archive. They're also where the principles behind <a href="${HB}">The T&amp;S Handbook</a> come from.</p>
    <div class="cta"><a class="btn primary" href="${LINKEDIN}">Follow on LinkedIn</a><a class="btn" href="${HB}">Read the handbook</a></div>
  </div>
  <section id="start"><div class="wrap">
    <div class="hb">
      <p class="lbl" style="margin:0">Start here</p>
      <h3>New here? Start with these</h3>
      <p class="starthere-note">${startHereNote}</p>
      <ol class="starthere-list">
${startHere.map(p => `        <li><time>${fmtDate(p.date)}</time><div><h3><a href="${postHref(p)}">${esc(p.title)}</a></h3><p>${esc(p.point)}</p></div></li>`).join("\n")}
      </ol>
    </div>
  </div></section>
${topicDefs.map(({topic, about}) => {
    const ps = newest.filter(p => p.topic === topic);
    if (!ps.length) return "";
    return `  <section><div class="wrap">
    <div class="sec-h"><h2>${esc(topic)}</h2><p class="big">${esc(about)}</p></div>
    <ol class="posts">
${ps.map(p => postRow(p)).join("\n")}
    </ol>
    <div class="more"><a href="${topicHref(topic)}">All posts in ${esc(topic)} →</a></div>
  </div></section>`;
  }).filter(Boolean).join("\n")}`;
fs.writeFileSync(path.join(SITE, "writing", "index.html"), shell({
  title: `Writing · ${NAME}`, description: wdesc, canonical: WRITING, bodyClass: "wr", body: indexBody,
  jsonLd: {"@context": "https://schema.org", "@type": "CollectionPage", name: `Writing · ${NAME}`, url: WRITING, description: wdesc}
}));

/* ---------- writing/<topic-slug>/index.html ---------- */
let topicPages = 0;
for (const {topic, about} of topicDefs) {
  const ps = newest.filter(p => p.topic === topic);
  if (!ps.length) continue;
  const dir = path.join(SITE, "writing", topicSlug(topic));
  fs.mkdirSync(dir, {recursive: true});
  const desc = about;
  const body = `  <div class="page-h">
    <p class="lbl" style="margin:0"><a href="${WRITING}">Writing</a></p>
    <h1 style="margin-top:18px">${esc(topic)}</h1>
    <p class="sub" style="max-width:62ch">${esc(about)}</p>
  </div>
  <section><div class="wrap">
    <ol class="posts">
${ps.map(p => postRow(p)).join("\n")}
    </ol>
    <div class="more"><a href="${WRITING}">All writing →</a></div>
  </div></section>`;
  fs.writeFileSync(path.join(dir, "index.html"), shell({
    title: `${topic} · Writing · ${NAME}`, description: desc, canonical: topicHref(topic), bodyClass: "wr", body,
    jsonLd: {"@context": "https://schema.org", "@type": "CollectionPage", name: `${topic} · Writing`, url: topicHref(topic), description: desc}
  }));
  topicPages++;
}

/* ---------- writing/<post-slug>/index.html ---------- */
for (const p of posts) {
  const dir = path.join(SITE, "writing", postSlug(p));
  fs.mkdirSync(dir, {recursive: true});
  const chapters = (p.chapters || []).map(c => c.slug).map(slug => chapterInfo[slug] ? {slug, ...chapterInfo[slug]} : null).filter(Boolean).sort((a, b) => a.n - b.n);
  const rel = related(p);
  const hasTopic = topicDefs.some(t => t.topic === p.topic);
  const canonical = postHref(p);
  const body = `  <div class="page-h">
    <p class="lbl" style="margin:0"><a href="${WRITING}">Writing</a>${hasTopic ? ` · <a href="${topicHref(p.topic)}">${esc(p.topic)}</a>` : ""}</p>
    <h1 style="margin-top:18px">${esc(p.title)}</h1>
    <p class="post-meta"><time>${fmtDate(p.date)}</time><span>${readingMin(p.body)} min read</span><span>${esc(p.type)}</span><a href="${p.url}">Discuss on LinkedIn →</a></p>
  </div>
  <section><div class="wrap">
    <div class="post-body">
${renderBody(p.body)}
    </div>
  </div></section>
${chapters.length ? `  <section><div class="wrap">
    <div class="sec-h tight"><h2 style="font-size:22px">In the handbook</h2></div>
    <div class="chapters-grid">
${chapters.map(c => `      <div class="chapter-card"><a href="${HB}${c.slug}/"><b>${c.n}. ${esc(c.title)}</b><span>${esc(c.about)}</span></a></div>`).join("\n")}
    </div>
  </div></section>` : ""}
${rel.length ? `  <section><div class="wrap">
    <div class="sec-h tight"><h2 style="font-size:22px">Related</h2></div>
    <ol class="posts">
${rel.map(o => postRow(o)).join("\n")}
    </ol>
  </div></section>` : ""}`;
  fs.writeFileSync(path.join(dir, "index.html"), shell({
    title: `${p.title} · ${NAME}`, description: p.point, canonical, bodyClass: "wr", body,
    jsonLd: {
      "@context": "https://schema.org", "@type": "Article", headline: p.title, description: p.point,
      datePublished: p.date, dateModified: p.engagement_checked || p.date,
      author: {"@type": "Person", name: NAME, url: `${HOME}/`}, publisher: {"@type": "Person", name: NAME},
      mainEntityOfPage: canonical, image: `${HOME}/og-image.png`
    }
  }));
}

/* ---------- writing/feed.xml: Atom, 30 newest, full text ---------- */
const feedPosts = newest.slice(0, 30);
const feedXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>${WRITING}feed.xml</id>
  <title>Writing · ${esc(NAME)}</title>
  <subtitle>${esc(wdesc)}</subtitle>
  <link href="${WRITING}feed.xml" rel="self"/>
  <link href="${WRITING}"/>
  <updated>${feedPosts.length ? isoOf(feedPosts[0]) : new Date().toISOString()}</updated>
  <author><name>${esc(NAME)}</name><email>${EMAIL}</email></author>
${feedPosts.map(p => `  <entry>
    <id>${postHref(p)}</id>
    <title>${esc(p.title)}</title>
    <link href="${postHref(p)}"/>
    <published>${isoOf(p)}</published>
    <updated>${isoOf(p)}</updated>
    <summary>${esc(p.point)}</summary>
    <content type="html">${esc(renderBody(p.body))}</content>
  </entry>`).join("\n")}
</feed>
`;
fs.writeFileSync(path.join(SITE, "writing", "feed.xml"), feedXml);

console.log(`Writing archive: ${posts.length} post pages, ${topicPages} topic pages, 1 index, feed.xml (${feedPosts.length} entries).`);
console.log(`Slug rule: from each post's title (no posts had an existing "slug" field); stable map in writing/slugs.json.`);
console.log(`Start here rule: ${startHereRule}.`);
