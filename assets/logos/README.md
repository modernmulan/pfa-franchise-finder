# Brand logos

Drop official brand logo image files here and the app picks them up
automatically. No code changes needed.

## Catalog brand cards

Save each as `assets/logos/<id>.png` (PNG or SVG, ideally a transparent
"solo" logo on no background). The `<id>` matches the catalog entry in
`js/data.js`:

| File name                     | Brand                     |
|-------------------------------|---------------------------|
| `siomai-king.png`             | Siomai King               |
| `toktok.png`                  | TokTok                    |
| `santinos.png`                | Santino's Supreme Slice   |
| `johann-coffee.png`           | Johann Coffee & Beverages |
| `fruitas.png`                 | Fruitas                   |
| `belgian-waffles.png`         | Famous Belgian Waffles    |
| `potato-corner.png`           | Potato Corner             |
| `macao-tea.png`               | Macao Imperial Tea        |
| `generika.png`                | Generika Drugstore        |
| `bayad-center.png`            | Bayad Center              |
| `lay-bare.png`                | Lay Bare                  |
| `7-eleven.png`                | 7-Eleven                  |
| `petron-shell.png`            | Petron / Shell Station    |
| `jollibee.png`                | Jollibee                  |
| `mcdonalds.png`               | McDonald's                |

Until a file exists, the card falls back to a public favicon (for the
few big brands that have a clean one) and then to a category icon tile.

## Landing-page logo wall

Save these as `assets/logos/strip/<slug>.png`:

`jollibee.png`, `7-eleven.png`, `mcdonalds.png`, `mang-inasal.png`,
`chowking.png`, `red-ribbon.png`, `greenwich.png`, `potato-corner.png`,
`generika.png`, `petron.png`, `figaro.png`, `mister-donut.png`,
`seaoil.png`, `fruitas.png`

Until a file exists, the wall shows a clean brand-name chip instead.

To add or reorder the wall brands, edit `STRIP_BRANDS` in `js/app.js`.
