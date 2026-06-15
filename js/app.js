/* =====================================================================
   app.js — UI + map orchestration
   ===================================================================== */

const state = {
  map: null,
  layers: { competitors: null, selected: null, anchors: null, heat: null, center: null },
  selectedBrand: null,    // franchise whose existing branches are shown on the map
  hidden: new Set(),      // map layer keys the user has toggled off via the legend
  radius: 1000,           // search/trade-area radius in metres (user-adjustable)
  hintShown: false,       // one-time "click the map" hint
  voiceOut: false,        // assistant reads answers aloud
  currentArea: null,
  currentKey: null,
  results: [],            // full ranked list for the current area
  competitors: [],        // competitor pins within the current radius
  allCompetitors: [],     // fixed competitor pool for the whole current city
  branchPools: {},        // fixed existing-branch locations per brand id
  activeCat: null,        // category tab filter (null = All)
  filters: { budget: "any", types: [], ownership: "any", format: "any" },
  saved: JSON.parse(localStorage.getItem("pfa_saved") || "[]"),
  leads: JSON.parse(localStorage.getItem("pfa_leads") || "[]"),
  chat: [],
};

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const peso = (n) => "₱" + n.toLocaleString("en-PH");
const joinList = (a) => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];

/* --------------------------- Map setup ----------------------------- */
function initMap() {
  state.map = L.map("map", { zoomControl: false, attributionControl: true })
    .setView([12.8797, 121.7740], 6);

  // Google-Earth-style satellite imagery (Esri World Imagery, no API key)
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics", maxZoom: 19,
  }).addTo(state.map);
  // Transparent reference overlays: place names + roads, tuned for imagery
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, opacity: 0.9 }).addTo(state.map);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}", { maxZoom: 19, opacity: 0.7 }).addTo(state.map);

  state.layers.competitors = L.layerGroup().addTo(state.map);
  state.layers.selected = L.layerGroup().addTo(state.map);
  state.layers.anchors = L.layerGroup().addTo(state.map);
  state.layers.center = L.layerGroup().addTo(state.map);
}

/* ------------------- Area resolution / geocoding ------------------- */
function normalize(s) { return s.trim().toLowerCase().replace(/\s+/g, " "); }

function seededRand(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6D2B79F5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function synthArea(name, lat, lng) {
  const rnd = seededRand(name);
  const tiers = ["mass", "mid", "premium"];
  const incomeTier = tiers[Math.floor(rnd() * 3)];
  const dist = {};
  Object.keys(CATEGORIES).forEach(c => { dist[c] = Math.floor(rnd() * 13) + 2; });
  const types = ["mall", "school", "office", "hospital", "church", "transit"];
  const anchors = [];
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const t = types[Math.floor(rnd() * types.length)];
    anchors.push({ name: `${t[0].toUpperCase() + t.slice(1)} ${i + 1}`, type: t, off: [(rnd() - 0.5) * 0.02, (rnd() - 0.5) * 0.02] });
  }
  return {
    name, center: [lat, lng], zoom: 15, synthetic: true,
    population: "the local population", ageLabel: "a mixed customer base",
    blurb: "an estimated area profile generated from public location signals",
    demographics: { incomeTier, daytimePop: 0.4 + rnd() * 0.5, residential: 0.4 + rnd() * 0.5, student: rnd(), tourist: rnd() },
    traffic: { foot: 0.4 + rnd() * 0.5, vehicle: 0.4 + rnd() * 0.5, transit: 0.3 + rnd() * 0.5 },
    distribution: dist, anchors,
  };
}

async function resolveArea(query) {
  const key = normalize(query);
  const seededKey = AREA_ALIASES[key] || key;
  if (AREAS[seededKey]) return { key: seededKey, area: AREAS[seededKey] };
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { "Accept-Language": "en" } });
    const data = await res.json();
    if (data && data.length) {
      const { lat, lon, display_name } = data[0];
      return { key: "custom:" + key, area: synthArea(display_name.split(",").slice(0, 2).join(", "), parseFloat(lat), parseFloat(lon)) };
    }
  } catch (e) { /* offline */ }
  return null;
}

