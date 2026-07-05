import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, SectionList, Switch, StyleSheet, ActivityIndicator, Alert,
  Modal, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, Image, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { SellerApi, UploadError, type ProductInput, type StockThisInput } from '../../services/api.service';
import { saveStockThis, flushQueue } from '../../services/offline-queue';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { useAuth } from '../../context/AuthContext';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // mirrors the API's 5 MB upload cap

// Per-shop AsyncStorage key for remembered category collapse state (Sprint 3).
const collapseKey = (shopId: string) => `stock:collapsed:${shopId}`;

interface Product {
  id: string; name: string; stockStatus: string;
  price: number; mrpPaise: number | null; unit: string | null;
  categoryId?: string | null; imageUrl?: string | null;
}
interface Category { id: string; name: string; sortOrder?: number; products: Product[] }
interface ShopData  { id: string; name: string; categories: Category[] }

// SectionList shapes (Sprint 3). Each category is one section; every row carries
// its category id so edit/long-press keep working on the grouped rows.
type RowItem = Product & { categoryId: string };
interface StockSection {
  id: string; name: string;
  total: number;        // products shown under this section (matches during search)
  outOfStock: number;   // of those, how many are out of stock
  collapsed: boolean;
  data: RowItem[];      // [] when collapsed → header still renders (sticky)
}

// Form state for add/edit. Strings (rupees) — converted to paise on save.
interface FormState {
  name: string; priceRupees: string; mrpRupees: string;
  unit: string; stockQty: string; categoryId: string | null;
  // Set when the add originated from a barcode scan → save() routes to the
  // idempotent stock-this upsert (offline-tolerant) instead of plain create.
  barcode: string | null; masterId: string | null;
  // Photo (Seller Sprint 1). imageUrl = the RESOLVED, uploaded URL (or null when
  // cleared). localUri = the on-device file shown as an instant preview and kept
  // for retry. imageTouched marks the field as changed, so save() sends the URL /
  // null only on edit when the seller actually touched the photo (else omit).
  imageUrl: string | null; localUri: string | null;
  uploading: boolean; uploadFailed: boolean; imageTouched: boolean;
}
const EMPTY_FORM: FormState = {
  name: '', priceRupees: '', mrpRupees: '', unit: '', stockQty: '', categoryId: null, barcode: null, masterId: null,
  imageUrl: null, localUri: null, uploading: false, uploadFailed: false, imageTouched: false,
};

