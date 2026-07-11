import type { PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import { sendPush } from '../../modules/notifications/fcm.service';
import { getMorningCard } from '../../modules/inventory/morning-card.service';
import { getInventoryConfig } from '../../modules/inventory/inventory.config';

/**
 * Morning verification card push — 9:00 AM IST (Inventory Engine, S5).
 *
 * For each active shop with ≥1 doubted tracked item, send the seller ONE silent
 * nudge ("N items verify करें"). The card itself is computed fresh by
 * GET /sellers/me/morning-card when the seller opens it — nothing is persisted,
 * so an answered item disappears immediately. Notification budget: this is one
 * of only four pings a seller ever gets (design §10.3).
 */
export async function runMorningCardPush(prisma: PrismaClient, redis: Redis): Promise<void> {
  const cfg = await getInventoryConfig(prisma);
  const shops = await prisma.shop.findMany({
    where: { isActive: true },
    select: { id: true, name: true, seller: { select: { userId: true } } },
  });

  let pushed = 0;
  for (const shop of shops) {
    try {
      const card = await getMorningCard(prisma, shop.id, cfg);
      if (card.length === 0) continue;

      const token = await redis.get(`fcm:token:${shop.seller.userId}`);
      if (!token) continue;

      const title = 'स्टॉक चेक करें ✅';
      const body = `${card.length} items verify करें — सिर्फ 1 मिनट`;
      await sendPush({
        token, title, body,
        data: { screen: 'MorningCard' },
        channel: 'chirawa_alerts',
      });
      await prisma.notification.create({
        data: {
          userId: shop.seller.userId, channel: 'fcm',
          eventType: 'morning_card', title, body,
        },
      }).catch(() => {}); // logging is non-blocking
      pushed += 1;
    } catch (err) {
      console.error(`[inventory] morning-card push failed for shop ${shop.id}:`, err);
    }
  }
  console.log(`🌅 Morning card: pushed to ${pushed}/${shops.length} shops`);
}
