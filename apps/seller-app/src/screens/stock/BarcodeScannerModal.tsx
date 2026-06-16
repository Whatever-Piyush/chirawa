import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { Colors, Spacing, FontSize, Radius } from '../../theme';

// Scan a product barcode (Catalog Engine Phase 3). Retail GTIN symbologies only —
// QR/PDF417 excluded. Includes a manual-entry fallback for damaged barcodes or
// camera trouble. Emits the raw barcode string; the caller looks it up.
export function BarcodeScannerModal({ visible, onClose, onBarcode }: {
  visible: boolean;
  onClose: () => void;
  onBarcode: (barcode: string) => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [manual, setManual] = useState('');
  // CameraView fires onBarcodeScanned continuously while a code is in frame — lock
  // after the first hit so we emit once per open.
  const lockRef = useRef(false);

  useEffect(() => {
    if (visible) { lockRef.current = false; setManual(''); }
  }, [visible]);

  function emit(barcode: string) {
    const code = barcode.trim();
    if (code.length < 8) return;
    onBarcode(code);
  }

  function handleScanned(result: BarcodeScanningResult) {
    if (lockRef.current) return;
    lockRef.current = true;
    emit(result.data);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.title}>Barcode scan karein</Text>
          <Pressable onPress={onClose} hitSlop={12}><Text style={styles.close}>✕</Text></Pressable>
        </View>

        <View style={styles.cameraWrap}>
          {!permission ? (
            <ActivityIndicator color={Colors.accent} />
          ) : !permission.granted ? (
            <View style={styles.permission}>
              <Text style={styles.permText}>Camera ki permission chahiye</Text>
              <Pressable style={styles.permBtn} onPress={() => void requestPermission()}>
                <Text style={styles.permBtnText}>Permission dein</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <CameraView
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
                onBarcodeScanned={handleScanned}
              />
              <View style={styles.reticle} pointerEvents="none" />
            </>
          )}
        </View>

        {/* Manual entry fallback — damaged barcode / camera trouble. */}
        <View style={styles.manualWrap}>
          <Text style={styles.manualLabel}>…ya barcode number type karein</Text>
          <View style={styles.manualRow}>
            <TextInput
              style={styles.manualInput}
              value={manual}
              onChangeText={setManual}
              placeholder="e.g. 8901725000011"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
            />
            <Pressable
              style={[styles.manualBtn, manual.trim().length < 8 && styles.manualBtnDisabled]}
              onPress={() => emit(manual)}
              disabled={manual.trim().length < 8}
            >
              <Text style={styles.manualBtnText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root:       { flex: 1, backgroundColor: '#000' },
  header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  title:      { color: Colors.white, fontSize: FontSize.lg, fontWeight: '800' },
  close:      { color: Colors.white, fontSize: FontSize.xl, fontWeight: '700' },
  cameraWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  reticle:    { position: 'absolute', width: '70%', height: 140, borderWidth: 3, borderColor: Colors.white, borderRadius: Radius.md, opacity: 0.85 },
  permission: { alignItems: 'center', gap: Spacing.md, padding: Spacing.lg },
  permText:   { color: Colors.white, fontSize: FontSize.md, textAlign: 'center' },
  permBtn:    { backgroundColor: Colors.accent, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm, borderRadius: Radius.md },
  permBtnText:{ color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
  manualWrap: { padding: Spacing.lg, backgroundColor: Colors.background },
  manualLabel:{ color: Colors.textMuted, fontSize: FontSize.sm, marginBottom: Spacing.xs },
  manualRow:  { flexDirection: 'row', gap: Spacing.sm },
  manualInput:{ flex: 1, backgroundColor: Colors.card, borderRadius: Radius.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: FontSize.md, color: Colors.text, borderWidth: 1, borderColor: Colors.border },
  manualBtn:  { backgroundColor: Colors.primary, paddingHorizontal: Spacing.lg, justifyContent: 'center', borderRadius: Radius.md },
  manualBtnDisabled: { opacity: 0.4 },
  manualBtnText: { color: Colors.white, fontWeight: '800', fontSize: FontSize.md },
});
