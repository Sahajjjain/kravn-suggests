"use strict";

/* ===== tiny helpers ===== */
const $ = (selector) => document.querySelector(selector);
const app = $("#app");
const qInput = $("#q");
const suggestBox = $("#suggest");
const dialog = $("#trailer");
const dialogFrame = $("#trailer-frame");

const TRY_SERIES = ["Breaking Bad", "Money Heist", "Stranger Things", "Panchayat", "The Boys", "Dark"];
const TRY_THESE = ["Inception", "Parasite", "3 Idiots", "Interstellar", "Dangal", "The Dark Knight"];
const band = (percent) => (percent >= 80 ? "high" : percent >= 60 ? "mid" : "low");
const RING_LENGTH = 113.1; // circumference of the meter circle (2 * pi * 18)

const HEART = `<svg class="heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;
const registry = new Map(); // "type:id" -> title, so a heart button can find the title it belongs to
const keyOf = (m) => `${m.type || "movie"}:${m.id}`;
const kindWord = (type) => (type === "tv" ? "series" : "movie");
const HOME_KEY = "kravn.home";
let homeType = (() => { try { return localStorage.getItem(HOME_KEY) === "tv" ? "tv" : "movie"; } catch { return "movie"; } })();

/* ===== "My list": saved in this browser's localStorage ===== */
const LIST_KEY = "kravn.list";
function readList() {
  try {
    const saved = JSON.parse(localStorage.getItem(LIST_KEY));
    return Array.isArray(saved) ? saved : [];
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

function toggleSave(key) {
  const movie = registry.get(key);
  if (!movie) return;
  if (isSaved(key)) {
    myList = myList.filter((m) => keyOf(m) !== key);
  } else {
    myList = [{ id: movie.id, type: movie.type || "movie", title: movie.title, year: movie.year, posterUrl: movie.posterUrl,
                rating: movie.rating, genres: movie.genres || [], overview: "" }, ...myList];
  }
  persist();
  syncSaveUi();
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
    throw new Error(body.message || "Something went wrong. Please try again.");
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
  const type = movie.type || "movie";
  const key = keyOf(movie);
  registry.set(key, movie);
  const poster = movie.posterUrl
    ? `<img src="${esc(movie.posterUrl)}" alt="Poster of ${esc(movie.title)}" loading="lazy">`
    : `<div class="no-poster">${esc(movie.title)}</div>`;
  const rating = movie.rating > 0 ? `<span class="chip-rating">★ ${movie.rating.toFixed(1)}</span>` : "";
  const firstGenre = (movie.genres || [])[0];
  const sub = (movie.year ? `<span>${esc(movie.year)}</span>` : "") + (firstGenre ? `<span>${esc(firstGenre)}</span>` : "");
  const saved = isSaved(key);
  const tag = type === "tv" ? `<span class="chip-type">Series</span>` : "";

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
      <a class="card-link" href="#/${type}/${movie.id}">
        <div class="poster-wrap"><div class="poster">${poster}${rating}${tag}</div>${ring}</div>
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

async function loadRow(token, name, onData) {
  const row = $("#row-" + name);
  try {
    const movies = await api(`/lists/${homeType}/${name}`);
    if (token !== navToken) return;
    row.innerHTML = movies.map((m) => card(m)).join("");
    if (onData) onData(movies);
  } catch (e) {
    if (token !== navToken) return;
    const block = row.closest(".row-block");
    // Show the error once, not once per row.
    if ($(".notice.error")) block.remove();
    else block.outerHTML = errorBox(e.message);
  }
}

// Puts a random top-trending movie's backdrop behind the hero.
function feature(movies) {
  const pool = movies.slice(0, 6).filter((m) => m.backdropUrl);
  const hero = $("#hero");
  if (!pool.length || !hero) return;
  const m = pool[Math.floor(Math.random() * pool.length)];
  hero.style.setProperty("--backdrop", `url('${m.backdropUrl}')`);
  $("#featured").innerHTML = `<a class="featured" href="#/${m.type || homeType}/${m.id}">
      ${m.posterUrl ? `<img src="${esc(m.posterUrl)}" alt="">` : ""}
      <div><small>Trending right now</small><b>${esc(m.title)}</b><span>See ${homeType === "tv" ? "series" : "movies"} like this</span></div></a>`;
}

async function showHome() {
  const token = ++navToken;
  document.title = "KravN Suggests";
  qInput.value = "";
  const tv = homeType === "tv";
  app.innerHTML = `
    <section class="hero" id="hero">
      <div class="type-toggle" role="group" aria-label="Browse">
        <button class="pill" type="button" data-home="movie" aria-pressed="${!tv}">Movies</button>
        <button class="pill" type="button" data-home="tv" aria-pressed="${tv}">Series</button>
      </div>
      <h1>${tv ? "Loved a series? Find the next one." : "Loved a movie? Find the next one."}</h1>
      <p>Search any film or series and see what to watch if you liked it. Every pick comes with a match meter, so you know how close it really is before you press play.</p>
      <div class="try">${(tv ? TRY_SERIES : TRY_THESE).map((n) => `<a href="#/search/${encodeURIComponent(n)}">${esc(n)}</a>`).join("")}</div>
      <div id="featured"></div>
    </section>
    ${rowShell("trending", "Trending this week")}
    ${rowShell("now_playing", tv ? "On air now" : "In theatres now")}
    ${rowShell("top_rated", "All-time top rated")}`;
  loadRow(token, "trending", feature);
  loadRow(token, "now_playing");
  loadRow(token, "top_rated");
}

function showList() {
  ++navToken;
  document.title = "My list - KravN Suggests";
  app.innerHTML = myList.length
    ? `<div class="section-head"><div><h2>My list</h2><p class="muted">Saved on this device. Tap the heart again to remove a title.</p></div></div>
       <div class="grid">${myList.map((m) => card(m)).join("")}</div>`
    : `<div class="notice"><h3>Your list is empty</h3><p>Tap the heart on any poster to save it here for later.</p></div>`;
}

async function showSearch(query) {
  const token = ++navToken;
  document.title = `${query} - KravN Suggests`;
  qInput.value = query;
  app.innerHTML = `
    <div class="section-head"><h2>Results for “${esc(query)}”</h2></div>
    <div class="grid" id="grid">${skeletons(12)}</div>`;
  try {
    const movies = await api("/search?q=" + encodeURIComponent(query));
    if (token !== navToken) return;
    $("#grid").outerHTML = movies.length
      ? `<div class="grid">${movies.map((m) => card(m)).join("")}</div>`
      : `<div class="notice"><h3>No movies or series found</h3><p>Check the spelling or try the full title.</p></div>`;
  } catch (e) {
    if (token === navToken) $("#grid").outerHTML = errorBox(e.message);
  }
}

async function showMovie(type, id) {
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
  const runtime = formatRuntime(m.runtime);
  const votes = m.voteCount > 0 ? ` (${new Intl.NumberFormat("en", { notation: "compact" }).format(m.voteCount)} votes)` : "";
  const country = regionName(m.region);

  const providers = m.providers.length
    ? `<div class="providers"><h3>Where to watch in ${esc(country)}</h3>
         <ul>${m.providers.map((p) => `<li>${p.logoUrl ? `<img src="${esc(p.logoUrl)}" alt="">` : ""}<span><b>${esc(p.name)}</b><small>${esc(p.type)}</small></span></li>`).join("")}</ul>
         ${m.providerLink ? `<a class="link" href="${esc(m.providerLink)}" target="_blank" rel="noopener">See all options</a>` : ""}</div>`
    : `<div class="providers"><h3>Where to watch in ${esc(country)}</h3><p class="muted">No streaming information is available yet.</p></div>`;

  const cast = m.cast.length
    ? `<section><div class="section-head"><h2>Cast</h2></div><ul class="cast">${m.cast.map((c) =>
        `<li>${c.photoUrl ? `<img src="${esc(c.photoUrl)}" alt="${esc(c.name)}" loading="lazy">` : `<div class="avatar"></div>`}<b>${esc(c.name)}</b><span>${esc(c.character)}</span></li>`).join("")}</ul></section>`
    : "";

  const type = m.type || "movie";
  const key = keyOf(m);
  registry.set(key, { id: m.id, type, title: m.title, year: m.year, posterUrl: m.posterUrl,
                       rating: m.rating, genres: m.genres, overview: "" });
  const saved = isSaved(key);
  const backdrop = m.backdropUrl ? ` style="--backdrop:url('${esc(m.backdropUrl)}')"` : "";
  return `
    <section class="detail"${backdrop}>
      <div class="detail-grid">
        ${m.posterUrl ? `<img class="detail-poster" src="${esc(m.posterUrl)}" alt="Poster of ${esc(m.title)}">` : `<div class="detail-poster"></div>`}
        <div>
          <h1>${esc(m.title)}</h1>
          <div class="facts">
            ${m.year ? `<span>${esc(m.year)}</span>` : ""}
            ${type === "tv" ? `<span>Series</span>` : ""}
            ${m.seasons > 0 ? `<span>${m.seasons} season${m.seasons > 1 ? "s" : ""}</span>` : ""}
            ${runtime ? `<span>${esc(runtime)}${type === "tv" ? " / ep" : ""}</span>` : ""}
            ${m.rating > 0 ? `<span class="score-chip">★ ${m.rating.toFixed(1)}${esc(votes)}</span>` : ""}
          </div>
          ${m.tagline ? `<p class="tagline">${esc(m.tagline)}</p>` : ""}
          <div class="genre-row">${m.genres.map((g) => `<span>${esc(g)}</span>`).join("")}</div>
          <p class="overview">${esc(m.overview || "No description available yet.")}</p>
          ${m.director ? `<p class="director">${type === "tv" ? "Created by" : "Directed by"} <b>${esc(m.director)}</b></p>` : ""}
          <div class="actions">
            ${m.trailerKey ? `<button class="btn primary" id="play" type="button">▶ Watch trailer</button>` : ""}
            <button class="btn ghost" type="button" data-save="${key}" aria-pressed="${saved}">${HEART}<span class="save-label">${saved ? "Saved to My list" : "Add to My list"}</span></button>
          </div>
          ${providers}
        </div>
      </div>
    </section>
    ${cast}`;
}

function matchesShell(m) {
  return `
    <section id="matches">
      <div class="section-head">
        <div>
          <h2>Watch if you like ${esc(m.title)}</h2>
          <p class="muted">The percentage shows how close each pick is to ${esc(m.title)} in themes, tone and style.</p>
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
    data = await api(`/${movie.type || "movie"}/${movie.id}/matches`);
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
  const arg = rest.join("/");
  try {
    if ((page === "movie" || page === "tv") && /^\d+$/.test(arg)) return showMovie(page, arg);
    if (page === "list") return showList();
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
    <li role="option" data-id="${m.id}" data-type="${m.type || "movie"}">
      ${m.posterUrl ? `<img src="${esc(m.posterUrl)}" alt="">` : `<div class="thumb"></div>`}
      <div><b>${esc(m.title)}</b><span>${esc(m.year)}${m.type === "tv" ? " · Series" : ""}</span></div>
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
  const { id, type } = item.dataset;
  hideSuggest();
  location.hash = `#/${type}/${id}`;
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
  const home = e.target.closest("[data-home]");
  if (home) {
    homeType = home.dataset.home;
    try { localStorage.setItem(HOME_KEY, homeType); } catch { /* ignore */ }
    showHome();
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

syncSaveUi();
route();
