export const STOREFRONT_THEME_IDS = [
  'BEACH_RETREAT',
  'ADVENTURE_TRAIL',
  'BACKPACKER_NOTEBOOK',
  'MOUNTAIN_ESCAPE',
  'CITY_EDITORIAL',
  'FOREST_CAMP',
  'DESERT_SUNSET',
  'ISLAND_HOPPING',
  'ROAD_TRIP',
  'WELLNESS_HIDEAWAY',
  'FOOD_TRAIL',
  'LUXURY_ATLAS',
] as const

export type StorefrontThemeId = (typeof STOREFRONT_THEME_IDS)[number]

type StorefrontThemeDefinition = {
  id: StorefrontThemeId
  name: string
  vibe: string
  headline: string
  subheadline: string
  chip: string
  pageClassName: string
  shellClassName: string
  heroClassName: string
  cardClassName: string
  pillClassName: string
  accentClassName: string
  previewClassName: string
  previewImageUrl: string
  storefrontBackdropImageUrl: string
}

function svgToDataUri(svg: string) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`
}

function buildThemeArtwork({
  skyTop,
  skyBottom,
  sun,
  horizon,
  foreground,
  accent,
  feature,
}: {
  skyTop: string
  skyBottom: string
  sun: string
  horizon: string
  foreground: string
  accent: string
  feature: string
}) {
  return svgToDataUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">
      <defs>
        <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${skyTop}"/>
          <stop offset="100%" stop-color="${skyBottom}"/>
        </linearGradient>
        <linearGradient id="ground" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0%" stop-color="${horizon}"/>
          <stop offset="100%" stop-color="${foreground}"/>
        </linearGradient>
      </defs>
      <rect width="1600" height="900" fill="url(#sky)"/>
      <circle cx="1260" cy="170" r="110" fill="${sun}" opacity="0.88"/>
      <ellipse cx="1180" cy="180" rx="260" ry="120" fill="${sun}" opacity="0.18"/>
      <path d="M0 560 C220 470 420 520 650 470 C840 430 1010 470 1190 430 C1370 392 1490 430 1600 390 L1600 900 L0 900 Z" fill="url(#ground)"/>
      <path d="M0 690 C230 620 430 650 650 610 C880 566 1080 610 1320 570 C1460 546 1535 560 1600 548 L1600 900 L0 900 Z" fill="${accent}" opacity="0.82"/>
      <path d="${feature}" fill="#ffffff" opacity="0.22"/>
    </svg>`,
  )
}

