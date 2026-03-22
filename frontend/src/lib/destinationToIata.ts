/**
 * Utility to derive pre-populated booking params from an itinerary.
 *
 * Flight searches require IATA airport codes. This module maps popular travel
 * destination names (as Claude might return them) to their primary airport code.
 * If a destination isn't in the table the lookup falls back to the raw city name
 * so the user can correct it manually.
 */
import type { Itinerary } from '../types/itinerary'
import type { FlightSearchParams, HotelSearchParams } from '../types/booking'

/** Map of lowercase city / country keywords → primary airport IATA code. */
const IATA_MAP: Record<string, string> = {
  // East Asia
  'tokyo': 'NRT', 'japan': 'NRT', 'osaka': 'KIX', 'kyoto': 'KIX',
  'sapporo': 'CTS', 'hokkaido': 'CTS', 'hiroshima': 'HIJ', 'fukuoka': 'FUK',
  'okinawa': 'OKA', 'nagoya': 'NGO',
  'seoul': 'ICN', 'korea': 'ICN', 'south korea': 'ICN', 'busan': 'PUS',
  'hong kong': 'HKG',
  'taipei': 'TPE', 'taiwan': 'TPE',
  'beijing': 'PEK', 'china': 'PEK', 'shanghai': 'PVG', 'chengdu': 'CTU',
  'macau': 'MFM',

  // Southeast Asia
  'bali': 'DPS', 'indonesia': 'DPS', 'jakarta': 'CGK', 'lombok': 'LOP',
  'bangkok': 'BKK', 'thailand': 'BKK', 'phuket': 'HKT', 'chiang mai': 'CNX',
  'krabi': 'KBV', 'koh samui': 'USM',
  'singapore': 'SIN',
  'kuala lumpur': 'KUL', 'malaysia': 'KUL', 'penang': 'PEN', 'langkawi': 'LGK',
  'hanoi': 'HAN', 'vietnam': 'HAN', 'ho chi minh': 'SGN', 'saigon': 'SGN',
  'da nang': 'DAD', 'nha trang': 'CXR', 'hoi an': 'DAD',
  'manila': 'MNL', 'philippines': 'MNL', 'cebu': 'CEB', 'boracay': 'MPH',
  'phnom penh': 'PNH', 'cambodia': 'PNH', 'siem reap': 'REP',
  'vientiane': 'VTE', 'laos': 'VTE',
  'yangon': 'RGN', 'myanmar': 'RGN', 'burma': 'RGN',

  // South Asia
  'delhi': 'DEL', 'new delhi': 'DEL', 'india': 'DEL',
  'mumbai': 'BOM', 'bombay': 'BOM',
  'goa': 'GOI', 'bangalore': 'BLR', 'bengaluru': 'BLR',
  'jaipur': 'JAI', 'kolkata': 'CCU', 'hyderabad': 'HYD', 'kochi': 'COK',
  'kathmandu': 'KTM', 'nepal': 'KTM',
  'colombo': 'CMB', 'sri lanka': 'CMB',
  'maldives': 'MLE', 'male': 'MLE',

  // Middle East / Central Asia
  'dubai': 'DXB', 'uae': 'DXB', 'united arab emirates': 'DXB', 'abu dhabi': 'AUH',
  'doha': 'DOH', 'qatar': 'DOH',
  'istanbul': 'IST', 'turkey': 'IST', 'ankara': 'ESB', 'cappadocia': 'ASR',
  'tel aviv': 'TLV', 'israel': 'TLV', 'jerusalem': 'TLV',
  'amman': 'AMM', 'jordan': 'AMM', 'petra': 'AMM',
  'riyadh': 'RUH', 'saudi arabia': 'RUH',

  // Europe — Western
  'london': 'LHR', 'united kingdom': 'LHR', 'uk': 'LHR', 'england': 'LHR',
  'edinburgh': 'EDI', 'scotland': 'EDI', 'glasgow': 'GLA',
  'dublin': 'DUB', 'ireland': 'DUB',
  'paris': 'CDG', 'france': 'CDG', 'nice': 'NCE',
  'amsterdam': 'AMS', 'netherlands': 'AMS', 'holland': 'AMS',
  'brussels': 'BRU', 'belgium': 'BRU',
  'madrid': 'MAD', 'spain': 'MAD', 'barcelona': 'BCN',
  'seville': 'SVQ', 'malaga': 'AGP',
  'lisbon': 'LIS', 'portugal': 'LIS', 'porto': 'OPO',
  'rome': 'FCO', 'italy': 'FCO', 'milan': 'MXP',
  'florence': 'FLR', 'venice': 'VCE', 'naples': 'NAP',
  'sicily': 'PMO', 'palermo': 'PMO', 'catania': 'CTA',
  'zurich': 'ZRH', 'switzerland': 'ZRH', 'geneva': 'GVA',
  'vienna': 'VIE', 'austria': 'VIE', 'salzburg': 'SZG',
  'frankfurt': 'FRA', 'germany': 'FRA', 'berlin': 'BER', 'munich': 'MUC',
  'copenhagen': 'CPH', 'denmark': 'CPH',
  'stockholm': 'ARN', 'sweden': 'ARN',
  'oslo': 'OSL', 'norway': 'OSL',
  'helsinki': 'HEL', 'finland': 'HEL',
  'reykjavik': 'KEF', 'iceland': 'KEF',

  // Europe — Eastern
  'prague': 'PRG', 'czech republic': 'PRG', 'czechia': 'PRG',
  'budapest': 'BUD', 'hungary': 'BUD',
  'warsaw': 'WAW', 'poland': 'WAW', 'krakow': 'KRK',
  'bucharest': 'OTP', 'romania': 'OTP',
  'athens': 'ATH', 'greece': 'ATH', 'santorini': 'JTR', 'mykonos': 'JMK',
  'sofia': 'SOF', 'bulgaria': 'SOF',
  'zagreb': 'ZAG', 'croatia': 'ZAG', 'dubrovnik': 'DBV', 'split': 'SPU',
  'belgrade': 'BEG', 'serbia': 'BEG',
  'tallinn': 'TLL', 'estonia': 'TLL',
  'riga': 'RIX', 'latvia': 'RIX',
  'vilnius': 'VNO', 'lithuania': 'VNO',

  // Africa
  'cairo': 'CAI', 'egypt': 'CAI',
  'marrakech': 'RAK', 'morocco': 'CMN', 'casablanca': 'CMN',
  'cape town': 'CPT', 'south africa': 'JNB', 'johannesburg': 'JNB',
  'nairobi': 'NBO', 'kenya': 'NBO',
  'dar es salaam': 'DAR', 'tanzania': 'DAR', 'zanzibar': 'ZNZ',
  'accra': 'ACC', 'ghana': 'ACC',
  'lagos': 'LOS', 'nigeria': 'LOS',
  'addis ababa': 'ADD', 'ethiopia': 'ADD',
  'tunis': 'TUN', 'tunisia': 'TUN',

  // Oceania
  'sydney': 'SYD', 'australia': 'SYD', 'melbourne': 'MEL',
  'brisbane': 'BNE', 'perth': 'PER', 'cairns': 'CNS',
  'auckland': 'AKL', 'new zealand': 'AKL', 'queenstown': 'ZQN',
  'fiji': 'NAN', 'nadi': 'NAN',
  'tahiti': 'PPT', 'french polynesia': 'PPT', 'bora bora': 'BOB',

  // North America
  'new york': 'JFK', 'nyc': 'JFK',
  'los angeles': 'LAX', 'la': 'LAX',
  'miami': 'MIA', 'florida': 'MIA', 'orlando': 'MCO',
  'san francisco': 'SFO', 'sf': 'SFO',
  'chicago': 'ORD',
  'las vegas': 'LAS',
  'honolulu': 'HNL', 'hawaii': 'HNL',
  'cancun': 'CUN', 'mexico': 'MEX', 'mexico city': 'MEX',
  'playa del carmen': 'CUN', 'tulum': 'CUN',
  'toronto': 'YYZ', 'canada': 'YYZ', 'vancouver': 'YVR', 'montreal': 'YUL',
  'havana': 'HAV', 'cuba': 'HAV',
  'san jose': 'SJO', 'costa rica': 'SJO',
  'guatemala': 'GUA',
  'cartagena': 'CTG', 'colombia': 'BOG', 'bogota': 'BOG', 'medellin': 'MDE',

  // South America
  'lima': 'LIM', 'peru': 'LIM', 'cusco': 'CUZ', 'machu picchu': 'CUZ',
  'rio de janeiro': 'GIG', 'brazil': 'GRU', 'sao paulo': 'GRU',
  'buenos aires': 'EZE', 'argentina': 'EZE',
  'santiago': 'SCL', 'chile': 'SCL',
  'quito': 'UIO', 'ecuador': 'UIO', 'galapagos': 'GPS',
  'la paz': 'LPB', 'bolivia': 'LPB',
}

