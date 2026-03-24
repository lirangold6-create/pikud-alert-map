const { isOrange, isRed, isGreen, alertKey, getAlertType } = require('../../lib/utils/alerts');

describe('Alert Classification Utilities', () => {
  describe('isOrange', () => {
    test('identifies orange warning alerts', () => {
      expect(isOrange('בדקות הקרובות צפויות להתקבל התרעות באזורך')).toBe(true);
      expect(isOrange('בדקות הקרובות')).toBe(true);
      expect(isOrange('צפויות להתקבל')).toBe(true);
    });

    test('rejects non-orange alerts', () => {
      expect(isOrange('ירי רקטות וטילים')).toBe(false);
      expect(isOrange('האירוע הסתיים')).toBe(false);
      expect(isOrange('')).toBe(false);
      expect(isOrange(null)).toBe(false);
    });
  });

  describe('isRed', () => {
    test('identifies red rocket alerts', () => {
      expect(isRed('ירי רקטות וטילים')).toBe(true);
    });

    test('rejects ended red alerts', () => {
      expect(isRed('ירי רקטות וטילים - האירוע הסתיים')).toBe(false);
    });

    test('rejects non-red alerts', () => {
      expect(isRed('בדקות הקרובות')).toBe(false);
      expect(isRed('האירוע הסתיים')).toBe(false);
      expect(isRed('')).toBe(false);
      expect(isRed(null)).toBe(false);
    });
  });

  describe('isGreen', () => {
    test('identifies green all-clear alerts', () => {
      expect(isGreen('האירוע הסתיים')).toBe(true);
      expect(isGreen('ניתן לצאת מהמרחב המוגן')).toBe(true);
    });

    test('rejects non-green alerts', () => {
      expect(isGreen('ירי רקטות וטילים')).toBe(false);
      expect(isGreen('בדקות הקרובות')).toBe(false);
      expect(isGreen('')).toBe(false);
      expect(isGreen(null)).toBe(false);
    });
  });

  describe('alertKey', () => {
    test('generates unique key from alert data', () => {
      const alert = {
        alertDate: '2026-03-10 14:21:08',
        data: 'תל אביב',
        title: 'בדקות הקרובות'
      };
      const key = alertKey(alert);
      expect(key).toBe('2026-03-10 14:21:08|תל אביב|בדקות הקרובות');
    });

    test('creates consistent keys for same alert', () => {
      const alert1 = { alertDate: '2026-03-10 14:21:08', data: 'רעננה', title: 'ירי רקטות וטילים' };
      const alert2 = { alertDate: '2026-03-10 14:21:08', data: 'רעננה', title: 'ירי רקטות וטילים' };
      expect(alertKey(alert1)).toBe(alertKey(alert2));
    });
  });

  describe('getAlertType', () => {
    test('returns correct type for each alert', () => {
      expect(getAlertType('ירי רקטות וטילים')).toBe('red');
      expect(getAlertType('בדקות הקרובות')).toBe('orange');
      expect(getAlertType('האירוע הסתיים')).toBe('green');
      expect(getAlertType('something else')).toBe('unknown');
    });
  });
});
