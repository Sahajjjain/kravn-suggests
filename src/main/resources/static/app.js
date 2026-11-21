"use strict";

/* ===== tiny helpers ===== */
const $ = (selector) => document.querySelector(selector);
const app = $("#app");
const qInput = $("#q");
const suggestBox = $("#suggest");
const dialog = $("#trailer");
const dialogFrame = $("#trailer-frame");

const TRY_THESE = ["Inception", "Breaking Bad", "3 Idiots", "Money Heist", "Interstellar", "Panchayat"];
const band = (percent) => (percent >= 80 ? "high" : percent >= 60 ? "mid" : "low");
const RING_LENGTH = 113.1; // circumference of the meter circle (2 * pi * 18)

const HEART = `<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
// Movies and series can share the same number, so everything is keyed by type + id.
const typeOf = (m) => (m && m.mediaType === "tv" ? "tv" : "movie");
const keyOf = (m) => typeOf(m) + ":" + m.id;
const hrefOf = (m) => `#/${typeOf(m)}/${m.id}`;
const ICON_MOVIE = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></svg>`;
const ICON_TV = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M8 3l4 4 4-4"/></svg>`;
const iconFor = (kind) => (kind === "tv" ? ICON_TV : ICON_MOVIE);
const registry = new Map(); // key -> item, so a heart button can find the title it belongs to
let homePool = [];           // titles loaded on the home page, used by "Surprise me"

/* ===== "My list": saved in this browser's localStorage ===== */
const LIST_KEY = "kravn.list";
function readList() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_KEY));
    // Older saved items have no type: they were all movies.
    return Array.isArray(saved)
      ? saved.filter((m) => m && m.id).map((m) => ({ ...m, mediaType: typeOf(m) }))
      : [];
  } catch {
    return [];
  }
}
let myList = readList();
const isSaved = (key) => myList.some((m) => keyOf(m) === key);

function persist() {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(myList));
  } catch {
    /* private mode: the list simply lasts until the tab closes */
  }
}

let toastTimer;
// Small message at the bottom of the screen, with an optional Undo button.
function toast(message, undo) {
  const box = $("#toast");
  if (!box) return;
  box.innerHTML = `<span></span>${undo ? `<button type="button" id="toast-undo">Undo</button>` : ""}`;
  box.firstChild.textContent = message;
  box.classList.add("show");
  const undoBtn = $("#toast-undo");
  if (undoBtn) undoBtn.addEventListener("click", () => { box.classList.remove("show"); undo(); });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove("show"), 4000);
}

function toggleSave(key, quiet) {
  const movie = registry.get(key);
  if (!movie) return;
  const wasSaved = isSaved(key);
  if (wasSaved) {
    myList = myList.filter((m) => keyOf(m) !== key);
  } else {
    myList = [{ id: movie.id, title: movie.title, year: movie.year, posterUrl: movie.posterUrl,
                rating: movie.rating, genres: movie.genres || [], overview: "", mediaType: typeOf(movie) }, ...myList];
  }
  persist();
  syncSaveUi();
  if (!quiet) {
    toast(wasSaved ? `Removed “${movie.title}” from My list` : `Saved “${movie.title}” to My list`,
          () => toggleSave(key, true));
  }
  if (location.hash === "#/list") showList();
}

// Makes every heart button and the counter in the top bar match the saved list.
function syncSaveUi() {
  document.querySelectorAll("[data-save]").forEach((btn) => {
    const key = btn.dataset.save;
    const saved = isSaved(key);
    const movie = registry.get(key);
    btn.setAttribute("aria-pressed", String(saved));
    btn.setAttribute("aria-label", `${saved ? "Remove from" : "Add to"} My list${movie ? ": " + movie.title : ""}`);
    const label = btn.querySelector(".save-label");
    if (label) label.textContent = saved ? "Saved to My list" : "Add to My list";
  });
  const count = $("#list-count");
  count.textContent = myList.length;
  count.hidden = myList.length === 0;
}

let navToken = 0; // lets a slow response know the user has already moved to another page

// Everything that comes from the server goes through esc() before it touches innerHTML.
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path) {
  let res;
  try {
    res = await fetch("/api" + path);
  } catch {
    throw new Error("Can't reach the server. Is the app still running?");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    if (res.status === 502 || res.status === 503 || res.status === 504) {
      throw new Error("The server is waking up or busy. Wait about 30 seconds and refresh the page.");
    }
    throw new Error(body.message || `Something went wrong (error ${res.status}). Please try again.`);
  }
  return res.json();
}

