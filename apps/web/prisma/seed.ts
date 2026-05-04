/**
 * TripKits dev seed
 *
 * Creates one fully-fleshed creator (handle: "alexwanders") with:
 *   - 40 vlogs across 8 destinations (COMPLETE processing status)
 *   - 8 Trip Kits (mix of FREE / FOLLOWER / PREMIUM, AI + manual, published)
 *   - Full itinerary days + activities with affiliate links on each kit
 *   - 2 subscription tiers
 *   - 3 subscribers (1 follower-only, 1 on each paid tier)
 *   - 15 commissions (PENDING + CONFIRMED + PAID) for the analytics dashboard
 *   - 30 click events spread across links
 *   - 2 merchandise items (PHYSICAL + DIGITAL)
 *
 * Run: npx tsx prisma/seed.ts
 * Or:  npx prisma db seed   (if "prisma.seed" is in package.json)
 *
 * Safe to re-run — upserts by stable IDs/handles so it won't duplicate.
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// ─── Stable fake Supabase auth.user UUIDs ─────────────────────────────────────
// These don't need to exist in auth.users for dev purposes (FK is to users.id
// which is the Prisma User model, not Supabase auth). We seed without a User
// model because the schema links Creator directly to userId (a string FK that
// points to auth.users). For local dev we just use deterministic fake UUIDs.
const CREATOR_USER_ID   = '00000000-0000-0000-0000-000000000001'
const SUBSCRIBER_1_ID   = '00000000-0000-0000-0000-000000000010'
const SUBSCRIBER_2_ID   = '00000000-0000-0000-0000-000000000011'
const SUBSCRIBER_3_ID   = '00000000-0000-0000-0000-000000000012'

// Unsplash-style placeholder images (stable URLs, no auth required)
const COVER = (seed: number) =>
  `https://picsum.photos/seed/${seed}/1280/720`
const AVATAR = 'https://picsum.photos/seed/creator-alex/400/400'

// ─── Destination data ─────────────────────────────────────────────────────────
const DESTINATIONS = [
  {
    title: '10 Days in Japan — Tokyo, Kyoto & Osaka on a Budget',
    slug: 'japan-tokyo-kyoto-osaka-budget',
    description: 'The ultimate first-timer guide to Japan. We did it for under $1,800 including flights from LA — here\'s every hotel, train, and bowl of ramen.',
    primaryCity: 'Tokyo',
    countries: ['Japan'],
    cities: ['Tokyo', 'Kyoto', 'Osaka', 'Nara'],
    durationDays: 10,
    budgetLow: 1500, budgetHigh: 2800,
    bestMonths: [3, 4, 10, 11],
    travelStyle: ['BUDGET', 'SOLO'],
    accessTier: 'FREE',
    isFeatured: true,
    cover: COVER(1001),
    days: [
      {
        dayNumber: 1, title: 'Day 1 — Arrive in Tokyo', city: 'Tokyo',
        summary: 'Land at Narita, grab your Suica card, and head to Shinjuku. First ramen dinner.',
        tips: ['Buy Suica at the airport before heading to the train', 'Store luggage at your hotel and walk Shinjuku before checking in'],
        activities: [
          { time: 'afternoon', title: 'Check in — Shinjuku Granbell Hotel', type: 'ACCOMMODATION',
            provider: 'STAY22', targetName: 'Shinjuku Granbell Hotel', priceFrom: 'from $89/night' },
          { time: 'evening', title: 'Ichiran Ramen Shinjuku', type: 'FOOD', provider: null, targetName: null },
          { time: 'night', title: 'Kabukicho neon walk', type: 'CULTURAL', provider: null, targetName: null },
        ],
      },
      {
        dayNumber: 2, title: 'Day 2 — Tokyo: Harajuku, Shibuya & Asakusa', city: 'Tokyo',
        summary: 'The tourist-essential day done right. Skip the queues with these local tips.',
        tips: ['Go to Shibuya Crossing at 8am — zero crowds', 'Meiji Shrine is free and 10 mins from Harajuku station'],
        activities: [
          { time: 'morning', title: 'Meiji Shrine', type: 'CULTURAL', provider: null, targetName: null },
          { time: 'afternoon', title: 'Harajuku & Takeshita Street', type: 'ATTRACTION', provider: null, targetName: null },
          { time: 'late-afternoon', title: 'Shibuya Crossing & Sky + observation deck', type: 'ATTRACTION',
            provider: 'GETYOURGUIDE', targetName: 'Shibuya Sky Observation Deck tickets', priceFrom: 'from $18' },
          { time: 'evening', title: 'Asakusa & Senso-ji at dusk', type: 'CULTURAL', provider: null, targetName: null },
        ],
      },
      {
        dayNumber: 3, title: 'Day 3 — Day Trip: Nikko', city: 'Nikko',
        summary: 'Two hours north of Tokyo, Nikko is all waterfalls and samurai shrines. Worth every yen.',
        tips: ['Nikko Pass covers trains + most entry fees — buy at Asakusa station'],
        activities: [
          { time: 'morning', title: 'Tosho-gu Shrine complex', type: 'CULTURAL',
            provider: 'GETYOURGUIDE', targetName: 'Nikko Tosho-gu guided tour', priceFrom: 'from $45' },
          { time: 'afternoon', title: 'Kegon Falls', type: 'ADVENTURE', provider: null, targetName: null },
        ],
      },
    ],
  },
  {
    title: 'Bali in 7 Days — Where to Actually Stay (Not Kuta)',
    slug: 'bali-7-days-where-to-stay',
    description: 'Seminyak for nights, Ubud for culture, Canggu for vibes. This is the Bali itinerary the influencers don\'t post.',
    primaryCity: 'Ubud',
    countries: ['Indonesia'],
    cities: ['Seminyak', 'Ubud', 'Canggu', 'Uluwatu'],
    durationDays: 7,
    budgetLow: 900, budgetHigh: 2000,
    bestMonths: [5, 6, 7, 8, 9],
    travelStyle: ['MID', 'COUPLE'],
    accessTier: 'FOLLOWER',
    isFeatured: true,
    cover: COVER(1002),
    days: [
      {
        dayNumber: 1, title: 'Day 1 — Seminyak: Arrive & Decompress', city: 'Seminyak',
        summary: 'Check in, find a beach club, eat your first nasi goreng.',
        tips: ['Grab a private driver from the airport — $15 fixed rate beats the metered taxis'],
        activities: [
          { time: 'afternoon', title: 'The Layar Villas, Seminyak', type: 'ACCOMMODATION',
            provider: 'STAY22', targetName: 'The Layar Seminyak', priceFrom: 'from $150/night' },
          { time: 'sunset', title: 'Potato Head Beach Club', type: 'FOOD', provider: null, targetName: null },
        ],
      },
      {
        dayNumber: 2, title: 'Day 2 — Ubud: Rice Terraces & Monkey Forest', city: 'Ubud',
        summary: 'The obligatory Ubud day, done correctly.',
        tips: ['Hire a scooter only if you\'re confident — traffic in Ubud is chaotic'],
        activities: [
          { time: 'morning', title: 'Tegallalang Rice Terraces', type: 'ATTRACTION', provider: null, targetName: null },
          { time: 'afternoon', title: 'Ubud Monkey Forest', type: 'ATTRACTION', provider: null, targetName: null },
          { time: 'afternoon', title: 'Tjampuhan Ridge Walk', type: 'ADVENTURE', provider: null, targetName: null },
          { time: 'evening', title: 'Kak Man Babi Guling (suckling pig dinner)', type: 'FOOD', provider: null, targetName: null },
        ],
      },
    ],
  },
  {
    title: 'Portugal Solo Trip — Lisbon, Porto & the Alentejo',
    slug: 'portugal-lisbon-porto-alentejo',
    description: 'Three weeks, three regions, one rolling carry-on. Portugal is criminally underrated and this kit covers every euro of it.',
    primaryCity: 'Lisbon',
    countries: ['Portugal'],
    cities: ['Lisbon', 'Porto', 'Évora', 'Monsaraz'],
    durationDays: 21,
    budgetLow: 2000, budgetHigh: 3500,
    bestMonths: [4, 5, 9, 10],
    travelStyle: ['BUDGET', 'SOLO'],
    accessTier: 'PREMIUM',
    isFeatured: false,
    cover: COVER(1003),
    days: [
      {
        dayNumber: 1, title: 'Day 1 — Lisbon: Alfama & Belém', city: 'Lisbon',
        summary: 'Start in the oldest neighbourhood, end at the monument that launched an empire.',
        tips: ['The 28E tram is a trap — full of tourists and pickpockets. Walk Alfama instead.'],
        activities: [
          { time: 'morning', title: 'Check in — Bairro Alto Hotel', type: 'ACCOMMODATION',
            provider: 'STAY22', targetName: 'Bairro Alto Hotel Lisbon', priceFrom: 'from $220/night' },
          { time: 'afternoon', title: 'Alfama neighbourhood walk', type: 'CULTURAL', provider: null, targetName: null },
          { time: 'late-afternoon', title: 'Jerónimos Monastery, Belém', type: 'CULTURAL',
            provider: 'GETYOURGUIDE', targetName: 'Jerónimos Monastery skip-the-line ticket', priceFrom: 'from $12' },
        ],
      },
    ],
  },
  {
    title: 'Morocco 12 Days — Marrakech, Fes, Sahara Desert',
    slug: 'morocco-12-days-marrakech-fes-sahara',
    description: 'The medinas, the dunes, the riads. A loop through Morocco\'s three unmissables with a desert night in between.',
    primaryCity: 'Marrakech',
    countries: ['Morocco'],
    cities: ['Marrakech', 'Fes', 'Merzouga', 'Aït Benhaddou'],
    durationDays: 12,
    budgetLow: 1200, budgetHigh: 2400,
    bestMonths: [3, 4, 10, 11],
    travelStyle: ['MID', 'COUPLE'],
    accessTier: 'FREE',
    isFeatured: false,
    cover: COVER(1004),
    days: [
      {
        dayNumber: 1, title: 'Day 1 — Marrakech: The Medina', city: 'Marrakech',
        summary: 'Arrive, check in to a riad, get immediately lost in the souks. This is the plan.',
        tips: ['Agree on prices before entering any stall', 'Djemaa el-Fna is free to walk — the "show" starts at sunset'],
        activities: [
          { time: 'afternoon', title: 'Riad BE Marrakech', type: 'ACCOMMODATION',
            provider: 'STAY22', targetName: 'Riad BE Marrakech', priceFrom: 'from $95/night' },
          { time: 'evening', title: 'Djemaa el-Fna at sunset', type: 'CULTURAL', provider: null, targetName: null },
          { time: 'evening', title: 'Cooking class in the medina', type: 'CULTURAL',
            provider: 'VIATOR', targetName: 'Marrakech traditional cooking class', priceFrom: 'from $35' },
        ],
      },
    ],
  },
  {
    title: 'Iceland Ring Road — 14 Days, All Seasons',
    slug: 'iceland-ring-road-14-days',
    description: 'The full ring road with every waterfall, glacier, and hot pot we stopped at. Includes a detailed rental car breakdown.',
    primaryCity: 'Reykjavik',
    countries: ['Iceland'],
    cities: ['Reykjavik', 'Akureyri', 'Höfn', 'Vík'],
    durationDays: 14,
    budgetLow: 3000, budgetHigh: 5500,
    bestMonths: [6, 7, 8],
    travelStyle: ['MID', 'COUPLE'],
    accessTier: 'FOLLOWER',
    isFeatured: false,
    cover: COVER(1005),
    days: [
      {
        dayNumber: 1, title: 'Day 1 — Reykjavik & Golden Circle', city: 'Reykjavik',
        summary: 'Land early, go straight to the Golden Circle, be back in Reykjavik for a hot dog.',
        tips: ['The "tourist" hot dog stand by the harbour (Bæjarins Beztu) is genuinely the best $4 you\'ll spend'],
        activities: [
          { time: 'morning', title: 'Þingvellir National Park', type: 'ADVENTURE', provider: null, targetName: null },
          { time: 'afternoon', title: 'Geysir & Strokkur geyser', type: 'ATTRACTION', provider: null, targetName: null },
          { time: 'afternoon', title: 'Gullfoss Waterfall', type: 'ATTRACTION', provider: null, targetName: null },
          { time: 'evening', title: 'Fosshotel Reykjavik', type: 'ACCOMMODATION',
            provider: 'STAY22', targetName: 'Fosshotel Reykjavik', priceFrom: 'from $180/night' },
        ],
      },
    ],
  },
  {
    title: 'Colombia 2 Weeks — Medellín, Cartagena & Coffee Region',
    slug: 'colombia-2-weeks-medellin-cartagena',
    description: 'The transformation story — Medellín is one of the most electric cities in South America right now. Here\'s the full two-week run.',
    primaryCity: 'Medellín',
    countries: ['Colombia'],
    cities: ['Medellín', 'Cartagena', 'Salento', 'Bogotá'],
    durationDays: 14,
    budgetLow: 1000, budgetHigh: 2200,
    bestMonths: [12, 1, 2, 3],
    travelStyle: ['BUDGET', 'SOLO'],
    accessTier: 'FREE',
    isFeatured: false,
    cover: COVER(1006),
    days: [
      {
        dayNumber: 1, title: 'Day 1 — Medellín: El Poblado', city: 'Medellín',
        summary: 'El Poblado is the gringo hub — great for a first night, move on after two days.',
        tips: ['Take the Metro Cable up to Parque Arvi on Day 2 — it\'s free with the metro card'],
        activities: [
          { time: 'afternoon', title: 'Casa Kiwi Hostel', type: 'ACCOMMODATION',
            provider: 'STAY22', targetName: 'Casa Kiwi Hostel Medellín', priceFrom: 'from $18/night' },
          { time: 'evening', title: 'Parque Lleras bar crawl', type: 'NIGHTLIFE', provider: null, targetName: null },
        ],
      },
    ],
  },
  {
    title: 'Thailand Island Hopping — Koh Tao, Samui & Phangan',
    slug: 'thailand-island-hopping-koh-tao-samui',
    description: 'Three islands, 10 days, zero regrets. Dive certifications, full moon parties, and the best pad thai you\'ll eat in your life.',
    primaryCity: 'Koh Tao',
    countries: ['Thailand'],
    cities: ['Koh Tao', 'Koh Samui', 'Koh Phangan'],
    durationDays: 10,
    budgetLow: 800, budgetHigh: 1800,
    bestMonths: [1, 2, 3, 11, 12],
    travelStyle: ['BUDGET', 'SOLO', 'BACKPACKER'],
    accessTier: 'FREE',
    isFeatured: false,
    cover: COVER(1007),
    days: [
      {
        dayNumber: 1, title: 'Day 1 — Koh Tao: Arrive & Dive', city: 'Koh Tao',
        summary: 'Koh Tao is the cheapest place in the world to get your PADI Open Water cert. Do it.',
        tips: ['Book dive school before you arrive — Crystal Dive and Big Blue are both legit', 'Stay near Sairee Beach — central to everything'],
        activities: [
          { time: 'morning', title: 'Crystal Dive — PADI Open Water Day 1', type: 'ADVENTURE',
            provider: 'VIATOR', targetName: 'Koh Tao PADI Open Water Course', priceFrom: 'from $250' },
          { time: 'evening', title: 'Koh Tao Cabana resort', type: 'ACCOMMODATION',
            provider: 'STAY22', targetName: 'Koh Tao Cabana', priceFrom: 'from $45/night' },
        ],
      },
    ],
  },
  {
    title: 'New York City Long Weekend — 4 Days From a Local',
    slug: 'new-york-city-4-day-local-guide',
    description: 'I grew up in Brooklyn and this is what I show every friend who visits. Skip the tourist traps, here\'s where to actually eat, drink and explore.',
    primaryCity: 'New York City',
    countries: ['USA'],
    cities: ['New York City', 'Brooklyn'],
    durationDays: 4,
    budgetLow: 600, budgetHigh: 1400,
    bestMonths: [4, 5, 9, 10],
    travelStyle: ['MID', 'COUPLE', 'SOLO'],
    accessTier: 'PREMIUM',
    isFeatured: true,
    cover: COVER(1008),
    days: [
      {
        dayNumber: 1, title: 'Day 1 — Brooklyn: DUMBO to Williamsburg', city: 'Brooklyn',
        summary: 'Start on the bridge, end with a rooftop beer in Williamsburg. Perfect Brooklyn day.',
        tips: ['The L train runs 24/7 to Williamsburg', 'Grimaldi\'s has the line — Juliana\'s next door is the same pizza with no wait'],
        activities: [
          { time: 'morning', title: 'Check in — 1 Hotel Brooklyn Bridge', type: 'ACCOMMODATION',
            provider: 'STAY22', targetName: '1 Hotel Brooklyn Bridge', priceFrom: 'from $320/night' },
          { time: 'morning', title: 'Brooklyn Bridge walk (Manhattan side to DUMBO)', type: 'ATTRACTION', provider: null, targetName: null },
          { time: 'lunch', title: 'Juliana\'s Pizza, DUMBO', type: 'FOOD', provider: null, targetName: null },
          { time: 'afternoon', title: 'Brooklyn Flea at Smorgasburg', type: 'FOOD', provider: null, targetName: null },
          { time: 'evening', title: 'Williamsburg bar hop (Westlight rooftop)', type: 'NIGHTLIFE', provider: null, targetName: null },
        ],
      },
      {
        dayNumber: 2, title: 'Day 2 — Manhattan: Central Park to the High Line', city: 'New York City',
        summary: 'The Manhattan essentials without looking like a tourist.',
        tips: ['High Line is free, open 7am-10pm', 'Chelsea Market is adjacent to the High Line — go for lunch'],
        activities: [
          { time: 'morning', title: 'Central Park sunrise run (or walk)', type: 'ADVENTURE', provider: null, targetName: null },
          { time: 'morning', title: 'The Met — Egyptian Wing & Impressionists', type: 'CULTURAL',
            provider: 'GETYOURGUIDE', targetName: 'The Met Museum guided tour', priceFrom: 'from $29' },
          { time: 'afternoon', title: 'The High Line', type: 'ATTRACTION', provider: null, targetName: null },
          { time: 'lunch', title: 'Chelsea Market', type: 'FOOD', provider: null, targetName: null },
          { time: 'evening', title: 'Katz\'s Delicatessen, Lower East Side', type: 'FOOD', provider: null, targetName: null },
        ],
      },
    ],
  },
]

// ─── Vlog titles per destination ─────────────────────────────────────────────
const VLOG_TITLES: Record<string, string[]> = {
  'japan': [
    'I spent $50 a day in Tokyo — here\'s everything I ate',
    'HONEST review of every budget hotel in Shinjuku',
    'Kyoto in cherry blossom season — is it worth the crowds?',
    'The Arashiyama bamboo grove at 5am (zero tourists)',
    'Osaka street food tour — 8 things under $5',
  ],
  'bali': [
    'Why I stopped staying in Kuta (and where I go instead)',
    'Canggu in 2024 — is it still worth it?',
    'The best sunrise spot in Bali that no one talks about',
    'Ubud day trip: rice terraces, monkey forest & the real cost',
    'Bali scooter rental guide — everything I wish I knew',
  ],
  'portugal': [
    'Lisbon on €50 a day — is it possible?',
    'Porto vs Lisbon — an honest comparison after 3 weeks',
    'The Alentejo wine region: my favourite place in Europe',
    'Sintra in a day — worth it or tourist trap?',
    'Portugal by train: the complete guide + timetables',
  ],
  'morocco': [
    'My first 48 hours in Marrakech (what no one warns you about)',
    'Sahara Desert overnight — what it actually costs',
    'Fes medina: getting lost on purpose',
    'Chefchaouen — the blue city in one day',
    'Morocco on $60 a day: the breakdown',
  ],
  'iceland': [
    'Iceland ring road in June — midnight sun everything',
    'The real cost of renting a car in Iceland (2024 prices)',
    'Jökulsárlón glacier lagoon: everything you need to know',
    'Iceland vs Norway — which is worth it?',
    'Hot springs in Iceland: the secret ones (not the Blue Lagoon)',
  ],
  'colombia': [
    'Medellín — why everyone I know who visits wants to stay',
    'Coffee region Colombia: Salento and the Cocora Valley',
    'Cartagena in 3 days: walled city, beaches, and heat',
    'Colombia safety in 2024 — the real talk',
    'Bogotá to Medellín: flights vs bus (actual prices)',
  ],
  'thailand': [
    'Getting PADI certified in Koh Tao — worth it?',
    'Full Moon Party Koh Phangan — honest review after 3 times',
    'Koh Samui beach breakdown: which beach is actually the best',
    'Thailand island hopping: the ferry guide',
    'Eating vegan in Thailand — better than you think',
  ],
  'new-york': [
    'I grew up in Brooklyn — here\'s what tourists always get wrong',
    'NYC on $100 a day — actually possible in 2024',
    'The best $1 pizza in New York (I tried 40 slices)',
    'Manhattan vs Brooklyn — where to stay your first time',
    'NYC subway guide for first-timers (from a local)',
  ],
}

const DEST_KEYS = ['japan', 'bali', 'portugal', 'morocco', 'iceland', 'colombia', 'thailand', 'new-york']

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000)
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function shortCode(prefix: string, n: number): string {
  return `${prefix}${String(n).padStart(4, '0')}`.toUpperCase()
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱  Seeding TripKits dev database…\n')

  // ── 1. Creator ─────────────────────────────────────────────────────────────
  const creator = await prisma.creator.upsert({
    where: { handle: 'alexwanders' },
    update: {},
    create: {
      userId: CREATOR_USER_ID,
      handle: 'alexwanders',
      displayName: 'Alex Wanders',
      bio: 'Full-time traveller, part-time overpacker. I\'ve been to 68 countries and still can\'t decide between Japan and Portugal. Trip kits for every budget.',
      avatarUrl: AVATAR,
      coverImageUrl: COVER(9999),
      location: 'Based everywhere',
      country: 'US',
      youtubeChannelId: 'UC_seed_alexwanders',
      youtubeHandle: 'alexwanders',
      instagramHandle: 'alexwanders',
      subscriberCount: 284000,
      plan: 'PRO',
      catalogScanStatus: 'COMPLETE',
      lastCatalogScan: daysAgo(3),
      isPublished: true,
      isVerified: true,
    },
  })
  console.log(`✓  Creator: @${creator.handle} (${creator.id})`)

  // ── 2. Vlogs (40 total, 5 per destination) ─────────────────────────────────
  let vlogIndex = 0
  const vlogIds: string[] = []

  for (const destKey of DEST_KEYS) {
    const titles = VLOG_TITLES[destKey]
    for (let i = 0; i < 5; i++) {
      vlogIndex++
      const externalId = `yt_seed_${destKey}_${i}`
      const vlog = await prisma.vlog.upsert({
        where: { platform_externalId: { platform: 'YOUTUBE', externalId } },
        update: {},
        create: {
          creatorId: creator.id,
          platform: 'YOUTUBE',
          externalId,
          externalUrl: `https://youtube.com/watch?v=${externalId}`,
          title: titles[i],
          description: `${titles[i]} — full travel guide with prices, hotels and honest opinions.`,
          thumbnailUrl: COVER(2000 + vlogIndex),
          publishedAt: daysAgo(vlogIndex * 9),
          durationSeconds: randomBetween(720, 2400),
          viewCount: randomBetween(15000, 480000),
          likeCount: randomBetween(800, 24000),
          processingStatus: 'COMPLETE',
          processedAt: daysAgo(vlogIndex * 9 - 1),
          countries: [destKey.split('-')[0]],
          cities: [],
          tags: [destKey, 'travel', 'budget travel'],
        },
      })
      vlogIds.push(vlog.id)
    }
  }
  console.log(`✓  Vlogs: ${vlogIndex} created`)

  // ── 3. Subscription tiers ──────────────────────────────────────────────────
  const followerTier = await prisma.subscriptionTier.upsert({
    where: { id: 'seed-tier-follower' },
    update: {},
    create: {
      id: 'seed-tier-follower',
      creatorId: creator.id,
      name: 'Follower',
      description: 'Free access to all follower-tier kits plus early previews.',
      monthlyPrice: 0,
      kitAccess: 'FOLLOWER',
      perks: ['All follower kits unlocked', 'Early access to new drops', 'Monthly newsletter'],
      sortOrder: 0,
      isActive: true,
    },
  })

  const premiumTier = await prisma.subscriptionTier.upsert({
    where: { id: 'seed-tier-premium' },
    update: {},
    create: {
      id: 'seed-tier-premium',
      creatorId: creator.id,
      name: 'Trip Partner',
      description: 'Full access to every kit including premium itineraries, packing lists, and budget breakdowns.',
      monthlyPrice: 999, // $9.99
      yearlyPrice: 7999, // $79.99
      kitAccess: 'PREMIUM',
      perks: [
        'All premium kits unlocked',
        'Full packing lists + gear picks',
        'Budget spreadsheets for every trip',
        'Discord community access',
        'Monthly live Q&A',
      ],
      sortOrder: 1,
      isActive: true,
    },
  })
  console.log(`✓  Subscription tiers: Follower + Trip Partner`)

  // ── 4. Trip Kits ───────────────────────────────────────────────────────────
  const createdKits: Array<{ id: string; slug: string }> = []
  let affilinkCounter = 0

  for (let di = 0; di < DESTINATIONS.length; di++) {
    const d = DESTINATIONS[di]
    const destKey = DEST_KEYS[di]

    // Gather the 5 vlog IDs for this destination
    const destVlogIds = vlogIds.slice(di * 5, di * 5 + 5)

    // Create affiliate links for this kit's activities first
    const activityLinks: Record<string, string> = {} // title key → link id

    for (const day of d.days) {
      for (const act of day.activities) {
        if (!act.provider || !act.targetName) continue
        affilinkCounter++
        const sc = shortCode('SD', affilinkCounter)
        const provider = act.provider as 'STAY22' | 'GETYOURGUIDE' | 'VIATOR'
        const linkType = provider === 'STAY22' ? 'HOTEL' : 'EXPERIENCE_TOUR'
        const url = provider === 'STAY22'
          ? `https://www.stay22.com/book/${sc}?aid=seed_test`
          : provider === 'GETYOURGUIDE'
            ? `https://www.getyourguide.com/activity/${sc}/?partner_id=seed_test`
            : `https://www.viator.com/tours/${sc}?mcid=seed_test`

        const link = await prisma.affiliateLink.upsert({
          where: { shortCode: sc },
          update: {},
          create: {
            creatorId: creator.id,
            type: linkType,
            targetName: act.targetName,
            targetUrl: url,
            affiliateUrl: url,
            shortCode: sc,
            provider,
            providerProductId: sc,
            city: day.city,
            priceFrom: act.priceFrom ?? null,
            estimatedCommissionPct: provider === 'STAY22' ? 30 : 8,
            clickCount: randomBetween(12, 890),
            conversionCount: randomBetween(1, 45),
            totalEarnings: randomBetween(20, 800),
            isActive: true,
          },
        })
        activityLinks[act.title] = link.id
      }
    }

    const kitSlug = d.slug
    const kit = await prisma.tripKit.upsert({
      where: { creatorId_slug: { creatorId: creator.id, slug: kitSlug } },
      update: {},
      create: {
        creatorId: creator.id,
        title: d.title,
        slug: kitSlug,
        description: d.description,
        coverImageUrl: d.cover,
        countries: d.countries,
        cities: d.cities,
        primaryCity: d.primaryCity,
        durationDays: d.durationDays,
        estimatedBudgetLow: d.budgetLow,
        estimatedBudgetHigh: d.budgetHigh,
        bestMonths: d.bestMonths,
        travelStyle: d.travelStyle as never,
        accessTier: d.accessTier as never,
        isPublished: true,
        isFeatured: d.isFeatured,
        generatedByAI: di < 6,
        aiVersion: di < 6 ? 'gemini-2.5-flash' : null,
        manuallyEdited: di >= 6,
        viewCount: randomBetween(800, 22000),
        saveCount: randomBetween(50, 2000),
        clickCount: randomBetween(100, 8000),
        totalLinkCount: d.days.reduce((s, day) => s + day.activities.filter(a => a.provider).length, 0),
        sourceVlogs: {
          create: destVlogIds.map(vlogId => ({ vlogId })),
        },
      },
    })
    createdKits.push({ id: kit.id, slug: kit.slug })

    // Create days + activities
    for (const dayData of d.days) {
      const day = await prisma.itineraryDay.upsert({
        where: { tripKitId_dayNumber: { tripKitId: kit.id, dayNumber: dayData.dayNumber } },
        update: {},
        create: {
          tripKitId: kit.id,
          dayNumber: dayData.dayNumber,
          title: dayData.title,
          summary: dayData.summary,
          city: dayData.city,
          tips: dayData.tips,
        },
      })

      for (let ai = 0; ai < dayData.activities.length; ai++) {
        const act = dayData.activities[ai]
        const linkId = activityLinks[act.title] ?? null
        const actId = `seed-act-${kit.id}-${dayData.dayNumber}-${ai}`
        await prisma.dayActivity.upsert({
          where: { id: actId },
          update: {},
          create: {
            id: actId,
            dayId: day.id,
            sortOrder: ai,
            time: act.time ?? null,
            title: act.title,
            type: act.type as never,
            affiliateLinkId: linkId,
          },
        })
      }
    }
  }
  console.log(`✓  Trip Kits: ${createdKits.length} with days, activities, and affiliate links`)

  // ── 5. Merchandise ─────────────────────────────────────────────────────────
  await prisma.merchandise.upsert({
    where: { creatorId_slug: { creatorId: creator.id, slug: 'alex-wanders-packing-guide' } },
    update: {},
    create: {
      creatorId: creator.id,
      title: 'The 1-Bag Travel Guide (PDF)',
      slug: 'alex-wanders-packing-guide',
      description: '48 pages. Everything I pack for 3-week trips in one 26L bag. Tested across 30 countries.',
      coverImageUrl: COVER(3001),
      type: 'DIGITAL',
      price: 1299, // $12.99
      currency: 'USD',
      isPublished: true,
      isFeatured: true,
      sortOrder: 0,
    },
  })

  await prisma.merchandise.upsert({
    where: { creatorId_slug: { creatorId: creator.id, slug: 'alex-wanders-tee' } },
    update: {},
    create: {
      creatorId: creator.id,
      title: 'Alex Wanders — Classic Logo Tee',
      slug: 'alex-wanders-tee',
      description: 'Heavyweight 100% cotton. The tee I wear on every trip.',
      coverImageUrl: COVER(3002),
      type: 'PHYSICAL',
      price: 3200, // $32.00
      currency: 'USD',
      printProvider: 'printful',
      isPublished: true,
      isFeatured: true,
      sortOrder: 1,
    },
  })
  console.log(`✓  Merchandise: 2 items`)

  // ── 6. Subscribers ─────────────────────────────────────────────────────────
  const now = new Date()

  const sub1 = await prisma.subscriber.upsert({
    where: { userId: SUBSCRIBER_1_ID },
    update: {},
    create: {
      userId: SUBSCRIBER_1_ID,
      displayName: 'Jamie Chen',
      avatarUrl: COVER(4001),
      location: 'San Francisco, CA',
    },
  })
  // Free follow only
  await prisma.follow.upsert({
    where: { subscriberId_creatorId: { subscriberId: sub1.id, creatorId: creator.id } },
    update: {},
    create: { subscriberId: sub1.id, creatorId: creator.id },
  })

  const sub2 = await prisma.subscriber.upsert({
    where: { userId: SUBSCRIBER_2_ID },
    update: {},
    create: {
      userId: SUBSCRIBER_2_ID,
      displayName: 'Maria Santos',
      avatarUrl: COVER(4002),
      location: 'Lisbon, Portugal',
    },
  })
  // Follower tier (free) subscription
  await prisma.subscription.upsert({
    where: { subscriberId_creatorId: { subscriberId: sub2.id, creatorId: creator.id } },
    update: {},
    create: {
      subscriberId: sub2.id,
      creatorId: creator.id,
      tierId: followerTier.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: daysAgo(15),
      currentPeriodEnd: new Date(now.getTime() + 15 * 86400000),
    },
  })

  const sub3 = await prisma.subscriber.upsert({
    where: { userId: SUBSCRIBER_3_ID },
    update: {},
    create: {
      userId: SUBSCRIBER_3_ID,
      displayName: 'Tom Nakamura',
      avatarUrl: COVER(4003),
      location: 'Tokyo, Japan',
    },
  })
  // Premium tier subscription
  await prisma.subscription.upsert({
    where: { subscriberId_creatorId: { subscriberId: sub3.id, creatorId: creator.id } },
    update: {},
    create: {
      subscriberId: sub3.id,
      creatorId: creator.id,
      tierId: premiumTier.id,
      status: 'ACTIVE',
      billingPeriod: 'MONTHLY',
      currentPeriodStart: daysAgo(8),
      currentPeriodEnd: new Date(now.getTime() + 22 * 86400000),
    },
  })
  console.log(`✓  Subscribers: 3 (1 follower, 1 follower-tier sub, 1 premium)`)

  // ── 7. Commissions (15 across Stay22 + GYG + Viator) ──────────────────────
  const allLinks = await prisma.affiliateLink.findMany({
    where: { creatorId: creator.id },
    select: { id: true, provider: true },
    take: 15,
  })

  const commissionStatuses: Array<'PENDING' | 'CONFIRMED' | 'PAID'> = ['PAID', 'PAID', 'PAID', 'PAID', 'PAID', 'CONFIRMED', 'CONFIRMED', 'CONFIRMED', 'PENDING', 'PENDING', 'PENDING', 'PENDING', 'CONFIRMED', 'PAID', 'PENDING']

  for (let ci = 0; ci < Math.min(15, allLinks.length); ci++) {
    const link = allLinks[ci]
    const status = commissionStatuses[ci]
    const gross = randomBetween(8000, 45000)   // cents
    const commission = Math.floor(gross * 0.28)
    const creatorEarnings = commission

    const extId = `seed-conv-${ci + 1}`
    const existing = await prisma.commission.findUnique({ where: { externalConversionId: extId } })
    if (!existing) {
      await prisma.commission.create({
        data: {
          creatorId: creator.id,
          affiliateLinkId: link.id,
          provider: link.provider,
          externalConversionId: extId,
          grossAmount: gross,
          commissionAmount: commission,
          platformFee: 0,
          creatorEarnings,
          currency: 'USD',
          status,
          convertedAt: daysAgo(randomBetween(1, 60)),
          paidAt: status === 'PAID' ? daysAgo(randomBetween(1, 20)) : null,
        },
      })
    }
  }
  console.log(`✓  Commissions: 15 (mix of PENDING / CONFIRMED / PAID)`)

  // ── 8. Click events (30 for analytics charts) ─────────────────────────────
  const devices = ['MOBILE', 'DESKTOP', 'TABLET'] as const
  const referrers = ['https://youtube.com', 'https://tiktok.com', null, null, 'https://google.com']

  for (let ci = 0; ci < 30; ci++) {
    const link = allLinks[ci % allLinks.length]
    const kit = createdKits[ci % createdKits.length]
    await prisma.clickEvent.create({
      data: {
        linkId: link.id,
        creatorId: creator.id,
        sessionId: `seed-session-${ci}`,
        tripKitId: kit.id,
        referrer: referrers[ci % referrers.length],
        device: devices[ci % devices.length],
        country: ['US', 'GB', 'AU', 'DE', 'JP', 'BR'][ci % 6],
        createdAt: daysAgo(randomBetween(0, 30)),
      },
    })
  }
  console.log(`✓  Click events: 30`)

  console.log('\n✅  Seed complete!\n')
  console.log('  Creator storefront: http://localhost:3000/@alexwanders')
  console.log('  Dashboard:          http://localhost:3000/dashboard')
  console.log(`  User ID for auth:   ${CREATOR_USER_ID}`)
  console.log('\n  To log in as this creator, create a Supabase auth user with that UUID,')
  console.log('  or use the Supabase dashboard to set the user_id on the creator record.\n')
}

main()
  .catch(e => { console.error(e); process.exit(1) })
  .finally(() => prisma.$disconnect())