/* ----------------------- Render map layers ------------------------- */
function offsetPoint(c, off) { return [c[0] + off[0], c[1] + off[1]]; }
function clampN(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

/* Haversine distance in metres */
function distM(a, b) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toR, dLng = (b[1] - a[1]) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/* Build a location-specific profile for the current focus point: nearby
   competitor counts, traffic and anchors all reflect how dense and
   connected that exact spot is. Clicking the map re-derives this. */
/* Place `count` fixed points around a centre, area-uniform within an
   annulus [minM, maxM] metres. Returns [[lat,lng], ...]. */
function placePoints(center, count, minM, maxM, rnd) {
  const degM = 1 / 111000, coslat = Math.cos(center[0] * Math.PI / 180);
  const out = [];
  for (let i = 0; i < count; i++) {
    const ang = rnd() * Math.PI * 2;
    const dist = Math.sqrt(minM * minM + rnd() * (maxM * maxM - minM * minM));
    out.push([center[0] + dist * Math.cos(ang) * degM, center[1] + dist * Math.sin(ang) * degM / coslat]);
  }
  return out;
}

/* Fixed competitor pool for a city: real businesses at stable locations.
   Re-centring or resizing the search just selects which fall inside, so
   pins never teleport. Dense core within ~1km, sparser ring out to ~3.4km. */
/* Categories that are spread out across a city rather than clustered.
   (e.g. tutoring centres sit one-per-neighbourhood, not bunched together,
   unlike food carts / fast food / fuel which realistically cluster.) */
const DISPERSED = new Set(["education"]);

function genCompetitorPool(base) {
  const rnd = seededRand(base.name + "|pool");
  const out = [];
  Object.entries(base.distribution || {}).forEach(([cat, D]) => {
    const names = COMPETITOR_BRANDS[cat] || [];
    const pts = DISPERSED.has(cat)
      ? placePoints(base.center, D, 500, 3400, rnd)            // thin, spread out, no dense core
      : [...placePoints(base.center, D, 0, 1050, rnd), ...placePoints(base.center, Math.round(D * 1.1), 1050, 3400, rnd)];
    pts.forEach((p, i) => out.push({ category: cat, brand: names.length ? names[i % names.length] : CATEGORIES[cat].label, lat: p[0], lng: p[1] }));
  });
  return out;
}

/* Roughly how many outlets a brand in each category already has across a
   city core. Convenience and fast food are everywhere; niche concepts rare. */
const UBIQUITY = { convenience: 14, fastfood: 10, coffee: 9, milktea: 9, pharmacy: 9,
  "food-cart": 8, "service-bills": 8, beverage: 6, dessert: 6, pizza: 5, "personal-care": 5, fuel: 7, education: 3 };

/* Fixed existing-branch locations for one brand in the current city. Count
   scales with the brand's category ubiquity; positions are stable so a
   wider radius reveals more of them. Cached per brand. */
function branchPool(brand) {
  if (!state.branchPools[brand.id]) {
    const rnd = seededRand(state.baseArea.name + "|branch|" + brand.id);
    const total = Math.round((UBIQUITY[brand.category] || 5) * (0.7 + 0.6 * rnd()));
    if (DISPERSED.has(brand.category)) {
      // spread far apart, never bunched (e.g. one tutoring centre per area)
      state.branchPools[brand.id] = placePoints(state.baseArea.center, total, 700, 3400, rnd);
    } else {
      const coreN = Math.round(total * 0.6);
      state.branchPools[brand.id] = [...placePoints(state.baseArea.center, coreN, 0, 1500, rnd),
        ...placePoints(state.baseArea.center, total - coreN, 1500, 3400, rnd)];
    }
  }
  return state.branchPools[brand.id];
}

function deriveLocal(base, focus) {
  const center = base.center;
  const d = distM(focus, center);
  const anchorsNear = (base.anchors || []).filter(a => distM(focus, offsetPoint(center, a.off)) <= Math.max(950, state.radius));
  // count the fixed competitor pool that falls inside the current radius
  const near = (state.allCompetitors || []).filter(x => distM(focus, [x.lat, x.lng]) <= state.radius);
  const distribution = {};
  Object.keys(base.distribution || {}).forEach(c => { distribution[c] = 0; });
  near.forEach(x => { distribution[x.category] = (distribution[x.category] || 0) + 1; });
  const tf = clampN(0.62 + 0.12 * anchorsNear.length, 0.5, 1.1);
  const traffic = { foot: clampN(base.traffic.foot * tf, 0, 1), vehicle: clampN(base.traffic.vehicle * tf, 0, 1), transit: clampN(base.traffic.transit * tf, 0, 1) };
  return { ...base, center, distribution, traffic, anchors: anchorsNear, name: base.name };
}

/* Focus marker, search radius, landmarks and demand heatmap for the
   current focus point. */
function renderMapEnv() {
  state.layers.anchors.clearLayers();
  state.layers.center.clearLayers();
  if (state.layers.heat) { state.map.removeLayer(state.layers.heat); state.layers.heat = null; }
  const c = state.focus, base = state.baseArea;

  L.circle(c, { radius: state.radius, color: "#ffd43b", weight: 2.5, opacity: 0.9, dashArray: "7 7", fillColor: "#ffd43b", fillOpacity: 0.05, interactive: false }).addTo(state.layers.center);
  L.marker(c, { interactive: false, icon: L.divIcon({ className: "focus-icon", iconSize: [16, 16], iconAnchor: [8, 8],
    html: `<span class="focus-pulse"><span class="ring"></span><span class="ring r2"></span><span class="core"></span></span>` }) }).addTo(state.layers.center);

  const heatPoints = [];
  (state.competitors || []).forEach(x => heatPoints.push([x.lat, x.lng, 0.45]));
  (base.anchors || []).forEach(a => {
    const p = offsetPoint(base.center, a.off);
    L.marker(p, { icon: L.divIcon({ className: "anchor-icon", html: `<div class="anchor-pin">${anchorEmoji(a.type)}</div>`, iconSize: [26, 26] }) })
      .addTo(state.layers.anchors).bindTooltip(`${a.name} · ${a.type}`, { direction: "top" });
    heatPoints.push([p[0], p[1], 1.0]);
  });
  const rnd = seededRand(base.name + "|heat");
  const intensity = trafficScore(state.currentArea);
  for (let i = 0; i < 26; i++) heatPoints.push([c[0] + (rnd() - 0.5) * 0.016, c[1] + (rnd() - 0.5) * 0.016, intensity * (0.4 + rnd() * 0.6)]);

  state.layers.heat = L.heatLayer(heatPoints, { radius: 34, blur: 30, maxZoom: 17, minOpacity: 0.18,
    gradient: { 0.35: "#d9480f", 0.7: "#f08c00", 1.0: "#ffd43b" } }).addTo(state.map);
  $("#legend").classList.remove("hidden");
}

/* Re-run the full analysis for the current focus point */
function refreshAnalysis() {
  const area = deriveLocal(state.baseArea, state.focus);
  state.currentArea = area;
  // the fixed competitors that fall within the current radius (stable positions)
  state.competitors = (state.allCompetitors || []).filter(x => distM(state.focus, [x.lat, x.lng]) <= state.radius);
  renderMapEnv();
  renderMapMarkers();
  applyHiddenLayers();
  renderResults(area, rankCatalog(area, state.filters));
}

/* Draw the map's business pins. Competitors are always one consistent
   colour (matches the legend). Which competitors show depends on the
   selected franchise's category, else the active tab, else a sample.
   A selected franchise's own existing branches are overlaid distinctly. */
function renderMapMarkers() {
  if (!state.layers.competitors) return;
  const cat = state.selectedBrand ? state.selectedBrand.category : state.activeCat;
  const all = state.competitors || [];
  const list = cat
    ? all.filter(x => x.category === cat)
    : all.filter((_, i) => i % Math.ceil(all.length / 18 || 1) === 0).slice(0, 18);

  state.layers.competitors.clearLayers();
  list.forEach(x => {
    // plain white dot = "other brands nearby" (clearly distinct from the violet brand pins)
    L.circleMarker([x.lat, x.lng], { radius: 4, color: "#10151c", weight: 1, fillColor: "#ffffff", fillOpacity: 0.95 })
      .addTo(state.layers.competitors)
      .bindTooltip(`${x.brand} <span style="opacity:.6">· ${CATEGORIES[x.category].label}</span>`, { direction: "top" });
  });

  state.layers.selected.clearLayers();
  if (state.selectedBrand && state.currentArea) {
    const branches = branchPool(state.selectedBrand).filter(p => distM(state.focus, p) <= state.radius);
    branches.forEach(p => {
      // distinct teal PIN shape (not a dot) = the franchise you selected
      const icon = L.divIcon({ className: "branch-icon", html: `<span class="branch-pin"></span>`, iconSize: [30, 38], iconAnchor: [15, 36] });
      L.marker(p, { icon }).addTo(state.layers.selected)
        .bindTooltip(`${state.selectedBrand.name} <span style="opacity:.6">· existing branch</span>`, { direction: "top" });
    });
    updateMapStatus(state.selectedBrand, branches.length);
    updateLegendSelected(state.selectedBrand);
  } else {
    $("#mapStatus").classList.add("hidden");
    updateLegendSelected(null);
  }
  applyHiddenLayers(); // keep toggles in effect after re-render
}

function updateMapStatus(brand, n) {
  const el = $("#mapStatus");
  el.classList.remove("hidden");
  el.innerHTML = n > 0
    ? `<span class="pin-swatch"></span> ${n} existing <b>${brand.name}</b> branch${n > 1 ? "es" : ""} nearby`
    : `<span class="pin-swatch"></span> No existing <b>${brand.name}</b> branches here yet, open territory`;
}

function updateLegendSelected(brand) {
  const row = $("#legendSelected");
  if (brand) { row.classList.remove("hidden"); $("#legendSelectedLabel").textContent = `${brand.name} branches`; }
  else row.classList.add("hidden");
}

/* Legend doubles as layer toggles. Apply the hidden set to the map. */
function applyHiddenLayers() {
  ["center", "heat", "competitors", "selected", "anchors"].forEach(key => {
    const layer = state.layers[key];
    if (!layer || !state.map) return;
    const shouldHide = state.hidden.has(key);
    if (shouldHide && state.map.hasLayer(layer)) state.map.removeLayer(layer);
    if (!shouldHide && !state.map.hasLayer(layer)) state.map.addLayer(layer);
    const row = document.querySelector(`#legend .legend-row[data-layer="${key}"]`);
    if (row) row.classList.toggle("off", shouldHide);
  });
}
function toggleLayer(key) {
  if (state.hidden.has(key)) state.hidden.delete(key); else state.hidden.add(key);
  applyHiddenLayers();
}

function showMapHint() {
  const el = $("#mapHint"); if (!el) return;
  el.classList.remove("hidden", "fade");
  setTimeout(() => { el.classList.add("fade"); setTimeout(() => el.classList.add("hidden"), 450); }, 6500);
}
function dismissMapHint() { const el = $("#mapHint"); if (el && !el.classList.contains("hidden")) { el.classList.add("fade"); setTimeout(() => el.classList.add("hidden"), 450); } }

/* Select / deselect a franchise to show its branches on the map */
function selectBrand(id) {
  const brand = CATALOG.find(b => b.id === id);
  state.selectedBrand = (state.selectedBrand && state.selectedBrand.id === id) ? null : brand;
  renderCards();
  renderMapMarkers();
}

function anchorEmoji(t) { return ({ mall: "🛍️", school: "🎓", office: "🏢", hospital: "🏥", church: "⛪", transit: "🚉" })[t] || "📍"; }

/* Plausible existing-competitor brand names per category, so map pins
   read as real businesses ("Mercury Drug") rather than a category label. */
const COMPETITOR_BRANDS = {
  "food-cart":     ["Siomai House", "Turbo Snacks", "Fishball King", "Kwek Express", "Rice in a Box", "Squid Balls Co."],
  "coffee":        ["Bo's Coffee", "Coffee Project", "CBTL", "Starbucks", "Figaro", "Tim Hortons"],
  "milktea":       ["Chatime", "Gong Cha", "Serenitea", "Tiger Sugar", "Happy Lemon", "Macao Imperial"],
  "beverage":      ["Zagu", "Buko Loco", "Refreshers", "Thirsty", "Juice Avenue"],
  "dessert":       ["Waffle Time", "Krispy Kreme", "Dairy Queen", "Gelatissimo", "Red Ribbon"],
  "pizza":         ["Pizza Hut", "Greenwich", "Yellow Cab", "Shakey's", "Angel's Pizza"],
  "fastfood":      ["Jollibee", "McDonald's", "Mang Inasal", "Chowking", "KFC", "Burger King"],
  "convenience":   ["7-Eleven", "Alfamart", "Ministop", "FamilyMart", "Uncle John's"],
  "pharmacy":      ["Mercury Drug", "Watsons", "South Star Drug", "Rose Pharmacy", "TGP"],
  "service-bills": ["Bayad Center", "Cebuana Lhuillier", "M Lhuillier", "Palawan Pay", "RD Pawnshop"],
  "personal-care": ["Lay Bare", "Bench Fix", "David's Salon", "Nailaholics", "Let's Face It"],
  "fuel":          ["Petron", "Shell", "Caltex", "Phoenix", "Seaoil"],
  "laundry":       ["Lavandera Ko", "WashUp", "Laundromatic"],
  "education":     ["Kumon", "AMA", "MathMasters", "AHEAD Tutorial", "Reading Buddies"],
};

/* --------------------------- Brand visuals ------------------------- */
/* Real brand logos are curated per brand from whichever public favicon
   CDN actually carries a usable mark (DuckDuckGo or Google). PH SME
   brands without a recognisable icon on either source use a clean
   category tile instead of a broken placeholder. In production a paid
   logo API (Logo.dev, Brandfetch) or hosted assets would cover all. */
/* Per-brand logo sources, tried in order:
   1. A local high-res file at assets/logos/<id>.png (drop the official
      logos there and they appear automatically).
   2. A public favicon CDN for the few big brands that have a clean one.
   3. The category emoji tile as a last resort.
   Add a brand's logo by saving assets/logos/<id>.png — see the README. */
const LOGO_CANDIDATES = {
  "siomai-king":    ["assets/logos/siomai-king.jpg"],
  "toktok":         ["assets/logos/toktok.png"],
  "santinos":       ["assets/logos/santinos.png"],
  "johann-coffee":  ["assets/logos/johann-coffee.png"],
  "fruitas":        ["assets/logos/fruitas.png", "https://icons.duckduckgo.com/ip3/fruitas.ph.ico"],
  "belgian-waffles":["assets/logos/belgian-waffles.png"],
  "potato-corner":  ["assets/logos/potato-corner.png", "https://icons.duckduckgo.com/ip3/potatocorner.com.ico"],
  "macao-tea":      ["assets/logos/macao-tea.png"],
  "generika":       ["assets/logos/generika.png"],
  "bayad-center":   ["assets/logos/bayad-center.jpg"],
  "lay-bare":       ["assets/logos/lay-bare.png"],
  "7-eleven":       ["assets/logos/7-eleven.jpg", "https://icons.duckduckgo.com/ip3/7-eleven.com.ph.ico"],
  "petron-shell":   ["assets/logos/petron-shell.png", "https://icons.duckduckgo.com/ip3/petron.com.ico"],
  "jollibee":       ["assets/logos/jollibee.png", "https://www.google.com/s2/favicons?domain=jollibee.com.ph&sz=128"],
  "mcdonalds":      ["assets/logos/mcdonalds.png", "https://www.google.com/s2/favicons?domain=mcdonalds.com.ph&sz=128"],
  "bos-coffee":     ["assets/logos/bos-coffee.jpg"],
  "pickup-coffee":  ["assets/logos/pickup-coffee.jpg"],
  "mang-inasal":    ["assets/logos/mang-inasal.svg"],
  "red-ribbon":     ["assets/logos/red-ribbon.webp"],
  "belgian-waffles":["assets/logos/belgian-waffles.png"],
  "tgp":            ["assets/logos/tgp.png"],
  "k2-pharmacy":    ["assets/logos/k2-pharmacy.avif"],
  "seaoil":         ["assets/logos/seaoil.jpg"],
  "uncle-johns":    ["assets/logos/uncle-johns.png"],
  "kumon":          ["assets/logos/kumon.jpeg"],
  "ama":            ["assets/logos/ama.png"],
};
/* Walk the candidate list on each load failure; emoji shows if all fail. */
function logoFallback(img) {
  const id = img.dataset.id, i = (+img.dataset.i) + 1, cands = LOGO_CANDIDATES[id] || [];
  if (i < cands.length) { img.dataset.i = i; img.src = cands[i]; }
  else { img.style.display = "none"; const em = img.parentNode.querySelector(".emoji"); if (em) em.style.display = "grid"; }
}
function brandLogo(brand, lg) {
  const meta = CATEGORIES[brand.category];
  const cls = "avatar" + (lg ? " lg" : "");
  const style = `background:${meta.color}18;border-color:${meta.color}66`;
  const cands = LOGO_CANDIDATES[brand.id] || [];
  if (cands.length) {
    return `<div class="${cls}" style="${style}">
      <img src="${cands[0]}" data-id="${brand.id}" data-i="0" alt="${brand.name} logo" loading="lazy" onerror="logoFallback(this)" />
      <span class="emoji" style="display:none">${meta.emoji}</span></div>`;
  }
  return `<div class="${cls}" style="${style}"><span class="emoji">${meta.emoji}</span></div>`;
}
function hydrateLogos() { /* logos load directly now; kept for call sites */ }

/* Landing-page logo wall. Uses assets/logos/strip/<slug>.png when present,
   otherwise a clean brand-name chip. */
/* Landing logo wall: actual franchise logo files supplied by the client */
const STRIP_BRANDS = [
  { name: "Jollibee",       file: "jollibee.png" },
  { name: "7-Eleven",       file: "7-eleven.jpg" },
  { name: "Potato Corner",  file: "potato-corner.png" },
  { name: "Mang Inasal",    file: "mang-inasal.svg" },
  { name: "Red Ribbon",     file: "red-ribbon.webp" },
  { name: "Bo's Coffee",    file: "bos-coffee.jpg" },
  { name: "Pickup Coffee",  file: "pickup-coffee.jpg" },
  { name: "SEAOIL",         file: "seaoil.jpg" },
  { name: "K2 Pharmacy",    file: "k2-pharmacy.avif" },
  { name: "The Generics Pharmacy", file: "tgp.png" },
  { name: "Uncle John's",   file: "uncle-johns.png" },
  { name: "Kumon",          file: "kumon.jpeg" },
  { name: "AMA Education",   file: "ama.png" },
];
/* Scattered positions with depth (front = big + sharp, back = small +
   blurred + dimmed) for a layered, floating "icon cloud" like the
   reference. Index aligns with STRIP_BRANDS order. */
const CLUSTER_POS = [
  { l: 40, t: 30, s: 128, r: -4, d: "front" }, // Jollibee
  { l: 12, t: 9,  s: 104, r: 5,  d: "front" }, // 7-Eleven
  { l: 68, t: 50, s: 118, r: 4,  d: "front" }, // Potato Corner
  { l: 6,  t: 56, s: 98,  r: -5, d: "front" }, // Mang Inasal
  { l: 73, t: 9,  s: 82,  r: 6,  d: "mid" },   // Red Ribbon
  { l: 30, t: 74, s: 76,  r: 4,  d: "mid" },   // Bo's Coffee
  { l: 54, t: 67, s: 74,  r: -3, d: "mid" },   // Pickup Coffee
  { l: 90, t: 33, s: 70,  r: -6, d: "mid" },   // SEAOIL
  { l: 58, t: 5,  s: 58,  r: 8,  d: "back" },  // K2
  { l: 0,  t: 33, s: 56,  r: -7, d: "back" },  // TGP
  { l: 33, t: 4,  s: 52,  r: 6,  d: "back" },  // Uncle John's
  { l: 88, t: 72, s: 58,  r: -4, d: "back" },  // Kumon
  { l: 22, t: 35, s: 50,  r: 5,  d: "back" },  // AMA
];
const DEPTH_FACTOR = { front: 1, mid: 0.55, back: 0.3 };
function buildLogoStrip() {
  const el = document.getElementById("lpLogoStrip");
  if (!el) return;
  el.innerHTML = STRIP_BRANDS.slice(0, CLUSTER_POS.length).map((b, i) => {
    const p = CLUSTER_POS[i];
    const dur = 6 + (i % 4) * 0.9;
    return `<div class="lp-logo ${p.d}" style="left:${p.l}%;top:${p.t}%;--depth:${DEPTH_FACTOR[p.d]};animation-delay:${i * 0.06}s">
      <div class="lp-tile ${p.d}" style="width:${p.s}px;height:${p.s}px;--r:${p.r}deg;animation-duration:${dur}s;animation-delay:${(i % 5) * 0.6}s">
        <img src="assets/logos/strip/${b.file}" alt="${b.name}" onerror="this.style.display='none';this.nextElementSibling.style.display='block';" />
        <span class="lp-logo-name" style="display:none">${b.name}</span>
      </div>
    </div>`;
  }).join("");
}

/* Mouse-driven parallax: tiles shift opposite the cursor, front layer
   more than back, for depth. Disabled on touch / when landing is hidden. */
function initParallax() {
  const cluster = document.getElementById("lpLogoStrip");
  const landing = document.getElementById("landing");
  if (!cluster || !landing || window.matchMedia("(pointer: coarse)").matches) return;
  window.addEventListener("mousemove", (e) => {
    if (landing.classList.contains("hidden")) return;
    const dx = (e.clientX / window.innerWidth - 0.5);
    const dy = (e.clientY / window.innerHeight - 0.5);
    cluster.querySelectorAll(".lp-logo").forEach(el => {
      const depth = parseFloat(el.style.getPropertyValue("--depth")) || 0.5;
      const max = 34 * depth;
      el.style.setProperty("--px", (-dx * max).toFixed(1) + "px");
      el.style.setProperty("--py", (-dy * max).toFixed(1) + "px");
    });
  }, { passive: true });
}

function scoreBadge(s, id) {
  const cls = s >= 75 ? "good" : s >= 55 ? "mid" : "low";
  const attrs = id ? `data-act="score" data-id="${id}" title="Click for the Fit Score breakdown"` : "";
  return `<div class="score ${cls}" ${attrs}><b>${s}</b><span>/100</span></div>`;
}

/* Focused popover explaining how the Fit Score was calculated */
function openScoreModal(id) {
  const row = state.results.find(r => r.brand.id === id);
  if (!row) return;
  const { brand, fit } = row, area = state.currentArea;
  const FACTORS = [
    ["Low competition", "competition", "Fewer direct rivals within your radius"],
    ["Category whitespace", "saturation", "How under-served this category is here"],
    ["Traffic & demand", "traffic", "Foot and vehicle traffic plus daytime population"],
    ["Income match", "demand", "Local spending power vs the brand's price point"],
    ["Entry accessibility", "access", "How attainable the startup capital is"],
  ];
  const bars = FACTORS.map(([label, key, desc]) => {
    const v = Math.round((fit.components[key] || 0) * 100);
    return `<div class="sb-row"><div class="sb-top"><span>${label}</span><b>${v}%</b></div>
      <div class="bar"><i style="width:${v}%"></i></div><div class="sb-desc">${desc}</div></div>`;
  }).join("");
  $("#scoreCard").innerHTML = `
    <button class="icon-btn close" data-close>✕</button>
    <div class="sb-head">${scoreBadge(fit.score)}
      <div><h2>Fit Score ${fit.score}/100</h2>
        <p class="muted">How well <b>${brand.name}</b> suits ${area ? area.name : "this area"}. The score is a weighted blend of the factors below, so a higher score means a stronger overall fit.</p></div>
    </div>
    <div class="sb-bars">${bars}</div>
    <button class="btn primary full" data-act="detail" data-id="${brand.id}">See full details</button>`;
  $("#scoreModal").classList.remove("hidden");
}

/* Formal, capitalised labels for the detail view */
const FORMAT_LABEL = { cart: "Cart", kiosk: "Kiosk", inline: "In-line store", standalone: "Standalone branch" };
const FMT_TIER = { cart: 0, kiosk: 1, inline: 2, standalone: 3 };
const FMT_SPACE = { cart: "2 to 6 sqm", kiosk: "6 to 15 sqm", inline: "20 to 60 sqm", standalone: "Standalone lot" };
/* Per-format requirements for a brand. Single-format brands return one row
   (the brand's own figures); multi-format brands split the investment range
   across formats (cart cheapest, in-line priciest) with format-typical space. */
function formatReqs(brand) {
  const fmts = brandFormats(brand).slice().sort((a, b) => (FMT_TIER[a] ?? 9) - (FMT_TIER[b] ?? 9));
  if (fmts.length === 1) return [{ format: fmts[0], label: FORMAT_LABEL[fmts[0]], investMin: brand.investMin, investMax: brand.investMax, space: brand.space }];
  const r10 = (v) => Math.round(v / 10000) * 10000;
  const min = brand.investMin, max = brand.investMax, step = (max - min) / fmts.length;
  return fmts.map((f, i) => ({ format: f, label: FORMAT_LABEL[f], investMin: r10(min + i * step), investMax: r10(min + (i + 1) * step), space: FMT_SPACE[f] || brand.space }));
}
const OWNERSHIP_LABEL = { owner: "Owner-operated", passive: "Semi-passive" };

/* Franchise fee is the upfront licence fee, distinct from total investment
   (which also covers equipment, fit-out and opening stock). Where a
   franchisor does not publish it, estimate from total investment using a
   capital-tiered share. */
function estFee(b) {
  if (b.franchiseFee) return { value: b.franchiseFee, est: false };
  const m = b.investMin;
  const pct = m < 500000 ? 0.30 : m < 2000000 ? 0.25 : m < 10000000 ? 0.15 : 0.08;
  let v = m * pct;
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(v)) - 1));
  v = Math.round(v / mag) * mag;
  return { value: v, est: true };
}
function feeText(b) { const f = estFee(b); return peso(f.value) + (f.est ? ' <span class="est">est.</span>' : ""); }
function investText(b) { return `${peso(b.investMin)} to ${peso(b.investMax)}`; }
function starBtn(id, on, label) {
  return `<button class="star-btn ${on ? "on" : ""}" data-act="save" data-id="${id}" title="${on ? "Saved" : "Save"}">${on ? "★" : "☆"}${label ? `<span>${on ? "Saved" : "Save"}</span>` : ""}</button>`;
}