/** Return the best-guess IATA code for a destination string. */
export function destinationToIata(destination: string): string {
  if (!destination) return ''
  const lower = destination.toLowerCase().trim()

  // Exact match
  if (IATA_MAP[lower]) return IATA_MAP[lower]

  // Partial match — destination contains a known key (e.g. "Palermo, Sicily")
  for (const [key, iata] of Object.entries(IATA_MAP)) {
    if (lower.includes(key)) return iata
  }

  // Fallback — show first 3 alpha chars so the user has something to correct
  return destination.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase()
}

/** Add `n` days to a Date and return a new Date. */
function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

/** Format a Date as YYYY-MM-DD for <input type="date"> */
function toInputDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

export interface DerivedBookingParams {
  flightParams: FlightSearchParams
  hotelParams: HotelSearchParams
  /** Human-readable primary destination (e.g. "Palermo, Sicily") */
  destinationLabel: string
}

/**
 * Derive pre-populated flight and hotel search params from an itinerary.
 * Departure defaults to 2 weeks from today; return = departure + total_days.
 */
export function deriveBookingParams(itinerary: Itinerary): DerivedBookingParams {
  const primaryDestination = itinerary.destinations?.[0] ?? ''
  const iata = destinationToIata(primaryDestination)
  const totalDays = itinerary.total_days ?? 7

  const departure = addDays(new Date(), 14)
  const returnDate = addDays(departure, totalDays)

  return {
    destinationLabel: primaryDestination,
    flightParams: {
      origin: '',            // user's home airport — they must fill this in
      destination: iata,
      departure_date: toInputDate(departure),
      return_date: toInputDate(returnDate),
      passengers: 1,
      cabin_class: 'economy',
    },
    hotelParams: {
      location: primaryDestination,
      check_in: toInputDate(departure),
      check_out: toInputDate(returnDate),
      guests: 1,
      rooms: 1,
    },
  }
}
