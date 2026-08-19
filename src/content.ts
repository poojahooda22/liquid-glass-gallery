/**
 * Card content. Thirty records against twelve scene painters.
 *
 * The reference streams a video per card; this build renders each scene
 * procedurally instead, so nothing is fetched, nothing is licensed, and every
 * card is live rather than a still. The glass shader neither knows nor cares
 * which it samples.
 *
 * Thirty is not arbitrary: the grid solver asks for roughly a ten by ten
 * torus, and the assignment in assign.ts needs enough distinct cards that no
 * cell has to reuse one of its own neighbours.
 */

export type SceneKind =
  | 'clouds'
  | 'clouds2'
  | 'plane'
  | 'forest'
  | 'city'
  | 'dusk'
  | 'ridge'
  | 'water'
  | 'sunset'
  | 'night'
  | 'stars'
  | 'neon';

export type Card = {
  code: string;
  type: string;
  title: string;
  desc: string;
  scene: SceneKind;
};

export const CARDS: readonly Card[] = [
  { code: 'ILG-03', type: 'CIVIC PLATFORM', title: 'Tidal Register', desc: 'A city keeping time with the water.', scene: 'water' },
  { code: 'ILG-06', type: 'BROADCAST', title: 'Paper Radio', desc: 'Voices printed instead of spoken.', scene: 'city' },
  { code: 'ILG-09', type: 'ENVIRONMENT', title: 'Understory', desc: 'The layer everything else grows on.', scene: 'forest' },
  { code: 'ILG-12', type: 'DIGITAL ARCHIVE', title: 'Nightshift Atlas', desc: 'Maps drawn by people who work late.', scene: 'city' },
  { code: 'ILG-15', type: 'PRODUCT', title: 'Quiet Machines', desc: 'Hardware that never raises its voice.', scene: 'clouds2' },
  { code: 'ILG-18', type: 'FILM TITLES', title: 'Ashfall', desc: 'Everything settles, eventually.', scene: 'clouds2' },
  { code: 'ILG-21', type: 'CAMPAIGN', title: 'Small Wins', desc: 'Progress you can actually count.', scene: 'clouds' },
  { code: 'ILG-24', type: 'WAYFINDING', title: 'Salt Line', desc: 'Where the map stops being useful.', scene: 'water' },
  { code: 'ILG-27', type: 'TYPE DESIGN', title: 'Blue Interval', desc: 'A face for the minutes before dawn.', scene: 'night' },
  { code: 'ILG-30', type: 'RESEARCH', title: 'Overwinter', desc: 'Systems designed to wait.', scene: 'ridge' },
  { code: 'ILG-33', type: 'MANUFACTURING', title: 'Hot Glass', desc: 'Shaped while it still moves.', scene: 'sunset' },
  { code: 'ILG-36', type: 'SPATIAL', title: 'Vantage', desc: 'Height as a public utility.', scene: 'ridge' },
  { code: 'ILG-39', type: 'DATA', title: 'Signal Garden', desc: 'Growing meaning out of noise.', scene: 'stars' },
  { code: 'ILG-42', type: 'TRANSPORT', title: 'Low Beam', desc: 'Made for the last hour of the drive.', scene: 'night' },
  { code: 'ILG-45', type: 'EDITORIAL', title: 'Foldout', desc: 'A page that keeps going.', scene: 'clouds' },
  { code: 'ILG-48', type: 'IDENTITY', title: 'Terminal Green', desc: 'The colour of somewhere in between.', scene: 'forest' },
  { code: 'ILG-51', type: 'DOCUMENTARY', title: 'Wet Season', desc: 'Six months told in one texture.', scene: 'forest' },
  { code: 'ILG-54', type: 'RETAIL', title: 'Bright Work', desc: 'Polish as a service.', scene: 'plane' },
  { code: 'ILG-57', type: 'EXHIBITION', title: 'Hollow Point', desc: 'Absence given a floor plan.', scene: 'clouds2' },
  { code: 'ILG-60', type: 'BRAND SYSTEM', title: 'Radial', desc: 'One centre, many arms.', scene: 'neon' },
  { code: 'ILG-63', type: 'HOSPITALITY', title: 'Slow Burn', desc: 'A room that takes its time.', scene: 'dusk' },
  { code: 'ILG-66', type: 'MOTION', title: 'Backscatter', desc: 'Light that came back changed.', scene: 'neon' },
  { code: 'ILG-69', type: 'CONSERVATION', title: 'Kelp Forest', desc: 'A city with no straight lines.', scene: 'water' },
  { code: 'ILG-72', type: 'SEASONAL', title: 'First Frost', desc: 'The night the light turns hard.', scene: 'ridge' },
  { code: 'ILG-75', type: 'PERFORMANCE', title: 'Off Book', desc: 'Learned well enough to forget.', scene: 'city' },
  { code: 'ILG-78', type: 'AGRICULTURE', title: 'Grain Belt', desc: 'Distance measured in harvests.', scene: 'dusk' },
  { code: 'ILG-81', type: 'NIGHTLIFE', title: 'Neon Ration', desc: 'Just enough light to keep going.', scene: 'neon' },
  { code: 'ILG-84', type: 'PHOTOGRAPHY', title: 'Long Exposure', desc: 'Standing still for the whole story.', scene: 'stars' },
  { code: 'ILG-87', type: 'INFRASTRUCTURE', title: 'Hard Water', desc: 'What the pipes remember.', scene: 'water' },
  { code: 'ILG-90', type: 'CARTOGRAPHY', title: 'Continental Drift', desc: 'Slower than you, and winning.', scene: 'plane' },
];
