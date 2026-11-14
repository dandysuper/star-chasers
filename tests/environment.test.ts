import { describe,it,expect } from 'vitest';
import { FlightSim, defaultControl } from '../src/physics/sim';
import { atmosphere, flightWorld } from '../src/physics/environment';
import { PRESET_BASIC } from '../src/data/parts';
describe('flight difficulty and environment',()=>{
 it('uses real radii and lunar distance independently of the game world',()=>{
  const sim=new FlightSim(PRESET_BASIC,'realistic');
  expect(sim.earth.R).toBe(6371000);expect(sim.moon.y).toBe(384400000);
  expect(sim.y).toBe(sim.earth.R);expect(sim.telemetry().altitude).toBe(0);
  expect(new FlightSim(PRESET_BASIC).earth.R).toBe(637100);
  expect(Math.sqrt(sim.earth.GM/sim.earth.R)).toBeCloseTo(7910, -1);
 });
 it('matches standard sea-level atmosphere and falls with height',()=>{
  const earth=flightWorld('realistic').earth;
  const a=atmosphere(0,earth,true);
  expect(a.density).toBeCloseTo(1.226,2);expect(a.pressure).toBeCloseTo(101400,-3);
  expect(atmosphere(11000,earth,true).density).toBeLessThan(0.37);
  expect(atmosphere(25000,earth,true).density).toBeLessThan(0.05);
  expect(atmosphere(120000,earth,true).density).toBe(0);
 });
 it('has no pilot torque without propulsive thrust, but conserves rotation',()=>{
  for(const throttle of [0,1]) {
   const sim=new FlightSim(PRESET_BASIC);sim.y=sim.earth.R+80000;sim.launched=true;sim.phase='flying';
   sim.angularVelocity=0.2;
   for(let i=0;i<60;i++) sim.step({...defaultControl(),throttle,engineOn:throttle===0,targetAngle:-1},[]);
   expect(sim.angularVelocity).toBeCloseTo(0.2,8);expect(sim.angle).toBeCloseTo(0.2,8);
  }
 });
 it('makes hard mode heavier and consumes more propellant for equal commanded thrust',()=>{
  const normal=new FlightSim(PRESET_BASIC),hard=new FlightSim(PRESET_BASIC,'hard');
  expect(hard.mass).toBeGreaterThan(normal.mass);
  for(let i=0;i<60;i++){normal.step({...defaultControl(),engineOn:true},[]);hard.step({...defaultControl(),engineOn:true},[]);}
  expect(hard.fuelBurnedTotal/normal.fuelBurnedTotal).toBeCloseTo(1.2,3);
  expect(hard.telemetry().altitude).toBeLessThan(normal.telemetry().altitude);
 });
});