function regionName(code) {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) || code;
  } catch {
    return code;
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function formatRuntime(minutes) {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/* ===== reusable HTML pieces ===== */
function errorBox(message) {
  return `<div class="notice error"><h3>Something went wrong</h3><p>${esc(message)}</p></div>`;
}

function skeletons(count) {
  return Array.from({ length: count }, () =>
    `<div class="card"><div class="poster skel"></div><div class="skel line"></div><div class="skel line short"></div></div>`
  ).join("");
}

// One poster card. When "match" is given it also shows the match meter and the reason.
function card(movie, match) {
  const key = keyOf(movie);
  registry.set(key, movie);
  const poster = movie.posterUrl
    ? `<img src="${esc(movie.posterUrl)}" alt="Poster of ${esc(movie.title)}" loading="lazy">`
    : `<div class="no-poster">${esc(movie.title)}</div>`;
  const rating = movie.rating > 0 ? `<span class="chip-rating">★ ${movie.rating.toFixed(1)}</span>` : "";
  const firstGenre = (movie.genres || [])[0];
  const sub = (movie.year ? `<span>${esc(movie.year)}</span>` : "") + (firstGenre ? `<span>${esc(firstGenre)}</span>` : "");
  const saved = isSaved(key);
  const badge = typeOf(movie) === "tv" ? `<span class="type-badge">Series</span>` : "";

  let ring = "";
  let reason = "";
  if (match) {
    const offset = (RING_LENGTH * (1 - match.similarity / 100)).toFixed(1);
    ring = `<div class="ring ${band(match.similarity)}" style="--off:${offset}" role="img" aria-label="${match.similarity} percent match">
        <svg viewBox="0 0 44 44"><circle class="track" cx="22" cy="22" r="18"/><circle class="fill" cx="22" cy="22" r="18" transform="rotate(-90 22 22)"/></svg>
        <span>${match.similarity}%</span></div>`;
    reason = `<p class="reason">${esc(match.reason)}</p>`;
  }

  return `<div class="card${match ? " has-match" : ""}">
      <a class="card-link" href="${hrefOf(movie)}">
        <div class="poster-wrap"><div class="poster">${poster}${rating}${badge}</div>${ring}</div>
        <div class="meta"><h3>${esc(movie.title)}</h3><p class="sub">${sub}</p>${reason}</div>
      </a>
      <button class="save" type="button" data-save="${key}" aria-pressed="${saved}"
              aria-label="${saved ? "Remove from" : "Add to"} My list: ${esc(movie.title)}">${HEART}</button>
    </div>`;
}

// Fill the meters one frame after they are in the page so the sweep animates.
function animateRings() {
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document.querySelectorAll(".ring:not(.go)").forEach((r) => r.classList.add("go"))));
}

/* ===== pages ===== */
function rowShell(name, title) {
  return `<section class="row-block">
      <div class="section-head">
        <h2>${esc(title)}</h2>
        <div class="arrows">
          <button class="arrow" type="button" data-row="${name}" data-dir="-1" aria-label="Scroll ${esc(title)} left">‹</button>
          <button class="arrow" type="button" data-row="${name}" data-dir="1" aria-label="Scroll ${esc(title)} right">›</button>
        </div>
      </div>
      <div class="row" id="row-${name}">${skeletons(8)}</div>
    </section>`;
}

// Loads one home row. Always returns an array (empty on error) so callers can combine rows.
async function loadRow(token, name) {
  const row = $("#row-" + name);
  if (!row) return [];
  try {
    const items = await api("/lists/" + name);
    if (token !== navToken) return [];
    row.innerHTML = items.map((m) => card(m)).join("");
    homePool.push(...items);
    return items;
  } catch (e) {
    if (token !== navToken) return [];
    const block = row.closest(".row-block");
    // Show the error once, not once per row.
    if ($(".notice.error")) block.remove();
    else block.outerHTML = errorBox(e.message);
    return [];
  }
}

