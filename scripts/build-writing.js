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
if (!slugsStore.cardHash) slugsStore.cardHash = {};
fs.mkdirSync(path.join(SITE, "writing"), {recursive: true});
fs.writeFileSync(SLUGS_PATH, JSON.stringify(slugsStore, null, 2) + "\n");
const postSlug = p => slugsStore.posts[p.id];
const topicSlug = t => slugsStore.topics[t];
const postHref = p => `${WRITING}${postSlug(p)}/`;
const topicHref = t => `${WRITING}${topicSlug(t)}/`;

/* ---------- Reuse the site's own head, header and footer markup, read from the writing page as it stands today ---------- */
const existing = fs.readFileSync(path.join(SITE, "writing", "index.html"), "utf8");
const grab = (re, fallback = "") => (existing.match(re) || [fallback])[0];
// The style block below is this script's own prior output, so it already carries one copy of EXTRA_CSS
// (and the page-h rule appended after it). Cut everything from the first such marker onward each run,
// rather than keep it, so re-running the build doesn't grow the page with another copy every time.
const STYLE_MARKER = ".hb .starthere-note{margin:2px 0 0";
const rawStyle = (existing.match(/<style>\n([\s\S]*?)\n<\/style>/) || [, ""])[1];
const markerAt = rawStyle.indexOf(STYLE_MARKER);
const SHARED_STYLE = (markerAt === -1 ? rawStyle : rawStyle.slice(0, markerAt)).replace(/\s+$/, "");
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
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.wr-search{position:relative;max-width:520px;margin:28px 0 0}
.wr-search input[type=search]{width:100%;padding:13px 40px 13px 16px;border-radius:10px;border:1px solid var(--line);background:#fff;font:inherit;font-size:15px;color:var(--ink);box-shadow:0 1px 2px rgba(21,23,43,.05);appearance:none}
.wr-search input[type=search]::-webkit-search-cancel-button{appearance:none}
.wr-search input[type=search]:focus{outline:2px solid var(--blue);outline-offset:2px}
.wr-search-hint{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:1px 6px;pointer-events:none}
.wr-search-results{position:absolute;left:0;right:0;top:calc(100% + 8px);z-index:20;max-height:420px;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);padding:8px}
.wr-search-group + .wr-search-group{margin-top:6px;padding-top:6px;border-top:1px solid var(--line)}
.wr-search-kind{margin:6px 10px 4px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.wr-search-item{display:block;padding:8px 10px;border-radius:8px;text-decoration:none;color:var(--ink)}
.wr-search-item b{display:block;font-size:14.5px;font-weight:600;letter-spacing:-.01em}
.wr-search-item span{display:block;margin-top:2px;font-size:13px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wr-search-item:hover,.wr-search-item.active{background:rgba(109,93,246,.12)}
.wr-search-empty,.wr-search-note{margin:6px 10px;font-size:13px;color:var(--muted)}
.follow-line{margin:16px 0 0;font-size:14.5px;color:var(--muted)}
.follow-line a{color:var(--blue);font-weight:500;text-decoration:none}
.follow-line a:hover{text-decoration:underline}
@media (max-width:900px){.hb .starthere-list li{grid-template-columns:1fr;gap:2px}.hb .starthere-list time{padding-top:0}.post-body{font-size:17px}}
`;

/* ---------- Page shell ---------- */
function shell({title, description, canonical, bodyClass, jsonLd, body, ogImage, extraScript}) {
  const img = ogImage || `${HOME}/og-image.png`;
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
<meta property="og:url" content="${canonical}"><meta property="og:image" content="${img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${img}">
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
${extraScript || ""}</body>
</html>
`;
}

/* ---------- "Get new posts" line: Atom feed + LinkedIn, no email form (none is configured) ---------- */
const followLine = () => `<p class="follow-line">Get new posts: <a href="${WRITING}feed.xml">RSS</a> · <a href="${LINKEDIN}">LinkedIn</a></p>`;

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
    <div class="wr-search" role="search">
      <label for="wr-search-input" class="sr-only">Search writing, the handbook and the workbench</label>
      <input id="wr-search-input" type="search" placeholder="Search writing, the handbook, the workbench…" autocomplete="off">
      <span class="wr-search-hint" aria-hidden="true">/</span>
      <div id="wr-search-results" class="wr-search-results" role="listbox" hidden></div>
    </div>
    ${followLine()}
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

/* ---------- The search box's own script: fetches the cross-site index lazily on focus, falls back to
   the posts already on this page (title + point) if that fetch fails, so it never looks broken. ---------- */
const searchFallback = posts.map(p => ({title: p.title, summary: p.point, url: postHref(p), kind: "post"}));
const searchScript = `<script>
(function(){
  var SEARCH_URL = ${JSON.stringify(SEARCH_INDEX_URL)};
  var FALLBACK = ${JSON.stringify(searchFallback).replace(/<\//g, "<\\/")};
  var input = document.getElementById("wr-search-input");
  var panel = document.getElementById("wr-search-results");
  if (!input || !panel) return;
  var cache = null, fetchPromise = null, items = [], activeIdx = -1;
  var KIND_LABEL = {chapter: "Handbook", post: "Writing", tool: "Workbench", update: "Update"};
  function kindLabel(k){ return KIND_LABEL[k] || (k ? k.charAt(0).toUpperCase() + k.slice(1) : ""); }
  function norm(s){ return (s || "").toLowerCase(); }
  function esc(s){ return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function scoreOf(q, it, titleKey, bodyKeys){
    var title = norm(it[titleKey]), score = 0;
    if (title.indexOf(q) === 0) score += 100; else if (title.indexOf(q) !== -1) score += 60;
    bodyKeys.forEach(function(k, i){ var v = it[k]; var text = norm(Array.isArray(v) ? v.join(" ") : v); if (text && text.indexOf(q) !== -1) score += (bodyKeys.length - i) * 10; });
    return score;
  }
  function scoreRemote(q, it){ return scoreOf(q, it, "title", ["tags", "summary", "text"]); }
  function scoreLocal(q, it){ return scoreOf(q, it, "title", ["summary"]); }
  function load(){
    if (!fetchPromise) fetchPromise = fetch(SEARCH_URL).then(function(r){ if (!r.ok) throw new Error(String(r.status)); return r.json(); }).then(function(d){ cache = (d && d.items) || []; return cache; });
    return fetchPromise;
  }
  function render(list, mode){
    items = list; activeIdx = -1;
    if (!list.length) { panel.innerHTML = '<p class="wr-search-empty">No results' + (mode === "local" ? " on this page." : ".") + "</p>"; panel.hidden = false; return; }
    var groups = {}, order = [];
    list.forEach(function(it){ var k = it.kind || "post"; if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(it); });
    var html = order.map(function(k){
      return '<div class="wr-search-group"><p class="wr-search-kind">' + esc(kindLabel(k)) + "</p>" +
        groups[k].map(function(it){
          var idx = list.indexOf(it);
          return '<a class="wr-search-item" data-idx="' + idx + '" href="' + it.url + '"><b>' + esc(it.title) + "</b>" + (it.summary ? "<span>" + esc(it.summary) + "</span>" : "") + "</a>";
        }).join("") + "</div>";
    }).join("");
    if (mode === "local") html += '<p class="wr-search-note">Searching this page only — the full index didn\\'t load.</p>';
    panel.innerHTML = html; panel.hidden = false;
  }
  function rank(q, list, scorer){ return list.map(function(it){ return {it: it, s: scorer(q, it)}; }).filter(function(x){ return x.s > 0; }).sort(function(a, b){ return b.s - a.s; }).slice(0, 12).map(function(x){ return x.it; }); }
  function runLocal(q){ render(rank(q, FALLBACK, scoreLocal), "local"); }
  function doSearch(){
    var q = norm(input.value).trim();
    if (!q) { panel.hidden = true; panel.innerHTML = ""; return; }
    if (cache) { render(rank(q, cache, scoreRemote), "remote"); return; }
    load().then(function(data){ render(rank(q, data, scoreRemote), "remote"); }).catch(function(){ runLocal(q); });
  }
  input.addEventListener("focus", function(){ load().catch(function(){}); });
  input.addEventListener("input", doSearch);
  input.addEventListener("keydown", function(e){
    var links = panel.querySelectorAll(".wr-search-item");
    if (e.key === "ArrowDown") { if (links.length) { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, links.length - 1); mark(links); } }
    else if (e.key === "ArrowUp") { if (links.length) { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); mark(links); } }
    else if (e.key === "Enter") { if (activeIdx >= 0 && links[activeIdx]) { window.location.href = links[activeIdx].href; } }
    else if (e.key === "Escape") { panel.hidden = true; input.blur(); }
  });
  function mark(links){ for (var i = 0; i < links.length; i++) links[i].classList.toggle("active", i === activeIdx); links[activeIdx].scrollIntoView({block: "nearest"}); }
  document.addEventListener("click", function(e){ if (!panel.contains(e.target) && e.target !== input) panel.hidden = true; });
  document.addEventListener("keydown", function(e){
    var tag = (document.activeElement || {}).tagName || "";
    if (e.key === "/" && document.activeElement !== input && tag !== "INPUT" && tag !== "TEXTAREA") { e.preventDefault(); input.focus(); }
  });
})();
</script>
`;

fs.writeFileSync(path.join(SITE, "writing", "index.html"), shell({
  title: `Writing · ${NAME}`, description: wdesc, canonical: WRITING, bodyClass: "wr", body: indexBody, extraScript: searchScript,
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

/* ---------- Share card: writing/<slug>/card.png, 1200x630, rendered from scripts/og-post.html with
   headless Chrome. Only re-rendered when missing or the post's title changed (hash kept in slugs.json),
   so a build that touches nothing doesn't re-launch Chrome 24 times. ---------- */
let cardsRendered = 0, cardsSkippedNoChrome = false;
function renderCard(p, dir) {
  const hash = titleHash(p.title);
  const cardPath = path.join(dir, "card.png");
  if (fs.existsSync(cardPath) && slugsStore.cardHash[p.id] === hash) return false;
  const fileUrl = "file:///" + OG_TEMPLATE.replace(/\\/g, "/");
  const url = `${fileUrl}?title=${encodeURIComponent(p.title)}&date=${encodeURIComponent(fmtDate(p.date))}`;
  try {
    execFileSync(CHROME, [
      "--headless=new", "--hide-scrollbars", "--disable-gpu",
      "--window-size=1200,630", "--virtual-time-budget=4000",
      `--screenshot=${cardPath}`, url
    ], {stdio: "ignore"});
    slugsStore.cardHash[p.id] = hash;
    cardsRendered++;
    return true;
  } catch (e) {
    cardsSkippedNoChrome = true;
    console.warn(`Could not render ${cardPath} (${e.message.split("\n")[0]}); og:image falls back to the site default.`);
    return false;
  }
}

/* ---------- writing/<post-slug>/index.html ---------- */
for (const p of posts) {
  const dir = path.join(SITE, "writing", postSlug(p));
  fs.mkdirSync(dir, {recursive: true});
  const chapters = (p.chapters || []).map(c => c.slug).map(slug => chapterInfo[slug] ? {slug, ...chapterInfo[slug]} : null).filter(Boolean).sort((a, b) => a.n - b.n);
  const rel = related(p);
  const hasTopic = topicDefs.some(t => t.topic === p.topic);
  const canonical = postHref(p);
  renderCard(p, dir);
  const hasCard = fs.existsSync(path.join(dir, "card.png"));
  const ogImage = hasCard ? `${canonical}card.png` : undefined;
  const body = `  <div class="page-h">
    <p class="lbl" style="margin:0"><a href="${WRITING}">Writing</a>${hasTopic ? ` · <a href="${topicHref(p.topic)}">${esc(p.topic)}</a>` : ""}</p>
    <h1 style="margin-top:18px">${esc(p.title)}</h1>
    <p class="post-meta"><time>${fmtDate(p.date)}</time><span>${readingMin(p.body)} min read</span><span>${esc(p.type)}</span><a href="${p.url}">Discuss on LinkedIn →</a></p>
    ${followLine()}
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
    title: `${p.title} · ${NAME}`, description: p.point, canonical, bodyClass: "wr", body, ogImage,
    jsonLd: {
      "@context": "https://schema.org", "@type": "Article", headline: p.title, description: p.point,
      datePublished: p.date, dateModified: p.engagement_checked || p.date,
      author: {"@type": "Person", name: NAME, url: `${HOME}/`}, publisher: {"@type": "Person", name: NAME},
      mainEntityOfPage: canonical, image: ogImage || `${HOME}/og-image.png`
    }
  }));
}
fs.writeFileSync(SLUGS_PATH, JSON.stringify(slugsStore, null, 2) + "\n"); // cardHash updated above

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

const cardFiles = posts.map(p => path.join(SITE, "writing", postSlug(p), "card.png")).filter(f => fs.existsSync(f));
const cardsBytes = cardFiles.reduce((n, f) => n + fs.statSync(f).size, 0);
console.log(`Writing archive: ${posts.length} post pages, ${topicPages} topic pages, 1 index, feed.xml (${feedPosts.length} entries).`);
console.log(`Slug rule: from each post's title (no posts had an existing "slug" field); stable map in writing/slugs.json.`);
console.log(`Start here rule: ${startHereRule}.`);
console.log(`Share cards: ${cardFiles.length}/${posts.length} card.png present (${(cardsBytes / 1024 / 1024).toFixed(2)} MB total), ${cardsRendered} (re)rendered this run${cardsSkippedNoChrome ? " — some renders failed, see warnings above" : ""}.`);
