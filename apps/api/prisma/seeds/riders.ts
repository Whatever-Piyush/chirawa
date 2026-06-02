import type { PrismaClient } from '@prisma/client';

// 3 delivery riders for Chirawa, each linked to two zones (so every zone has
// coverage). Phones are bare 10-digit (see normalizePhone). PIN is unset — set
// via the rider app on first login; dev OTP bypass (123456) works regardless.
const RIDERS = [
  { phone: '7700110001', fullName: 'Sunil Yadav',  vehicle: 'RJ18 SA 1001', zoneNames: ['Zone 1 — Main Market / Central', 'Zone 2 — Station Road'] },
  { phone: '7700110002', fullName: 'Anil Meena',   vehicle: 'RJ18 SA 1002', zoneNames: ['Zone 3 — North Residential', 'Zone 4 — South Residential'] },
  { phone: '7700110003', fullName: 'Vikram Singh', vehicle: 'RJ18 SA 1003', zoneNames: ['Zone 5 — East (Highway side)', 'Zone 6 — West Outskirts'] },
];

export async function seedRiders(prisma: PrismaClient): Promise<void> {
  const zones = await prisma.deliveryZone.findMany({ select: { id: true, name: true } });
  const zoneId = (name: string) => zones.find((z) => z.name === name)?.id;

  let count = 0;
  for (const r of RIDERS) {
    const user = await prisma.user.upsert({
      where:  { phone: r.phone },
      update: { role: 'rider', isActive: true },
      create: { phone: r.phone, role: 'rider', isActive: true },
    });
    const profile = await prisma.riderProfile.upsert({
      where:  { userId: user.id },
      update: { fullName: r.fullName, vehicleNumber: r.vehicle },
      create: { userId: user.id, fullName: r.fullName, vehicleNumber: r.vehicle },
    });
    // Start offline; the rider goes online from the app.
    await prisma.riderAvailability.upsert({
      where:  { riderId: profile.id },
      update: {},
      create: { riderId: profile.id, status: 'offline' },
    });
    // Link to zones (idempotent).
    for (const zn of r.zoneNames) {
      const zid = zoneId(zn);
      if (!zid) continue;
      const existing = await prisma.riderZone.findUnique({
        where: { riderId_zoneId: { riderId: profile.id, zoneId: zid } },
      });
      if (!existing) await prisma.riderZone.create({ data: { riderId: profile.id, zoneId: zid } });
    }
    count++;
  }
  console.log(`  ✅ Riders seeded (${count} riders linked to zones)`);
}