export default function StockScreen() {
  const { state }               = useAuth();
  const [shop, setShop]         = useState<ShopData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  // Inventory search (Sprint 2). Own state — loadShop() never touches it, so the
  // query survives a refresh / stock toggle / offline-sync reload untouched.
  const [query, setQuery]       = useState('');
  // Category collapse state (Sprint 3): the set of COLLAPSED category ids. Empty =
  // all expanded (categories are expanded by default). Persisted per shop in
  // AsyncStorage; own state, so a loadShop() refresh never clobbers it.
  const [collapsedSet, setCollapsedSet] = useState<Set<string>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState<FormState>(EMPTY_FORM);
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving]       = useState(false);
  const [importing, setImporting] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lookingUp, setLookingUp]     = useState(false);
  const uploadAbortRef = useRef<AbortController | null>(null);

  const loadShop = useCallback(async () => {
    if (!state.token) return;
    setError(false);
    try {
      // Resolve the shop from the seller's profile — NOT from the first order.
      // A newly provisioned seller (zero orders) still gets their shop, so
      // adding products works immediately (Seller Sprint 0 P0-1).
      const myShop = await SellerApi.getMyShop(state.token);
      const data = await SellerApi.getShopProducts(myShop.id, state.token) as ShopData;
      setShop(data);
    } catch {
      // Never silently fall through to "no shop" on a network failure —
      // surface an error the seller can retry (Seller Sprint 0 P0-3).
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [state.token]);

  const retry = useCallback(() => { setLoading(true); void loadShop(); }, [loadShop]);

  useEffect(() => { void loadShop(); }, [loadShop]);

  // Replay any stock-this saves that were queued while offline (Phase 3).
  useEffect(() => {
    if (!state.token) return;
    void flushQueue(state.token).then(({ synced }) => { if (synced > 0) void loadShop(); }).catch(() => {});
  }, [state.token, loadShop]);

  // Restore remembered category collapse state for this shop (Sprint 3). Keyed on
  // shop id, so a loadShop() refresh (new object, same id) does NOT reload/clobber
  // the in-memory set; an app restart remounts the screen → reload from storage.
  useEffect(() => {
    const shopId = shop?.id;
    if (!shopId) return;
    let cancelled = false;
    void AsyncStorage.getItem(collapseKey(shopId)).then((raw) => {
      if (cancelled || !raw) return;
      try {
        const ids = JSON.parse(raw) as unknown;
        if (Array.isArray(ids)) setCollapsedSet(new Set(ids as string[]));
      } catch { /* ignore a corrupt cache entry */ }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [shop?.id]);

  // Tap a category header to collapse/expand; persist the set per shop (Sprint 3).
  const toggleCategory = useCallback((catId: string) => {
    setCollapsedSet((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId); else next.add(catId);
      const shopId = shop?.id;
      if (shopId) void AsyncStorage.setItem(collapseKey(shopId), JSON.stringify([...next])).catch(() => {});
      return next;
    });
  }, [shop?.id]);

  // Scan → look up the master → open the add sheet prefilled. Lookup failure
  // (offline) still opens it with the barcode so the seller can fill manually.
  async function handleScanned(barcode: string) {
    setScannerOpen(false);
    if (!state.token) return;
    setLookingUp(true);
    try {
      const res = await SellerApi.getMasterByBarcode(barcode, state.token);
      const m = res.master;
      setEditingId(null);
      setForm({
        ...EMPTY_FORM,
        name:     m?.name ?? '',
        mrpRupees: m?.mrpPaise != null ? String(Math.round(m.mrpPaise / 100)) : '',
        unit:     m?.unit ?? '',
        barcode,
        masterId: m?.id ?? null,
      });
      setNewCategory('');
      setModalOpen(true);
    } catch {
      setEditingId(null);
      setForm({ ...EMPTY_FORM, barcode });
      setNewCategory('');
      setModalOpen(true);
    } finally {
      setLookingUp(false);
    }
  }

  // ── Product photo (Seller Sprint 1) ────────────────────────────────────────
  // Upload happens ON PICK, not on Save: the seller sees progress + can cancel/
  // retry immediately, and save() only sends the already-resolved URL.
  function choosePhoto() {
    Alert.alert('Product ki photo', 'Photo kahan se lein?', [
      { text: '📷 Camera',  onPress: () => void pickFrom('camera') },
      { text: '🖼️ Gallery', onPress: () => void pickFrom('gallery') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }

  async function pickFrom(source: 'camera' | 'gallery') {
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!perm.granted) {
      // Message + Open Settings (only when the OS won't re-ask) + fallback to the
      // other source (§9 permission-denied).
      const other: 'camera' | 'gallery' = source === 'camera' ? 'gallery' : 'camera';
      const buttons: Array<{ text: string; style?: 'cancel'; onPress?: () => void }> = [];
      if (!perm.canAskAgain) buttons.push({ text: 'Settings kholein', onPress: () => void Linking.openSettings() });
      buttons.push({ text: other === 'camera' ? '📷 Camera try karein' : '🖼️ Gallery try karein', onPress: () => void pickFrom(other) });
      buttons.push({ text: 'Cancel', style: 'cancel' });
      Alert.alert(
        source === 'camera' ? 'Camera permission chahiye' : 'Gallery permission chahiye',
        source === 'camera' ? 'Photo lene ke liye camera ki permission dein.' : 'Photo chunne ke liye gallery ki permission dein.',
        buttons,
      );
      return;
    }

    const result = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (result.canceled || !result.assets?.[0]) return; // seller backed out
    const asset = result.assets[0];

    // Reject oversize BEFORE the round trip (quality 0.6 + crop usually keeps it
    // small; the picker doesn't always report fileSize, so the server 400 is the
    // backstop — see startUpload).
    if (asset.fileSize != null && asset.fileSize > MAX_IMAGE_BYTES) {
      Alert.alert('Photo bahut badi hai', 'Photo bahut badi hai — chhoti photo chunein');
      return;
    }
    await startUpload(asset.uri);
  }

  async function startUpload(uri: string) {
    if (!state.token) return;
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    // Show the local file instantly as the preview; keep it for retry.
    setForm((f) => ({ ...f, localUri: uri, uploading: true, uploadFailed: false }));
    try {
      const { url } = await SellerApi.uploadProductImage(uri, state.token, controller.signal);
      setForm((f) => ({ ...f, imageUrl: url, localUri: uri, uploading: false, uploadFailed: false, imageTouched: true }));
    } catch (e: unknown) {
      if (controller.signal.aborted) { // seller cancelled — not a failure
        setForm((f) => ({ ...f, uploading: false, uploadFailed: false, localUri: null }));
        return;
      }
      if (e instanceof UploadError && e.status === 400) { // oversize / bad type — re-pick, no retry
        setForm((f) => ({ ...f, uploading: false, uploadFailed: false, localUri: null }));
        Alert.alert('Photo bahut badi hai', 'Photo bahut badi hai — chhoti photo chunein');
        return;
      }
      // Network failure — keep localUri so Retry can re-send the same file.
      setForm((f) => ({ ...f, uploading: false, uploadFailed: true }));
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
    }
  }

  function cancelUpload() { uploadAbortRef.current?.abort(); }
  function retryUpload()  { if (form.localUri) void startUpload(form.localUri); }
  function removePhoto() {
    uploadAbortRef.current?.abort();
    setForm((f) => ({ ...f, imageUrl: null, localUri: null, uploading: false, uploadFailed: false, imageTouched: true }));
  }

  function closeSheet() { uploadAbortRef.current?.abort(); setModalOpen(false); }

  async function toggleStock(productId: string, currentStatus: string) {
    if (!state.token) return;
    setUpdating(productId);
    const newStatus = currentStatus === 'available' ? 'out_of_stock' : 'available';
    try {
      await SellerApi.updateStock(productId, newStatus, state.token);
      await loadShop();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Update nahi hua');
    } finally {
      setUpdating(null);
    }
  }

  async function handleImport() {
    if (!state.token || !shop) return;
    const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    setImporting(true);
    try {
      const report = await SellerApi.importProductsCsv(shop.id, { uri: asset.uri, name: asset.name }, state.token);
      const errLines = report.errors.slice(0, 5).map((e) => `Row ${e.row}: ${e.reason}`).join('\n');
      Alert.alert(
        'Import ho gaya ✅',
        `Naye: ${report.created}\nUpdate: ${report.updated}\nSkip: ${report.skipped}` +
          (report.errors.length
            ? `\n\nErrors:\n${errLines}${report.errors.length > 5 ? `\n…+${report.errors.length - 5} aur` : ''}`
            : ''),
      );
      await loadShop();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Import fail hua');
    } finally {
      setImporting(false);
    }
  }

  function openAdd() {
    setEditingId(null); setForm(EMPTY_FORM); setNewCategory(''); setModalOpen(true);
  }
  function openEdit(p: Product) {
    setEditingId(p.id);
    setForm({
      ...EMPTY_FORM,
      name: p.name,
      priceRupees: String(Math.round(p.price / 100)),
      mrpRupees:   p.mrpPaise != null ? String(Math.round(p.mrpPaise / 100)) : '',
      unit:        p.unit ?? '',
      categoryId:  p.categoryId ?? null,
      imageUrl:    p.imageUrl ?? null, // existing photo — untouched until changed
    });
    setNewCategory(''); setModalOpen(true);
  }

  async function save() {
    if (!state.token || !shop) return;
    const name  = form.name.trim();
    const price = Number(form.priceRupees);
    if (!name)                       { Alert.alert('Galti', 'Product ka naam likhein'); return; }
    if (!Number.isFinite(price) || price < 0) { Alert.alert('Galti', 'Sahi price likhein'); return; }
    const mrp = form.mrpRupees.trim() === '' ? undefined : Number(form.mrpRupees);
    if (mrp !== undefined && (!Number.isFinite(mrp) || mrp < price)) {
      Alert.alert('Galti', 'MRP price se kam nahi ho sakta'); return;
    }
    const qty = form.stockQty.trim() === '' ? undefined : Number(form.stockQty);
    if (form.uploading) { Alert.alert('Ruko', 'Photo upload hone dein, phir save karein'); return; }

    setSaving(true);
    try {
      let categoryId = form.categoryId ?? undefined;
      // Create a new category on the fly if one was typed.
      if (newCategory.trim()) {
        const cat = await SellerApi.createCategory(shop.id, newCategory.trim(), state.token);
        categoryId = cat.id;
      }
      const base: Partial<ProductInput> = {
        name,
        pricePaise: Math.round(price * 100),
        ...(mrp !== undefined ? { mrpPaise: Math.round(mrp * 100) } : {}),
        ...(form.unit.trim() ? { unit: form.unit.trim() } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(qty !== undefined ? { stockQty: qty } : {}),
      };
      if (editingId) {
        // Photo: send the resolved URL / null (clear) only if the seller touched
        // it; otherwise omit so the existing image is left as-is (Seller Sprint 1).
        const updatePayload = { ...base, ...(form.imageTouched ? { imageUrl: form.imageUrl } : {}) };
        await SellerApi.updateProduct(editingId, updatePayload, state.token);
      } else if (form.barcode) {
        // Scanned add → idempotent stock-this upsert, queued if offline.
        const stockInput: StockThisInput = {
          shopId: shop.id, barcode: form.barcode, name, pricePaise: Math.round(price * 100),
          ...(mrp !== undefined ? { mrpPaise: Math.round(mrp * 100) } : {}),
          ...(form.unit.trim() ? { unit: form.unit.trim() } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(qty !== undefined ? { stockQty: qty } : {}),
          ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}),
          ...(form.masterId ? { masterId: form.masterId } : {}),
        };
        const result = await saveStockThis(stockInput, state.token);
        if (result === 'queued') {
          Alert.alert('Offline — queue mein daala 📥', 'Internet aane par apne aap sync ho jayega.');
        }
      } else {
        // New product: include the photo URL only when one was set (never null).
        await SellerApi.createProduct(
          { shopId: shop.id, ...base, ...(form.imageUrl ? { imageUrl: form.imageUrl } : {}) } as ProductInput,
          state.token,
        );
      }
      setModalOpen(false);
      await loadShop();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Save nahi hua');
    } finally {
      setSaving(false);
    }
  }

  function productActions(p: Product) {
    Alert.alert(p.name, undefined, [
      { text: 'Galat image report karein', onPress: () => void reportImage(p.id) },
      { text: 'Product hatayein', style: 'destructive', onPress: () => void doDelete(p.id) },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }
  async function reportImage(productId: string) {
    if (!state.token) return;
    try {
      await SellerApi.reportProductImage(productId, undefined, state.token);
      Alert.alert('Report bhej diya ✅', 'Image review ke liye bhej di gayi hai.');
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Report nahi gaya');
    }
  }
  async function doDelete(productId: string) {
    if (!state.token) return;
    try { await SellerApi.deleteProduct(productId, state.token); await loadShop(); }
    catch (e: unknown) { Alert.alert('Error', e instanceof Error ? e.message : 'Delete nahi hua'); }
  }

  const allProducts = shop?.categories.flatMap((c) =>
    c.products.map((p) => ({ ...p, categoryId: c.id })),
  ) ?? [];

  // Client-side inventory search (Sprint 2): case-insensitive, whitespace-trimmed,
  // matches product name OR unit.
  const normalizedQuery = query.trim().toLowerCase();
  const isSearching     = normalizedQuery !== '';

  // ── Category sections (Sprint 3) ────────────────────────────────────────────
  // One SectionList section per category, in server sortOrder; products keep their
  // server order inside each. Collapsed → empty `data` (the sticky header still
  // shows). While searching we force-expand and drop non-matching categories; the
  // remembered collapse set is never mutated, so it returns when search clears.
  const sections = useMemo<StockSection[]>(() => {
    const cats = [...(shop?.categories ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const q = normalizedQuery;
    const matches = (p: RowItem) =>
      p.name.toLowerCase().includes(q) || (p.unit ?? '').toLowerCase().includes(q);

    return cats
      .map((c) => {
        const rows: RowItem[] = c.products.map((p) => ({ ...p, categoryId: c.id }));
        const shown     = isSearching ? rows.filter(matches) : rows;
        const collapsed = isSearching ? false : collapsedSet.has(c.id);
        return {
          id:         c.id,
          name:       c.name,
          total:      shown.length,
          outOfStock: shown.filter((p) => p.stockStatus === 'out_of_stock').length,
          collapsed,
          data:       collapsed ? [] : shown,
        };
      })
      // While searching, hide categories with no match; otherwise keep every
      // category (empty ones stay visible with a "0 products" header).
      .filter((s) => !isSearching || s.total > 0);
  }, [shop, isSearching, normalizedQuery, collapsedSet]);

  const searchResultCount = isSearching ? sections.reduce((n, s) => n + s.total, 0) : 0;

  const photoPreview = form.localUri ?? form.imageUrl; // on-device file first, else the uploaded URL

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.accent} size="large" /></View>;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Inventory</Text>
          <Text style={styles.headerSub}>
            {allProducts.filter((p) => p.stockStatus === 'available').length}/{allProducts.length} available
          </Text>
        </View>
        {shop && (
          <View style={styles.headerBtns}>
            <Pressable style={styles.importBtn} onPress={() => void handleImport()} disabled={importing}>
              {importing ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.importBtnText}>⬆ CSV</Text>}
            </Pressable>
            <Pressable style={styles.scanBtn} onPress={() => setScannerOpen(true)} disabled={lookingUp}>
              {lookingUp ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.scanBtnText}>📷 Scan</Text>}
            </Pressable>
            <Pressable style={styles.addBtn} onPress={openAdd}>
              <Text style={styles.addBtnText}>+ Add</Text>
            </Pressable>
          </View>
        )}
      </View>

      {error || !shop
        ? <View style={styles.center}>
            <Text style={styles.errorEmoji}>📡</Text>
            <Text style={styles.errorText}>Shop load nahi hui</Text>
            <Text style={styles.errorSub}>Internet check karein aur dobara koshish karein</Text>
            <Pressable style={styles.retryBtn} onPress={retry}>
              <Text style={styles.retryBtnText}>🔄 Retry</Text>
            </Pressable>
          </View>
        : <View style={styles.body}>
            {/* Persistent inventory search — client-side, matches name + unit (Sprint 2).
                Shown while there is anything to search, or while a query is active so
                the seller can always clear it. */}
            {(allProducts.length > 0 || isSearching) && (
              <View style={styles.searchWrap}>
                <View style={styles.searchBar}>
                  <Text style={styles.searchIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">🔍</Text>
                  <TextInput
                    style={styles.searchInput}
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Product ya unit dhundein…"
                    placeholderTextColor={Colors.textMuted}
                    autoCorrect={false}
                    autoCapitalize="none"
                    returnKeyType="search"
                    clearButtonMode="never"
                  />
                  {query.length > 0 && (
                    <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Search saaf karein">
                      <Text style={styles.searchClear} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">✕</Text>
                    </Pressable>
                  )}
                </View>
                {isSearching && (
                  <Text style={styles.resultCount}>
                    {searchResultCount} {searchResultCount === 1 ? 'result' : 'results'}
                  </Text>
                )}
              </View>
            )}
            <SectionList<RowItem, StockSection>
              style={styles.list}
              sections={sections}
              keyExtractor={(item) => item.id}
              stickySectionHeadersEnabled
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                isSearching
                  ? <View style={styles.noResults}>
                      <Text style={styles.noResultsEmoji} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">🔍</Text>
                      <Text style={styles.noResultsText}>Kuch nahi mila</Text>
                      <Text style={styles.noResultsSub}>"{query.trim()}" se koi product match nahi hua</Text>
                    </View>
                  : <Text style={styles.empty}>Abhi koi product nahi. "+ Add" dabayein.</Text>
              }
              renderSectionHeader={({ section }) => (
                <Pressable
                  style={styles.sectionHeader}
                  onPress={() => toggleCategory(section.id)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !section.collapsed }}
                  accessibilityLabel={
                    `${section.name}, ${section.total} ${section.total === 1 ? 'product' : 'products'}` +
                    (section.outOfStock > 0 ? `, ${section.outOfStock} out of stock` : '')
                  }
                >
                  <Text style={styles.sectionChevron} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{section.collapsed ? '▸' : '▾'}</Text>
                  <Text style={styles.sectionIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">🗂️</Text>
                  <Text style={styles.sectionName} numberOfLines={1}>{section.name}</Text>
                  <View style={styles.sectionMeta}>
                    <Text style={styles.sectionCount}>{section.total} {section.total === 1 ? 'product' : 'products'}</Text>
                    {section.outOfStock > 0 && <Text style={styles.sectionOOS}>{section.outOfStock} out of stock</Text>}
                  </View>
                </Pressable>
              )}
              renderSectionFooter={({ section }) => (
                // Expanded but empty → the "no products" hint. Collapsed empties show
                // only the "0 products" count in the header above.
                !section.collapsed && section.total === 0
                  ? <Text style={styles.emptyCatRow}>No products in this category yet.</Text>
                  : null
              )}
              renderItem={({ item }) => (
                <Pressable style={styles.productRow} onPress={() => openEdit(item)} onLongPress={() => productActions(item)}>
                  {item.imageUrl
                    ? <Image source={{ uri: item.imageUrl }} style={styles.rowThumb} accessibilityLabel={`${item.name} ki photo`} />
                    : <View style={[styles.rowThumb, styles.rowThumbPlaceholder]}><Text style={styles.rowThumbIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">📦</Text></View>}
                  <View style={styles.productInfo}>
                    <Text style={styles.productName}>{item.name}</Text>
                    <Text style={styles.productPrice}>
                      ₹{Math.round(item.price / 100)}
                      {item.mrpPaise ? <Text style={styles.mrp}>  ₹{Math.round(item.mrpPaise / 100)}</Text> : null}
                      {item.unit ? ` / ${item.unit}` : ''}
                    </Text>
                  </View>
                  {updating === item.id
                    ? <ActivityIndicator color={Colors.accent} />
                    : <Switch
                        value={item.stockStatus === 'available'}
                        onValueChange={() => void toggleStock(item.id, item.stockStatus)}
                        trackColor={{ false: Colors.border, true: Colors.success }}
                        thumbColor={Colors.white}
                      />
                  }
                </Pressable>
              )}
            />
          </View>
      }

      {/* ── Add / Edit product modal ───────────────────────────────────────── */}
      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={closeSheet}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{editingId ? 'Product Edit' : 'Naya Product'}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {/* Photo — upload-on-pick with preview / progress / cancel / retry / remove */}
              <Text style={styles.fieldLabel}>Photo</Text>
              <View style={styles.photoRow}>
                {photoPreview
                  ? <Image source={{ uri: photoPreview }} style={styles.photoPreview} accessibilityLabel="Product ki photo preview" />
                  : <View style={[styles.photoPreview, styles.photoPlaceholder]}><Text style={styles.photoPlaceholderIcon}>📷</Text></View>}
                <View style={styles.photoActions}>
                  {form.uploading ? (
                    <>
                      <View style={styles.photoStatusRow}>
                        <ActivityIndicator color={Colors.accent} />
                        <Text style={styles.photoStatus}>Upload ho rahi hai…</Text>
                      </View>
                      <Pressable style={styles.photoBtnGhost} onPress={cancelUpload}>
                        <Text style={styles.photoBtnGhostText}>Cancel</Text>
                      </Pressable>
                    </>
                  ) : form.uploadFailed ? (
                    <>
                      <Text style={styles.photoError}>Upload fail hui</Text>
                      <View style={styles.photoBtnRow}>
                        <Pressable style={styles.photoBtn} onPress={retryUpload}>
                          <Text style={styles.photoBtnText}>🔄 Retry</Text>
                        </Pressable>
                        <Pressable style={styles.photoBtnGhost} onPress={removePhoto}>
                          <Text style={styles.photoBtnGhostText}>Hatayein</Text>
                        </Pressable>
                      </View>
                    </>
                  ) : photoPreview ? (
                    <View style={styles.photoBtnRow}>
                      <Pressable style={styles.photoBtn} onPress={choosePhoto}>
                        <Text style={styles.photoBtnText}>Photo badlein</Text>
                      </Pressable>
                      <Pressable style={styles.photoBtnGhost} onPress={removePhoto}>
                        <Text style={styles.photoBtnGhostText}>Hatayein</Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable style={styles.photoBtn} onPress={choosePhoto}>
                      <Text style={styles.photoBtnText}>📷 Photo add karein</Text>
                    </Pressable>
                  )}
                </View>
              </View>

              <Field label="Naam *" value={form.name} onChangeText={(name) => setForm((f) => ({ ...f, name }))} placeholder="e.g. Aashirvaad Atta" />
              <View style={styles.row}>
                <View style={styles.flex1}><Field label="Price ₹ *" value={form.priceRupees} onChangeText={(priceRupees) => setForm((f) => ({ ...f, priceRupees }))} keyboardType="numeric" placeholder="285" /></View>
                <View style={styles.flex1}><Field label="MRP ₹" value={form.mrpRupees} onChangeText={(mrpRupees) => setForm((f) => ({ ...f, mrpRupees }))} keyboardType="numeric" placeholder="320" /></View>
              </View>
              <View style={styles.row}>
                <View style={styles.flex1}><Field label="Unit" value={form.unit} onChangeText={(unit) => setForm((f) => ({ ...f, unit }))} placeholder="5 kg" /></View>
                <View style={styles.flex1}><Field label="Stock qty" value={form.stockQty} onChangeText={(stockQty) => setForm((f) => ({ ...f, stockQty }))} keyboardType="numeric" placeholder="optional" /></View>
              </View>

              <Text style={styles.fieldLabel}>Category</Text>
              <View style={styles.chips}>
                {shop?.categories.map((c) => (
                  <Pressable key={c.id}
                    style={[styles.chip, form.categoryId === c.id && styles.chipActive]}
                    onPress={() => setForm((f) => ({ ...f, categoryId: f.categoryId === c.id ? null : c.id }))}>
                    <Text style={[styles.chipText, form.categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
                  </Pressable>
                ))}
              </View>
              <Field label="…ya nayi category" value={newCategory} onChangeText={setNewCategory} placeholder="Nayi category ka naam" />
            </ScrollView>

            <View style={styles.sheetActions}>
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={closeSheet} disabled={saving}>
                <Text style={styles.btnGhostText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.btn, styles.btnPrimary]} onPress={() => void save()} disabled={saving}>
                {saving ? <ActivityIndicator color={Colors.white} /> : <Text style={styles.btnPrimaryText}>{editingId ? 'Save' : 'Add Product'}</Text>}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Barcode scanner (Catalog Engine Phase 3) ───────────────────────── */}
      <BarcodeScannerModal
        visible={scannerOpen}
        onClose={() => setScannerOpen(false)}
        onBarcode={(barcode) => void handleScanned(barcode)}
      />
    </View>
  );
}

function Field(props: {
  label: string; value: string; onChangeText: (t: string) => void;
  placeholder?: string; keyboardType?: 'numeric' | 'default';
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{props.label}</Text>
      <TextInput
        style={styles.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={Colors.textMuted}
        keyboardType={props.keyboardType ?? 'default'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    backgroundColor: Colors.primary, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
  },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  headerSub:   { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.7)' },
  headerBtns:  { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  addBtn:      { backgroundColor: Colors.white, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.md },
  addBtnText:  { color: Colors.primary, fontWeight: '800', fontSize: FontSize.md },
  importBtn:   { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.md, minWidth: 64, alignItems: 'center' },
  importBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  scanBtn:     { backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, borderRadius: Radius.md, minWidth: 72, alignItems: 'center' },
  scanBtnText: { color: Colors.white, fontWeight: '700', fontSize: FontSize.sm },
  empty:       { textAlign: 'center', color: Colors.textMuted, marginTop: Spacing.xl, fontSize: FontSize.md },
  // inventory search (Sprint 2)
  body:        { flex: 1 },
  list:        { flex: 1 },
  listContent: { paddingBottom: Spacing.xl },
  // category sections (Sprint 3)
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    backgroundColor: Colors.background,       // opaque — the sticky header sits over rows
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  sectionChevron: { fontSize: FontSize.sm, color: Colors.textMuted, width: 14, textAlign: 'center' },
  sectionIcon:    { fontSize: FontSize.md },
  sectionName:    { flex: 1, fontSize: FontSize.md, fontWeight: '800', color: Colors.text },
  sectionMeta:    { alignItems: 'flex-end' },
  sectionCount:   { fontSize: FontSize.sm, color: Colors.textMuted, fontWeight: '600' },
  sectionOOS:     { fontSize: FontSize.sm, color: Colors.error, fontWeight: '700', marginTop: 1 },
  emptyCatRow:    { marginHorizontal: Spacing.lg, marginTop: Spacing.sm, color: Colors.textMuted, fontStyle: 'italic', fontSize: FontSize.sm },
  searchWrap:  { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  searchBar:   { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.card, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: Spacing.md },
  searchIcon:  { fontSize: FontSize.md, color: Colors.textMuted },
  searchInput: { flex: 1, paddingVertical: Spacing.sm, fontSize: FontSize.md, color: Colors.text },
  searchClear: { fontSize: FontSize.md, color: Colors.textMuted, fontWeight: '800', paddingHorizontal: Spacing.xs },
  resultCount: { fontSize: FontSize.sm, color: Colors.textMuted, marginTop: Spacing.sm, marginLeft: Spacing.xs },
  noResults:      { alignItems: 'center', marginTop: Spacing.xl, paddingHorizontal: Spacing.xl },
  noResultsEmoji: { fontSize: 48 },
  noResultsText:  { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginTop: Spacing.sm },
  noResultsSub:   { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.xs },
  errorEmoji:  { fontSize: 56 },
  errorText:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text, marginTop: Spacing.md },
  errorSub:    { fontSize: FontSize.sm, color: Colors.textMuted, textAlign: 'center', marginTop: Spacing.xs, paddingHorizontal: Spacing.xl },
  retryBtn:    { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, marginTop: Spacing.lg },
  retryBtnText:{ color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
  productRow: {
    backgroundColor: Colors.card, borderRadius: Radius.md,
    padding: Spacing.lg, marginHorizontal: Spacing.lg, marginTop: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    ...Shadow.card,
  },
  productInfo:  { flex: 1 },
  productName:  { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  productPrice: { fontSize: FontSize.sm, color: Colors.textMuted },
  mrp:          { textDecorationLine: 'line-through', color: Colors.textMuted },
  // row thumbnail
  rowThumb:            { width: 44, height: 44, borderRadius: Radius.sm, marginRight: Spacing.md, backgroundColor: Colors.background },
  rowThumbPlaceholder: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  rowThumbIcon:        { fontSize: 20 },
  // photo control (add/edit sheet)
  photoRow:          { flexDirection: 'row', gap: Spacing.md, alignItems: 'center', marginBottom: Spacing.md },
  photoPreview:      { width: 72, height: 72, borderRadius: Radius.md, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  photoPlaceholder:  { alignItems: 'center', justifyContent: 'center' },
  photoPlaceholderIcon: { fontSize: 28 },
  photoActions:      { flex: 1, gap: Spacing.sm },
  photoStatusRow:    { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  photoStatus:       { fontSize: FontSize.sm, color: Colors.textMuted },
  photoError:        { fontSize: FontSize.sm, color: Colors.error, fontWeight: '600' },
  photoBtnRow:       { flexDirection: 'row', gap: Spacing.sm },
  photoBtn:          { backgroundColor: Colors.primary, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, alignItems: 'center' },
  photoBtnText:      { color: Colors.white, fontWeight: '800', fontSize: FontSize.sm },
  photoBtnGhost:     { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, alignItems: 'center' },
  photoBtnGhostText: { color: Colors.text, fontWeight: '700', fontSize: FontSize.sm },
  // modal
  modalRoot:  { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet:      { backgroundColor: Colors.background, borderTopLeftRadius: Radius.lg, borderTopRightRadius: Radius.lg, padding: Spacing.lg, maxHeight: '88%' },
  sheetHandle:{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, marginBottom: Spacing.md },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text, marginBottom: Spacing.md },
  fieldWrap:  { marginBottom: Spacing.md },
  fieldLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted, marginBottom: Spacing.xs },
  input:      { backgroundColor: Colors.card, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: FontSize.md, color: Colors.text, borderWidth: 1, borderColor: Colors.border },
  row:        { flexDirection: 'row', gap: Spacing.md },
  flex1:      { flex: 1 },
  chips:      { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  chip:       { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs, borderRadius: Radius.full ?? 20, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card },
  chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText:     { color: Colors.text, fontSize: FontSize.sm },
  chipTextActive: { color: Colors.white, fontWeight: '700' },
  sheetActions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },
  btn:         { flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  btnGhost:    { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  btnGhostText:{ color: Colors.text, fontWeight: '700', fontSize: FontSize.md },
  btnPrimary:  { backgroundColor: Colors.primary },
  btnPrimaryText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
});