/* --------------------------- Results UI ---------------------------- */
function renderResults(area, results) {
  state.currentArea = area;
  state.results = results;
  $("#landing").classList.add("hidden");
  $("#welcome").classList.add("hidden");
  $("#panel").classList.remove("hidden");
  $("#reverseResults").classList.add("hidden");
  $("#results").classList.remove("hidden");

  $("#panelArea").textContent = area.name;
  $("#panelSub").textContent = `${results.length} brands · ranked by Fit Score (0 to 100)`;
  $("#assistantOrb").classList.remove("hidden");  // assistant becomes available once an area is loaded
  $("#topbar").classList.remove("hidden");        // reveal the whole top bar after the first search
  $("#searchCluster").classList.remove("hidden"); // including the search field
  $("#radiusControl").classList.remove("hidden"); // and the trade-area radius control
  if (!state.hintShown) { state.hintShown = true; showMapHint(); }

  // AI reco summary
  $("#recoSummary").classList.remove("hidden");
  $("#recoSummary").innerHTML = buildReco(area, results);

  // Category tabs
  renderCatTabs(area, results);

  // Cards
  renderCards();
}

function buildReco(area, results) {
  const cats = rankCategories(area, state.filters, results).filter(c => c.score >= 50).slice(0, 3);
  if (!cats.length) return `For <b>${area.name}</b>, no categories clear the fit bar under these filters. Try widening your budget or business type.`;
  const names = cats.map(c => c.label);
  const top = results[0];
  return `<div class="reco-icon">✦</div><div class="reco-body">
      <b>AI recommendation for ${area.name}</b>
      <p>${capFirst(area.blurb)}. With ${area.population} and ${area.ageLabel}, the best-fit franchise categories here are <b>${joinList(names)}</b>.
      ${top ? `Strongest single match: <b>${top.brand.name}</b> at <b>${top.fit.score}/100</b>.` : ""}</p>
    </div>`;
}
function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function renderCatTabs(area, results) {
  const cats = rankCategories(area, state.filters, results);
  const tabs = [`<button class="cat-tab ${state.activeCat === null ? "on" : ""}" data-cat="__all">All <span>${results.length}</span></button>`]
    .concat(cats.map(c => {
      const n = results.filter(r => r.brand.category === c.category).length;
      return `<button class="cat-tab ${state.activeCat === c.category ? "on" : ""}" data-cat="${c.category}">${CATEGORIES[c.category].emoji} ${c.label} <span>${n}</span></button>`;
    }));
  $("#catTabsWrap").classList.remove("hidden");
  $("#catTabs").innerHTML = tabs.join("");
}

