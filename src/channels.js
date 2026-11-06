/**
 * Словарь каналов BimmerLink: английское имя из CSV → русское имя, единица, группа.
 *
 * Единицы указаны для метрических настроек BimmerLink (°C, бар, км/ч).
 * Если в приложении включены другие единицы — поправьте их здесь и выполните `npm run reparse`.
 *
 * warn — порог, выше которого участок подсвечивается как тревожный (можно менять под свою машину).
 */
const GROUPS = {
  temp: 'Температуры',
  pressure: 'Давления',
  engine: 'Двигатель',
  mixture: 'Смесь',
  misfire: 'Пропуски зажигания',
  motion: 'Движение',
  other: 'Прочее'
};

const KNOWN = {
  'coolant temperature': { name: 'Температура ОЖ', unit: '°C', group: 'temp', warn: 110 },
  'engine oil temperature': { name: 'Температура масла', unit: '°C', group: 'temp', warn: 120 },
  'transmission temperature': { name: 'Температура АКПП', unit: '°C', group: 'temp', warn: 110 },
  'intake air temperature': { name: 'Температура впуска', unit: '°C', group: 'temp' },
  'intake air temperature at start': { name: 'Температура впуска при пуске', unit: '°C', group: 'temp' },
  'intake air temperature in the charger line': {
    name: 'Температура после интеркулера',
    unit: '°C',
    group: 'temp',
    warn: 60
  },
  'target temperature coolant': { name: 'Целевая температура ОЖ', unit: '°C', group: 'temp' },
  'boost pressure': { name: 'Давление наддува', unit: 'бар', group: 'pressure' },
  'actual oil pressure': { name: 'Давление масла', unit: 'бар', group: 'pressure' },
  'multiplicative mixture correction of the mixture adaptation': {
    name: 'Мультипликативная коррекция смеси',
    unit: '×',
    group: 'mixture'
  },
  'engine speed': { name: 'Обороты двигателя', unit: 'об/мин', group: 'engine' },
  'vehicle speed': { name: 'Скорость', unit: 'км/ч', group: 'motion' }
};

function describeChannel(sourceName) {
  const key = String(sourceName).trim().toLowerCase();
  if (KNOWN[key]) return { ...KNOWN[key] };

  const misfire = key.match(/^misfire detection counter cylinder (\d+)$/);
  if (misfire) return { name: `Пропуски, цилиндр ${misfire[1]}`, unit: 'шт', group: 'misfire' };

  // Эвристики для параметров, которых нет в словаре
  if (/temperature/.test(key)) return { name: sourceName, unit: '°C', group: 'temp' };
  if (/pressure/.test(key)) return { name: sourceName, unit: '', group: 'pressure' };
  if (/speed|rpm/.test(key)) return { name: sourceName, unit: '', group: 'engine' };
  if (/lambda|mixture|fuel/.test(key)) return { name: sourceName, unit: '', group: 'mixture' };
  return { name: sourceName, unit: '', group: 'other' };
}

module.exports = { GROUPS, KNOWN, describeChannel };
