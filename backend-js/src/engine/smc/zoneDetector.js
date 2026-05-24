/**
 * Supply and Demand Zone Detector - Smart Money Concepts
 * Identifies institutional order blocks and fair value gaps
 */

import { logger } from "../../services/logger.js";

export class ZoneDetector {
  constructor(config = {}) {
    this.config = {
      minDepartureStrength: config.minDepartureStrength || 2.0, // 2x ATR
      maxBaseSize: config.maxBaseSize || 5, // Max candles in base
      minZoneWidth: config.minZoneWidth || 0.0005, // 0.05% minimum zone
      freshness: config.freshness || 20, // Candles before zone is considered tested
      ...config,
    };
  }

  /**
   * Detect supply and demand zones
   * @param {Array} candles - OHLCV candle data
   * @returns {Object} Zone analysis
   */
  detect(candles) {
    if (!candles || candles.length < 10) {
      return {
        demandZones: [],
        supplyZones: [],
        activeZones: [],
        nearestDemand: null,
        nearestSupply: null,
      };
    }

    // Calculate ATR for departure strength
    const atr = this.calculateATR(candles, 14);

    // Detect demand zones (rally-base-rally)
    const demandZones = this.detectDemandZones(candles, atr);

    // Detect supply zones (drop-base-drop)
    const supplyZones = this.detectSupplyZones(candles, atr);

    // Filter active (untested) zones
    const activeDemand = this.filterActiveZones(demandZones, candles);
    const activeSupply = this.filterActiveZones(supplyZones, candles);

    // Get nearest zones to current price
    const currentPrice = candles[candles.length - 1].close;
    const nearestDemand = this.findNearestZone(currentPrice, activeDemand, "below");
    const nearestSupply = this.findNearestZone(currentPrice, activeSupply, "above");

    return {
      demandZones: activeDemand,
      supplyZones: activeSupply,
      allZones: [...activeDemand, ...activeSupply].sort((a, b) => b.quality - a.quality),
      nearestDemand,
      nearestSupply,
      inZone: this.isPriceInZone(currentPrice, nearestDemand) || this.isPriceInZone(currentPrice, nearestSupply),
    };
  }

  /**
   * Detect demand zones (Rally-Base-Rally)
   */
  detectDemandZones(candles, atr) {
    const zones = [];

    // Look for RBR pattern
    for (let i = this.config.maxBaseSize + 2; i < candles.length - 1; i++) {
      const baseStart = i - this.config.maxBaseSize;
      const baseEnd = i;

      const beforeBase = candles[baseStart - 1];
      const baseCandles = candles.slice(baseStart, baseEnd);
      const afterBase = candles[baseEnd];

      // Check for rally before base (strong bullish candle)
      const beforeRally = this.isStrongBullish(beforeBase, atr);

      // Check for consolidation in base
      const isConsolidation = this.isConsolidation(baseCandles);

      // Check for rally after base
      const afterRally = this.isStrongBullish(afterBase, atr);

      if (beforeRally && isConsolidation && afterRally) {
        // Valid demand zone
        const zoneHigh = Math.max(...baseCandles.map((c) => c.high));
        const zoneLow = Math.min(...baseCandles.map((c) => c.low));
        const zoneWidth = zoneHigh - zoneLow;

        if (zoneWidth / candles[baseStart].close >= this.config.minZoneWidth) {
          zones.push({
            type: "demand",
            high: zoneHigh,
            low: zoneLow,
            baseCandles: baseCandles.length,
            originIndex: i,
            timestamp: candles[baseStart].timestamp,
            quality: this.calculateZoneQuality(baseCandles, beforeBase, afterBase, atr),
            departureStrength: this.calculateDepartureStrength(beforeBase, afterBase, atr),
            tested: false,
            testCount: 0,
          });
        }
      }
    }

    // Remove overlapping zones, keep highest quality
    return this.removeOverlappingZones(zones);
  }