export const STOREFRONT_THEMES: StorefrontThemeDefinition[] = [
  {
    id: 'BEACH_RETREAT',
    name: 'Beach Retreat',
    vibe: 'Salt-air, barefoot luxury, ocean glow',
    headline: 'Sunset itineraries, island stays, and slow days by the water.',
    subheadline: 'Designed for creators whose audience wants beaches, boutique stays, and breezy travel energy.',
    chip: 'Coastal',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(125,211,252,0.24),_rgba(8,47,73,0.96)_42%,_#03141e_100%)] text-white',
    shellClassName: 'border-sky-200/15 bg-sky-200/6',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(125,211,252,0.22),rgba(45,212,191,0.14),rgba(255,255,255,0.05))]',
    cardClassName: 'border-sky-200/15 bg-sky-100/7',
    pillClassName: 'border-sky-200/20 bg-sky-200/10 text-sky-100',
    accentClassName: 'text-sky-100',
    previewClassName: 'from-sky-300/80 via-cyan-200/65 to-teal-200/60',
    previewImageUrl: buildThemeArtwork({ skyTop: '#86d8ff', skyBottom: '#0f766e', sun: '#fff4b3', horizon: '#7dd3fc', foreground: '#0f3d56', accent: '#0ea5a4', feature: 'M0 690 C210 650 420 640 610 680 C770 716 940 736 1120 714 C1270 694 1410 650 1600 626 L1600 900 L0 900 Z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#9ee7ff', skyBottom: '#0b3d5a', sun: '#fff7c2', horizon: '#67e8f9', foreground: '#0a2233', accent: '#14b8a6', feature: 'M0 720 C180 666 356 650 520 688 C690 726 866 754 1090 724 C1290 698 1450 640 1600 612 L1600 900 L0 900 Z' }),
  },
  {
    id: 'ADVENTURE_TRAIL',
    name: 'Adventure Trail',
    vibe: 'Action-first, bold, outdoorsy',
    headline: 'Trails, adrenaline, and the gear that gets you there.',
    subheadline: 'For creators covering hiking, surf, diving, tours, and action-heavy itineraries.',
    chip: 'Adrenaline',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(132,204,22,0.18),_rgba(23,23,23,0.94)_38%,_#05080d_100%)] text-white',
    shellClassName: 'border-lime-200/15 bg-lime-200/6',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(132,204,22,0.18),rgba(245,158,11,0.14),rgba(255,255,255,0.04))]',
    cardClassName: 'border-lime-200/15 bg-zinc-950/60',
    pillClassName: 'border-lime-200/20 bg-lime-200/10 text-lime-100',
    accentClassName: 'text-lime-100',
    previewClassName: 'from-lime-300/80 via-amber-300/70 to-orange-300/65',
    previewImageUrl: buildThemeArtwork({ skyTop: '#9adf4f', skyBottom: '#1f2937', sun: '#fde68a', horizon: '#65a30d', foreground: '#111827', accent: '#f59e0b', feature: 'M150 700 L430 430 L640 690 L860 520 L1120 728 L1310 570 L1510 760 L1600 900 L0 900 Z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#bef264', skyBottom: '#111827', sun: '#fde68a', horizon: '#4d7c0f', foreground: '#0b1220', accent: '#f97316', feature: 'M110 720 L420 402 L650 704 L872 528 L1114 736 L1360 520 L1540 770 L1600 900 L0 900 Z' }),
  },
  {
    id: 'BACKPACKER_NOTEBOOK',
    name: 'Backpacker Notebook',
    vibe: 'Budget-savvy, scrapbook energy',
    headline: 'Hostels, routes, and real travel hacks worth saving.',
    subheadline: 'Built for backpacking creators who want their storefront to feel like a living notebook.',
    chip: 'Backpacking',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.14),_rgba(69,26,3,0.95)_34%,_#120c07_100%)] text-white',
    shellClassName: 'border-amber-200/15 bg-amber-100/5',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(251,191,36,0.18),rgba(248,113,113,0.12),rgba(255,255,255,0.04))]',
    cardClassName: 'border-amber-200/15 bg-stone-900/70',
    pillClassName: 'border-amber-200/20 bg-amber-100/10 text-amber-100',
    accentClassName: 'text-amber-100',
    previewClassName: 'from-amber-300/80 via-orange-300/70 to-rose-300/65',
    previewImageUrl: buildThemeArtwork({ skyTop: '#fcd34d', skyBottom: '#7c2d12', sun: '#fff1a6', horizon: '#f59e0b', foreground: '#45210f', accent: '#fb7185', feature: 'M150 560 H1260 V610 H150 Z M220 610 H1320 V640 H220 Z M1010 430 l130 0 l42 230 l-212 0 Z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#fbbf24', skyBottom: '#5b2412', sun: '#fff3bf', horizon: '#fb923c', foreground: '#34170d', accent: '#f97316', feature: 'M140 550 H1320 V612 H140 Z M220 615 H1400 V648 H220 Z M980 410 l160 0 l55 255 l-248 0 Z' }),
  },
  {
    id: 'MOUNTAIN_ESCAPE',
    name: 'Mountain Escape',
    vibe: 'Altitude, crisp air, alpine calm',
    headline: 'Cabins, peaks, and routes for people who chase elevation.',
    subheadline: 'Ideal for mountain towns, ski trips, alpine hikes, and quiet escapes.',
    chip: 'Alpine',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(191,219,254,0.18),_rgba(17,24,39,0.95)_40%,_#050815_100%)] text-white',
    shellClassName: 'border-slate-200/15 bg-slate-100/6',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(148,163,184,0.2),rgba(191,219,254,0.14),rgba(255,255,255,0.04))]',
    cardClassName: 'border-slate-200/15 bg-slate-950/60',
    pillClassName: 'border-slate-200/20 bg-slate-100/10 text-slate-100',
    accentClassName: 'text-slate-100',
    previewClassName: 'from-slate-300/80 via-sky-200/65 to-indigo-200/55',
    previewImageUrl: buildThemeArtwork({ skyTop: '#cbd5e1', skyBottom: '#1e293b', sun: '#f8fafc', horizon: '#94a3b8', foreground: '#0f172a', accent: '#64748b', feature: 'M80 760 L370 420 L620 750 L860 350 L1080 736 L1330 480 L1510 770 L1600 900 L0 900 Z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#dbeafe', skyBottom: '#172554', sun: '#ffffff', horizon: '#93c5fd', foreground: '#0f172a', accent: '#475569', feature: 'M40 780 L350 420 L625 760 L870 320 L1105 742 L1360 460 L1540 790 L1600 900 L0 900 Z' }),
  },
  {
    id: 'CITY_EDITORIAL',
    name: 'City Editorial',
    vibe: 'Sharp, polished, metropolitan',
    headline: 'The city guide storefront for the audience that wants your exact itinerary.',
    subheadline: 'Best for urban creators covering neighborhoods, dining, design hotels, and shopping.',
    chip: 'City',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(196,181,253,0.16),_rgba(15,23,42,0.95)_35%,_#04060f_100%)] text-white',
    shellClassName: 'border-violet-200/15 bg-violet-100/6',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(129,140,248,0.2),rgba(196,181,253,0.14),rgba(255,255,255,0.04))]',
    cardClassName: 'border-violet-200/15 bg-slate-950/65',
    pillClassName: 'border-violet-200/20 bg-violet-100/10 text-violet-100',
    accentClassName: 'text-violet-100',
    previewClassName: 'from-violet-300/80 via-fuchsia-300/70 to-cyan-300/55',
    previewImageUrl: buildThemeArtwork({ skyTop: '#c4b5fd', skyBottom: '#172554', sun: '#f5f3ff', horizon: '#818cf8', foreground: '#0f172a', accent: '#22d3ee', feature: 'M240 260 h210 v380 h-210 z M520 180 h250 v460 h-250 z M840 230 h190 v410 h-190 z M1100 300 h220 v340 h-220 z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#a78bfa', skyBottom: '#0f172a', sun: '#faf5ff', horizon: '#6366f1', foreground: '#020617', accent: '#06b6d4', feature: 'M220 260 h220 v390 h-220 z M500 160 h270 v490 h-270 z M830 220 h210 v430 h-210 z M1100 300 h240 v350 h-240 z' }),
  },
  {
    id: 'FOREST_CAMP',
    name: 'Forest Camp',
    vibe: 'Woodland, earthy, quiet adventure',
    headline: 'Cabins, campfires, and slower routes into the trees.',
    subheadline: 'Made for forest stays, camps, cabins, and nature-heavy itineraries.',
    chip: 'Woodland',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.15),_rgba(5,46,22,0.96)_36%,_#030a05_100%)] text-white',
    shellClassName: 'border-emerald-200/15 bg-emerald-100/5',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(34,197,94,0.18),rgba(163,230,53,0.1),rgba(255,255,255,0.04))]',
    cardClassName: 'border-emerald-200/15 bg-emerald-950/40',
    pillClassName: 'border-emerald-200/20 bg-emerald-100/10 text-emerald-100',
    accentClassName: 'text-emerald-100',
    previewClassName: 'from-emerald-300/80 via-lime-300/70 to-yellow-200/55',
    previewImageUrl: buildThemeArtwork({ skyTop: '#4ade80', skyBottom: '#14532d', sun: '#ecfccb', horizon: '#16a34a', foreground: '#052e16', accent: '#65a30d', feature: 'M260 370 c90 40 130 160 60 280 c-30 60 -70 80 -110 80 c-55 0 -90 -35 -90 -85 c0 -65 55 -110 110 -110 c28 0 56 8 82 22 c-18 -58 -42 -104 -52 -153 Z M980 340 c95 38 138 160 70 280 c-30 62 -72 80 -112 80 c-55 0 -90 -35 -90 -86 c0 -65 55 -109 110 -109 c30 0 60 9 86 24 c-16 -58 -40 -108 -64 -159 Z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#86efac', skyBottom: '#14532d', sun: '#f7fee7', horizon: '#22c55e', foreground: '#052e16', accent: '#4d7c0f', feature: 'M290 350 c96 42 140 168 66 292 c-34 58 -74 74 -118 74 c-55 0 -92 -34 -92 -86 c0 -68 56 -112 112 -112 c26 0 54 8 82 22 c-18 -58 -40 -106 -50 -150 Z M990 320 c100 44 146 170 72 294 c-32 56 -72 72 -116 72 c-56 0 -94 -36 -94 -88 c0 -68 56 -112 112 -112 c28 0 56 8 86 24 c-18 -62 -40 -112 -60 -160 Z' }),
  },
  {
    id: 'DESERT_SUNSET',
    name: 'Desert Sunset',
    vibe: 'Warm, cinematic, open-road glow',
    headline: 'Golden-hour stays, wide roads, and places that feel bigger in person.',
    subheadline: 'Great for desert road trips, design hotels, canyons, and warm-weather escapes.',
    chip: 'Sunset',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(251,146,60,0.2),_rgba(67,20,7,0.95)_35%,_#130704_100%)] text-white',
    shellClassName: 'border-orange-200/15 bg-orange-100/5',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(251,146,60,0.18),rgba(244,114,182,0.12),rgba(255,255,255,0.04))]',
    cardClassName: 'border-orange-200/15 bg-stone-950/65',
    pillClassName: 'border-orange-200/20 bg-orange-100/10 text-orange-100',
    accentClassName: 'text-orange-100',
    previewClassName: 'from-orange-300/80 via-rose-300/70 to-yellow-200/55',
    previewImageUrl: buildThemeArtwork({ skyTop: '#fb923c', skyBottom: '#7c2d12', sun: '#fde68a', horizon: '#f97316', foreground: '#431407', accent: '#fb7185', feature: 'M140 715 C340 625 565 610 760 646 C940 678 1150 660 1400 596 L1480 715 L1600 900 L0 900 Z M220 580 h160 v55 h-160 z M1130 520 h130 v38 h-130 z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#fdba74', skyBottom: '#7f1d1d', sun: '#fde68a', horizon: '#f59e0b', foreground: '#3f1308', accent: '#f97316', feature: 'M120 730 C310 620 560 604 780 646 C1000 688 1220 664 1460 584 L1600 900 L0 900 Z M200 580 h190 v58 h-190 z M1140 515 h150 v40 h-150 z' }),
  },
  {
    id: 'ISLAND_HOPPING',
    name: 'Island Hopping',
    vibe: 'Tropical, bright, playful',
    headline: 'Ferry stops, beach clubs, and the spots fans actually ask about.',
    subheadline: 'For creators bouncing between islands, coves, ports, and sun-drenched stays.',
    chip: 'Island',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(45,212,191,0.2),_rgba(8,47,73,0.94)_35%,_#041019_100%)] text-white',
    shellClassName: 'border-teal-200/15 bg-teal-100/5',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(45,212,191,0.16),rgba(125,211,252,0.14),rgba(255,255,255,0.04))]',
    cardClassName: 'border-teal-200/15 bg-sky-950/50',
    pillClassName: 'border-teal-200/20 bg-teal-100/10 text-teal-100',
    accentClassName: 'text-teal-100',
    previewClassName: 'from-teal-300/80 via-cyan-300/70 to-sky-200/55',
    previewImageUrl: buildThemeArtwork({ skyTop: '#5eead4', skyBottom: '#0f3d5a', sun: '#fef9c3', horizon: '#22d3ee', foreground: '#083344', accent: '#0ea5e9', feature: 'M220 610 C360 560 460 530 560 512 C650 494 740 468 860 430 C920 510 1010 575 1140 618 C1000 662 850 700 640 700 C440 700 310 672 220 610 Z M1060 430 l120 82 l-120 84 l-120 -84 Z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#67e8f9', skyBottom: '#164e63', sun: '#fef3c7', horizon: '#2dd4bf', foreground: '#083344', accent: '#0284c7', feature: 'M210 626 C360 566 480 532 582 512 C670 496 774 460 902 418 C980 512 1080 584 1220 630 C1068 684 900 722 664 722 C452 722 312 692 210 626 Z M1120 416 l140 94 l-140 94 l-138 -94 Z' }),
  },
  {
    id: 'ROAD_TRIP',
    name: 'Road Trip',
    vibe: 'Americana, route map, motion',
    headline: 'Routes, stopovers, motels, playlists, and the best reasons to keep driving.',
    subheadline: 'Perfect for creators mapping drives, diners, desert loops, and scenic detours.',
    chip: 'Route',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(244,114,182,0.16),_rgba(30,27,75,0.95)_34%,_#080512_100%)] text-white',
    shellClassName: 'border-rose-200/15 bg-rose-100/5',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(244,114,182,0.16),rgba(251,146,60,0.12),rgba(255,255,255,0.04))]',
    cardClassName: 'border-rose-200/15 bg-indigo-950/40',
    pillClassName: 'border-rose-200/20 bg-rose-100/10 text-rose-100',
    accentClassName: 'text-rose-100',
    previewClassName: 'from-rose-300/80 via-orange-300/70 to-fuchsia-200/55',
    previewImageUrl: buildThemeArtwork({ skyTop: '#fb7185', skyBottom: '#312e81', sun: '#fed7aa', horizon: '#f97316', foreground: '#1e1b4b', accent: '#f43f5e', feature: 'M180 650 C340 612 530 592 710 620 C910 650 1110 636 1360 586 L1400 640 H1220 C1060 640 980 770 820 770 H420 C330 770 270 710 180 650 Z M270 560 h640 l60 46 h-640 z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#fda4af', skyBottom: '#1e1b4b', sun: '#ffedd5', horizon: '#fb923c', foreground: '#1e1b4b', accent: '#e11d48', feature: 'M160 664 C350 610 560 590 770 626 C980 662 1180 644 1420 582 L1470 648 H1270 C1090 648 1016 786 846 786 H400 C302 786 246 722 160 664 Z M240 552 h692 l82 54 h-692 z' }),
  },
  {
    id: 'WELLNESS_HIDEAWAY',
    name: 'Wellness Hideaway',
    vibe: 'Calm, spa-forward, restorative',
    headline: 'Retreats, slower mornings, and places that help your audience reset.',
    subheadline: 'A softer template for wellness travel, restorative escapes, and mindful itineraries.',
    chip: 'Wellness',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(244,244,245,0.18),_rgba(9,9,11,0.96)_38%,_#050608_100%)] text-white',
    shellClassName: 'border-stone-200/15 bg-stone-100/6',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(226,232,240,0.18),rgba(190,242,100,0.08),rgba(255,255,255,0.05))]',
    cardClassName: 'border-stone-200/15 bg-zinc-950/60',
    pillClassName: 'border-stone-200/20 bg-stone-100/10 text-stone-100',
    accentClassName: 'text-stone-100',
    previewClassName: 'from-stone-200/80 via-lime-200/60 to-emerald-200/45',
    previewImageUrl: buildThemeArtwork({ skyTop: '#f5f5f4', skyBottom: '#3f3f46', sun: '#ecfccb', horizon: '#d6d3d1', foreground: '#18181b', accent: '#84cc16', feature: 'M340 500 c120 0 200 90 200 200 H140 C140 590 220 500 340 500 Z M980 470 c136 0 226 100 226 230 H754 C754 570 844 470 980 470 Z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#fafaf9', skyBottom: '#27272a', sun: '#f0fdf4', horizon: '#e7e5e4', foreground: '#18181b', accent: '#a3e635', feature: 'M330 490 c128 0 214 96 214 210 H126 C126 586 212 490 330 490 Z M1000 460 c144 0 234 106 234 240 H760 C760 566 852 460 1000 460 Z' }),
  },
  {
    id: 'FOOD_TRAIL',
    name: 'Food Trail',
    vibe: 'Street-food heat, indulgent, energetic',
    headline: 'Every meal, market, and must-order dish mapped into one storefront.',
    subheadline: 'Great for creators whose subscribers follow them bite by bite through a city or region.',
    chip: 'Food',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(248,113,113,0.18),_rgba(69,10,10,0.95)_34%,_#120405_100%)] text-white',
    shellClassName: 'border-rose-200/15 bg-rose-100/5',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(248,113,113,0.18),rgba(251,191,36,0.12),rgba(255,255,255,0.04))]',
    cardClassName: 'border-rose-200/15 bg-red-950/35',
    pillClassName: 'border-rose-200/20 bg-rose-100/10 text-rose-100',
    accentClassName: 'text-rose-100',
    previewClassName: 'from-rose-300/80 via-amber-300/75 to-orange-200/55',
    previewImageUrl: buildThemeArtwork({ skyTop: '#fb7185', skyBottom: '#7f1d1d', sun: '#fde68a', horizon: '#f97316', foreground: '#450a0a', accent: '#f59e0b', feature: 'M260 520 h980 v54 H260 Z M360 458 h780 v44 H360 Z M280 598 h920 v54 H280 Z M970 376 l108 0 l0 222 l-108 0 Z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#fca5a5', skyBottom: '#7f1d1d', sun: '#fde68a', horizon: '#fb923c', foreground: '#450a0a', accent: '#f59e0b', feature: 'M230 520 h1030 v58 H230 Z M330 452 h830 v46 H330 Z M250 608 h970 v60 H250 Z M1000 370 l126 0 l0 238 l-126 0 Z' }),
  },
  {
    id: 'LUXURY_ATLAS',
    name: 'Luxury Atlas',
    vibe: 'Editorial, premium, elevated',
    headline: 'Flagship stays, refined itineraries, and the polished version of your taste.',
    subheadline: 'For luxury creators showcasing five-star hotels, shopping, and elevated city itineraries.',
    chip: 'Luxury',
    pageClassName: 'bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.16),_rgba(24,24,27,0.96)_34%,_#050505_100%)] text-white',
    shellClassName: 'border-yellow-200/15 bg-yellow-100/5',
    heroClassName: 'bg-[linear-gradient(135deg,rgba(250,204,21,0.16),rgba(244,244,245,0.12),rgba(255,255,255,0.04))]',
    cardClassName: 'border-yellow-200/15 bg-neutral-950/60',
    pillClassName: 'border-yellow-200/20 bg-yellow-100/10 text-yellow-100',
    accentClassName: 'text-yellow-100',
    previewClassName: 'from-yellow-200/85 via-amber-200/70 to-stone-200/55',
    previewImageUrl: buildThemeArtwork({ skyTop: '#fde68a', skyBottom: '#3f3f46', sun: '#fff7cc', horizon: '#facc15', foreground: '#18181b', accent: '#d4d4d8', feature: 'M210 300 h1120 v420 H210 Z M260 352 h1020 v316 H260 Z M430 230 h100 l0 70 h-100 z M1070 230 h100 l0 70 h-100 z' }),
    storefrontBackdropImageUrl: buildThemeArtwork({ skyTop: '#fef3c7', skyBottom: '#27272a', sun: '#fff8db', horizon: '#eab308', foreground: '#18181b', accent: '#e5e7eb', feature: 'M190 290 h1160 v438 H190 Z M250 346 h1048 v334 H250 Z M420 220 h110 l0 76 h-110 z M1080 220 h110 l0 76 h-110 z' }),
  },
]

export function getStorefrontTheme(themeId?: string | null) {
  return (
    STOREFRONT_THEMES.find((theme) => theme.id === themeId) ??
    STOREFRONT_THEMES.find((theme) => theme.id === 'CITY_EDITORIAL')!
  )
}

export function parseStorefrontGalleryImages(value: string) {
  return value
    .split('\n')
    .map((entry) => entry.trim())
    .filter(Boolean)
}