// Puts a random top-trending title's backdrop behind the hero.
function feature(items) {
  const pool = items.filter((m) => m.backdropUrl);
  const hero = $("#hero");
  if (!pool.length || !hero) return;
  const m = pool[Math.floor(Math.random() * pool.length)];
  hero.style.setProperty("--backdrop", `url('${m.backdropUrl}')`);
  $("#featured").innerHTML = `<a class="featured" href="${hrefOf(m)}">
      ${m.posterUrl ? `<img src="${esc(m.posterUrl)}" alt="">` : ""}
      <div><small>Trending right now</small><b>${esc(m.title)}</b><span>See ${typeOf(m) === "tv" ? "series" : "movies"} like this</span></div></a>`;
}

// Opens a random trending title.
async function surprise() {
  let pool = homePool;
  if (!pool.length) {
    try {
      pool = await api("/lists/trending");
    } catch {
      return;
    }
  }
  if (!pool.length) return;
  location.hash = hrefOf(pool[Math.floor(Math.random() * pool.length)]);
}

// A big, clearly separated block for movies or for series.
function zoneHead(kind, title, blurb, link) {
  return `<div class="zone-head">
      <div><span class="zone-icon">${iconFor(kind)}</span>
        <h2>${esc(title)}</h2><p>${esc(blurb)}</p></div>
      <a class="zone-link" href="${link}">See all ${kind === "tv" ? "series" : "movies"} →</a>
    </div>`;
}

async function showHome() {
  const token = ++navToken;
  homePool = [];
  document.title = "KravN Suggests";
  qInput.value = "";
  app.innerHTML = `
    <section class="hero" id="hero">
      <h1>Loved a movie or series? Find the next one.</h1>
      <p>Search any film or show and see what to watch if you liked it. Every pick comes with a match meter, so you know how close it really is before you press play.</p>
      <div class="try">${TRY_THESE.map((n) => `<a href="#/search/${encodeURIComponent(n)}">${esc(n)}</a>`).join("")}</div>
      <div class="hero-actions">
        <a class="cta" href="#/movies">Explore movies <span aria-hidden="true">→</span></a>
        <a class="cta cta-tv" href="#/series">Explore series <span aria-hidden="true">→</span></a>
        <button class="cta-link" type="button" id="surprise">Surprise me</button>
      </div>
      <div id="featured"></div>
    </section>
    <section class="zone zone-movies">
      ${zoneHead("movie", "Movies", "What the world is watching on the big screen.", "#/movies")}
      ${rowShell("trending", "Trending this week")}
      ${rowShell("now_playing", "In theatres now")}
    </section>
    <section class="zone zone-tv">
      ${zoneHead("tv", "Series", "Binge-worthy shows, from new episodes to all-time greats.", "#/series")}
      ${rowShell("trending_tv", "Trending this week")}
      ${rowShell("on_the_air", "Airing now")}
    </section>`;
  Promise.all([loadRow(token, "trending"), loadRow(token, "trending_tv")]).then(([movies, series]) => {
    if (token === navToken) feature([...movies.slice(0, 4), ...series.slice(0, 4)]);
  });
  ["now_playing", "on_the_air"].forEach((name) => loadRow(token, name));
}

/* ----- Movies and Series pages ----- */
const BROWSE = {
  movie: {
    title: "Movies", icon: "🎬", noun: "movies", zone: "zone-movies",
    blurb: "Trending, in theatres, coming soon and all-time greats. Pick a genre to dig deeper.",
    rows: [["trending", "Trending this week"], ["now_playing", "In theatres now"], ["upcoming", "Coming soon"],
           ["popular", "Popular right now"], ["top_rated", "All-time top rated"]],
    genres: [[28, "Action"], [35, "Comedy"], [18, "Drama"], [53, "Thriller"], [27, "Horror"], [10749, "Romance"],
             [878, "Sci-Fi"], [16, "Animation"], [80, "Crime"], [12, "Adventure"], [14, "Fantasy"], [9648, "Mystery"], [10751, "Family"]],
  },
  tv: {
    title: "Series", icon: "📺", noun: "series", zone: "zone-tv",
    blurb: "New episodes, binge-worthy hits and all-time greats. Pick a genre to dig deeper.",
    rows: [["trending_tv", "Trending this week"], ["on_the_air", "Airing now"],
           ["popular_tv", "Popular right now"], ["top_rated_tv", "All-time top rated"]],
    genres: [[10759, "Action & Adventure"], [35, "Comedy"], [18, "Drama"], [80, "Crime"], [10765, "Sci-Fi & Fantasy"],
             [9648, "Mystery"], [16, "Animation"], [10764, "Reality"], [99, "Documentary"], [10751, "Family"], [10762, "Kids"]],
  },
};
const browseState = { movie: { genre: 0, sort: "popular" }, tv: { genre: 0, sort: "popular" } };
let browseType = "movie";
let browseToken = 0;   // ignores slow answers after the genre or sort changed
let browsePage = 1;
let browseSeen = new Set();

