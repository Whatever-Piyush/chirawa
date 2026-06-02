import type { PrismaClient } from '@prisma/client';

// 6 delivery zones for Chirawa as an approximate 2×3 grid around the town centre
// (~28.2330, 75.6307). These are deliberately rough — the founding team should
// adjust the polygons after the first week of real deliveries (Chunk 5.1).
//
// lat bands: south 28.224–28.233, north 28.233–28.242
// lng bands: west 75.616–75.626, mid 75.626–75.636, east 75.636–75.646
const cell = (latMin: number, latMax: number, lngMin: number, lngMax: number) => [
  { lat: latMin, lng: lngMin },
  { lat: latMin, lng: lngMax },
  { lat: latMax, lng: lngMax },
  { lat: latMax, lng: lngMin },
];

const ZONES = [
  { name: 'Zone 1 — Main Market / Central', description: 'Around the main bazaar',     polygon: cell(28.2330, 28.2420, 75.6260, 75.6360) },
  { name: 'Zone 2 — Station Road',          description: 'Station Road area',           polygon: cell(28.2240, 28.2330, 75.6260, 75.6360) },
  { name: 'Zone 3 — North Residential',     description: 'Behind bus stand',            polygon: cell(28.2330, 28.2420, 75.6360, 75.6460) },
  { name: 'Zone 4 — South Residential',     description: 'South residential',           polygon: cell(28.2240, 28.2330, 75.6360, 75.6460) },
  { name: 'Zone 5 — East (Highway side)',   description: 'Towards the highway',          polygon: cell(28.2330, 28.2420, 75.6160, 75.6260) },
  { name: 'Zone 6 — West Outskirts',        description: 'West outskirts',               polygon: cell(28.2240, 28.2330, 75.6160, 75.6260) },
];

export async function seedZones(prisma: PrismaClient): Promise<void> {
  // Idempotent: clear and re-create (cascades to rider_zones in dev).
  await prisma.riderZone.deleteMany({});
  await prisma.deliveryZone.deleteMany({});
  for (const z of ZONES) {
    await prisma.deliveryZone.create({
      data: { name: z.name, description: z.description, polygon: z.polygon, isActive: true },
    });
  }
  console.log(`  ✅ Delivery zones seeded (${ZONES.length} Chirawa zones)`);
}
