const { haversineKm, bearing, centroid, median } = require('../../lib/utils/geo');

describe('Geographic Utilities', () => {
  describe('haversineKm', () => {
    test('calculates distance between Tel Aviv and Jerusalem correctly', () => {
      const tlvLat = 32.0853, tlvLng = 34.7818;
      const jlmLat = 31.7683, jlmLng = 35.2137;
      const dist = haversineKm(tlvLat, tlvLng, jlmLat, jlmLng);
      expect(dist).toBeGreaterThan(45);
      expect(dist).toBeLessThan(55);
    });

    test('returns 0 for identical coordinates', () => {
      const dist = haversineKm(32.0, 34.0, 32.0, 34.0);
      expect(dist).toBe(0);
    });

    test('handles negative coordinates', () => {
      const dist = haversineKm(-33.8688, 151.2093, 51.5074, -0.1278);
      expect(dist).toBeGreaterThan(16900);
      expect(dist).toBeLessThan(17100);
    });
  });

  describe('bearing', () => {
    test('calculates bearing from Tel Aviv to Jerusalem', () => {
      const tlvLat = 32.0853, tlvLng = 34.7818;
      const jlmLat = 31.7683, jlmLng = 35.2137;
      const bear = bearing(tlvLat, tlvLng, jlmLat, jlmLng);
      expect(bear).toBeGreaterThan(0.5);
      expect(bear).toBeLessThan(2.5);
    });

    test('returns 0 for identical coordinates', () => {
      const bear = bearing(32.0, 34.0, 32.0, 34.0);
      expect(bear).toBe(0);
    });
  });

  describe('centroid', () => {
    test('calculates centroid of multiple points', () => {
      const points = [
        { lat: 32.0, lng: 34.0 },
        { lat: 32.0, lng: 35.0 },
        { lat: 33.0, lng: 34.5 }
      ];
      const center = centroid(points);
      expect(center.lat).toBeCloseTo(32.333, 2);
      expect(center.lng).toBeCloseTo(34.5, 2);
    });

    test('returns null for empty array', () => {
      expect(centroid([])).toBeNull();
    });

    test('returns single point for array of one', () => {
      const points = [{ lat: 32.0, lng: 34.0 }];
      const center = centroid(points);
      expect(center.lat).toBe(32.0);
      expect(center.lng).toBe(34.0);
    });
  });

  describe('median', () => {
    test('calculates median of odd-length array', () => {
      expect(median([1, 2, 3, 4, 5])).toBe(3);
    });

    test('calculates median of even-length array', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    test('returns 0 for empty array', () => {
      expect(median([])).toBe(0);
    });

    test('handles unsorted arrays', () => {
      expect(median([5, 1, 3, 2, 4])).toBe(3);
    });
  });
});
