/* =====================================================================
   scoring.js — Heuristic "fit" model (PRD §7)
   ---------------------------------------------------------------------
   Fit Score blends, per brand at a given area:
     • Competition density   (penalty for same-category crowding)
     • Category saturation    (whitespace = bonus, saturated = penalty)
     • Customer traffic        (foot/vehicle/transit + daytime pop)
     • Demand / demographic    (income tier vs. brand price point)
     • Anchor proximity        (relevant anchors for the brand category)
     • Filter alignment        (budget / category / preference — PRD §6)
   Territory availability is a HARD filter handled in app.js, not scored.

   Weights are heuristic and tunable — the point is to show the logic
   and the output, not perfect math.
   ===================================================================== */

const WEIGHTS = {
  competition: 18,   // less crowding -> higher
  saturation:  11,   // category whitespace -> higher
  traffic:     15,
  demand:      16,    // income/price-point match
  anchor:      9,
  access:      20,    // entry accessibility: lower capital is more broadly viable
  filter:      11,    // soft preference alignment (re-rank, not exclude)
};

const TIER_VALUE = { mass: 1, mid: 2, premium: 3 };

/* Which anchor types pull the right crowd for each category */
const ANCHOR_FIT = {
  "food-cart":     ["mall", "school", "transit", "office"],
  "coffee":        ["office", "mall", "school", "transit"],
  "milktea":       ["school", "mall", "office"],
  "beverage":      ["mall", "school", "transit"],
  "dessert":       ["mall", "school"],
  "pizza":         ["school", "mall", "office"],
  "fastfood":      ["mall", "transit", "office", "school"],
  "convenience":   ["transit", "office", "mall"],
  "pharmacy":      ["hospital", "mall", "church"],
  "service-bills": ["mall", "transit", "office"],
  "personal-care": ["mall", "office"],
  "fuel":          ["transit"],
  "education":     ["school", "mall", "office"],
};

/* Categories that compete with / cannibalise each other (adjacency) */
const ADJACENT = {
  "coffee":   ["milktea", "beverage"],
  "milktea":  ["coffee", "beverage"],
  "beverage": ["milktea", "coffee"],
  "fastfood": ["pizza"],
  "pizza":    ["fastfood"],
};

function clamp(n, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, n)); }

/* Average traffic signal for an area, lightly weighted toward foot traffic */
function trafficScore(area) {
  const t = area.traffic;
  const day = area.demographics.daytimePop;
  return clamp(0.4 * t.foot + 0.25 * t.vehicle + 0.15 * t.transit + 0.2 * day);
}

/* Count of competitors in the brand's own + adjacent categories */
function competitorCounts(area, category) {
  const dist = area.distribution || {};
  const direct = dist[category] || 0;
  const adj = (ADJACENT[category] || []).reduce((s, c) => s + (dist[c] || 0), 0);
  const total = Object.values(dist).reduce((s, n) => s + n, 0) || 1;
  return { direct, adj, total };
}

/* Score one brand against one area. Returns score + component breakdown
   + human-readable rationale bullets. */
function scoreBrand(brand, area, filters) {
  const { direct, adj, total } = competitorCounts(area, brand.category);

  // --- Competition density: penalise direct + (some) adjacent competitors
  const effectiveComp = direct + 0.4 * adj;
  const competition = clamp(1 - effectiveComp / 26); // ~26 rivals => saturated

  // --- Category saturation: this category's share of all nearby businesses
  const share = (direct + 0.5 * adj) / total;
  const saturation = clamp(1 - share * 3.2); // >~31% share => fully saturated

  // --- Traffic potential
  const traffic = trafficScore(area);

  // --- Demand / demographic match (income tier vs. brand price tier)
  const areaTier = TIER_VALUE[area.demographics.incomeTier] || 2;
  const brandTier = TIER_VALUE[brand.targetTier] || 2;
  // perfect when equal; mass brands tolerate higher-income areas well
  let gap = Math.abs(areaTier - brandTier);
  if (brandTier < areaTier) gap *= 0.6; // affordable concept in richer area: still fine
  const demand = clamp(1 - gap / 2.2);

  // --- Anchor proximity: how many relevant anchor types are present
  const want = ANCHOR_FIT[brand.category] || [];
  const present = new Set((area.anchors || []).map(a => a.type));
  const hits = want.filter(t => present.has(t)).length;
  const anchor = clamp(want.length ? hits / Math.min(want.length, 3) : 0.5);

  // --- Entry accessibility. If the user set a budget, accessibility means
  //     "does it fit YOUR budget" (it passed the hard filter, so yes) and high-
  //     capital brands like Jollibee are no longer penalised. With no budget set,
  //     it reflects how broadly attainable the capital outlay is.
  const budgetSet = filters && filters.budget && filters.budget !== "any" && BUDGET_BANDS[filters.budget];
  const access = budgetSet ? 0.92 : clamp(1 - Math.log10(Math.max(brand.investMin, 100000) / 150000) / 2.4);

  // --- Soft filter alignment (preference only, §6 — type & budget are
  //     applied as HARD filters in rankCatalog; here we re-rank on the
  //     softer "preference" signals: ownership and format)
  let filterScore = 1;
  if (filters) {
    if (filters.ownership && filters.ownership !== "any" && filters.ownership !== brand.ownership) filterScore -= 0.6;
    if (filters.format && filters.format !== "any") {
      const groups = brandFormats(brand).map(f => (f === "cart" || f === "kiosk") ? "cart" : f === "inline" ? "inline" : "standalone");
      if (!groups.includes(filters.format)) filterScore -= 0.5;
    }
  }
  filterScore = clamp(filterScore);

  // --- Weighted total
  const parts = {
    competition: competition * WEIGHTS.competition,
    saturation:  saturation  * WEIGHTS.saturation,
    traffic:     traffic     * WEIGHTS.traffic,
    demand:      demand      * WEIGHTS.demand,
    anchor:      anchor      * WEIGHTS.anchor,
    access:      access      * WEIGHTS.access,
    filter:      filterScore * WEIGHTS.filter,
  };
  const score = Math.round(Object.values(parts).reduce((s, n) => s + n, 0));

  return {
    score: clamp(score, 0, 100),
    components: { competition, saturation, traffic, demand, anchor, access, filter: filterScore },
    rivals: { direct, adj },
    rationale: buildRationale(brand, area, { competition, saturation, traffic, demand, anchor }, { direct, adj }),
  };
}

