import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Modal, Alert, ActivityIndicator, Vibration,
} from 'react-native';
import { io, type Socket } from 'socket.io-client';
import { Colors, Spacing, FontSize, Radius, Shadow } from '../../theme';
import { RiderApi } from '../../services/api.service';
import { useAuth } from '../../context/AuthContext';

const DEV_HOST  = '192.168.1.6';
const SOCKET_URL = __DEV__ ? `http://${DEV_HOST}:3000` : 'https://api.chirawa.in';
const COD_CAP   = 200000; // ₹2000 in paise

interface Assignment {
  orderId: string; shopName: string; shopAddress: string;
  deliveryLocality: string; totalAmount: number; paymentMethod: string;
}

export default function HomeScreen() {
  const { state }                   = useAuth();
  const [isOnline,   setIsOnline]   = useState(false);
  const [toggling,   setToggling]   = useState(false);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [accepting,  setAccepting]  = useState(false);
  const [timer,      setTimer]      = useState(60);
  const socketRef  = useRef<Socket | null>(null);
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const vibRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load current availability on mount
  useEffect(() => {
    if (!state.token) return;
    void RiderApi.getAvailability(state.token).then((r) => setIsOnline(r.status === 'online')).catch(() => {});
  }, [state.token]);

  // Socket.io
  useEffect(() => {
    if (!state.token) return;
    const socket = io(SOCKET_URL, { auth: { token: state.token }, transports: ['websocket'] });
    socket.on('order:assigned', (data: Assignment) => {
      setAssignment(data);
      setTimer(60);
      startAlarm();
    });
    socketRef.current = socket;
    return () => { socket.disconnect(); stopAlarm(); };
  }, [state.token]);

  // 60-second countdown
  useEffect(() => {
    if (!assignment) return;
    timerRef.current = setInterval(() => {
      setTimer((t) => {
        if (t <= 1) { stopAlarm(); setAssignment(null); return 60; }
        return t - 1;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [assignment]);

  function startAlarm() {
    vibRef.current = setInterval(() => Vibration.vibrate([400, 400, 400]), 1200);
  }
  function stopAlarm() {
    Vibration.cancel();
    if (vibRef.current)  { clearInterval(vibRef.current);  vibRef.current  = null; }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function toggleAvailability() {
    if (!state.token) return;
    setToggling(true);
    try {
      const newStatus = isOnline ? 'offline' : 'online';
      await RiderApi.setAvailability(newStatus, state.token);
      setIsOnline(!isOnline);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Update nahi hua');
    } finally {
      setToggling(false);
    }
  }

  async function acceptOrder() {
    if (!assignment || !state.token) return;
    setAccepting(true);
    stopAlarm();
    try {
      // Accept is handled by backend assigning — just dismiss and go to delivery tab
      setAssignment(null);
      Alert.alert('✅ Order Accept!', 'Shop pe pahuncho aur pickup karo.');
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Accept nahi hua');
    } finally {
      setAccepting(false);
    }
  }

  function declineOrder() {
    stopAlarm();
    setAssignment(null);
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chirawa Rider</Text>
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

      {/* Incoming order modal — 60 second timer */}
      <Modal visible={!!assignment} animationType="slide" statusBarTranslucent>
        <View style={styles.orderModal}>
          <Text style={styles.orderModalTitle}>📦 NAYI DELIVERY!</Text>

          <View style={styles.timerCircle}>
            <Text style={styles.timerText}>{timer}</Text>
            <Text style={styles.timerLabel}>seconds</Text>
          </View>

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

          <TouchableOpacity style={styles.acceptBtn} onPress={acceptOrder} disabled={accepting}>
            {accepting
              ? <ActivityIndicator color={Colors.white} />
              : <Text style={styles.acceptBtnText}>✅ ACCEPT KAREIN</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.declineBtn} onPress={declineOrder}>
            <Text style={styles.declineBtnText}>❌ Decline</Text>
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
  timerCircle: { width: 120, height: 120, borderRadius: 60, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  timerText:   { fontSize: FontSize.xxxl, fontWeight: '900', color: Colors.white },
  timerLabel:  { fontSize: FontSize.xs, color: 'rgba(255,255,255,0.7)' },
  orderInfo:   { backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: Radius.lg, padding: Spacing.lg, width: '100%', gap: Spacing.sm },
  orderInfoShop:   { fontSize: FontSize.lg, fontWeight: '700', color: Colors.white },
  orderInfoAddr:   { fontSize: FontSize.sm, color: 'rgba(255,255,255,0.8)' },
  orderInfoTo:     { fontSize: FontSize.md, color: Colors.white },
  orderInfoAmount: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.white },
  codBadge: { color: Colors.warning },
  upiTag:   { color: 'rgba(255,255,255,0.8)' },
  acceptBtn: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.xl, width: '100%', alignItems: 'center' },
  acceptBtnText: { fontSize: FontSize.xl, fontWeight: '900', color: Colors.primary },
  declineBtn:    { borderWidth: 2, borderColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, width: '100%', alignItems: 'center' },
  declineBtnText: { color: Colors.white, fontSize: FontSize.lg, fontWeight: '700' },
});
