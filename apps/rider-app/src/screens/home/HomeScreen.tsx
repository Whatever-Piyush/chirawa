import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, Alert, ActivityIndicator, Vibration,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { io, type Socket } from 'socket.io-client';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { RiderApi } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';
import { setRiderOnline } from '../../hooks/useRiderLocationPublisher';
import type { MainTabParamList } from '../../navigation/AppNavigator';
import { DEV_HOST } from '../../config/devHost';

const SOCKET_URL = __DEV__ ? `http://${DEV_HOST}:3000` : 'https://api.chirawa.in';
const COD_CAP   = 200000; // ₹2000 in paise

interface Assignment {
  orderId: string; shopName: string; shopAddress: string;
  deliveryLocality: string; totalAmount: number; paymentMethod: string;
}

export default function HomeScreen() {
  const { state }                   = useAuth();
  const navigation                  = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const [isOnline,   setIsOnline]   = useState(false);
  const [toggling,   setToggling]   = useState(false);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const socketRef     = useRef<Socket | null>(null);
  const vibRef        = useRef<ReturnType<typeof setInterval> | null>(null);
  const vibTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load current availability on mount. Mirrors into the location publisher's
  // module store so going offline stops rider:location emits mid-batch; the
  // cleanup resets the mirror on logout/session change (module state outlives us).
  useEffect(() => {
    if (!state.token) return;
    void RiderApi.getAvailability(state.token).then((r) => {
      const online = r.status === 'online';
      setIsOnline(online);
      setRiderOnline(online);
    }).catch(() => {});
    return () => setRiderOnline(false);
  }, [state.token]);

  // Socket.io
  useEffect(() => {
    if (!state.token) return;
    const socket = io(SOCKET_URL, { auth: { token: state.token }, transports: ['websocket'] });
    socket.on('order:assigned', (data: Assignment) => {
      setAssignment(data);
      startAlarm();
    });
    socketRef.current = socket;
    return () => { socket.disconnect(); stopAlarm(); };
  }, [state.token]);

  function startAlarm() {
    stopAlarm(); // a second assignment while one is showing must not leak the old interval
    vibRef.current = setInterval(() => Vibration.vibrate([400, 400, 400]), 1200);
    // Same 60s cap the old countdown enforced — just without the fake deadline UI.
    vibTimeoutRef.current = setTimeout(stopAlarm, 60000);
  }
  function stopAlarm() {
    Vibration.cancel();
    if (vibRef.current)        { clearInterval(vibRef.current);      vibRef.current        = null; }
    if (vibTimeoutRef.current) { clearTimeout(vibTimeoutRef.current); vibTimeoutRef.current = null; }
  }

  async function toggleAvailability() {
    if (!state.token) return;
    setToggling(true);
    try {
      const newStatus = isOnline ? 'offline' : 'online';
      await RiderApi.setAvailability(newStatus, state.token);
      setIsOnline(!isOnline);
      setRiderOnline(!isOnline);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Update nahi hua');
    } finally {
      setToggling(false);
    }
  }

  // The backend already assigned this order to us (there is no accept/reject
  // API) — the modal is a notification, not a choice. Acknowledge and go.
  function goToDelivery() {
    stopAlarm();
    setAssignment(null);
    navigation.navigate('Delivery');
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Bringly Rider</Text>
        <View style={[styles.statusDot, { backgroundColor: isOnline ? Colors.online : Colors.offline }]} />
      </View>

      {/* Online/Offline toggle — large button, center of screen */}
      <View style={styles.body}>
        <Text style={styles.statusLabel}>
          {isOnline ? '🟢 Aap Online Hain' : '⚫ Aap Offline Hain'}
        </Text>
        <Text style={styles.statusSub}>
          {isOnline ? 'Orders aa sakte hain' : 'Toggle karein orders lene ke liye'}
        </Text>

        <TouchableOpacity
          style={[styles.toggleBtn, isOnline ? styles.toggleBtnOnline : styles.toggleBtnOffline]}
          onPress={toggleAvailability}
          disabled={toggling}
          activeOpacity={0.85}
        >
          {toggling
            ? <ActivityIndicator color={Colors.white} size="large" />
            : <Text style={styles.toggleBtnText}>
                {isOnline ? 'OFFLINE HO JAAO' : 'ONLINE HO JAAO'}
              </Text>
          }
        </TouchableOpacity>
      </View>

      {/* Assignment notification — the order is already ours, no accept/decline */}
      <Modal visible={!!assignment} animationType="slide" statusBarTranslucent>
        <View style={styles.orderModal}>
          <Text style={styles.orderModalTitle}>🛵 Nayi delivery aayi hai!</Text>
          <Text style={styles.orderModalSub}>Yeh order aapko assign ho gaya hai</Text>

          <View style={styles.orderInfo}>
            <Text style={styles.orderInfoShop}>🏪 {assignment?.shopName}</Text>
            <Text style={styles.orderInfoAddr}>{assignment?.shopAddress}</Text>
            <Text style={styles.orderInfoTo}>📍 Deliver: {assignment?.deliveryLocality}</Text>
            <Text style={styles.orderInfoAmount}>
              ₹{Math.round((assignment?.totalAmount ?? 0) / 100)}
              {'  '}
              <Text style={assignment?.paymentMethod === 'cod' ? styles.codBadge : styles.upiTag}>
                {assignment?.paymentMethod === 'cod' ? '💵 COD' : '💳 Online'}
              </Text>
            </Text>
          </View>

          <TouchableOpacity style={styles.acceptBtn} onPress={goToDelivery}>
            <Text style={styles.acceptBtnText}>Chalo — pickup karo</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingTop: 56, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    backgroundColor: Colors.primary,
  },
  headerTitle: { flex: 1, fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  statusDot:   { width: 12, height: 12, borderRadius: 6 },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.xl },
  statusLabel: { fontSize: FontSize.xl, fontWeight: '700', color: Colors.text },
  statusSub:   { fontSize: FontSize.md, color: Colors.textMuted, textAlign: 'center' },
  toggleBtn: { width: 200, height: 200, borderRadius: 100, justifyContent: 'center', alignItems: 'center', ...Shadow.card },
  toggleBtnOnline:  { backgroundColor: Colors.error },
  toggleBtnOffline: { backgroundColor: Colors.primary },
  toggleBtnText:    { color: Colors.white, fontSize: FontSize.md, fontWeight: '900', textAlign: 'center' },
  // Modal
  orderModal: { flex: 1, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center', padding: Spacing.xl, gap: Spacing.xl },
  orderModalTitle: { fontSize: FontSize.xxl, fontWeight: '900', color: Colors.white },
  orderModalSub:   { fontSize: FontSize.md, color: 'rgba(255,255,255,0.85)', marginTop: -Spacing.md },
  orderInfo:   { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: Radius.lg, padding: Spacing.lg, width: '100%', gap: Spacing.sm },
  orderInfoShop:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.white },
  orderInfoAddr:   { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)' },
  orderInfoTo:     { fontSize: FontSize.md, color: Colors.white },
  orderInfoAmount: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  codBadge: { color: Colors.warning },
  upiTag:   { color: 'rgba(255,255,255,0.8)' },
  acceptBtn: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.xl, width: '100%', alignItems: 'center' },
  acceptBtnText: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.primary },
});
