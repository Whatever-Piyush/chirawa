# Search Bar — Redesign Plan

Target the search experience to the reference screens. Review/edit, then say "go".

> Status: **IMPLEMENTED ✅** (base) — one refinement pending below.

---

## REFINEMENT — fix the suggestions dropdown (⏳ to implement next)

**Problems now:**
- The suggestion dropdown is **too long** (up to 6).
- It's **not specific** — it includes loose "contains" matches.
- It **stays open even after the item is searched** (it shows whenever there's a
  query + results, overlapping the results grid).

**What to implement:**
1. **Auto-hide once searched.** Show the dropdown only while the user is typing a
   query that **hasn't been searched yet**; the moment results for that query are
   shown, the dropdown disappears. Also close it immediately when a suggestion is
   tapped or the search is submitted (Enter). Reopen only when the text changes
   again.
   - Concretely: `visible = focused && q.length≥2 && q !== lastSearched &&
     !justPicked && suggestions.length`. `lastSearched` is set when results land;
     `justPicked` is set on tap/submit and cleared on the next keystroke.
2. **Shorter + specific.** Cap at **4**, and **prefix matches only** (names that
   start with the typed text, case-insensitive) so suggestions are tight and
   relevant — drop the loose substring matches.
3. **Instant + independent of the grid.** Build suggestions from a small **pool of
   known product names** (the browse feed loaded on mount + names seen in recent
   results), prefix-filtered — so they appear *while typing* (before the server
   responds) and aren't tied to the already-visible results list.

**Result:** type → a short, relevant prefix list appears → as soon as the search
runs and the grid fills, the dropdown closes; tapping a suggestion closes it too.

---
_Base implementation notes below._

### As built
- **Exact-match-first ranking** — `searchCatalog` adds a boost on top of the
  trigram score: exact name (+10) → prefix (+5) → contains (+2) → fuzzy/related.
- **Empty state** — recent searches + a **3-up grid of products to add**
  (compact `ProductCard`s from `fetchProducts`). No promo banner. Popular chips
  removed in favour of the product feed.
- **Results** — switched from list rows to a **3-up `ProductCard` grid**
  (shops still listed above). Add/stepper now use the global cart (capsule
  updates too).
- **Autocomplete suggestions** — derived from result names (exact→prefix→
  contains, max 6) shown under the input.
- **Placeholder** — home `SearchBar` keeps a fixed `Search for` with only the
  quoted item name rotating; the Search screen's input placeholder rotates the
  same way (`Search for "milk"`).
- _Note: the old list-row product renderer + local cart handlers remain as dead
  code (harmless; `noUnusedLocals` off). Can be pruned on request._

---
_Original proposal below._

### Locked decisions (from feedback)
- **No promo banner / brand strip** anywhere — not in Search, not on Home. (Home's
  banner was already removed; Search won't add one.)
- **Placeholder:** the `Search for` text stays **fixed**; only the quoted **item
  name** rotates, e.g. `Search for "atta"` → `Search for "milk"` → … . Today the
  whole string animates (`Search "atta"`); we'll split it so only the name swaps.
  (`SearchBar.tsx`: static prefix + animated rotating name. Hindi keeps a fixed
  `खोजें` suffix with the rotating name.)
- **Card size:** the empty-state feed and the results both use the **3-per-row
  compact `ProductCard`** (`size="compact"`) — same dimensions as the reference
  screens.

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
When the query is empty, below the recent-searches row, render a **3-per-row grid**
of compact `ProductCard`s to add (ADD/stepper/price/“OFF” come for free). Source:
`fetchProducts({ limit })` (existing catalog endpoint) — a "Popular" feed.
**No promo banner** above or within it.
- Feed source: generic popular products (first N active). *(confirmed)*

### 4c. Autocomplete suggestions while typing (reference list)
Under the field, show up to ~6 **name suggestions** that match the query, with the
matched substring bolded, ordered exact→prefix→contains. Tapping a suggestion
fills the field and runs the search.
- Source: lightweight — derive from the search results' product names (no new
  endpoint), or add a tiny `/search/suggest` returning names only.
  Default: **derive from results' names** (no backend addition).

### 4d. Results as a grid (match the reference)
Switch product results from list rows to a **3-per-row grid** using compact
`ProductCard` (same size as the reference). Keep the existing filter/sort/price
controls above the grid. *(grid confirmed)*

---

## 5. Out of scope / excluded
- **Promo banner + brand strip — excluded** (Search and Home), per request.
- "Ad" tags, "low return rate" badges from the reference.
- Voice (mic) input — leave as-is.

## 6. Remaining open question
1. Suggestions = **derived from results' names** [default] or a new
   `/search/suggest` endpoint?

(Everything else is locked: no promo banner; fixed `Search for` + rotating name;
3-up compact cards for the empty feed and results; exact-match-first ranking.)