function renderCards() {
  const results = state.activeCat
    ? state.results.filter(r => r.brand.category === state.activeCat)
    : state.results;

  $("#results").innerHTML = results.length ? results.map(({ brand, fit }) => {
    const saved = state.saved.includes(brand.id);
    const selected = state.selectedBrand && state.selectedBrand.id === brand.id;
    return `
    <article class="card ${selected ? "selected" : ""}" data-id="${brand.id}" data-act="open">
      ${brandLogo(brand)}
      <div class="card-body">
        <div class="card-top">
          <h3>${brand.name}</h3>
          ${scoreBadge(fit.score, brand.id)}
        </div>
        <div class="card-cat">${CATEGORIES[brand.category].emoji} ${CATEGORIES[brand.category].label}</div>
        <p class="card-desc">${brand.description}</p>
        <div class="card-meta">
          <span title="One-time licence fee paid to the brand">Franchise fee <b>${feeText(brand)}</b></span>
          <span title="Total initial investment: the licence fee plus equipment, store fit-out and opening stock">Total investment <b>${investText(brand)}</b></span>
        </div>
        <div class="card-why">${fit.rationale.filter(r => r.good).slice(0, 2).map(r =>
          `<span class="why g">✓ ${r.text}</span>`).join("")}</div>
        <div class="card-actions">
          <button class="btn primary" data-act="detail" data-id="${brand.id}">View details</button>
          <button class="btn" data-act="contact" data-id="${brand.id}">Send Inquiry</button>
          <button class="btn icon map-btn ${selected ? "on" : ""}" data-act="mapsel" data-id="${brand.id}" title="Show this brand's existing branches on the map">📍</button>
          ${starBtn(brand.id, saved)}
        </div>
      </div>
    </article>`;
  }).join("") : `<div class="empty">No brands in this category under the current filters.</div>`;
  hydrateLogos();
}

