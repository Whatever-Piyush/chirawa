import { z } from 'zod';

// All money in integer paise (ADR-002). Prices are non-negative; a sale price of
// 0 is allowed (free item / sample) but MRP, if present, must be >= price.
const paise = z.number().int().min(0).max(100_000_000); // cap ₹10,00,000 sanity bound
const uuid  = z.string().uuid();

// ── Product ───────────────────────────────────────────────────────────────────
// GTIN/EAN: 8–14 digits (validated for the GS1 check digit in the service).
const barcode = z.string().trim().regex(/^\d{8,14}$/, 'barcode must be 8–14 digits');

export const createProductSchema = z
  .object({
    shopId:      uuid,
    name:        z.string().trim().min(1).max(200),
    pricePaise:  paise,
    mrpPaise:    paise.optional(),
    unit:        z.string().trim().max(50).optional(),
    categoryId:  uuid.optional(),
    description: z.string().trim().max(2000).optional(),
    stockQty:    z.number().int().min(0).max(1_000_000).optional(),
    imageUrl:    z.string().url().max(500).optional(),
    barcode:     barcode.optional(),
    masterId:    uuid.optional(),
  })
  .refine((d) => d.mrpPaise == null || d.mrpPaise >= d.pricePaise, {
    message: 'MRP must be greater than or equal to price',
    path:    ['mrpPaise'],
  });

// "I stock this" (Catalog Engine Phase 3): a seller scans a barcode, gets prefill
// from MasterCatalog, sets a price + In/Out → one idempotent upsert keyed by
// (shopId, barcode). Re-scanning the same item updates rather than duplicates,
// which is exactly what the offline-sync queue relies on.
export const stockThisSchema = z
  .object({
    shopId:     uuid,
    barcode,
    masterId:   uuid.optional(),
    name:       z.string().trim().min(1).max(200),
    pricePaise: paise,
    mrpPaise:   paise.optional(),
    unit:       z.string().trim().max(50).optional(),
    categoryId: uuid.optional(),
    stockQty:   z.number().int().min(0).max(1_000_000).optional(),
    imageUrl:   z.string().url().max(500).optional(),
  })
  .refine((d) => d.mrpPaise == null || d.mrpPaise >= d.pricePaise, {
    message: 'MRP must be greater than or equal to price',
    path:    ['mrpPaise'],
  });

// Edit: every field optional, shopId is fixed (resolved from the product).
export const updateProductSchema = z
  .object({
    name:        z.string().trim().min(1).max(200).optional(),
    pricePaise:  paise.optional(),
    mrpPaise:    paise.nullable().optional(),
    unit:        z.string().trim().max(50).nullable().optional(),
    categoryId:  uuid.nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    stockQty:    z.number().int().min(0).max(1_000_000).optional(),
    imageUrl:    z.string().url().max(500).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

export const setStockQtySchema = z.object({ stockQty: z.number().int().min(0).max(1_000_000) });

// ── Category ────────────────────────────────────────────────────────────────
export const createCategorySchema = z.object({
  shopId:    uuid,
  name:      z.string().trim().min(1).max(100),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export const updateCategorySchema = z
  .object({
    name:      z.string().trim().min(1).max(100).optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive:  z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

// ── Variant ─────────────────────────────────────────────────────────────────
export const createVariantSchema = z
  .object({
    name:       z.string().trim().min(1).max(60),
    pricePaise: paise,
    mrpPaise:   paise.optional(),
    stockQty:   z.number().int().min(0).max(1_000_000).optional(),
    sku:        z.string().trim().max(60).optional(),
    sortOrder:  z.number().int().min(0).max(10_000).optional(),
  })
  .refine((d) => d.mrpPaise == null || d.mrpPaise >= d.pricePaise, {
    message: 'MRP must be greater than or equal to price',
    path:    ['mrpPaise'],
  });
export const updateVariantSchema = z
  .object({
    name:       z.string().trim().min(1).max(60).optional(),
    pricePaise: paise.optional(),
    mrpPaise:   paise.nullable().optional(),
    stockQty:   z.number().int().min(0).max(1_000_000).optional(),
    sku:        z.string().trim().max(60).nullable().optional(),
    sortOrder:  z.number().int().min(0).max(10_000).optional(),
    isActive:   z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

// ── Request-this-item (Phase 6) ─────────────────────────────────────────────
// Customer demand capture from empty-search / out-of-stock. At least one of a
// free-text wish or a scanned barcode must be present (GS1 check-digit validated
// in the service). pincode is optional minimal PII for the demand dashboard.
export const createRequestSchema = z
  .object({
    rawText:         z.string().trim().min(1).max(200).optional(),
    barcode:         barcode.optional(),
    masterId:        uuid.optional(),
    pincode:         z.string().trim().regex(/^\d{6}$/, 'pincode must be 6 digits').optional(),
    notifyOnRestock: z.boolean().optional(),
  })
  .refine((d) => !!d.rawText || !!d.barcode, {
    message: 'Provide an item name or a barcode',
    path:    ['rawText'],
  });

export type CreateRequestInput  = z.infer<typeof createRequestSchema>;
export type CreateProductInput  = z.infer<typeof createProductSchema>;
export type StockThisInput      = z.infer<typeof stockThisSchema>;
export type UpdateProductInput  = z.infer<typeof updateProductSchema>;
export type SetStockQtyInput    = z.infer<typeof setStockQtySchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateVariantInput  = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput  = z.infer<typeof updateVariantSchema>;
