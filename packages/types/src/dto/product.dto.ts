import type { Paise } from '../domain/money';
import type { StockStatus } from '../enums/stock-status.enum';

export interface ProductResponse {
  id: string;
  name: string;
  description: string | null;
  price: Paise;
  stockStatus: StockStatus;
  images: string[];
  sortOrder: number;
}

export interface ShopResponse {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  isOpen: boolean;
  openTime: string;   // "09:00"
  closeTime: string;  // "22:00"
  estimatedDeliveryMinutes: number;
  categories: CategoryWithProducts[];
}

export interface CategoryWithProducts {
  id: string;
  name: string;
  sortOrder: number;
  products: ProductResponse[];
}