/* --------------------------- Detail view --------------------------- */
function openDetail(brandId, fmtIdx) {
  const row = state.results.find(r => r.brand.id === brandId) || { brand: CATALOG.find(b => b.id === brandId), fit: null };
  const { brand, fit } = row;
  const meta = CATEGORIES[brand.category];
  const saved = state.saved.includes(brand.id);
  const reqs = formatReqs(brand);
  const fi = Math.max(0, Math.min(reqs.length - 1, fmtIdx || 0));
  const active = reqs[fi];

  const bars = fit ? Object.entries({
    "Low competition": fit.components.competition,
    "Category whitespace": fit.components.saturation,
    "Traffic and demand": fit.components.traffic,
    "Income match": fit.components.demand,
    "Entry accessibility": fit.components.access,
  }).map(([label, v]) => `<div class="bar-row"><span>${label}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div></div>`).join("") : "";

  $("#detailCard").innerHTML = `
    <div class="detail-head">
      ${brandLogo(brand, true)}
      <div class="detail-head-text">
        <h2>${brand.name}</h2>
        <div class="card-cat">${meta.emoji} ${meta.label} · ${OWNERSHIP_LABEL[brand.ownership]}</div>
      </div>
      <div class="detail-head-right">
        ${fit ? scoreBadge(fit.score, brand.id) : ""}
        ${starBtn(brand.id, saved, true)}
        <button class="icon-btn close" data-close>✕</button>
      </div>
    </div>

    <p class="detail-desc">${brand.description}</p>
    ${reqs.length > 1 ? `<div class="fmt-tabs"><span class="fmt-label">Store format</span>${reqs.map((r, i) => `<button class="fmt-chip ${i === fi ? "on" : ""}" data-act="fmt" data-id="${brand.id}" data-i="${i}">${r.label}</button>`).join("")}</div>` : `<div class="detail-formats">📐 Format: ${reqs[0].label}</div>`}

    ${fit ? `<div class="detail-rationale">
      <h4>Why it fits ${state.currentArea ? state.currentArea.name : "here"}</h4>
      <ul>${fit.rationale.filter(r => r.good).map(r => `<li class="g">✓ ${r.text}</li>`).join("")}</ul>
      <div class="bars">${bars}</div>
    </div>` : ""}

    <div class="detail-grid">
      <div><label>Franchise fee</label><b>${feeText(brand)}</b></div>
      <div><label>Total investment${reqs.length > 1 ? ` (${active.label})` : ""}</label><b>${peso(active.investMin)} to ${peso(active.investMax)}</b></div>
      <div><label>Space required</label><b>${active.space}</b></div>
    </div>

    <div class="fee-note">Franchise fee is the one-time licence fee paid to the brand. Total investment is the full cost to launch, including the fee plus equipment, store fit-out and opening stock.${estFee(brand).est ? " The franchise fee shown is an estimate." : ""}</div>

    <div class="detail-source">Source: ${brand.source}. Figures as of ${brand.asOf}, ranges vary by package, store size and location.</div>

    <div class="detail-actions">
      <button class="btn primary" data-act="contact" data-id="${brand.id}">Send Inquiry</button>
      <button class="btn" data-act="mapsel" data-id="${brand.id}">📍 Show branches</button>
    </div>`;
  $("#detailModal").classList.remove("hidden");
  hydrateLogos();
}

