// Hook captions (owner decision Q1): generated from per-scenario templates in English and Arabic, based on the
// run's real rules. Western digits in both languages (Q3). Chosen deterministically from the seed.
import { rand } from '../engine/rng.js';

const fmt = (n) => n.toLocaleString('en-US');

const TEMPLATES = {
  'split-chamber': {
    en: ['Every crush splits a ball into three', 'Four presses. One ball. Will it reach {max}?', 'One ball becomes {max}. Watch.', 'How fast can one ball become {max}?'],
    ar: ['كل ضغطة تقسم الكرة إلى ثلاث', 'أربع مكابس وكرة واحدة… هل تصل إلى {max}؟', 'كرة واحدة تصبح {max}. شاهد.', 'كم تحتاج كرة واحدة لتصبح {max}؟'],
  },
  'rotary-sweeper': {
    en: ['The arm sweeps. The wedges crush. Every crush makes three.', 'Can the chamber hold {max} balls?', 'One ball, one arm, {max} balls.', 'Watch the pile grow until the glass gives way'],
    ar: ['الذراع تكنس والأسافين تسحق… وكل سحقة تصنع ثلاثاً', 'هل تتسع الغرفة لـ {max} كرة؟', 'كرة واحدة، ذراع واحدة، {max} كرة.', 'شاهد الكومة تكبر حتى ينكسر الزجاج'],
  },
  jaws: {
    en: ['Every bite splits a ball into three', 'The jaws never stop closing', 'Can the jaws make {max} balls?'],
    ar: ['كل عضّة تقسم الكرة إلى ثلاث', 'الفكوك لا تتوقف عن الإغلاق', 'هل تصنع الفكوك {max} كرة؟'],
  },
  rams: {
    en: ['Every smash speeds up the rams', 'The rams swing faster every time', 'How fast will the rams get?'],
    ar: ['كل ضربة تسرّع المطارق', 'المطارق تتأرجح أسرع في كل مرة', 'إلى أي سرعة ستصل المطارق؟'],
  },
  kaleidoscope: {
    en: ['The kaleidoscope closes. Every squeeze makes three.', 'Symmetry, pressure, {max} balls', 'Watch the pattern fill up'],
    ar: ['المشكال ينغلق… وكل ضغطة تصنع ثلاثاً', 'تناظر وضغط و{max} كرة', 'شاهد النقش يمتلئ'],
  },
  walls: {
    en: ['The walls close in. Every squeeze makes three.', 'Two walls. One ball. {max} balls.', 'How long until the walls are full?'],
    ar: ['الجدران تقترب… وكل ضغطة تصنع ثلاثاً', 'جداران وكرة واحدة و{max} كرة.', 'متى تمتلئ المساحة بين الجدران؟'],
  },
  'laser-cross': {
    en: ['The laser splits everything it touches', 'One laser. One ball. {max} balls.', 'Nothing survives the laser in one piece'],
    ar: ['الليزر يقسم كل ما يلمسه', 'ليزر واحد وكرة واحدة و{max} كرة.', 'لا شيء يعبر الليزر سليماً'],
  },
  'orbit-crusher': {
    en: ['Every blade cut makes three balls', 'Can the orbit hold {max} balls?', '{blades} blades. One orbit. {max} balls.', 'The blades never stop. Neither do the balls.'],
    ar: ['كل ضربة شفرة تصنع ثلاث كرات', 'هل يتسع المدار لـ {max} كرة؟', '{blades} شفرات، مدار واحد، {max} كرة.', 'الشفرات لا تتوقف… والكرات أيضاً.'],
  },
};

/** Returns { lang, text } or null. lang: 'en' | 'ar' | 'none'. */
export function captionFor(config, lang) {
  if (!lang || lang === 'none') return null;
  const family = config.scenario.split('@')[0];
  const set = (TEMPLATES[family] || TEMPLATES['split-chamber'])[lang];
  if (!set) return null;
  const i = Math.floor(rand(config.seed >>> 0, 0xca9, lang === 'ar' ? 2 : 1, 0) * set.length);
  const max = (config.orbit && config.orbit.maxBalls) || (config.packed && config.packed.maxBalls) || (config.machine && config.machine.maxBalls) || 10000;
  const blades = (config.orbit && config.orbit.blades.count) || (config.machine && config.machine.bladeCount) || 4;
  const text = set[i].replace('{max}', fmt(max)).replace('{blades}', String(blades));
  return { lang, text };
}
