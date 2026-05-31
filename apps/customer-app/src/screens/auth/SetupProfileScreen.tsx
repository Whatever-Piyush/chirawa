import React, { useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../components/ui';
import { Colors, Spacing } from '../../theme';
import { useAuth } from '../../context/AuthContext';

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
}: {
  values: number[];
  selected: number;
  onSelect: (v: number) => void;
  formatLabel?: (v: number) => string;
  flex: number;
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
              color={isSelected ? Colors.primary : '#6B7280'}
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
  const insets = useSafeAreaInsets();
  const { updateProfile } = useAuth();

  const [name, setName] = useState('');
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [dobSet, setDobSet] = useState(false);

  // Working selection inside the modal (separate from the committed `date`).
  const [draftDay, setDraftDay] = useState(date.getDate());
  const [draftMonth, setDraftMonth] = useState(date.getMonth());
  const [draftYear, setDraftYear] = useState(date.getFullYear());

  const openPicker = () => {
    // Seed the draft from the currently committed date each time we open.
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

  const handleContinue = () => {
    if (name.trim().length < 2) return;
    const dobString = dobSet ? date.toISOString().split('T')[0] : '';
    void updateProfile(name.trim(), dobString);
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
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles" size={32} color={Colors.primary} />
        </View>
        <Text weight="bold" style={styles.title}>
          Let's get to know you
        </Text>
        <Text style={styles.subtitle}>
          Enter your details to personalize your Bringly experience.
        </Text>

        <View style={styles.inputGroup}>
          <Text weight="semibold" style={styles.label}>
            Full Name
          </Text>
          <View style={styles.inputContainer}>
            <Ionicons name="person-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder="e.g. Aditya Sharma"
              placeholderTextColor="#9CA3AF"
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
          <TouchableOpacity
            style={styles.inputContainer}
            activeOpacity={0.7}
            onPress={openPicker}
          >
            <Ionicons name="calendar-outline" size={20} color="#9CA3AF" style={styles.inputIcon} />
            <Text style={[styles.input, { paddingTop: 16 }, !dobSet && { color: '#9CA3AF' }]}>
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
                <Text weight="medium" color="#6B7280" style={styles.modalAction}>
                  Cancel
                </Text>
              </TouchableOpacity>
              <Text weight="bold" style={styles.modalTitle}>
                Date of Birth
              </Text>
              <TouchableOpacity onPress={confirmDate} hitSlop={8}>
                <Text weight="bold" color={Colors.primary} style={styles.modalAction}>
                  Done
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.wheelRow}>
              <WheelColumn
                values={dayValues}
                selected={draftDay}
                onSelect={setDraftDay}
                flex={1}
              />
              <WheelColumn
                values={monthValues}
                selected={draftMonth}
                onSelect={setDraftMonth}
                formatLabel={(m) => MONTHS[m]}
                flex={1.4}
              />
              <WheelColumn
                values={YEARS}
                selected={draftYear}
                onSelect={setDraftYear}
                flex={1.4}
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* 🔴 Footer is locked to the bottom safely */}
      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.button, name.trim().length < 2 && styles.buttonDisabled]}
          onPress={handleContinue}
          disabled={name.trim().length < 2}
          activeOpacity={0.8}
        >
          <Text weight="bold" color={Colors.white} style={styles.buttonText}>
            Continue to App
          </Text>
          <Ionicons name="arrow-forward" size={20} color={Colors.white} />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.white },
  scrollContent: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: 100 },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: 'rgba(212, 66, 74, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  title: { fontSize: 28, lineHeight: 34, color: '#111827', marginBottom: 8, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: '#6B7280', marginBottom: 40, lineHeight: 22 },
  inputGroup: { marginBottom: Spacing.xl },
  label: { fontSize: 14, color: '#374151', marginBottom: 8, letterSpacing: 0.3 },
  optional: { color: '#9CA3AF', fontWeight: 'normal' },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    paddingHorizontal: Spacing.md,
    height: 56,
  },
  inputIcon: { marginRight: 12 },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    fontFamily: 'Poppins_500Medium',
    height: '100%',
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    paddingTop: Spacing.md,
  },
  button: {
    flexDirection: 'row',
    backgroundColor: Colors.primary,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    shadowColor: Colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  buttonDisabled: { backgroundColor: '#D1D5DB', shadowOpacity: 0 },
  buttonText: { fontSize: 16, letterSpacing: 0.5 },

  // ── Date picker modal ──────────────────────────────────────────────
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.white,
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
    borderBottomColor: '#F3F4F6',
  },
  modalTitle: { fontSize: 16, color: '#111827' },
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
  wheelItemSelected: { backgroundColor: 'rgba(212, 66, 74, 0.1)' },
  wheelText: { fontSize: 16 },
});