function showBrowse(type) {
  const token = ++navToken;
  browseType = type;
  const cfg = BROWSE[type];
  const state = browseState[type];
  document.title = `${cfg.title} - KravN Suggests`;
  qInput.value = "";
  const chip = (id, label) =>
    `<button class="pill" type="button" data-genre="${id}" aria-pressed="${state.genre === id}">${esc(label)}</button>`;
  app.innerHTML = `
    <section class="zone ${cfg.zone}">
      <div class="browse-banner">
        <span class="zone-icon">${iconFor(type)}</span>
        <div><h1>${cfg.title}</h1><p>${esc(cfg.blurb)}</p></div>
      </div>
      <div class="chips" id="chips" role="group" aria-label="Browse by genre">
        ${chip(0, "All")}${cfg.genres.map(([id, name]) => chip(id, name)).join("")}
      </div>
      <div id="browse-body"></div>
    </section>`;
  renderBrowseBody(token);
}

function renderBrowseBody(token) {
  const type = browseType;
  const cfg = BROWSE[type];
  const state = browseState[type];
  const myToken = ++browseToken;
  document.querySelectorAll("#chips .pill").forEach((b) =>
    b.setAttribute("aria-pressed", String(Number(b.dataset.genre) === state.genre)));
  const body = $("#browse-body");
  if (!body) return;

  if (state.genre === 0) {
    body.innerHTML = cfg.rows.map(([name, title]) => rowShell(name, title)).join("");
    cfg.rows.forEach(([name]) => loadRow(token, name));
    return;
  }

  const genreName = (cfg.genres.find(([id]) => id === state.genre) || [0, ""])[1];
  browsePage = 1;
  browseSeen = new Set();
  body.innerHTML = `
    <div class="section-head"><h2>${esc(genreName)} ${cfg.noun}</h2>
      <div class="tools" role="group" aria-label="Sort">
        <button class="pill" type="button" data-bsort="popular" aria-pressed="${state.sort === "popular"}">Most popular</button>
        <button class="pill" type="button" data-bsort="rating" aria-pressed="${state.sort === "rating"}">Top rated</button>
      </div>
    </div>
    <div class="grid" id="bgrid">${skeletons(12)}</div>
    <div class="more"><button class="btn ghost" type="button" id="load-more" hidden>Load more</button></div>`;
  loadBrowsePage(token, myToken, true);
}

async function loadBrowsePage(token, myToken, first) {
  const type = browseType;
  const state = browseState[type];
  const grid = $("#bgrid");
  const more = $("#load-more");
  if (!grid) return;
  if (more) { more.disabled = true; more.textContent = "Loading…"; }
  let items;
  try {
    items = await api(`/discover/${type}?genre=${state.genre}&sort=${state.sort}&page=${browsePage}`);
  } catch (e) {
    if (token !== navToken || myToken !== browseToken) return;
    if (first) grid.outerHTML = errorBox(e.message);
    else if (more) { more.disabled = false; more.textContent = "Couldn't load. Try again"; }
    return;
  }
  if (token !== navToken || myToken !== browseToken) return;
  const fresh = items.filter((m) => !browseSeen.has(keyOf(m)));
  fresh.forEach((m) => browseSeen.add(keyOf(m)));
  if (first) grid.innerHTML = "";
  if (first && !fresh.length) {
    grid.outerHTML = `<div class="notice"><h3>Nothing here yet</h3><p>Try another genre.</p></div>`;
    return;
  }
  grid.insertAdjacentHTML("beforeend", fresh.map((m) => card(m)).join(""));
  if (more) {
    more.disabled = false;
    more.textContent = "Load more";
    more.hidden = items.length === 0 || browsePage >= 10;
  }
}

let listFilter = "all";

