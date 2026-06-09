# Search Bar — Redesign Plan

Target the search experience to the reference screens. Review/edit, then say "go".

> Status: **PROPOSAL — not yet coded.**

---

## 1. What the reference screens show

**Idle / empty (IMG_3621):**
- Search field with a rotating placeholder ("Search for 'Safai Abhiyaan'").
- **Recent searches** — horizontal history chips.
- A promo banner + a brand strip (HOCCO).
- A **product grid** (2–3 cols) with image, **ADD**, price, strikethrough MRP,
  "₹N OFF", name, unit — i.e. **browse-and-add products even before searching**.

**Typing "tool kit" (IMG_3521/3522/3523):**
- The field shows the query + clear (×) + mic.
- **Autocomplete suggestion list** under the field — rows with a small icon and
  the matched text styled (Tool kit, Car **tool kit**, Stanley **tool kit**, …).
- A **filter bar** (Filters · Sort · Price · Brand · Material · Rating 4+ ·
  price buckets).
- **Product results grid** (3-up) with ADD, price/MRP/OFF, rating + count, stock
  badges, "Ad" tags.

---

## 2. Where we are today (`SearchScreen.tsx`)

- Idle state shows **only recent searches + popular chips** — no products.
- No **autocomplete suggestion** list while typing.
- Results render as **list rows** (avatar + name + price + stepper), not a grid.
- Has: debounced search (300 ms, min 2 chars), recent searches, category chips,
  price buckets, sort, shops section.
- **Backend ranking** (`searchCatalog`): fuzzy trigram similarity
  (`word_similarity`/`similarity`) + alias expansion, `ORDER BY score DESC`.
  Exact matches usually score high but **aren't explicitly prioritized** — a
  fuzzy/alias hit can outrank an exact name match.

---

## 3. The two asks (your words)

1. **Empty search bar → show products to add to the cart** (like IMG_3621).
2. **Typing → exact item first, then related/partial matches.** "Match exactly
   what the user is searching for, at priority."

---

## 4. Proposed changes

### 4a. Exact-match-first ranking (backend) — the core of ask #2
In `searchCatalog`, add a relevance boost on top of the trigram score so order is:
1. **Exact** name match (`lower(name) = lower(query)`) — top.
2. **Prefix** match (`name ILIKE query || '%'`).
3. **Contains** match (`name ILIKE '%' || query || '%'`).
4. **Fuzzy / alias** (current similarity) — "related items".

```
score = GREATEST(<existing similarities>)
      + CASE WHEN lower(p.name) = lower(:q)        THEN 10
             WHEN p.name ILIKE :q || '%'           THEN 5
             WHEN p.name ILIKE '%' || :q || '%'    THEN 2
             ELSE 0 END
```
So a partial word still returns related items, but anything that literally
contains the query — exact first — ranks above fuzzy matches.

### 4b. Empty-state product feed — ask #1
When the query is empty, below the recent-searches row, render a **product grid**
of items to add (reuse the app's `ProductCard`, so ADD/stepper/price/“OFF” all
come for free). Source: `fetchProducts({ limit })` (existing catalog endpoint) —
a "Popular / You may like" feed.
- ❓ *Decision: feed source — generic popular products, or a specific category?
  Default: generic popular (first N active products).*

### 4c. Autocomplete suggestions while typing (reference list)
Under the field, show up to ~6 **name suggestions** that match the query, with the
matched substring bolded, ordered exact→prefix→contains. Tapping a suggestion
fills the field and runs the search.
- Source: lightweight — derive from the search results' product names (no new
  endpoint), or add a tiny `/search/suggest` returning names only.
  Default: **derive from results' names** (no backend addition).

### 4d. Results as a grid (match the reference)
Switch product results from list rows to a **2–3 col grid** using `ProductCard`
(consistent with Home/Category). Keep the existing filter/sort/price controls
above the grid.
- ❓ *Decision: switch to grid (recommended) or keep current list rows?*

---

## 5. Out of scope (unless you want them)
- Promo banner + brand strip in the empty state (IMG_3621) — purely marketing.
- "Ad" tags, "low return rate" badges from the reference.
- Voice (mic) input — leave as-is.

## 6. Open questions (answer or say "go" for defaults)
1. Empty-state feed = generic **popular products** [default] or a chosen category?
2. Suggestions = **derived from results** [default] or a new suggest endpoint?
3. Results layout = **grid via ProductCard** [default] or keep list rows?
4. Keep the existing **filter/sort/price** controls above results? [default: yes]
