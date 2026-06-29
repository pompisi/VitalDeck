// the selectable STATUS characters (the "player toggle"). each is a baked
// phosphor-green PNG with a true transparent background (white-on-transparent
// original kept alongside as *_src.png for future re-tinting). require() paths must
// be static literals so Metro can bundle them.
import type { ImageSourcePropType } from 'react-native';

export type CharacterKey = 'operative' | 'wizard';

export const CHARACTERS: { key: CharacterKey; label: string; source: ImageSourcePropType }[] = [
  { key: 'operative', label: 'OPERATIVE', source: require('../assets/character_operative.png') },
  { key: 'wizard', label: 'WIZARD', source: require('../assets/character_wizard.png') },
];

const BY_KEY: Record<CharacterKey, ImageSourcePropType> = {
  operative: CHARACTERS[0].source,
  wizard: CHARACTERS[1].source,
};

export const characterSource = (key: CharacterKey): ImageSourcePropType =>
  BY_KEY[key] ?? BY_KEY.operative;
