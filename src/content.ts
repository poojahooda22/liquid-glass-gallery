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

/**
 * Photographic card content.
 *
 * The reference streams a video per card. Stills plus motion get most of the
 * way there for none of the bandwidth, and the thing that actually matters to
 * the glass is the same either way: high-frequency detail for the lens to
 * bend. Foliage, breaking water, city-scale structure and paint texture all
 * carry it; a smooth gradient does not, which is why the procedural scenes
 * only ever half-worked as refraction subjects.
 *
 * Served straight from the Unsplash CDN, cropped to the card's 4:3 at source
 * so nothing is scaled twice. The CDN sends an open CORS header, which is
 * what allows the cross-origin texture upload. Free to use under the Unsplash
 * License, no permission or attribution required.
 *
 * Eighteen images against thirty cards, so the set repeats - as the reference
 * does, with nineteen clips across a hundred meshes.
 */
const unsplash = (id: string): string =>
  `https://images.unsplash.com/photo-${id}?w=1200&h=900&fit=crop&crop=entropy&q=75&auto=format`;

export const IMAGE_POOL: readonly string[] = [
  '1518837695005-2083093ee35b', // ocean, breaking surf
  '1559825481-12a05cc00344',    // ocean, open water
  '1616141893496-fbc65370493e', // ocean, wave face
  '1436491865332-7a61a109cc05', // airliner in flight
  '1529074963764-98f45c47344b', // aircraft over cloud
  '1464802686167-b939a6910659', // galaxy
  '1444703686981-a3abbc4d4fe3', // deep field
  '1464822759023-fed622ff2c3b', // mountain range
  '1483728642387-6c3bdd6c93e5', // ridge line
  '1506905925346-21bda4d32df4', // peaks at altitude
  '1454496522488-7a8e488e8606', // alpine light
  '1603437873662-dc1f44901825', // cloud bank
  '1501630834273-4b5604d2ee31', // sky
  '1605721911519-3dfeb3be25e7', // painter at the canvas
  '1541753866388-0b3c701627d3', // paint and brushes
  '1542273917363-3b1817f69a2d', // forest canopy
  '1507041957456-9c397ce39c97', // woodland
  '1531366936337-7c912a4589a7', // aurora
].map(unsplash);

/**
 * Moving card content.
 *
 * The reference streams one clip per card, and that is the thing a still
 * cannot fake: clouds billow, surf breaks, the sky rotates. A slow pan over a
 * photograph reads as a slideshow, not as footage - which is exactly what the
 * first pass got wrong.
 *
 * 720p renditions, which is the right size for a card a few hundred pixels
 * wide on a sphere; 1080p costs decode budget for detail the refraction
 * throws away immediately. Served with an open CORS header, which is what
 * allows the cross-origin frame upload. Free under the Pexels licence, no
 * attribution required.
 *
 * Thirteen clips across thirty cards, so the set repeats - as the reference
 * does with nineteen across a hundred. Cards fall back to a photograph while
 * a clip buffers, and to a procedural scene before that, so the grid is never
 * incomplete.
 */
export const VIDEO_POOL: readonly string[] = [
  'https://videos.pexels.com/video-files/2865145/2865145-hd_1280_720_30fps.mp4',    // cloud timelapse
  'https://videos.pexels.com/video-files/9540152/9540152-hd_1280_720_25fps.mp4',    // cloud bank
  'https://videos.pexels.com/video-files/34693119/14704849_1280_720_30fps.mp4',     // ocean
  'https://videos.pexels.com/video-files/35371501/14986828_1280_720_30fps.mp4',     // surf
  'https://videos.pexels.com/video-files/6867012/6867012-hd_1280_720_24fps.mp4',    // milky way
  'https://videos.pexels.com/video-files/13322952/13322952-hd_1280_720_30fps.mp4',  // night sky
  'https://videos.pexels.com/video-files/36111065/15314254_1280_720_30fps.mp4',     // mountains
  'https://videos.pexels.com/video-files/28638515/12438507_1280_720_24fps.mp4',     // ridge line
  'https://videos.pexels.com/video-files/34283393/14524500_1280_720_30fps.mp4',     // aerial
  'https://videos.pexels.com/video-files/11130971/11130971-hd_1280_720_30fps.mp4',  // flight
  'https://videos.pexels.com/video-files/6074110/6074110-hd_1280_720_24fps.mp4',    // forest
  'https://videos.pexels.com/video-files/6800084/6800084-hd_1280_720_25fps.mp4',    // painting
  'https://videos.pexels.com/video-files/8064422/8064422-hd_1280_720_30fps.mp4',    // city at night
];