function showList() {
  ++navToken;
  document.title = "My list - KravN Suggests";
  if (!myList.length) {
    app.innerHTML = `<div class="notice"><h3>Your list is empty</h3><p>Tap the heart on any poster to save it here for later.</p></div>`;
    return;
  }
  const movies = myList.filter((m) => typeOf(m) === "movie").length;
  const series = myList.length - movies;
  if (listFilter === "movie" && !movies) listFilter = "all";
  if (listFilter === "tv" && !series) listFilter = "all";
  const shown = myList.filter((m) => listFilter === "all" || typeOf(m) === listFilter);
  const pill = (f, label) => `<button class="pill" type="button" data-listfilter="${f}" aria-pressed="${listFilter === f}">${label}</button>`;
  app.innerHTML = `
    <div class="section-head"><div><h2>My list</h2><p class="muted">Saved on this device. Tap the heart again to remove a title.</p></div>
      <button class="btn ghost" type="button" id="clear-list">Clear all</button></div>
    <div class="tools solo" role="group" aria-label="Filter my list">
      ${pill("all", `All (${myList.length})`)}${pill("movie", `Movies (${movies})`)}${pill("tv", `Series (${series})`)}
    </div>
    <div class="grid">${shown.map((m) => card(m)).join("")}</div>`;
}

async function showSearch(query) {
  const token = ++navToken;
  document.title = `${query} - KravN Suggests`;
  qInput.value = query;
  app.innerHTML = `
    <div class="section-head"><h2>Results for “${esc(query)}”</h2></div>
    <div class="grid" id="grid">${skeletons(12)}</div>`;
  let items;
  try {
    items = await api("/search?q=" + encodeURIComponent(query));
  } catch (e) {
    if (token === navToken) $("#grid").outerHTML = errorBox(e.message);
    return;
  }
  if (token !== navToken) return;
  if (!items.length) {
    $("#grid").outerHTML = `<div class="notice"><h3>Nothing found</h3><p>Check the spelling or try the full title.</p></div>`;
    return;
  }

  const movies = items.filter((m) => typeOf(m) === "movie").length;
  const series = items.length - movies;
  let filter = "all";
  $("#grid").outerHTML = `
    <div class="tools solo" id="stools" role="group" aria-label="Filter results">
      <button class="pill" type="button" data-filter="all" aria-pressed="true">All (${items.length})</button>
      <button class="pill" type="button" data-filter="movie" aria-pressed="false">Movies (${movies})</button>
      <button class="pill" type="button" data-filter="tv" aria-pressed="false">Series (${series})</button>
    </div>
    <div class="grid" id="sgrid"></div>`;
  const draw = () => {
    const shown = items.filter((m) => filter === "all" || typeOf(m) === filter);
    $("#sgrid").innerHTML = shown.length
      ? shown.map((m) => card(m)).join("")
      : `<div class="notice"><h3>No ${filter === "tv" ? "series" : "movies"} in these results</h3><p>Try the “All” tab.</p></div>`;
    document.querySelectorAll("#stools .pill").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.filter === filter)));
  };
  $("#stools").addEventListener("click", (e) => {
    const button = e.target.closest(".pill");
    if (!button) return;
    filter = button.dataset.filter;
    draw();
  });
  draw();
}

async function showTitle(type, id) {
  const token = ++navToken;
  app.innerHTML = `<div class="skel" style="height:460px;border-radius:18px;margin-top:36px"></div>`;
  let movie;
  try {
    movie = await api(`/${type}/${id}`);
  } catch (e) {
    if (token === navToken) app.innerHTML = errorBox(e.message);
    return;
  }
  if (token !== navToken) return;

  document.title = `${movie.title} - KravN Suggests`;
  app.innerHTML = detailHtml(movie) + matchesShell(movie);
  const play = $("#play");
  if (play) play.addEventListener("click", () => openTrailer(movie.trailerKey));
  loadMatches(movie, token);
}

