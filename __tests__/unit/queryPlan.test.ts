import { createQueryPlan, DEFAULT_QUERY_PLAN } from '../../src/services/search/queryPlan';

describe('queryPlan', () => {
  describe('intent classification', () => {
    it('treats addresses as address intent', () => {
      expect(createQueryPlan('350 5th Ave').intent).toBe('address');
      expect(createQueryPlan('123 main street').intent).toBe('address');
    });

    it('treats bare category phrases as nearby intent', () => {
      expect(createQueryPlan('bagels').intent).toBe('nearby');
      expect(createQueryPlan('coffee near me').intent).toBe('nearby');
      expect(createQueryPlan('pizza open now').intent).toBe('nearby');
    });

    it('treats proper-name tokens as a place lookup', () => {
      expect(createQueryPlan('h&h bagels').intent).toBe('named-place');
      expect(createQueryPlan('pizza palace').intent).toBe('named-place');
      expect(createQueryPlan('starbucks').intent).toBe('named-place');
    });

    it('allows distant framing for addresses and named places, not for nearby', () => {
      expect(createQueryPlan('350 5th Ave').allowsDistantFraming).toBe(true);
      expect(createQueryPlan('starbucks').allowsDistantFraming).toBe(true);
      expect(createQueryPlan('bagels').allowsDistantFraming).toBe(false);
      expect(createQueryPlan('coffee near me').allowsDistantFraming).toBe(false);
    });
  });

  describe('policy table', () => {
    it('keeps the canonical numbers', () => {
      expect(DEFAULT_QUERY_PLAN.areaRadiusKm).toBe(75); // engine area gate
      expect(DEFAULT_QUERY_PLAN.tailRadiusKm).toBe(120); // panel distant-tail drop
      expect(DEFAULT_QUERY_PLAN.nearbyRadiusKm).toBe(50); // panel local ordering
      expect(DEFAULT_QUERY_PLAN.maxRenderedPins).toBe(24); // pin rendering budget
      expect(DEFAULT_QUERY_PLAN.fitAnchorRadiusKm).toBe(30); // camera fit radius
    });

    it('carries all policy fields per intent', () => {
      const plan = createQueryPlan('bagels');
      expect(plan.areaRadiusKm).toBe(75);
      expect(plan.tailRadiusKm).toBe(120);
      expect(plan.nearbyRadiusKm).toBe(50);
      expect(plan.maxRenderedPins).toBe(24);
      expect(plan.fitAnchorRadiusKm).toBe(30);
    });

    it('sizes the answer horizon from the intent, not from the map zoom', () => {
      // A bare category is answered around the user; a brand/named place may
      // reach across the metro; an address is a single destination.
      expect(createQueryPlan('coffee').horizon.maxRadiusKm).toBe(30);
      expect(createQueryPlan('whole foods').horizon.maxRadiusKm).toBe(40);
      expect(createQueryPlan('350 5th Ave').horizon.maxRadiusKm).toBe(10);
    });
  });
});