/* Turn component values into plain-language "why" bullets */
function buildRationale(brand, area, c, rivals) {
  const out = [];
  const cat = CATEGORIES[brand.category].label.toLowerCase();

  if (rivals.direct === 0) out.push({ good: true, text: `No direct ${cat} competitors mapped nearby, clear whitespace.` });
  else if (c.competition > 0.6) out.push({ good: true, text: `Only ${rivals.direct} ${cat} rival(s) nearby, room to enter.` });
  else out.push({ good: false, text: `${rivals.direct} ${cat} competitors already nearby, getting crowded.` });

  if (c.saturation > 0.6) out.push({ good: true, text: `The ${cat} category is under-served in this area.` });
  else if (c.saturation < 0.35) out.push({ good: false, text: `${cat} is already everywhere here, high saturation.` });

  if (c.traffic > 0.75) out.push({ good: true, text: `Very high foot and vehicle traffic plus daytime population.` });
  else if (c.traffic < 0.45) out.push({ good: false, text: `Modest traffic, fewer passers-by than prime corridors.` });

  if (c.demand > 0.75) out.push({ good: true, text: `Local income level matches this brand's price point.` });
  else if (c.demand < 0.5) out.push({ good: false, text: `Price point sits ${brand.targetTier === "premium" ? "above" : "off"} the area's typical spend.` });

  const want = ANCHOR_FIT[brand.category] || [];
  const present = (area.anchors || []).filter(a => want.includes(a.type)).map(a => a.name);
  if (c.anchor > 0.66 && present.length) out.push({ good: true, text: `Close to the right crowd-pullers (${present.slice(0,2).join(", ")}).` });
  else if (c.anchor < 0.4) out.push({ good: false, text: `Few anchors here that pull this brand's target customer.` });

  return out;
}

/* Rank the whole catalog for an area, applying HARD filters (budget,
   territory) then sorting by fit. Returns array of {brand, fit}. */
function rankCatalog(area, filters) {
  const band = filters && filters.budget && filters.budget !== "any" ? BUDGET_BANDS[filters.budget] : null;

  const types = filters && filters.types && filters.types.length ? filters.types : null;

  return CATALOG
    .filter(b => {
      // type of business is a HARD filter when one or more are selected
      if (types && !types.includes(b.category)) return false;
      if (!band) return true;
      // budget is a HARD filter: brand's entry investment must fall in band
      return b.investMin <= band.max && b.investMax >= band.min;
    })
    .map(b => ({ brand: b, fit: scoreBrand(b, area, filters) }))
    .sort((a, b) => b.fit.score - a.fit.score);
}

/* Rank categories for an area by the best brand fit in each category.
   Feeds the AI reco summary and the category tabs. Returns
   [{category, score, label}] sorted high to low. */
function rankCategories(area, filters, ranked) {
  const rows = ranked || rankCatalog(area, filters);
  const best = {};
  rows.forEach(({ brand, fit }) => {
    if (best[brand.category] === undefined || fit.score > best[brand.category]) best[brand.category] = fit.score;
  });
  return Object.keys(best)
    .map(c => ({ category: c, score: best[c], label: CATEGORIES[c].label }))
    .sort((a, b) => b.score - a.score);
}

/* Reverse search (PRD §5): rank seeded AREAS for a given category */
function rankAreasForCategory(category, filters) {
  return Object.keys(AREAS).map(key => {
    const area = AREAS[key];
    // use the best brand in that category as the proxy for "concept fit"
    const brand = CATALOG.find(b => b.category === category) || CATALOG[0];
    const fit = scoreBrand({ ...brand, category }, area, filters);
    return { key, area, fit };
  }).sort((a, b) => b.fit.score - a.fit.score);
}