function detailHtml(m) {
  const tv = typeOf(m) === "tv";
  const runtime = formatRuntime(m.runtime);
  const votes = m.voteCount > 0 ? ` (${new Intl.NumberFormat("en", { notation: "compact" }).format(m.voteCount)} votes)` : "";
  const country = regionName(m.region);
  const noun = tv ? "series" : "movie";

  const providers = m.providers.length
    ? `<div class="providers"><h3>Where to watch in ${esc(country)}</h3>
         <ul>${m.providers.map((p) => `<li>${p.logoUrl ? `<img src="${esc(p.logoUrl)}" alt="">` : ""}<span><b>${esc(p.name)}</b><small>${esc(p.type)}</small></span></li>`).join("")}</ul>
         ${m.providerLink ? `<a class="link" href="${esc(m.providerLink)}" target="_blank" rel="noopener">See all options</a>` : ""}</div>`
    : `<div class="providers"><h3>Where to watch in ${esc(country)}</h3><p class="muted">No streaming information is available yet.</p></div>`;

  const cast = m.cast.length
    ? `<section><div class="section-head"><h2>Cast</h2></div><ul class="cast">${m.cast.map((c) =>
        `<li>${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="${esc(c.name)}" loading="lazy">` : `<div class="avatar"></div>`}<b>${esc(c.name)}</b><span>${esc(c.character)}</span></li>`).join("")}</ul></section>`
    : "";

  const seasons = tv && m.seasons && m.seasons.length
    ? `<section><div class="section-head"><h2>Seasons</h2><p class="muted">${esc(plural(m.seasons.length, "season"))}</p></div>
        <ul class="seasons">${m.seasons.map((s) =>
          `<li>${s.posterUrl ? `<img src="${esc(s.posterUrl)}" alt="" loading="lazy">` : `<div class="avatar"></div>`}<b>${esc(s.name)}</b><span>${esc(plural(s.episodes, "episode"))}${s.year ? " · " + esc(s.year) : ""}</span></li>`).join("")}</ul></section>`
    : "";

  const key = keyOf(m);
  registry.set(key, { id: m.id, title: m.title, year: m.year, posterUrl: m.posterUrl,
                      rating: m.rating, genres: m.genres, overview: "", mediaType: typeOf(m) });
  const saved = isSaved(key);
  const backdrop = m.backdropUrl ? ` style="--backdrop:url('${esc(m.backdropUrl)}')"` : "";
  const seasonFact = tv && m.seasonCount > 0
    ? `<span>${esc(plural(m.seasonCount, "season"))}${m.episodeCount > 0 ? " · " + esc(plural(m.episodeCount, "episode")) : ""}</span>` : "";
  return `
    <section class="detail${tv ? " is-tv" : ""}"${backdrop}>
      <div class="detail-grid">
        ${m.posterUrl ? `<img class="detail-poster" src="${esc(m.posterUrl)}" alt="Poster of ${esc(m.title)}">` : `<div class="detail-poster"></div>`}
        <div>
          <h1>${esc(m.title)}</h1>
          <div class="facts">
            ${tv ? `<span class="type-chip">Series</span>` : ""}
            ${m.year ? `<span>${esc(m.year)}</span>` : ""}
            ${seasonFact}
            ${runtime ? `<span>${esc(runtime)}${tv ? " per episode" : ""}</span>` : ""}
            ${m.rating > 0 ? `<span class="score-chip">★ ${m.rating.toFixed(1)}${esc(votes)}</span>` : ""}
            ${tv && m.status ? `<span class="status-chip">${esc(m.status)}</span>` : ""}
          </div>
          ${m.tagline ? `<p class="tagline">${esc(m.tagline)}</p>` : ""}
          <div class="genre-row">${m.genres.map((g) => `<span>${esc(g)}</span>`).join("")}</div>
          <p class="overview">${esc(m.overview || "No description available yet.")}</p>
          ${m.director ? `<p class="director">${tv ? "Created by" : "Directed by"} <b>${esc(m.director)}</b></p>` : ""}
          <div class="actions">
            ${m.trailerKey ? `<button class="btn primary" id="play" type="button">▶ Watch trailer</button>` : ""}
            <button class="btn ghost" type="button" data-save="${key}" aria-pressed="${saved}">${HEART}<span class="save-label">${saved ? "Saved to My list" : "Add to My list"}</span></button>
          </div>
          ${providers}
        </div>
      </div>
    </section>
    ${cast}
    ${seasons}`;
}

function matchesShell(m) {
  return `
    <section id="matches">
      <div class="section-head">
        <div>
          <h2>Watch if you like ${esc(m.title)}</h2>
          <p class="muted">The percentage shows how close each title is to ${esc(m.title)} in themes, tone and style.</p>
        </div>
        <div class="tools" id="tools" hidden></div>
      </div>
      <ul class="legend" id="legend">
        <li class="high">80% and up: near twin</li>
        <li class="mid">60 to 79%: same wavelength</li>
        <li class="low">Below 60%: loosely related</li>
      </ul>
      <div class="grid matches-grid" id="mgrid">${skeletons(8)}</div>
    </section>`;
}

async function loadMatches(movie, token) {
  let data;
  try {
    data = await api(`/${typeOf(movie)}/${movie.id}/matches`);
  } catch (e) {
    if (token === navToken) $("#mgrid").outerHTML = errorBox(e.message);
    return;
  }
  if (token !== navToken) return;

  if (data.matches.length === 0) {
    $("#mgrid").outerHTML = `<div class="notice"><h3>No recommendations yet</h3><p>TMDB doesn't have similar titles for this one.</p></div>`;
    return;
  }

  const counts = { high: 0, mid: 0, low: 0 };
  data.matches.forEach((m) => counts[band(m.similarity)]++);
  $("#legend").innerHTML = `
    <li class="high">80% and up, near twin (${counts.high})</li>
    <li class="mid">60 to 79%, same wavelength (${counts.mid})</li>
    <li class="low">Below 60%, loosely related (${counts.low})</li>`;

  let sort = "match";
  const sorters = {
    match: (a, b) => b.similarity - a.similarity,
    rating: (a, b) => b.movie.rating - a.movie.rating,
    newest: (a, b) => (b.movie.year || "0").localeCompare(a.movie.year || "0"),
  };
  const tools = $("#tools");
  tools.innerHTML = `
    <button class="pill" data-sort="match" aria-pressed="true">Best match</button>
    <button class="pill" data-sort="rating" aria-pressed="false">Top rated</button>
    <button class="pill" data-sort="newest" aria-pressed="false">Newest</button>
    ${data.aiScored
      ? `<span class="badge ai">Scored by Claude</span>`
      : `<span class="badge" title="Add an Anthropic API key to get AI scoring">Estimated from shared genres</span>`}`;
  tools.hidden = false;

  const draw = () => {
    const sorted = [...data.matches].sort(sorters[sort]);
    $("#mgrid").innerHTML = sorted.map((m) => card(m.movie, m)).join("");
    tools.querySelectorAll(".pill").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sort === sort)));
    animateRings();
  };
  tools.addEventListener("click", (e) => {
    const button = e.target.closest(".pill");
    if (!button) return;
    sort = button.dataset.sort;
    draw();
  });
  draw();
}

