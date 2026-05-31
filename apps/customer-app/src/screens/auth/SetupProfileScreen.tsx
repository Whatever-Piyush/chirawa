import React, { useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/ui';
import { Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import { useT } from '@chirawa/i18n';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const TODAY = new Date();
// Oldest selectable year (~120 years back) down to the current year.
const YEARS = Array.from({ length: 120 }, (_, i) => TODAY.getFullYear() - i);

// Days in a given month/year (handles leap years).
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

// A single scrollable column of selectable values.
function WheelColumn({
  values,
  selected,
  onSelect,
  formatLabel,
  flex,
  c,
  styles,
}: {
  values: number[];
  selected: number;
  onSelect: (v: number) => void;
  formatLabel?: (v: number) => string;
  flex: number;
  c: ColorPalette;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <ScrollView
      style={{ flex }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.wheelContent}
    >
      {values.map((v) => {
        const isSelected = v === selected;
        return (
          <TouchableOpacity
            key={v}
            style={[styles.wheelItem, isSelected && styles.wheelItemSelected]}
            activeOpacity={0.7}
            onPress={() => onSelect(v)}
          >
            <Text
              weight={isSelected ? 'bold' : 'regular'}
              color={isSelected ? c.primary : c.textSecondary}
              style={styles.wheelText}
            >
              {formatLabel ? formatLabel(v) : String(v)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export default function SetupProfileScreen() {
  const t = useT();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { state, updateProfile } = useAuth();
  const { colors: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);

  // Same screen serves first-run setup (gate) and later editing (pushed route).
  const isEdit = route.name === 'EditProfile';

  const initialDate = state.dob ? new Date(state.dob) : new Date();

  const [name, setName] = useState(isEdit ? (state.name ?? '') : '');
  const [date, setDate] = useState(initialDate);
  const [showPicker, setShowPicker] = useState(false);
  const [dobSet, setDobSet] = useState(isEdit && !!state.dob);

  // Working selection inside the modal (separate from the committed `date`).
  const [draftDay, setDraftDay] = useState(initialDate.getDate());
  const [draftMonth, setDraftMonth] = useState(initialDate.getMonth());
  const [draftYear, setDraftYear] = useState(initialDate.getFullYear());

  const openPicker = () => {
    setDraftDay(date.getDate());
    setDraftMonth(date.getMonth());
    setDraftYear(date.getFullYear());
    setShowPicker(true);
  };

  const confirmDate = () => {
    // Clamp the day to the chosen month (e.g. Feb 30 -> Feb 28/29).
    const maxDay = daysInMonth(draftYear, draftMonth);
    const day = Math.min(draftDay, maxDay);
    let selected = new Date(draftYear, draftMonth, day);
    // Never allow a future birth date.
    if (selected > TODAY) selected = TODAY;
    setDate(selected);
    setDobSet(true);
    setShowPicker(false);
  };

  const dayCount = daysInMonth(draftYear, draftMonth);
  const dayValues = Array.from({ length: dayCount }, (_, i) => i + 1);
  const monthValues = Array.from({ length: 12 }, (_, i) => i);

  const handleSubmit = () => {
    if (name.trim().length < 2) return;
    const dobString = dobSet ? (date.toISOString().split('T')[0] ?? '') : '';
    void updateProfile(name.trim(), dobString);
    // In setup mode the navigator auto-swaps once a name exists; on edit we pop.
    if (isEdit) navigation.goBack();
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isEdit ? (
          <TouchableOpacity
            style={styles.backBtn}
            onPress={() => navigation.goBack()}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={24} color={c.textPrimary} />
          </TouchableOpacity>
        ) : (
          <View style={styles.iconWrap}>
            <Ionicons name="sparkles" size={32} color={c.primary} />
          </View>
        )}
        <Text weight="bold" style={styles.title}>
          {isEdit ? t('profile.editTitle') : "Let's get to know you"}
        </Text>
        <Text style={styles.subtitle}>
          {isEdit
            ? t('profile.editSubtitle')
            : 'Enter your details to personalize your Bringly experience.'}
        </Text>

        <View style={styles.inputGroup}>
          <Text weight="semibold" style={styles.label}>
            Full Name
          </Text>
          <View style={styles.inputContainer}>
            <Ionicons
              name="person-outline"
              size={20}
              color={c.textTertiary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.input}
              placeholder="e.g. Aditya Sharma"
              placeholderTextColor={c.textTertiary}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text weight="semibold" style={styles.label}>
            Date of Birth <Text style={styles.optional}>(Optional)</Text>
          </Text>

          {/* Tapping this opens the JS-only date picker modal */}
          <TouchableOpacity style={styles.inputContainer} activeOpacity={0.7} onPress={openPicker}>
            <Ionicons
              name="calendar-outline"
              size={20}
              color={c.textTertiary}
              style={styles.inputIcon}
            />
            <Text style={[styles.input, { paddingTop: 16 }, !dobSet && { color: c.textTertiary }]}>
              {dobSet ? date.toLocaleDateString() : 'Select your birth date'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── JS-only date picker (no native module) ──────────────────────── */}
      <Modal
        visible={showPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPicker(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { paddingBottom: insets.bottom + Spacing.md }]}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setShowPicker(false)} hitSlop={8}>
                <Text weight="medium" color={c.textSecondary} style={styles.modalAction}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <Text weight="bold" style={styles.modalTitle}>
                Date of Birth
              </Text>
              <TouchableOpacity onPress={confirmDate} hitSlop={8}>
                <Text weight="bold" color={c.primary} style={styles.modalAction}>
                  Done
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.wheelRow}>
              <WheelColumn values={dayValues} selected={draftDay} onSelect={setDraftDay} flex={1} c={c} styles={styles} />
              <WheelColumn
                values={monthValues}
                selected={draftMonth}
                onSelect={setDraftMonth}
                formatLabel={(m) => MONTHS[m]}
                flex={1.4}
                c={c}
                styles={styles}
              />
              <WheelColumn values={YEARS} selected={draftYear} onSelect={setDraftYear} flex={1.4} c={c} styles={styles} />
            </View>
          </View>
        </View>
      </Modal>

      {/* Footer is locked to the bottom safely */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, name.trim().length < 2 && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={name.trim().length < 2}
          activeOpacity={0.8}
        >
          <Text weight="bold" color={c.textInverse} style={styles.buttonText}>
            {isEdit ? t('profile.saveChanges') : 'Continue to App'}
          </Text>
          <Ionicons name="arrow-forward" size={20} color={c.textInverse} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const makeStyles = (c: ColorPalette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: c.background },
    scrollContent: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: 100 },
    backBtn: { marginBottom: Spacing.xl },
    iconWrap: {
      width: 64,
      height: 64,
      borderRadius: 20,
      backgroundColor: c.primaryLight,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: Spacing.xl,
    },
    title: { fontSize: 28, lineHeight: 34, color: c.textPrimary, marginBottom: 8, letterSpacing: -0.5 },
    subtitle: { fontSize: 15, color: c.textSecondary, marginBottom: 40, lineHeight: 22 },
    inputGroup: { marginBottom: Spacing.xl },
    label: { fontSize: 14, color: c.textPrimary, marginBottom: 8, letterSpacing: 0.3 },
    optional: { color: c.textTertiary, fontWeight: 'normal' },
    inputContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 16,
      paddingHorizontal: Spacing.md,
      height: 56,
    },
    inputIcon: { marginRight: 12 },
    input: {
      flex: 1,
      fontSize: 16,
      color: c.textPrimary,
      fontFamily: 'Poppins_500Medium',
      height: '100%',
    },
    footer: {
      paddingHorizontal: Spacing.xl,
      paddingBottom: Spacing.xl,
      backgroundColor: c.background,
      borderTopWidth: 1,
      borderTopColor: c.divider,
      paddingTop: Spacing.md,
    },
    button: {
      flexDirection: 'row',
      backgroundColor: c.primary,
      height: 56,
      borderRadius: 16,
      justifyContent: 'center',
      alignItems: 'center',
      gap: 8,
      shadowColor: c.primary,
      shadowOpacity: 0.3,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    buttonDisabled: { backgroundColor: c.disabled, shadowOpacity: 0 },
    buttonText: { fontSize: 16, letterSpacing: 0.5 },

    // ── Date picker modal ──────────────────────────────────────────────
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: c.surface,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.md,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
    },
    modalTitle: { fontSize: 16, color: c.textPrimary },
    modalAction: { fontSize: 16 },
    wheelRow: { flexDirection: 'row', height: 240, marginTop: Spacing.sm },
    wheelContent: { paddingVertical: 8 },
    wheelItem: {
      height: 44,
      justifyContent: 'center',
      alignItems: 'center',
      borderRadius: 10,
      marginHorizontal: 4,
    },
    wheelItemSelected: { backgroundColor: c.primaryLight },
    wheelText: { fontSize: 16 },
  });
