import type { Paise } from '../domain/money';

export interface SearchProductResult {
  id:         string;
  name:       string;
  pricePaise: Paise;
  shopId:     string;
  shopName:   string;
  imageUrl:   string | null;
  inStock:    boolean;
}

export interface SearchShopResult {
  id:      string;
  name:    string;
  address: string;
  isOpen:  boolean;
}

export type SearchSort = 'relevance' | 'priceLow' | 'priceHigh' | 'rating';

export interface SearchFilters {
  category?: string;   // category name
  shopId?:   string;
  minPrice?: number;   // paise
  maxPrice?: number;   // paise
  inStock?:  boolean;
  sort?:     SearchSort;
}

export interface SearchResponse {
  products: SearchProductResult[];
  shops:    SearchShopResult[];
  query:    string;
  total:    number;   // full count of matching products (results capped at 20)
}

// Lightweight autocomplete row for the search dropdown (GET /search/suggest).
export interface SearchSuggestion {
  id:         string;
  name:       string;
  pricePaise: Paise;
  imageUrl:   string | null;
}

export interface SearchSuggestResponse {
  query:       string;
  suggestions: SearchSuggestion[];
}