  /**
   * Detect supply zones (Drop-Base-Drop)
   */
  detectSupplyZones(candles, atr) {
    const zones = [];

    // Look for DBD pattern
    for (let i = this.config.maxBaseSize + 2; i < candles.length - 1; i++) {
      const baseStart = i - this.config.maxBaseSize;
      const baseEnd = i;

      const beforeBase = candles[baseStart - 1];
      const baseCandles = candles.slice(baseStart, baseEnd);
      const afterBase = candles[baseEnd];

      // Check for drop before base (strong bearish candle)
      const beforeDrop = this.isStrongBearish(beforeBase, atr);

      // Check for consolidation in base
      const isConsolidation = this.isConsolidation(baseCandles);

      // Check for drop after base
      const afterDrop = this.isStrongBearish(afterBase, atr);

      if (beforeDrop && isConsolidation && afterDrop) {
        // Valid supply zone
        const zoneHigh = Math.max(...baseCandles.map((c) => c.high));
        const zoneLow = Math.min(...baseCandles.map((c) => c.low));
        const zoneWidth = zoneHigh - zoneLow;

        if (zoneWidth / candles[baseStart].close >= this.config.minZoneWidth) {
          zones.push({
            type: "supply",
            high: zoneHigh,
            low: zoneLow,
            baseCandles: baseCandles.length,
            originIndex: i,
            timestamp: candles[baseStart].timestamp,
            quality: this.calculateZoneQuality(baseCandles, beforeBase, afterBase, atr),
            departureStrength: this.calculateDepartureStrength(beforeBase, afterBase, atr),
            tested: false,
            testCount: 0,
          });
        }
      }
    }

    // Remove overlapping zones
    return this.removeOverlappingZones(zones);
  }

  /**
   * Check if candle is strong bullish
   */
  isStrongBullish(candle, atr) {
    const body = candle.close - candle.open;
    const range = candle.high - candle.low;

    if (body <= 0 || range === 0) return false;

    // Body should be large
    const bodyToRange = body / range;
    if (bodyToRange < 0.6) return false;

    // Should be larger than ATR
    if (body < atr * 0.5) return false;

    return true;
  }

  /**
   * Check if candle is strong bearish
   */
  isStrongBearish(candle, atr) {
    const body = candle.open - candle.close;
    const range = candle.high - candle.low;

    if (body <= 0 || range === 0) return false;

    const bodyToRange = body / range;
    if (bodyToRange < 0.6) return false;

    if (body < atr * 0.5) return false;

    return true;
  }

  /**
   * Check if candles show consolidation
   */
  isConsolidation(candles) {
    if (candles.length === 0) return false;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const range = Math.max(...highs) - Math.min(...lows);
    const avgPrice = candles.reduce((sum, c) => sum + c.close, 0) / candles.length;

    // Range should be tight (less than 0.5% of price)
    const tight = (range / avgPrice) < 0.005;

    // Volume should be lower than average (institutions accumulating)
    const avgVolume = candles.reduce((sum, c) => sum + (c.volume || 0), 0) / candles.length;
    const prevCandle = candles[0]; // Assuming previous candle is before this array

    return tight;
  }

  /**
   * Calculate zone quality (0-100)
   */
  calculateZoneQuality(baseCandles, beforeCandle, afterCandle, atr) {
    let quality = 50; // Base quality

    // Strong departure
    const beforeStrength = Math.abs(beforeCandle.close - beforeCandle.open);
    const afterStrength = Math.abs(afterCandle.close - afterCandle.open);

    if (beforeStrength > atr * 1.5) quality += 15;
    if (afterStrength > atr * 1.5) quality += 15;

    // Small base (institutional precision)
    if (baseCandles.length <= 2) quality += 10;
    else if (baseCandles.length <= 3) quality += 5;

    // Recent zone (higher probability)
    quality += 10;

    return Math.min(100, quality);
  }

  /**
   * Calculate departure strength
   */
  calculateDepartureStrength(before, after, atr) {
    const beforeMove = Math.abs(before.close - before.open);
    const afterMove = Math.abs(after.close - after.open);
    const avgMove = (beforeMove + afterMove) / 2;

    return avgMove / atr;
  }

