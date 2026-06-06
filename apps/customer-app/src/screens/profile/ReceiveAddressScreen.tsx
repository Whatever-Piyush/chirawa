import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../navigation/AppNavigator';
import { FontSize, FontWeight, MIN_TAP, Radius, Spacing } from '../../theme';
import { useTheme, type ColorPalette } from '../../theme/ThemeContext';
import { api } from '../../services/api.service';
import { useT } from '@chirawa/i18n';
import { useToast } from '../../components/ui';

type Props = NativeStackScreenProps<RootStackParamList, 'ReceiveAddress'>;

interface SharedAddress {
  label?:   string | null;
  street:   string;
  landmark: string;
  locality: string;
  city:     string;
  pincode:  string;
  lat:      number;
  lng:      number;
}

type Status = 'saving' | 'done' | 'error';

export default function ReceiveAddressScreen({ route, navigation }: Props) {
  const t      = useT();
  const toast  = useToast();
  const { colors: Colors } = useTheme();
  const styles = useMemo(() => makeStyles(Colors), [Colors]);

  const [status, setStatus] = useState<Status>('saving');
  // Guard against double-run (deep-link + focus can fire twice).
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    void (async () => {
      try {
        const raw = route.params?.payload;
        if (!raw) throw new Error('no payload');
        const addr = JSON.parse(decodeURIComponent(raw)) as SharedAddress;
        if (!addr.street || !addr.locality || !addr.pincode) throw new Error('bad payload');

        await api.createAddress({
          label:    addr.label ?? undefined,
          street:   addr.street,
          landmark: addr.landmark || '—',
          locality: addr.locality,
          city:     addr.city || 'Chirawa',
          pincode:  addr.pincode,
          lat:      addr.lat,
          lng:      addr.lng,
        });
        setStatus('done');
        toast.show(t('shareAddress.received'), 'success');
      } catch {
        setStatus('error');
        toast.show(t('shareAddress.receivedFail'), 'error');
      }
    })();
  }, [route.params, t, toast]);

  const goHome = () => navigation.navigate('MainTabs', { screen: 'Home' });

  return (
    <View style={styles.container}>
      {status === 'saving' && (
        <>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.text}>…</Text>
        </>
      )}

      {status !== 'saving' && (
        <>
          <View style={[styles.iconWrap, status === 'error' && styles.iconWrapError]}>
            <Ionicons
              name={status === 'done' ? 'checkmark-circle' : 'alert-circle'}
              size={72}
              color={status === 'done' ? Colors.success : Colors.error}
            />
          </View>
          <Text style={styles.text}>
            {status === 'done' ? t('shareAddress.received') : t('shareAddress.receivedFail')}
          </Text>
          <TouchableOpacity style={styles.btn} activeOpacity={0.85} onPress={goHome}>
            <Text style={styles.btnText}>OK</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const makeStyles = (Colors: ColorPalette) =>
  StyleSheet.create({
    container: {
      flex: 1, backgroundColor: Colors.background,
      alignItems: 'center', justifyContent: 'center',
      padding: Spacing.xxl, gap: Spacing.lg,
    },
    iconWrap: { alignItems: 'center', justifyContent: 'center' },
    iconWrapError: {},
    text: {
      fontSize: FontSize.lg, fontWeight: FontWeight.semibold,
      color: Colors.textPrimary, textAlign: 'center',
    },
    btn: {
      backgroundColor: Colors.primary, borderRadius: Radius.full,
      paddingHorizontal: 40, minHeight: MIN_TAP,
      alignItems: 'center', justifyContent: 'center', marginTop: Spacing.sm,
    },
    btnText: { color: Colors.white, fontSize: FontSize.md, fontWeight: FontWeight.bold },
  });
