const { buildWaves, processWave, isWaveComplete, WAVE_GAP_MS } = require('../../lib/utils/waves');

describe('Wave Detection Utilities', () => {
  describe('buildWaves', () => {
    test('groups alerts within 20-minute gap into same wave', () => {
      const alerts = [
        { alertDate: '2026-03-10 14:21:00', data: 'City1', title: 'בדקות הקרובות' },
        { alertDate: '2026-03-10 14:22:00', data: 'City2', title: 'בדקות הקרובות' },
        { alertDate: '2026-03-10 14:25:00', data: 'City1', title: 'ירי רקטות וטילים' }
      ];
      
      const waves = buildWaves(alerts);
      expect(waves).toHaveLength(1);
      expect(waves[0].alertCount).toBe(3);
    });

    test('splits alerts with >20-minute gap into separate waves', () => {
      const alerts = [
        { alertDate: '2026-03-10 14:00:00', data: 'City1', title: 'בדקות הקרובות' },
        { alertDate: '2026-03-10 14:25:00', data: 'City2', title: 'בדקות הקרובות' }
      ];
      
      const waves = buildWaves(alerts);
      expect(waves).toHaveLength(2);
    });

    test('returns empty array for no alerts', () => {
      expect(buildWaves([])).toEqual([]);
    });

    test('handles single alert', () => {
      const alerts = [
        { alertDate: '2026-03-10 14:00:00', data: 'City1', title: 'בדקות הקרובות' }
      ];
      const waves = buildWaves(alerts);
      expect(waves).toHaveLength(1);
      expect(waves[0].summary.warned).toBe(1);
    });
  });

  describe('processWave', () => {
    test('tracks orange, red, and green per city', () => {
      const alerts = [
        { alertDate: '2026-03-10 14:21:00', data: 'City1', title: 'בדקות הקרובות', time: 1710082860000 },
        { alertDate: '2026-03-10 14:27:00', data: 'City1', title: 'ירי רקטות וטילים', time: 1710083220000 },
        { alertDate: '2026-03-10 14:55:00', data: 'City1', title: 'האירוע הסתיים', time: 1710084900000 }
      ];
      
      const wave = processWave(alerts);
      expect(wave.cities['City1'].orange).toBe(true);
      expect(wave.cities['City1'].red).toBe(true);
      expect(wave.cities['City1'].green).toBe(true);
    });

    test('calculates correct conversion rate', () => {
      const alerts = [
        { alertDate: '2026-03-10 14:21:00', data: 'City1', title: 'בדקות הקרובות', time: 1710082860000 },
        { alertDate: '2026-03-10 14:21:00', data: 'City2', title: 'בדקות הקרובות', time: 1710082860000 },
        { alertDate: '2026-03-10 14:27:00', data: 'City1', title: 'ירי רקטות וטילים', time: 1710083220000 }
      ];
      
      const wave = processWave(alerts);
      expect(wave.summary.warned).toBe(2);
      expect(wave.summary.red).toBe(1);
      expect(wave.summary.conversionRate).toBeCloseTo(0.5, 2);
    });

    test('identifies hasGreen flag correctly', () => {
      const alertsWithGreen = [
        { alertDate: '2026-03-10 14:21:00', data: 'City1', title: 'בדקות הקרובות', time: 1710082860000 },
        { alertDate: '2026-03-10 14:55:00', data: 'City1', title: 'האירוע הסתיים', time: 1710084900000 }
      ];
      
      const alertsWithoutGreen = [
        { alertDate: '2026-03-10 14:21:00', data: 'City1', title: 'בדקות הקרובות', time: 1710082860000 },
        { alertDate: '2026-03-10 14:27:00', data: 'City1', title: 'ירי רקטות וטילים', time: 1710083220000 }
      ];
      
      const waveWithGreen = processWave(alertsWithGreen);
      const waveWithoutGreen = processWave(alertsWithoutGreen);
      
      expect(waveWithGreen.summary.hasGreen).toBe(true);
      expect(waveWithoutGreen.summary.hasGreen).toBe(false);
    });
  });

  describe('isWaveComplete', () => {
    test('returns true for wave with green and sufficient warned cities', () => {
      const wave = {
        summary: { hasGreen: true, warned: 10, red: 5, conversionRate: 0.5 }
      };
      expect(isWaveComplete(wave, 5)).toBe(true);
    });

    test('returns false for wave without green', () => {
      const wave = {
        summary: { hasGreen: false, warned: 10, red: 5, conversionRate: 0.5 }
      };
      expect(isWaveComplete(wave, 5)).toBe(false);
    });

    test('returns false for wave with insufficient warned cities', () => {
      const wave = {
        summary: { hasGreen: true, warned: 3, red: 1, conversionRate: 0.33 }
      };
      expect(isWaveComplete(wave, 5)).toBe(false);
    });

    test('respects custom minWarnedCities threshold', () => {
      const wave = {
        summary: { hasGreen: true, warned: 8, red: 4, conversionRate: 0.5 }
      };
      expect(isWaveComplete(wave, 10)).toBe(false);
      expect(isWaveComplete(wave, 5)).toBe(true);
    });
  });

  describe('WAVE_GAP_MS constant', () => {
    test('equals 20 minutes in milliseconds', () => {
      expect(WAVE_GAP_MS).toBe(20 * 60 * 1000);
      expect(WAVE_GAP_MS).toBe(1200000);
    });
  });
});
