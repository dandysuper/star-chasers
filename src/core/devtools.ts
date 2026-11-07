/** Dev-only conveniences, all inert unless the query string asks for them. */

const DEV_SCENES = ['menu', 'hub', 'builder', 'flight', 'explore'] as const;
export type DevScene = typeof DEV_SCENES[number];

function query(key: string): string | null {
  if (typeof location === 'undefined') return null;
  return new URLSearchParams(location.search).get(key);
}

/** `?scene=builder` boots straight into a scene instead of the menu. */
export function devSceneOverride(): DevScene | null {
  const value = query('scene');
  if (!value) return null;
  return (DEV_SCENES as readonly string[]).includes(value) ? (value as DevScene) : null;
}

/** `?mission=m2` selects a mission for the direct-to-scene boot. */
export function devMissionOverride(): string | null {
  return query('mission');
}

/** `?spawn=board` drops the player at a named base station. */
export function devSpawnOverride(): string | null {
  return query('spawn');
}

/** `?lang=en` / `?lang=ru` pins the language for a screenshot run. */
export function devLangOverride(): 'en' | 'ru' | null {
  const value = query('lang');
  return value === 'en' || value === 'ru' ? value : null;
}