/* --------------------------- Contact form -------------------------- */
function openContact(brandId) {
  const brand = CATALOG.find(b => b.id === brandId);
  $("#contactCard").innerHTML = `
    <button class="icon-btn close" data-close>✕</button>
    <h2>Send Inquiry to ${brand.name}</h2>
    <p class="muted">We will pass your details to ${brand.name} as a qualified lead for ${state.currentArea ? state.currentArea.name : "your area"}.</p>
    <form id="leadForm" class="lead-form">
      <label>Full name<input name="name" required placeholder="Juan dela Cruz" /></label>
      <label>Email<input name="email" type="email" required placeholder="you@email.com" /></label>
      <label>Mobile<input name="phone" required placeholder="09xx xxx xxxx" /></label>
      <label>Target area<input name="area" value="${state.currentArea ? state.currentArea.name : ""}" /></label>
      <label>Budget
        <select name="budget"><option>Under ₱250K</option><option>₱250K to ₱500K</option><option>₱500K to ₱1M</option><option>₱1M to ₱5M</option><option>₱5M to ₱10M</option><option>₱10M and up</option></select>
      </label>
      <label class="full">Message (optional)<textarea name="message" rows="2" placeholder="When are you looking to open?"></textarea></label>
      <button type="submit" class="btn primary full">Send Inquiry</button>
    </form>`;
  $("#contactModal").classList.remove("hidden");
  $("#leadForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const lead = { brand: brand.name, brandId: brand.id, ...Object.fromEntries(fd.entries()), ts: new Date().toISOString() };
    state.leads.push(lead);
    localStorage.setItem("pfa_leads", JSON.stringify(state.leads));
    $("#contactCard").innerHTML = `
      <button class="icon-btn close" data-close>✕</button>
      <div class="success">
        <div class="check">✓</div>
        <h2>Inquiry sent</h2>
        <p>Thanks, ${(lead.name || "there").split(" ")[0]}. Your interest in <b>${brand.name}</b> for <b>${lead.area || "your area"}</b> has been logged.</p>
        <p class="muted">Demo note: leads are stored locally. ${state.leads.length} captured this session.</p>
        <button class="btn primary" data-close>Done</button>
      </div>`;
  });
}

/* ----------------------------- Saving ------------------------------ */
function toggleSave(id) {
  const i = state.saved.indexOf(id);
  if (i >= 0) state.saved.splice(i, 1); else state.saved.push(id);
  localStorage.setItem("pfa_saved", JSON.stringify(state.saved));
  $("#savedCount").textContent = state.saved.length;
  // update the star buttons in place (avoid re-rendering cards, which would
  // re-fetch the logos and make them flash)
  const on = state.saved.includes(id);
  document.querySelectorAll(`.star-btn[data-id="${id}"]`).forEach(btn => {
    const hasLabel = !!btn.querySelector("span");
    btn.classList.toggle("on", on);
    btn.title = on ? "Saved" : "Save";
    btn.innerHTML = (on ? "★" : "☆") + (hasLabel ? `<span>${on ? "Saved" : "Save"}</span>` : "");
  });
}

function openSaved() {
  const items = state.saved.map(id => CATALOG.find(b => b.id === id)).filter(Boolean);
  $("#savedCard").innerHTML = `
    <button class="icon-btn close" data-close>✕</button>
    <h2>★ Saved brands <span class="muted">(${items.length})</span></h2>
    ${items.length ? `<div class="saved-list">${items.map(b => `
      <div class="saved-row">
        ${brandLogo(b)}
        <div><b>${b.name}</b><div class="card-cat">${CATEGORIES[b.category].label} · ${investText(b)}</div></div>
        <button class="btn sm" data-act="detail" data-id="${b.id}">View</button>
        <button class="btn sm icon" data-act="unsave" data-id="${b.id}" title="Remove">✕</button>
      </div>`).join("")}</div>`
      : `<p class="muted">No saved brands yet. Tap the ☆ on any brand to shortlist it.</p>`}`;
  $("#savedModal").classList.remove("hidden");
  hydrateLogos();
}

/* --------------------------- AI assistant -------------------------- */
function detectCategory(q) {
  const map = { "coffee": "coffee", "café": "coffee", "cafe": "coffee", "milk tea": "milktea", "milktea": "milktea", "boba": "milktea",
    "pizza": "pizza", "fries": "food-cart", "siomai": "food-cart", "food cart": "food-cart", "waffle": "dessert", "dessert": "dessert",
    "juice": "beverage", "shake": "beverage", "fruit": "beverage", "burger": "fastfood", "fast food": "fastfood", "jollibee": "fastfood",
    "mcdo": "fastfood", "convenience": "convenience", "7-eleven": "convenience", "7 eleven": "convenience", "pharmacy": "pharmacy",
    "drugstore": "pharmacy", "bills": "service-bills", "payment": "service-bills", "salon": "personal-care", "wax": "personal-care",
    "spa": "personal-care", "fuel": "fuel", "gas": "fuel", "station": "fuel" };
  for (const k in map) if (q.includes(k)) return map[k];
  return null;
}

/* Fran's answers: warm, first-person, conversational, but to the point. */
function answerAsk(qRaw) {
  const q = qRaw.toLowerCase();
  const area = state.currentArea;
  if (!area) return "Search an area first and I'll tell you what fits there.";
  const cat = detectCategory(q);
  const lc = (c) => CATEGORIES[c].label.toLowerCase();

  if (/categor|what.*best|what.*fit|recommend|top/.test(q) && !cat) {
    const cats = rankCategories(area, state.filters, state.results).slice(0, 3);
    return `In ${area.name} I'd lean toward ${joinList(cats.map(c => `<b>${c.label}</b>`))} — those fit this spot best. If I had to pick one brand, it'd be <b>${state.results[0].brand.name}</b>.`;
  }
  if (/\bwhere\b/.test(q) && cat) {
    const ranked = rankAreasForCategory(cat, state.filters);
    return `For ${lc(cat)}, I'd start with <b>${ranked[0].area.name.split(",")[0]}</b> — it scores highest of the areas I track. `
      + `<button class="link-inline" data-reverse="${cat}">Want the full ranking?</button>`;
  }
  if (/why not|why isn'?t|why.*low|bad|avoid/.test(q) && cat) {
    const brand = CATALOG.find(b => b.category === cat);
    const fit = scoreBrand(brand, area, state.filters);
    const cons = fit.rationale.filter(r => !r.good);
    return cons.length
      ? `Honestly, ${lc(cat)} is a tough sell here — ${cons.map(c => c.text.toLowerCase().replace(/\.$/, "")).join(", and ")}. It lands around ${fit.score}/100.`
      : `Actually ${lc(cat)} isn't bad here at all — it scores ${fit.score}/100, no real red flags.`;
  }
  if (cat) {
    const brand = CATALOG.find(b => b.category === cat);
    const fit = scoreBrand(brand, area, state.filters);
    const pros = fit.rationale.filter(r => r.good).map(r => r.text.toLowerCase().replace(/\.$/, ""));
    return `${CATEGORIES[cat].label} looks ${fit.score >= 70 ? "strong" : fit.score >= 55 ? "decent" : "a bit risky"} here — about ${fit.score}/100. ` + (pros.length ? `What's working: ${pros.slice(0, 2).join(", and ")}.` : "Not much going for it, to be honest.");
  }
  const top = rankCatalog(area, state.filters).slice(0, 3);
  return `My top picks for ${area.name} are ${joinList(top.map(t => `<b>${t.brand.name}</b>`))}. Ask me "why not [category]?" and I'll walk you through it.`;
}