/* ===== router (uses the # part of the URL so Back and shareable links work) ===== */
function route() {
  window.scrollTo(0, 0);
  const [page, ...rest] = (location.hash || "#/").slice(2).split("/");
  // Highlight the matching tab in the top bar.
  const section = page === "movies" || page === "movie" ? "movies"
    : page === "series" || page === "tv" ? "series" : page === "list" ? "list" : page === "search" ? "" : "home";
  document.querySelectorAll("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === section));
  const arg = rest.join("/");
  try {
    if ((page === "movie" || page === "tv") && /^\d+$/.test(arg)) return showTitle(page, arg);
    if (page === "list") return showList();
    if (page === "movies") return showBrowse("movie");
    if (page === "series") return showBrowse("tv");
    if (page === "search" && arg) return showSearch(decodeURIComponent(arg));
  } catch {
    /* a badly encoded link falls through to the home page */
  }
  return showHome();
}
window.addEventListener("hashchange", route);

/* ===== trailer pop-up ===== */
function openTrailer(key) {
  const k = encodeURIComponent(key);
  if (typeof dialog.showModal === "function") {
    dialogFrame.src = `https://www.youtube-nocookie.com/embed/${k}?autoplay=1&rel=0`;
    dialog.showModal();
  } else {
    window.open(`https://www.youtube.com/watch?v=${k}`, "_blank", "noopener");
  }
}
dialog.addEventListener("close", () => { dialogFrame.src = "about:blank"; });
dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
$("#trailer-close").addEventListener("click", () => dialog.close());

/* ===== search box with live suggestions ===== */
let suggestTimer;
let suggestSeq = 0;
let activeIndex = -1;

function hideSuggest() {
  clearTimeout(suggestTimer);
  suggestSeq++; // ignore any request that is still in flight
  activeIndex = -1;
  suggestBox.hidden = true;
  suggestBox.innerHTML = "";
  qInput.setAttribute("aria-expanded", "false");
}

function showSuggest(movies) {
  if (movies.length === 0) return hideSuggest();
  suggestBox.innerHTML = movies.map((m) => `
    <li role="option" data-id="${m.id}" data-type="${typeOf(m)}">
      ${m.posterUrl ? `<img src="${esc(m.posterUrl)}" alt="">` : `<div class="thumb"></div>`}
      <div><b>${esc(m.title)}</b><span>${typeOf(m) === "tv" ? "Series" : "Movie"}${m.year ? " · " + esc(m.year) : ""}</span></div>
    </li>`).join("");
  activeIndex = -1;
  suggestBox.hidden = false;
  qInput.setAttribute("aria-expanded", "true");
}

function setActive(index) {
  const items = [...suggestBox.querySelectorAll("li")];
  items.forEach((li, i) => li.classList.toggle("active", i === index));
  activeIndex = index;
}

qInput.addEventListener("input", () => {
  clearTimeout(suggestTimer);
  const query = qInput.value.trim();
  if (query.length < 2) return hideSuggest();
  suggestTimer = setTimeout(async () => {
    const seq = ++suggestSeq;
    try {
      const movies = await api("/search?q=" + encodeURIComponent(query));
      if (seq === suggestSeq) showSuggest(movies.slice(0, 6));
    } catch {
      if (seq === suggestSeq) hideSuggest();
    }
  }, 250);
});

qInput.addEventListener("keydown", (e) => {
  const items = suggestBox.querySelectorAll("li");
  if (e.key === "ArrowDown" && items.length) {
    e.preventDefault();
    setActive((activeIndex + 1) % items.length);
  } else if (e.key === "ArrowUp" && items.length) {
    e.preventDefault();
    setActive((activeIndex - 1 + items.length) % items.length);
  } else if (e.key === "Enter") {
    e.preventDefault();
    const query = qInput.value.trim();
    const chosen = activeIndex >= 0 ? items[activeIndex] : null;
    hideSuggest();
    if (chosen) location.hash = `#/${chosen.dataset.type}/${chosen.dataset.id}`;
    else if (query) location.hash = "#/search/" + encodeURIComponent(query);
  } else if (e.key === "Escape") {
    hideSuggest();
  }
});

// mousedown (not click) so it fires before the input loses focus
suggestBox.addEventListener("mousedown", (e) => {
  const item = e.target.closest("li[data-id]");
  if (!item) return;
  e.preventDefault();
  const target = `#/${item.dataset.type}/${item.dataset.id}`;
  hideSuggest();
  location.hash = target;
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) hideSuggest(); });

