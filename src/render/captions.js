// Hook captions (owner decision Q1): generated from per-scenario templates in English and Arabic, based on the
// run's real rules. Western digits in both languages (Q3). Chosen deterministically from the seed.
import { rand } from '../engine/rng.js';

const fmt = (n) => n.toLocaleString('en-US');

const TEMPLATES = {
  'split-chamber': {
    en: ['Every crush splits a ball into three', 'Four presses. One ball. Will it reach {max}?', 'One ball becomes {max}. Watch.', 'How fast can one ball become {max}?'],
    ar: ['كل ضغطة تقسم الكرة إلى ثلاث', 'أربع مكابس وكرة واحدة… هل تصل إلى {max}؟', 'كرة واحدة تصبح {max}. شاهد.', 'كم تحتاج كرة واحدة لتصبح {max}؟'],
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
  const max = (config.orbit && config.orbit.maxBalls) || 10000;
  const blades = (config.orbit && config.orbit.blades.count) || 0;
  const text = set[i].replace('{max}', fmt(max)).replace('{blades}', String(blades));
  return { lang, text };
}
