/**
 * Real-time test — connects via Socket.io and places an order
 * to verify events are received live.
 *
 * Run: node scripts/test-realtime.mjs <ACCESS_TOKEN>
 */
import { io } from 'socket.io-client';

const token = process.argv[2];
if (!token) {
  console.error('Usage: node scripts/test-realtime.mjs <ACCESS_TOKEN>');
  process.exit(1);
}

const socket = io('http://localhost:3000', {
  auth:       { token },
  transports: ['websocket'],
});

socket.on('connect', () => {
  console.log('✅ Connected! Socket ID:', socket.id);
});

socket.on('connected', (data) => {
  console.log('🔐 Auth confirmed:', data);
});

socket.on('order:status', (data) => {
  console.log('📦 Order status update:', data);
});

socket.on('order:new', (data) => {
  console.log('🔔 NEW ORDER ALERT (seller):', data);
});

socket.on('order:location', (data) => {
  console.log('📍 Rider location:', data);
});

socket.on('connect_error', (err) => {
  console.error('❌ Connection error:', err.message);
  process.exit(1);
});

// Subscribe to a test order
socket.on('connected', () => {
  socket.emit('order:subscribe', 'test-order-123');
  console.log('📡 Subscribed to order:test-order-123');
  console.log('Listening for events... (Ctrl+C to stop)');
});
