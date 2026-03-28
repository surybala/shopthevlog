export interface Interest {
  label: string
  emoji: string
  /** Lowercase slug sent to the API as the travel_styles value */
  tag: string
}

export const INTERESTS: Interest[] = [
  { label: 'Adventure',       emoji: '🧗', tag: 'adventure' },
  { label: 'Luxury',          emoji: '✨', tag: 'luxury' },
  { label: 'Budget Travel',   emoji: '💰', tag: 'budget' },
  { label: 'Solo Travel',     emoji: '🎒', tag: 'solo' },
  { label: 'Family',          emoji: '👨‍👩‍👧', tag: 'family' },
  { label: 'Backpacking',     emoji: '🏕️', tag: 'backpacking' },
  { label: 'Cultural',        emoji: '🏛️', tag: 'cultural' },
  { label: 'Beach & Islands', emoji: '🏖️', tag: 'beach' },
  { label: 'Mountain',        emoji: '🏔️', tag: 'mountain' },
  { label: 'City Break',      emoji: '🌆', tag: 'city break' },
  { label: 'Road Trip',       emoji: '🚗', tag: 'road trip' },
  { label: 'Food & Culinary', emoji: '🍜', tag: 'food & culinary' },
  { label: 'Photography',     emoji: '📸', tag: 'photography' },
  { label: 'Wildlife',        emoji: '🦁', tag: 'wildlife' },
  { label: 'History',         emoji: '🏺', tag: 'history' },
  { label: 'Wellness',        emoji: '🧘', tag: 'wellness' },
]
