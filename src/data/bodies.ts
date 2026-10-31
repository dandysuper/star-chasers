/** Celestial bodies at 1/10 radius scale (KSP-like, CORE_SPEC §4). */

export interface Body {
  name: 'earth' | 'moon';
  R: number;          // radius, m
  GM: number;         // gravitational parameter, m³/s²
  atmHeight: number;  // atmosphere top, m (0 = none)
  rho0: number;       // surface air density, kg/m³
  scaleH: number;     // scale height, m
  x: number;
  y: number;
}

export const G0 = 9.80665;

export const EARTH: Body = {
  name: 'earth',
  R: 637100,
  GM: 9.81 * 637100 * 637100, // 3.9817e12
  atmHeight: 70000,
  rho0: 1.225,
  scaleH: 5600,
  x: 0,
  y: 0,
};

export const MOON: Body = {
  name: 'moon',
  R: 173700,
  GM: 1.62 * 173700 * 173700, // 4.888e10
  atmHeight: 0,
  rho0: 0,
  scaleH: 1,
  x: 0,
  y: 38440000, // 1/10 of the real distance, static in MVP
};

/** Moon's sphere of influence: r_SOI = a·(M_moon/M_earth)^0.4 ≈ 6,610,000 m. */
export const MOON_SOI = 38440000 * Math.pow(MOON.GM / EARTH.GM, 0.4);

export function dominantBody(x: number, y: number): Body {
  const dx = x - MOON.x;
  const dy = y - MOON.y;
  return Math.hypot(dx, dy) < MOON_SOI ? MOON : EARTH;
}
