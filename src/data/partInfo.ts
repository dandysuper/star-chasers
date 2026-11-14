/**
 * partInfo.ts — what the builder's info plate says about each part: its job,
 * the physics formula it obeys, and a real spacecraft part for comparison.
 *
 * Real figures are from NASA's public mission pages and fact sheets (SLS,
 * RS-25, RL10, Saturn V / F-1, Apollo, Orion). They are rounded so a kid can
 * read them; the game parts are deliberately much smaller.
 */
import { partDef, type PartDef } from './parts';
import { G0 } from './bodies';
import { partCost } from './budget';

type L = { en: string; ru: string };

export interface PartInfoText {
  /** What the part does, one sentence. */
  role: L;
  /** The formula the part obeys, written for reading, not for code. */
  formula: string;
  /** What the formula means in words. */
  formulaNote: L;
  /** A real NASA part to compare with. */
  real: L;
}

export const PART_INFO: Record<string, PartInfoText> = {
  nose_cone: {
    role: {
      en: 'A pointed tip that lets the rocket slice through the air.',
      ru: 'Острый наконечник: ракета легче режет воздух.',
    },
    formula: 'D = ½ · ρ · v² · Cd · A',
    formulaNote: {
      en: 'Drag D grows with air density ρ and speed squared. A pointed nose lowers Cd.',
      ru: 'Сопротивление D растёт с плотностью воздуха ρ и квадратом скорости. Острый нос уменьшает Cd.',
    },
    real: {
      en: 'NASA: SLS carries Orion under a launch-abort tower and fairing panels that are thrown away once the air is thin, about 3 minutes after lift-off.',
      ru: 'NASA: на SLS «Орион» закрыт обтекателем с башней САС. Его сбрасывают, когда воздух становится разреженным, примерно через 3 минуты после старта.',
    },
  },
  probe_core: {
    role: {
      en: 'A flight computer: it lets you steer the rocket.',
      ru: 'Бортовой компьютер: позволяет управлять ракетой.',
    },
    formula: 'θ(t+Δt) = θ + ω · Δt',
    formulaNote: {
      en: 'The computer turns the rocket at up to ω = 30° per second toward the angle you ask for.',
      ru: 'Компьютер поворачивает ракету со скоростью до ω = 30° в секунду к нужному углу.',
    },
    real: {
      en: 'NASA: the Apollo Guidance Computer flew to the Moon with about 4 KB of working memory and 72 KB of program memory.',
      ru: 'NASA: бортовой компьютер «Аполлона» долетел до Луны с ~4 КБ оперативной памяти и 72 КБ памяти программ.',
    },
  },
  pod: {
    role: {
      en: 'A crew capsule for one astronaut. It can steer, like the flight computer.',
      ru: 'Капсула для одного космонавта. Тоже умеет управлять ракетой.',
    },
    formula: 'n = a / g₀',
    formulaNote: {
      en: 'The g-load n: how many times heavier the crew feel. Astronauts handle about 3–4 g on launch.',
      ru: 'Перегрузка n: во сколько раз экипаж тяжелее обычного. На старте это около 3–4 g.',
    },
    real: {
      en: 'NASA: the Apollo command module weighed about 5.6 t for 3 crew; Orion carries 4 astronauts and has the largest heat shield ever built for crew, 5 m across.',
      ru: 'NASA: командный модуль «Аполлона» весил ~5,6 т на троих; «Орион» везёт четверых, его теплозащитный щит диаметром 5 м — самый большой для пилотируемых кораблей.',
    },
  },
  tank_s: {
    role: { en: 'A small fuel tank.', ru: 'Маленький топливный бак.' },
    formula: 'Δv = Isp · g₀ · ln(m₀ / m₁)',
    formulaNote: {
      en: 'Tsiolkovsky\'s rocket equation: Δv grows with the ratio of full mass m₀ to empty mass m₁.',
      ru: 'Формула Циолковского: Δv растёт с отношением полной массы m₀ к пустой m₁.',
    },
    real: {
      en: 'NASA: rockets carry liquid oxygen at −183 °C. It boils off, so tanks are topped up until the last minutes of the countdown.',
      ru: 'NASA: жидкий кислород в баках имеет температуру −183 °C. Он испаряется, поэтому баки доливают до последних минут отсчёта.',
    },
  },
  tank_m: {
    role: { en: 'A medium fuel tank.', ru: 'Средний топливный бак.' },
    formula: 'Δv = Isp · g₀ · ln(m₀ / m₁)',
    formulaNote: {
      en: 'Doubling the fuel does not double Δv: the logarithm makes each extra tank count for a little less.',
      ru: 'Вдвое больше топлива — не вдвое больше Δv: из-за логарифма каждый новый бак даёт чуть меньше.',
    },
    real: {
      en: 'NASA: liquid hydrogen is −253 °C. The Space Shuttle tank was orange because of the foam insulation that kept it cold.',
      ru: 'NASA: жидкий водород имеет температуру −253 °C. Бак шаттла был оранжевым из-за теплоизоляционной пены.',
    },
  },
  tank_l: {
    role: { en: 'A large fuel tank.', ru: 'Большой топливный бак.' },
    formula: 'm₀ / m₁ = e^(Δv / (Isp·g₀))',
    formulaNote: {
      en: 'To go far, most of a rocket must be fuel: for 9 km/s to orbit, about 9 of every 10 kg on the pad.',
      ru: 'Чтобы улететь далеко, ракета почти вся должна быть топливом: для 9 км/с до орбиты — около 9 кг из каждых 10 на старте.',
    },
    real: {
      en: 'NASA: the SLS core stage is 65 m tall and holds about 2.8 million litres (733,000 gallons) of liquid hydrogen and oxygen.',
      ru: 'NASA: центральная ступень SLS высотой 65 м вмещает ~2,8 млн литров (733 000 галлонов) жидкого водорода и кислорода.',
    },
  },
  engine_spark: {
    role: { en: 'An all-round engine: good at sea level and in space.', ru: 'Универсальный двигатель: хорош и у Земли, и в космосе.' },
    formula: 'F = ṁ · vₑ,  vₑ = Isp · g₀',
    formulaNote: {
      en: 'Thrust F is the fuel burned per second ṁ times how fast the exhaust leaves vₑ.',
      ru: 'Тяга F — это расход топлива в секунду ṁ, умноженный на скорость истечения газа vₑ.',
    },
    real: {
      en: 'NASA: SLS flies on four RS-25 engines, each about 1,860 kN at sea level, Isp 366 s at sea level and 452 s in vacuum.',
      ru: 'NASA: SLS летит на четырёх двигателях RS-25: каждый ~1860 кН у Земли, удельный импульс 366 с у Земли и 452 с в вакууме.',
    },
  },
  engine_bull: {
    role: { en: 'A heavy, powerful booster engine for lifting off.', ru: 'Тяжёлый мощный стартовый двигатель.' },
    formula: 'TWR = F / (m · g)',
    formulaNote: {
      en: 'Thrust-to-weight ratio: above 1 the rocket rises; 1.3–2 is a good lift-off.',
      ru: 'Тяговооружённость: больше 1 — ракета взлетает; 1,3–2 — хороший старт.',
    },
    real: {
      en: 'NASA: each of the five F-1 engines on Saturn V made about 6,770 kN, still the most powerful single-chamber liquid engine ever flown.',
      ru: 'NASA: каждый из пяти двигателей F-1 «Сатурна-5» давал ~6770 кН — до сих пор самый мощный однокамерный жидкостный двигатель.',
    },
  },
  engine_whisper: {
    role: {
      en: 'A vacuum engine: weak in the air, very efficient in space. Use it on an upper stage.',
      ru: 'Вакуумный двигатель: слаб в воздухе, очень экономичен в космосе. Ставь на верхнюю ступень.',
    },
    formula: 'Isp(p) = Isp_vac − (Isp_vac − Isp_sl) · p / p₀',
    formulaNote: {
      en: 'Air pressure p pushes back on the wide nozzle, so Isp drops near the ground.',
      ru: 'Давление воздуха p давит на широкое сопло, поэтому у земли удельный импульс падает.',
    },
    real: {
      en: 'NASA: the RL10 upper-stage engine (about 110 kN, Isp up to 465 s in vacuum) has flown since 1963 and powers the SLS upper stage.',
      ru: 'NASA: двигатель верхних ступеней RL10 (~110 кН, удельный импульс до 465 с в вакууме) летает с 1963 года, в том числе на SLS.',
    },
  },
  decoupler: {
    role: {
      en: 'A stage separator: drops the empty stage below it (key Q).',
      ru: 'Разделитель ступеней: сбрасывает пустую ступень снизу (клавиша Q).',
    },
    formula: 'Δv = Σ Isp·g₀·ln(m₀ᵢ / m₁ᵢ)',
    formulaNote: {
      en: 'Each stage gets its own rocket equation. Dropping empty tanks makes the rest much lighter.',
      ru: 'Для каждой ступени своя формула Циолковского. Без пустых баков ракета намного легче.',
    },
    real: {
      en: 'NASA: Saturn V dropped its first stage about 2.5 minutes after launch, at roughly 67 km up.',
      ru: 'NASA: «Сатурн-5» сбрасывал первую ступень примерно через 2,5 минуты после старта, на высоте ~67 км.',
    },
  },
  fins: {
    role: {
      en: 'Stabilisers (fins): keep the rocket pointing straight in the air.',
      ru: 'Рули (стабилизаторы): держат ракету прямо в воздухе.',
    },
    formula: 'stable when CP is below CM',
    formulaNote: {
      en: 'Fins move the centre of pressure (CP) behind the centre of mass (CM), so the air turns the nose back into the wind, like a dart.',
      ru: 'Рули сдвигают центр давления (ЦД) ниже центра масс (ЦМ), и воздух сам выравнивает ракету, как оперение дротика.',
    },
    real: {
      en: 'NASA: Saturn V had four big fins on its first stage. Modern rockets like SLS steer by swivelling (gimballing) their engines instead.',
      ru: 'NASA: у «Сатурна-5» было четыре больших стабилизатора на первой ступени. Современные ракеты, как SLS, рулят поворотом двигателей.',
    },
  },
  parachute: {
    role: {
      en: 'A parachute for a soft landing (key C, below 20 km).',
      ru: 'Парашют для мягкой посадки (клавиша C, ниже 20 км).',
    },
    formula: 'v_term = √(2·m·g / (ρ·Cd·A))',
    formulaNote: {
      en: 'Terminal speed: a bigger canopy area A means a slower fall.',
      ru: 'Установившаяся скорость: чем больше площадь купола A, тем медленнее падение.',
    },
    real: {
      en: 'NASA: Orion lands under three main parachutes, each 35 m across, slowing to about 27 km/h (17 mph) before splashdown.',
      ru: 'NASA: «Орион» садится на трёх основных парашютах диаметром по 35 м и приводняется со скоростью ~27 км/ч.',
    },
  },
};