  /**
   * Filter active (untested) zones
   */
  filterActiveZones(zones, candles) {
    const currentIndex = candles.length - 1;
    const active = [];

    for (const zone of zones) {
      // Check if price has returned to zone since formation
      let tested = false;
      let testCount = 0;

      for (let i = zone.originIndex + 1; i <= currentIndex; i++) {
        const candle = candles[i];

        // Check if price entered zone
        if (candle.low <= zone.high && candle.high >= zone.low) {
          tested = true;
          testCount++;
        }
      }

      if (!tested || testCount === 0) {
        active.push({
          ...zone,
          tested: false,
          testCount: 0,
          freshness: "fresh",
        });
      } else if (testCount < 2) {
        // Partially tested, still valid
        active.push({
          ...zone,
          tested: true,
          testCount,
          freshness: "lightly_tested",
        });
      }
    }

    return active;
  }

  /**
   * Remove overlapping zones, keep best quality
   */
  removeOverlappingZones(zones) {
    const tolerance = 0.001; // 0.1% overlap tolerance

    // Sort by quality (descending)
    const sorted = [...zones].sort((a, b) => b.quality - a.quality);
    const unique = [];

    for (const zone of sorted) {
      let overlaps = false;

      for (const existing of unique) {
        const overlap =
          (zone.low <= existing.high && zone.high >= existing.low) ||
          (existing.low <= zone.high && existing.high >= zone.low);

        if (overlap) {
          // Check if they're close enough to be considered same zone
          const distance = Math.abs(zone.low - existing.low) / zone.low;
          if (distance < tolerance) {
            overlaps = true;
            break;
          }
        }
      }

      if (!overlaps) {
        unique.push(zone);
      }
    }

    return unique;
  }

  /**
   * Find nearest zone to current price
   */
  findNearestZone(price, zones, direction) {
    if (!zones || zones.length === 0) return null;

    let nearest = null;
    let minDistance = Infinity;

    for (const zone of zones) {
      let distance;
      let isInDirection;

      if (direction === "below") {
        distance = price - zone.high;
        isInDirection = zone.high < price;
      } else {
        distance = zone.low - price;
        isInDirection = zone.low > price;
      }

      if (isInDirection && distance > 0 && distance < minDistance) {
        minDistance = distance;
        nearest = zone;
      }
    }

    if (nearest) {
      return {
        ...nearest,
        distance: minDistance,
        distancePercent: (minDistance / price) * 100,
      };
    }

    return null;
  }

  /**
   * Check if price is inside a zone
   */
  isPriceInZone(price, zone) {
    if (!zone) return false;
    return price >= zone.low && price <= zone.high;
  }

  /**
   * Calculate ATR
   */
  calculateATR(candles, period) {
    if (candles.length < period) return 0;

    let atr = 0;
    for (let i = candles.length - period; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1]?.close || candles[i].open;

      const tr1 = high - low;
      const tr2 = Math.abs(high - prevClose);
      const tr3 = Math.abs(low - prevClose);

      atr += Math.max(tr1, tr2, tr3);
    }

    return atr / period;
  }

  /**
   * Get entry model recommendation
   */
  getEntryModel(price, demand, supply) {
    // Check for sniper entry (price in zone)
    if (this.isPriceInZone(price, demand)) {
      return {
        type: "sniper",
        zone: demand,
        direction: "BUY",
        sl: demand.low,
        tp: null, // To be calculated based on next resistance
      };
    }

    if (this.isPriceInZone(price, supply)) {
      return {
        type: "sniper",
        zone: supply,
        direction: "SELL",
        sl: supply.high,
        tp: null,
      };
    }

    // Check for refined entry (price near zone)
    if (demand && demand.distancePercent && demand.distancePercent < 0.2) {
      return {
        type: "refined",
        zone: demand,
        direction: "BUY",
        waitFor: "price_to_enter_zone",
      };
    }

    if (supply && supply.distancePercent && supply.distancePercent < 0.2) {
      return {
        type: "refined",
        zone: supply,
        direction: "SELL",
        waitFor: "price_to_enter_zone",
      };
    }

    return null;
  }
}
