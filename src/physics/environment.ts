import { EARTH, MOON, type Body } from '../data/bodies';
export type Difficulty = 'normal' | 'hard' | 'realistic';
export const PROFILES = {
 normal: {dryMass:1, consumption:1, drag:1, inertia:1, distance:1},
 hard: {dryMass:1.15, consumption:1.2, drag:1.25, inertia:1.4, distance:1.5},
 realistic: {dryMass:1, consumption:1, drag:1, inertia:1.6, distance:1},
} as const;
export function flightWorld(mode: Difficulty): {earth:Body;moon:Body;moonSOI:number} {
 const earth = mode === 'realistic' ? {...EARTH,R:6371000,GM:3.98600435507e14,atmHeight:120000,scaleH:8500} : {...EARTH};
 const moon = mode === 'realistic' ? {...MOON,R:1737400,GM:4.902800118e12,y:384400000} : {...MOON,y:MOON.y*PROFILES[mode].distance};
 return {earth,moon,moonSOI:moon.y*Math.pow(moon.GM/earth.GM,0.4)};
}
/** NASA Glenn's three-zone metric atmosphere; upper region remains a curve-fit approximation. */
export function atmosphere(altitude:number, earth:Body, realistic:boolean) {
 const h=Math.max(0,altitude);
 if(h>=earth.atmHeight) return {density:0,pressure:0,temperature:216.65,sound:295};
 if(!realistic) {const density=earth.rho0*Math.exp(-h/earth.scaleH);return {density,pressure:101325*density/earth.rho0,temperature:288.15,sound:340.3};}
 let c:number,p:number;
 if(h<11000){c=15.04-0.00649*h;p=101.29*Math.pow((c+273.1)/288.08,5.256);}
 else if(h<25000){c=-56.46;p=22.65*Math.exp(1.73-0.000157*h);}
 else {c=-131.21+0.00299*h;p=2.488*Math.pow((c+273.1)/216.6,-11.388);}
 const temperature=c+273.1;
 return {density:p/(0.2869*temperature),pressure:p*1000,temperature,sound:Math.sqrt(1.4*286.9*temperature)};
}
