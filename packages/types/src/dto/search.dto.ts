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

export interface SearchResponse {
  products: SearchProductResult[];
  shops:    SearchShopResult[];
  query:    string;
}
