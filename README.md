# Philippine Franchising Association, Demo

A map-first tool where a prospective franchisee types in their area and instantly
sees **which franchise brands fit there**, ranked by a fit score backed by
competition, traffic/demand, demographics, and entry accessibility.

This is the **pitch/illustration demo** described in the PRD. No build step, no
API keys, no backend.

## Run it

```bash
cd PFA
python3 -m http.server 8000
# then open http://localhost:8000
```

Any static server works (or `node .claude/serve.js` and open http://localhost:8778).

> Serve over `http://`, not `file://`. Typing a city that is not seeded uses the
> OpenStreetMap geocoder to fly there.

## What to demo

1. Type an area, or click **Angeles City / Makati CBD / Quezon City**. The map flies there.
2. The map shows a clean set of competitor pins, a demand/traffic **heatmap**, and **anchor pins** (malls, schools, offices, hospitals, transit).
3. The right panel opens with an **AI recommendation** summary: population, age skew, and the best-fit categories for that area.
4. Use the **category tabs** (All, then the top categories) to filter the ranked brand cards.
5. Each card shows a **logo**, description, franchise fee, investment range, fit score, and the top reasons. Click anywhere on a card, or **View details**, to expand.
6. The **detail view** has a star to save (top right), the fit rationale, a score breakdown, investment/royalty/space, and the source + as-of date.
7. **Send Inquiry** captures a lead (stored locally for the demo).
8. **Filters** live in the top bar: budget and business type are hard filters; involvement and format are a soft re-rank.
9. The **AI assistant** is the blue orb (bottom left). Click it for a mini chat: "Best categories here?", "Why not milk tea here?", "Where is best for coffee?"
10. **Reverse search**: ask "where is best for [concept]?" to get ranked *areas* back.
11. **Compare** two areas side by side, and **Saved** for your shortlist (both top right).

## What's real vs. mocked (demo honesty)

| Layer | Status |
|-------|--------|
| Map + geocoding | Real. Leaflet + Esri World Imagery (Google-Earth-style satellite) with place/road labels, OSM Nominatim search. True 3D camera tilt needs a different engine (MapLibre/Cesium) |
| Franchise catalog (`js/data.js`) | Real PH figures from the PRD seed table. Unconfirmed fields show "On request". Each entry carries `source` + `asOf` |
| Brand logos | Curated per brand from public favicon CDNs (DuckDuckGo / Google) for the 6 brands that have a usable mark; the rest use a clean category tile. A paid logo API would cover all in production |
| Competitor pins | Seeded. Hand-tuned category distribution per city, kept sparse for readability |
| Demand heatmap | Seeded. Derived from the area's traffic profile + anchors (stand-in for Google "popular times") |
| Demographics | Seeded. Income tier, daytime population, age skew per area (stand-in for PSA census) |
| Fit Score | Heuristic. See `js/scoring.js`. Logic is real (PRD §7 + an entry-accessibility factor); inputs are seeded |
| AI reco + assistant | Rule-based, grounded in the area's data. Swap for a real LLM in production |
| Leads | Logged to localStorage (stand-in for a CRM/endpoint) |
| Non-seeded areas | Map flies there + a synthetic profile is generated, labelled "estimated data". Rich seeded data exists for Angeles City, Makati CBD, Quezon City |

## Files

```
index.html        markup + CDN script tags (Leaflet, leaflet.heat)
css/styles.css     all styling
js/data.js         franchise catalog + seeded area profiles
js/scoring.js      the heuristic fit model
js/app.js          map, search, rendering, filters, tabs, modals, assistant, reverse search
```

## Production path (not in this demo)

- The base layer is already satellite imagery. For a true tilted **3D Earth** camera, swap Leaflet for MapLibre GL (free, with terrain + pitch) or Cesium / Google Photorealistic 3D Tiles (needs a key). `initMap()` and `renderArea()` are the only places that touch the map.
- Wire **Google Places API** for live competitors + popular-times traffic.
- Back the **AI reco + assistant** with a real LLM grounded in the area's data.
- Use a **logo API** (Logo.dev, Brandfetch) or hosted brand assets for uniform high-res logos.
- Point lead capture at a CRM or endpoint, and expand the catalog beyond the 15 seeded brands.
```