function openChat() {
  $("#assistantChat").classList.remove("hidden");
  $("#assistantOrb").classList.add("hidden");
  if (!state.chat.length) {
    pushChat("bot", "Hi, I'm Fran! Ask me anything about franchising. Let's find the right fit for you.");
  }
  renderSuggest();
  setTimeout(() => $("#chatInput").focus(), 50);
}
function closeChat() { $("#assistantChat").classList.add("hidden"); if (state.currentArea) $("#assistantOrb").classList.remove("hidden"); }

function renderSuggest() {
  const s = state.currentArea
    ? ["Best categories here?", "Why not milk tea here?", "Where is best for coffee?"]
    : ["What does this tool do?"];
  $("#chatSuggest").innerHTML = s.map(t => `<button class="sg" data-q="${t}">${t}</button>`).join("");
}

function pushChat(role, html) {
  state.chat.push({ role, html });
  const log = $("#chatLog");
  log.insertAdjacentHTML("beforeend", `<div class="msg ${role}">${html}</div>`);
  log.scrollTop = log.scrollHeight;
  if (role === "bot") speakAnswer(html);
}

/* ---- Voice icons (real line icons, not emoji) ---- */
const ICON = {
  speakerOff: '<svg viewBox="0 0 24 24" class="i"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>',
  speakerOn:  '<svg viewBox="0 0 24 24" class="i"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  mic:        '<svg viewBox="0 0 24 24" class="i"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
  send:       '<svg viewBox="0 0 24 24" class="i"><path d="M4 12l16-7-7 16-2-7-7-2z"/></svg>',
};

/* Read text aloud. en-PH usually has no synthesis voice (that was the
   silence) so we pick an available English voice and fall back to en-US. */
function speakAnswer(html) {
  if (!state.voiceOut || !window.speechSynthesis) return;
  const tmp = document.createElement("div"); tmp.innerHTML = html;
  const text = (tmp.textContent || "").replace(/›/g, ",").trim();
  if (!text) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  // a warm British woman for "Fran" (names vary by OS/browser)
  const prefer = ["Google UK English Female", "Microsoft Libby Online (Natural) - English (United Kingdom)",
    "Microsoft Sonia Online (Natural) - English (United Kingdom)", "Microsoft Libby", "Microsoft Sonia",
    "Microsoft Hazel", "Serena", "Kate", "Stephanie", "Martha", "Fiona"];
  const byName = prefer.map(n => voices.find(v => v.name && v.name.includes(n))).find(Boolean);
  const gbFemale = voices.find(v => /^en[-_]GB/i.test(v.lang) && /female|libby|sonia|hazel|serena|kate|stephanie|martha|fiona|amy|emma/i.test(v.name));
  const voice = byName || gbFemale || voices.find(v => /^en[-_]GB/i.test(v.lang)) || voices.find(v => /^en/i.test(v.lang));
  if (voice) { u.voice = voice; u.lang = voice.lang; } else { u.lang = "en-GB"; }
  u.rate = 0.98; u.pitch = 1.08;
  synth.speak(u);
}

function setupVoice() {
  $("#chatMic").innerHTML = ICON.mic;
  $("#chatSend").innerHTML = ICON.send;
  const speakBtn = $("#chatSpeak");
  speakBtn.innerHTML = ICON.speakerOff;

  if (window.speechSynthesis) { window.speechSynthesis.getVoices(); window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices(); }

  // read-aloud toggle: turning it on reads the latest message
  if (!window.speechSynthesis) { speakBtn.style.display = "none"; }
  else speakBtn.addEventListener("click", () => {
    state.voiceOut = !state.voiceOut;
    speakBtn.classList.toggle("on", state.voiceOut);
    speakBtn.innerHTML = state.voiceOut ? ICON.speakerOn : ICON.speakerOff;
    speakBtn.title = state.voiceOut ? "Voice on (tap to mute)" : "Read answers aloud";
    if (state.voiceOut) { const last = [...state.chat].reverse().find(m => m.role === "bot"); if (last) speakAnswer(last.html); }
    else window.speechSynthesis.cancel();
  });

  // speech-to-text mic: keep listening and wait ~3.5s of silence before sending
  const mic = $("#chatMic");
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { mic.style.display = "none"; return; }
  const recog = new SR();
  recog.lang = "en-PH"; recog.continuous = true; recog.interimResults = true; recog.maxAlternatives = 1;
  let listening = false, finalText = "", silence = null;
  recog.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + " "; else interim += r[0].transcript;
    }
    $("#chatInput").value = (finalText + interim).trim();
    clearTimeout(silence);
    silence = setTimeout(() => { try { recog.stop(); } catch (e) {} }, 3500);
  };
  recog.onend = () => {
    listening = false; mic.classList.remove("listening"); clearTimeout(silence);
    const t = (finalText || $("#chatInput").value).trim(); finalText = "";
    if (t) sendChat(t);
  };
  recog.onerror = () => { listening = false; mic.classList.remove("listening"); clearTimeout(silence); finalText = ""; };
  mic.addEventListener("click", () => {
    if (listening) { try { recog.stop(); } catch (e) {} return; }
    finalText = ""; $("#chatInput").value = "";
    try { recog.start(); listening = true; mic.classList.add("listening"); } catch (e) {}
  });
}

const LEADINS = ["Great question.", "Good one.", "Happy to help.", "Sure thing.", "Let's take a look.", "Good thinking.", "Nice one."];
function sendChat(text) {
  if (!text || !text.trim()) return;
  pushChat("user", text);
  $("#chatInput").value = "";
  setTimeout(() => {
    let ans;
    if (/what.*do|how.*work/.test(text.toLowerCase()) && !state.currentArea) {
      ans = "Type a city or area in the search bar and I'll rank the brands that fit that spot. From there you can compare, save, and send an inquiry.";
    } else {
      ans = answerAsk(text);
    }
    const lead = LEADINS[Math.floor(Math.random() * LEADINS.length)];
    pushChat("bot", `<span class="lead">${lead}</span> ${ans}`);
  }, 150);
}

/* --------------------- Reverse search rendering -------------------- */
function showReverse(catKey) {
  const ranked = rankAreasForCategory(catKey, state.filters);
  $("#results").classList.add("hidden");
  $("#recoSummary").classList.add("hidden");
  $("#catTabsWrap").classList.add("hidden");
  const el = $("#reverseResults"); el.classList.remove("hidden");
  $("#panelArea").textContent = `Best areas for ${CATEGORIES[catKey].label}`;
  $("#panelSub").textContent = "Reverse search, areas ranked by concept fit";
  el.innerHTML = `<button class="link-btn back" id="backToResults">← Back to brands</button>` + ranked.map((r, i) => `
    <article class="card rev"><div class="rank">#${i + 1}</div>
      <div class="card-body"><div class="card-top"><h3>${r.area.name}</h3>${scoreBadge(r.fit.score)}</div>
        <div class="card-why">${r.fit.rationale.filter(x => x.good).slice(0, 2).map(x => `<span class="why g">✓ ${x.text}</span>`).join("")}</div>
        <button class="btn primary" data-act="goarea" data-area="${r.key}">Open this area →</button></div></article>`).join("");
}

/* ----------------------------- Flow -------------------------------- */
async function doSearch(query) {
  if (!query || !query.trim()) return;
  $("#searchBtn").textContent = "…";
  const resolved = await resolveArea(query);
  $("#searchBtn").textContent = "Search";
  if (!resolved) { alert(`Could not find "${query}". Try a Philippine city or area.`); return; }
  state.currentKey = resolved.key;
  state.activeCat = null;
  state.selectedBrand = null;
  state.baseArea = resolved.area;
  state.allCompetitors = genCompetitorPool(resolved.area); // fixed business locations for this city
  state.branchPools = {};
  state.focus = resolved.area.center.slice();
  state.map.flyTo(state.focus, resolved.area.zoom || 15, { duration: 1.6, easeLinearity: 0.18 });
  refreshAnalysis();
}

