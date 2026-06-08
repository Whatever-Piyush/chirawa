import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import type { LastAddedItem } from '../context/CartContext';

// Stacked, overlapping circular thumbnails of the last 3 added items. New items
// slide in from the right; evicted (oldest) items slide out to the left; the
// strip width stretches/shrinks to fit. Newest renders on top (rightmost).
const SIZE = 30;          // circle diameter
const STEP = 18;          // x-distance between circle centers (≈40% overlap)
const EXIT_X = -SIZE - 8;  // off-screen-left target for an evicted circle

interface Slot {
  key:     string;
  item:    LastAddedItem;
  x:       Animated.Value;
  opacity: Animated.Value;
}

const widthFor = (n: number) => (n > 0 ? (n - 1) * STEP + SIZE : 0);

export default function CartThumbs({ items }: { items: LastAddedItem[] }) {
  const [slots, setSlots] = useState<Slot[]>(() =>
    items.map((it, i) => ({
      key: it.productId, item: it,
      x: new Animated.Value(i * STEP), opacity: new Animated.Value(1),
    })),
  );
  const slotsRef = useRef(slots);
  slotsRef.current = slots;
  const width = useRef(new Animated.Value(widthFor(items.length))).current;

  useEffect(() => {
    const cur = slotsRef.current;
    const newKeys = items.map((it) => it.productId);

    // Survivors keep their slot (repositioned); new items get a fresh slot
    // starting off to the right.
    const live: Slot[] = items.map((it, i) => {
      const targetX = i * STEP;
      const existing = cur.find((s) => s.key === it.productId);
      if (existing) {
        existing.item = it;
        Animated.spring(existing.x, { toValue: targetX, useNativeDriver: true, tension: 180, friction: 18 }).start();
        Animated.timing(existing.opacity, { toValue: 1, duration: 150, useNativeDriver: true }).start();
        return existing;
      }
      const slot: Slot = {
        key: it.productId, item: it,
        x: new Animated.Value(items.length * STEP + SIZE),
        opacity: new Animated.Value(0),
      };
      Animated.parallel([
        Animated.spring(slot.x, { toValue: targetX, useNativeDriver: true, tension: 160, friction: 16 }),
        Animated.timing(slot.opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
      ]).start();
      return slot;
    });

    // Evicted items animate out to the left, then unmount.
    const exiting = cur.filter((s) => !newKeys.includes(s.key));
    exiting.forEach((s) => {
      Animated.parallel([
        Animated.timing(s.x, { toValue: EXIT_X, duration: 260, useNativeDriver: true }),
        Animated.timing(s.opacity, { toValue: 0, duration: 240, useNativeDriver: true }),
      ]).start(() => setSlots((prev) => prev.filter((x) => x.key !== s.key)));
    });

    setSlots([...exiting, ...live]);
    Animated.spring(width, { toValue: widthFor(items.length), useNativeDriver: false, tension: 160, friction: 18 }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const order = items.map((it) => it.productId);

  return (
    <Animated.View style={[styles.row, { width }]}>
      {slots.map((s) => {
        const idx = order.indexOf(s.key);           // -1 → exiting (stays behind)
        return (
          <Animated.View
            key={s.key}
            style={[
              styles.thumb,
              { transform: [{ translateX: s.x }], opacity: s.opacity, zIndex: idx + 1 },
            ]}
          >
            {s.item.imageUrl ? (
              <Image source={{ uri: s.item.imageUrl }} style={styles.img} resizeMode="cover" />
            ) : (
              <View style={[styles.img, { backgroundColor: s.item.imageColor }]} />
            )}
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { height: SIZE, justifyContent: 'center' },
  thumb: { position: 'absolute', left: 0, width: SIZE, height: SIZE },
  img: {
    width: SIZE, height: SIZE, borderRadius: SIZE / 2,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.85)',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
});
