# Beauty & Personal Care + Dark-Store Model

Status: **IMPLEMENTED** (seed + home metadata). Re-seed the DB to apply.

---

## 1. Dark-store model (shops removed)

The app is now a **dark store**: the customer browses by category and never sees
which store an everyday item ships from.

- **One invisible store** — `Chirawa Store` (seller `9001110001`) holds the entire
  everyday catalog: Grocery & Kitchen, Dairy & Bread, Snacks & Drinks,
  Veggies & Fruits, Dry Fruits & Nuts, Bakery, Sauces & Spreads, packed
  Sweets & Mithai, **and all Beauty & Personal Care sub-categories**.
- **Only real shops** = the 5 featured **Chirawa Special** halwai/mithai shops
  (`9001110006`–`9001110010`).
- **Retired** legacy per-area stores (`9001110002`–`9001110005`, `9001110011`)
  are deactivated on seed (`isActive:false`), so the catalog drops them. The API
  filters `shop.isActive`, so their products/categories disappear — no deletes.

> Re-seed required: run the prisma seed (or `prisma migrate reset`) so the
> retirement + consolidation take effect on an existing database.

---

## 2. Beauty & Personal Care section (matches the reference screenshot)

8 sub-categories, each its own real category so a tile opens only its products.
Rendered with the existing 4-per-row tile grid (`CategorySections`) — same
aesthetic as the screenshot, but with our theme's rounded emoji tiles.

| sortOrder | Category            | Tile label          | Emoji |
|-----------|---------------------|---------------------|-------|
| 9         | Bath & Body         | Bath & Body         | 🧼    |
| 10        | Hair Care           | Hair                | 💇    |
| 11        | Skin & Face         | Skin & Face         | 🧴    |
| 12        | Beauty & Cosmetics  | Beauty & Cosmetics  | 💄    |
| 13        | Feminine Hygiene    | Feminine Hygiene    | 🌸    |
| 14        | Baby Care           | Baby Care           | 🍼    |
| 15        | Health & Pharma     | Health & Pharma     | 💊    |
| 16        | Sexual Wellness     | Sexual Wellness     | ❤️    |

Each sub-category is seeded with famous-brand, image-less products, e.g.:

- **Bath & Body** — Pears, Dove, Lux, Lifebuoy, Dettol, Santoor, Cinthol, Nivea
  Lotion, Vaseline, Dove Body Wash, Pond's Talc.
- **Hair Care** — Dove, Head & Shoulders, Sunsilk, Clinic Plus, TRESemmé,
  L'Oréal (conditioner + Casting hair colour), Parachute, Dabur Amla, Indulekha,
  Bajaj Almond Drops.
- **Skin & Face** — Nivea, Pond's, Garnier, Himalaya, Lakmé Sun Expert, Cetaphil,
  Mamaearth, Olay, Nivea Men.
- **Beauty & Cosmetics** — Lakmé 9to5, Maybelline (kajal/foundation/lip gloss),
  Lakmé compact, SUGAR crayon lipstick, Insight eyeliner, makeup brush.
- **Feminine Hygiene** — Whisper, Stayfree, Sofy, Veet, Clean & Dry.
- **Baby Care** — Pampers, Huggies, Johnson's (powder + lotion), Himalaya Baby,
  Mamaearth Baby Wash, Cerelac, sipper cup.
- **Health & Pharma** (OTC) — ON Whey, Honitus, Vicks, Volini, Digene, Electral,
  Dettol Antiseptic, Savlon, Revital H, face masks.
- **Sexual Wellness** — Durex, Manforce, Skore.

---

## 3. Notes / still open

- **Carousel tab**: the "For You" carousel's beauty tab now points to `Skin & Face`.
- **Household Essentials** (Home & Lifestyle, Cleaners & Repellents, Electronics,
  Stationery & Games) from the screenshot is still **not built** — separate task.
- **Header tabs** (Vacations / Electronics / Pharmacy) — not in scope.
- **Images** — staying imageless (cards show a clean placeholder).
- If you want the dark store hidden from any "all shops" list too, say so — it's
  kept active because the catalog needs it; only featured shops surface today.