function readFilters() {
  state.filters.budget = $("#fBudget").value;
  state.filters.ownership = $("#fOwnership").value;
  state.filters.format = $("#fFormat").value;
  state.filters.types = $$("#fTypes .chip.on").map(c => c.dataset.cat);
  const n = (state.filters.budget !== "any" ? 1 : 0) + (state.filters.ownership !== "any" ? 1 : 0)
    + (state.filters.format !== "any" ? 1 : 0) + state.filters.types.length;
  const badge = $("#filterCount");
  badge.textContent = n; badge.classList.toggle("hidden", n === 0);
}

function applyFilters() {
  readFilters();
  state.activeCat = null;
  if (state.currentArea) renderResults(state.currentArea, rankCatalog(state.currentArea, state.filters));
}

/* ------------------------- Event wiring ---------------------------- */
function buildTypeChips() {
  $("#fTypes").innerHTML = Object.entries(CATEGORIES).map(([k, m]) => `<button class="chip" data-cat="${k}">${m.emoji} ${m.label}</button>`).join("");
}
function closeModals() { $$(".modal").forEach(m => m.classList.add("hidden")); }

function wire() {
  $("#searchBtn").addEventListener("click", () => doSearch($("#areaSearch").value));
  $("#areaSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") doSearch(e.target.value); });

  // suggestions
  const sug = $("#suggestions");
  $("#areaSearch").addEventListener("input", (e) => {
    const v = normalize(e.target.value);
    if (!v) { sug.classList.remove("show"); return; }
    const m = Object.keys(AREAS).filter(k => k.includes(v) || AREAS[k].name.toLowerCase().includes(v));
    if (!m.length) { sug.classList.remove("show"); return; }
    sug.innerHTML = m.map(k => `<div data-area="${AREAS[k].name}">📍 ${AREAS[k].name}</div>`).join("");
    sug.classList.add("show");
  });
  sug.addEventListener("click", (e) => { const d = e.target.closest("[data-area]"); if (d) { $("#areaSearch").value = d.dataset.area; sug.classList.remove("show"); doSearch(d.dataset.area); } });
  document.addEventListener("click", (e) => { if (!e.target.closest(".search-wrap")) sug.classList.remove("show"); });

  $$(".quick").forEach(b => b.addEventListener("click", () => { $("#areaSearch").value = b.dataset.area; doSearch(b.dataset.area); }));

  // welcome-screen search
  const wGo = () => { const v = $("#welcomeSearch").value; if (v) { $("#areaSearch").value = v; doSearch(v); } };
  $("#welcomeGo").addEventListener("click", wGo);
  $("#welcomeSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") wGo(); });

  // landing CTA -> reveal the "Where do you want to franchise?" search screen
  const enterApp = () => {
    $("#landing").classList.add("hidden");
    $("#welcome").classList.remove("hidden");
    setTimeout(() => $("#welcomeSearch").focus(), 60);
  };
  $("#enterApp").addEventListener("click", enterApp);

  // filters dropdown
  $("#filterToggle").addEventListener("click", (e) => { e.stopPropagation(); $("#filtersPanel").classList.toggle("hidden"); });
  $("#filtersPanel").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", (e) => { if (!e.target.closest(".search-cluster")) $("#filtersPanel").classList.add("hidden"); });
  $("#fBudget").addEventListener("change", applyFilters);
  $("#fOwnership").addEventListener("change", applyFilters);
  $("#fFormat").addEventListener("change", applyFilters);
  $("#fTypes").addEventListener("click", (e) => { const c = e.target.closest(".chip"); if (!c) return; c.classList.toggle("on"); applyFilters(); });
  $("#applyFilters").addEventListener("click", () => $("#filtersPanel").classList.add("hidden"));
  $("#resetFilters").addEventListener("click", () => {
    $("#fBudget").value = "any"; $("#fOwnership").value = "any"; $("#fFormat").value = "any";
    $$("#fTypes .chip").forEach(c => c.classList.remove("on")); applyFilters();
  });

  // category tabs
  $("#catTabs").addEventListener("click", (e) => {
    const t = e.target.closest(".cat-tab"); if (!t) return;
    state.activeCat = t.dataset.cat === "__all" ? null : t.dataset.cat;
    renderCatTabs(state.currentArea, state.results); renderCards();
    renderMapMarkers(); // map reflects the selected category
  });

  // panel + results delegation
  $("#panel").addEventListener("click", (e) => {
    if (e.target.id === "backToResults") { renderResults(state.currentArea, state.results); return; }
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    const id = btn.dataset.id, act = btn.dataset.act;
    if (act === "detail") openDetail(id);
    else if (act === "contact") openContact(id);
    else if (act === "score") { e.stopPropagation(); openScoreModal(id); }
    else if (act === "save") { e.stopPropagation(); toggleSave(id); }
    else if (act === "mapsel") { e.stopPropagation(); selectBrand(id); }
    else if (act === "goarea") doSearch(btn.dataset.area);
    else if (act === "open") openDetail(id); // clicking the card body
  });

  $("#closePanel").addEventListener("click", () => $("#panel").classList.add("hidden"));

  // modal delegation
  $$(".modal").forEach(m => m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]")) { closeModals(); return; }
    const btn = e.target.closest("[data-act]"); if (!btn) return;
    const id = btn.dataset.id, act = btn.dataset.act;
    if (act === "detail") { closeModals(); openDetail(id); }
    else if (act === "fmt") { openDetail(id, +btn.dataset.i); }
    else if (act === "score") { closeModals(); openScoreModal(id); }
    else if (act === "contact") { closeModals(); openContact(id); }
    else if (act === "mapsel") { closeModals(); selectBrand(id); }     // show branches on the map
    else if (act === "save") { toggleSave(id); openDetail(id); }       // re-render detail to update star
    else if (act === "unsave") { toggleSave(id); openSaved(); }        // refresh saved list
  }));
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { closeModals(); closeChat(); } });

  // assistant
  $("#assistantOrb").addEventListener("click", openChat);
  $("#chatClose").addEventListener("click", closeChat);
  $("#chatSend").addEventListener("click", () => sendChat($("#chatInput").value));
  $("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(e.target.value); });
  $("#chatSuggest").addEventListener("click", (e) => { const s = e.target.closest(".sg"); if (s) sendChat(s.dataset.q); });
  $("#chatLog").addEventListener("click", (e) => { const r = e.target.closest("[data-reverse]"); if (r) { showReverse(r.dataset.reverse); closeChat(); } });
  setupVoice();

  $("#savedBtn").addEventListener("click", openSaved);
  $("#savedCount").textContent = state.saved.length;

  // legend rows toggle their map layer on/off
  $("#legend").addEventListener("click", (e) => { const r = e.target.closest(".legend-row[data-layer]"); if (r) toggleLayer(r.dataset.layer); });

  // click anywhere on the map to re-centre the analysis on that exact spot
  state.map.on("click", (e) => { if (!state.baseArea) return; dismissMapHint(); state.focus = [e.latlng.lat, e.latlng.lng]; refreshAnalysis(); });

  // search-radius presets: resize the trade area and recompute
  $("#radiusControl").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-r]"); if (!b || !state.baseArea) return;
    state.radius = +b.dataset.r;
    $$("#radiusControl button").forEach(x => x.classList.toggle("on", x === b));
    refreshAnalysis();
  });
}

window.addEventListener("DOMContentLoaded", () => { initMap(); buildTypeChips(); buildLogoStrip(); initParallax(); wire(); });