// Heart buttons, row arrows and the "/" shortcut
document.addEventListener("click", (e) => {
  const heart = e.target.closest("[data-save]");
  if (heart) {
    e.preventDefault();
    toggleSave(heart.dataset.save);
    return;
  }
  const genreBtn = e.target.closest("[data-genre]");
  if (genreBtn) {
    browseState[browseType].genre = Number(genreBtn.dataset.genre);
    renderBrowseBody(navToken);
    return;
  }
  const sortBtn = e.target.closest("[data-bsort]");
  if (sortBtn) {
    browseState[browseType].sort = sortBtn.dataset.bsort;
    renderBrowseBody(navToken);
    return;
  }
  if (e.target.closest("#load-more")) {
    browsePage += 1;
    loadBrowsePage(navToken, browseToken, false);
    return;
  }
  const listBtn = e.target.closest("[data-listfilter]");
  if (listBtn) {
    listFilter = listBtn.dataset.listfilter;
    showList();
    return;
  }
  if (e.target.closest("#clear-list")) {
    if (myList.length && confirm("Remove everything from My list?")) {
      const backup = myList;
      myList = [];
      persist();
      syncSaveUi();
      showList();
      toast("My list cleared", () => { myList = backup; persist(); syncSaveUi(); if (location.hash === "#/list") showList(); });
    }
    return;
  }
  if (e.target.closest("#to-top")) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  if (e.target.closest("#surprise")) {
    surprise();
    return;
  }
  const arrow = e.target.closest(".arrow");
  if (arrow) {
    const row = $("#row-" + arrow.dataset.row);
    if (row) row.scrollBy({ left: Number(arrow.dataset.dir) * row.clientWidth * 0.8, behavior: "smooth" });
  }
});
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    qInput.focus();
  }
});

// "Back to top" button appears after scrolling down.
window.addEventListener("scroll", () => {
  const btn = $("#to-top");
  if (btn) btn.classList.toggle("show", window.scrollY > 700);
}, { passive: true });

syncSaveUi();
route();