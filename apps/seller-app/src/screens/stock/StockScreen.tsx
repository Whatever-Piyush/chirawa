import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, Switch, StyleSheet, ActivityIndicator, Alert,
  Modal, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { SellerApi, type ProductInput, type StockThisInput } from '../../services/api.service';
import { saveStockThis, flushQueue } from '../../services/offline-queue';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { useAuth } from '../../context/AuthContext';
import type { RootStackParamList } from '../../navigation/AppNavigator';

interface Product {
  id: string; name: string; stockStatus: string;
  price: number; mrpPaise: number | null; unit: string | null;
  categoryId?: string | null;
}
interface Category { id: string; name: string; products: Product[] }
interface ShopData  { id: string; name: string; categories: Category[] }

// Form state for add/edit. Strings (rupees) — converted to paise on save.
interface FormState {
  name: string; priceRupees: string; mrpRupees: string;
  unit: string; stockQty: string; categoryId: string | null;
  // Set when the add originated from a barcode scan → save() routes to the
  // idempotent stock-this upsert (offline-tolerant) instead of plain create.
  barcode: string | null; masterId: string | null;
}
const EMPTY_FORM: FormState = { name: '', priceRupees: '', mrpRupees: '', unit: '', stockQty: '', categoryId: null, barcode: null, masterId: null };

export default function StockScreen() {
  const { state }               = useAuth();
  const navigation              = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [shop, setShop]         = useState<ShopData | null>(null);
  const [loading, setLoading]   = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm]           = useState<FormState>(EMPTY_FORM);
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving]       = useState(false);
  const [importing, setImporting] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [lookingUp, setLookingUp]     = useState(false);

  const loadShop = useCallback(async () => {
    if (!state.token || !state.userId) return;
    try {
      const orders = await SellerApi.getOrders(state.token) as Array<{ shopId: string }>;
      const shopId = orders[0]?.shopId;
      if (!shopId) { setLoading(false); return; }
      const data = await SellerApi.getShopProducts(shopId, state.token) as ShopData;
      setShop(data);
    } catch (e) {
      console.error('Load shop failed:', e);
    } finally {
      setLoading(false);
    }
  }, [state.token, state.userId]);

  useEffect(() => { void loadShop(); }, [loadShop]);

  // Replay any stock-this saves that were queued while offline (Phase 3).
  useEffect(() => {
    if (!state.token) return;
    void flushQueue(state.token).then(({ synced }) => { if (synced > 0) void loadShop(); }).catch(() => {});
  }, [state.token, loadShop]);

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
        name:        m?.name ?? '',
        priceRupees: '',
        mrpRupees:   m?.mrpPaise != null ? String(Math.round(m.mrpPaise / 100)) : '',
        unit:        m?.unit ?? '',
        stockQty:    '',
        categoryId:  null,
        barcode,
        masterId:    m?.id ?? null,
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
      name: p.name,
      priceRupees: String(Math.round(p.price / 100)),
      mrpRupees:   p.mrpPaise != null ? String(Math.round(p.mrpPaise / 100)) : '',
      unit:        p.unit ?? '',
      stockQty:    '',
      categoryId:  p.categoryId ?? null,
      barcode:     null,  // editing an existing row → normal update path
      masterId:    null,
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
        await SellerApi.updateProduct(editingId, base, state.token);
      } else if (form.barcode) {
        // Scanned add → idempotent stock-this upsert, queued if offline.
        const stockInput: StockThisInput = {
          shopId: shop.id, barcode: form.barcode, name, pricePaise: Math.round(price * 100),
          ...(mrp !== undefined ? { mrpPaise: Math.round(mrp * 100) } : {}),
          ...(form.unit.trim() ? { unit: form.unit.trim() } : {}),
          ...(categoryId ? { categoryId } : {}),
          ...(qty !== undefined ? { stockQty: qty } : {}),
          ...(form.masterId ? { masterId: form.masterId } : {}),
        };
        const result = await saveStockThis(stockInput, state.token);
        if (result === 'queued') {
          Alert.alert('Offline — queue mein daala 📥', 'Internet aane par apne aap sync ho jayega.');
        }
      } else {
        await SellerApi.createProduct({ shopId: shop.id, ...base } as ProductInput, state.token);
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

      {/* Morning verification card entry (Inventory Engine S5) */}
      {shop && (
        <Pressable style={styles.morningBanner} onPress={() => navigation.navigate('MorningCard')}>
          <Text style={styles.morningBannerText}>☀️ आज का स्टॉक चेक — 1 मिनट</Text>
          <Text style={styles.morningBannerArrow}>→</Text>
        </Pressable>
      )}

      {!shop
        ? <View style={styles.center}><Text style={styles.noShop}>Koi shop nahi mili</Text></View>
        : <FlatList
            data={allProducts}
            keyExtractor={(p) => p.id}
            contentContainerStyle={{ padding: Spacing.lg, gap: Spacing.sm }}
            ListEmptyComponent={<Text style={styles.empty}>Abhi koi product nahi. "+ Add" dabayein.</Text>}
            renderItem={({ item }) => (
              <Pressable style={styles.productRow} onPress={() => openEdit(item)} onLongPress={() => productActions(item)}>
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
      }

      {/* ── Add / Edit product modal ───────────────────────────────────────── */}
      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalRoot}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{editingId ? 'Product Edit' : 'Naya Product'}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
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
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setModalOpen(false)} disabled={saving}>
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
  noShop:      { fontSize: FontSize.lg, color: Colors.textMuted },
  // Morning card banner (Inventory Engine S5)
  morningBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginHorizontal: Spacing.lg, marginTop: Spacing.md,
    backgroundColor: Colors.accent, borderRadius: Radius.md,
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg,
  },
  morningBannerText:  { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
  morningBannerArrow: { color: Colors.white, fontWeight: '900', fontSize: FontSize.lg },
  empty:       { textAlign: 'center', color: Colors.textMuted, marginTop: Spacing.xl, fontSize: FontSize.md },
  productRow: {
    backgroundColor: Colors.card, borderRadius: Radius.md,
    padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    ...Shadow.card,
  },
  productInfo:  { flex: 1 },
  productName:  { fontSize: FontSize.md, fontWeight: '600', color: Colors.text },
  productPrice: { fontSize: FontSize.sm, color: Colors.textMuted },
  mrp:          { textDecorationLine: 'line-through', color: Colors.textMuted },
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