export interface PartFact {
  label: L;
  value: string;
}

/** The numbers row of the plate: mass, fuel, thrust, Isp, exhaust speed, cost. */
export function partFacts(id: string): PartFact[] {
  const d: PartDef = partDef(id);
  const f: PartFact[] = [{ label: { en: 'Dry mass', ru: 'Сухая масса' }, value: `${d.massDry} kg` }];
  if (d.fuel) {
    f.push({ label: { en: 'Fuel', ru: 'Топливо' }, value: `${d.fuel} kg` });
    f.push({ label: { en: 'Full / empty', ru: 'Полный / пустой' }, value: `${((d.massDry + d.fuel) / d.massDry).toFixed(1)}×` });
  }
  if (d.thrustVac && d.ispVac && d.ispAsl) {
    const sl = d.thrustVac * (d.ispAsl / d.ispVac);
    f.push({ label: { en: 'Thrust (vac / sea)', ru: 'Тяга (вакуум / Земля)' }, value: `${d.thrustVac / 1000} / ${Math.round(sl / 1000)} kN` });
    f.push({ label: { en: 'Isp (vac / sea)', ru: 'Уд. импульс (вак. / Земля)' }, value: `${d.ispVac} / ${d.ispAsl} s` });
    f.push({ label: { en: 'Exhaust speed vₑ', ru: 'Скорость газа vₑ' }, value: `${(d.ispVac * G0 / 1000).toFixed(2)} km/s` });
    f.push({ label: { en: 'Fuel use ṁ', ru: 'Расход ṁ' }, value: `${(d.thrustVac / (d.ispVac * G0)).toFixed(1)} kg/s` });
  }
  if (d.chuteArea) f.push({ label: { en: 'Canopy area', ru: 'Площадь купола' }, value: `${d.chuteArea} m²` });
  if (d.crew) f.push({ label: { en: 'Crew', ru: 'Экипаж' }, value: String(d.crew) });
  f.push({ label: { en: 'Cost', ru: 'Цена' }, value: `$${partCost(id)}M` });
  return f;
}
