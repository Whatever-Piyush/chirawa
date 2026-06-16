// Curated Hinglish / phonetic-Latin / Devanagari synonym groups for everyday
// grocery staples. Indian shoppers type the same product many ways — "doodh",
// "dudh", "दूध", "milk" — so we expand the query across the whole group to lift
// recall cheaply (no LLM needed; that's a later tier — see SEARCH_BAR.md §2.2).
//
// Each inner array is an interchangeable set: matching ANY member expands to ALL.
const SYNONYM_GROUPS: string[][] = [
  ['milk', 'doodh', 'dudh', 'दूध'],
  ['flour', 'atta', 'aata', 'wheat', 'gehu', 'gehun', 'आटा'],
  ['salt', 'namak', 'नमक'],
  ['sugar', 'chini', 'cheeni', 'shakkar', 'चीनी'],
  ['rice', 'chawal', 'chaval', 'चावल'],
  ['oil', 'tel', 'cooking oil', 'तेल'],
  ['soap', 'sabun', 'साबुन'],
  ['biscuit', 'biscuits', 'biskut', 'biscuit', 'बिस्किट'],
  ['egg', 'eggs', 'anda', 'ande', 'अंडा'],
  ['water', 'paani', 'pani', 'पानी'],
  ['tea', 'chai', 'chaay', 'चाय'],
  ['curd', 'yogurt', 'dahi', 'दही'],
  ['noodles', 'maggi', 'मैगी'],
  ['bread', 'double roti', 'ब्रेड'],
  ['butter', 'makhan', 'मक्खन'],
  ['ghee', 'घी'],
  ['paneer', 'cottage cheese', 'पनीर'],
  ['onion', 'pyaaz', 'pyaz', 'प्याज'],
  ['potato', 'aloo', 'alu', 'आलू'],
  ['tomato', 'tamatar', 'टमाटर'],
  ['lentils', 'dal', 'daal', 'pulses', 'दाल'],
  ['spices', 'masala', 'मसाला'],
  ['shampoo', 'शैम्पू'],
  ['detergent', 'surf', 'washing powder', 'डिटर्जेंट'],
  ['toothpaste', 'manjan', 'टूथपेस्ट'],
  ['coriander', 'dhania', 'kothmir', 'kothimbir', 'धनिया'],
  ['chilli', 'mirch', 'मिर्च'],
  ['turmeric', 'haldi', 'हल्दी'],
  ['cumin', 'jeera', 'जीरा'],
  ['snacks', 'namkeen', 'नमकीन'],
];

// term → all members of its group. Built once at module load.
const HINGLISH_INDEX = new Map<string, string[]>();
for (const group of SYNONYM_GROUPS) {
  const lower = group.map((g) => g.toLowerCase());
  for (const term of lower) HINGLISH_INDEX.set(term, lower);
}

// Synonyms for a normalized query (whole string, else its first word). Empty when
// the query isn't a known staple — callers merge this into the alias expansion.
export function expandHinglish(norm: string): string[] {
  const q = norm.toLowerCase().trim();
  const direct = HINGLISH_INDEX.get(q);
  if (direct) return direct;
  const first = q.split(/\s+/)[0];
  if (first && first !== q) {
    const byFirst = HINGLISH_INDEX.get(first);
    if (byFirst) return byFirst;
  }
  return [];
}
