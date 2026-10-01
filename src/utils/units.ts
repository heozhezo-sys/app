/**
 * Weight, distance and duration conversion.
 *
 * Weights are stored as INTEGER grams everywhere. That choice earns its keep here:
 * 2.5 lb is exactly 1134 grams, and a 1.25 kg plate is exactly 1250 grams. A float
 * column would render 1133.98 g, and the difference between those two is a plate that
 * does not exist.
 *
 * Every function here is pure integer arithmetic, so the conversions are testable
 * without a database.
 */

import type { WeightUnit } from '@/types/settings';

const GRAMS_PER_KG = 1000;
const GRAMS_PER_LB = 453.59237;

/** Parses a decimal string to grams without going through `parseFloat`. */
function decimalStringToNumber(value: string): number | null {
  const cleaned = value.trim().replace(',', '.');
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '.') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function kgToGrams(kg: number): number {
  return Math.round(kg * GRAMS_PER_KG);
}

export function gramsToKg(grams: number): number {
  return grams / GRAMS_PER_KG;
}

export function lbToGrams(lb: number): number {
  return Math.round(lb * GRAMS_PER_LB);
}

export function gramsToLb(grams: number): number {
  return grams / GRAMS_PER_LB;
}

/**
 * Parses user-entered weight into grams.
 *
 * Rounds to the nearest gram and rejects anything non-positive: a negative weight is a
 * typo, and zero is meaningful (bodyweight movements), so zero is allowed but a
 * negative is not.
 */
export function parseWeightToGrams(input: string, unit: WeightUnit): number | null {
  const value = decimalStringToNumber(input);
  if (value === null || value < 0) return null;
  const grams = unit === 'lb' ? lbToGrams(value) : kgToGrams(value);
  // Rounding can turn a tiny positive input into 0; treat that as "no weight given".
  return grams >= 0 ? grams : null;
}

export function formatWeight(grams: number | null, unit: WeightUnit, precise = false): string {
  if (grams === null || grams < 0) return '';
  const value = unit === 'lb' ? gramsToLb(grams) : gramsToKg(grams);
  // Plate-friendly values read best without trailing zeros.
  const rounded = Math.round(value * 100) / 100;
  const text = precise || rounded % 1 !== 0 ? String(rounded) : String(rounded);
  return unit === 'lb' ? `${text} lb` : `${text} kg`;
}

/** RPE is stored as an integer scaled by 10, so 7.5 is 75. */
export function rpeToScaled(rpe: number): number | null {
  if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) return null;
  // Half-point RPE is the finest anyone actually records.
  return Math.round(rpe * 2) * 5;
}

export function scaledToRpe(scaled: number): number {
  return scaled / 10;
}

/** Metres and kilometres. Distance is stored in whole metres. */
export function kmToMetres(km: number): number {
  return Math.round(km * 1000);
}

export function metresToKm(metres: number): number {
  return metres / 1000;
}

export function parseDistanceToMetres(input: string, unit: 'km' | 'm'): number | null {
  const value = decimalStringToNumber(input);
  if (value === null || value < 0) return null;
  return unit === 'km' ? kmToMetres(value) : Math.round(value);
}

export function formatDistance(metres: number | null, unit: 'km' | 'm'): string {
  if (metres === null || metres < 0) return '';
  if (unit === 'm') return `${metres} m`;
  const km = Math.round((metres / 1000) * 100) / 100;
  return `${km} km`;
}

/** Durations are stored in whole seconds. */
export function minutesToSeconds(minutes: number): number {
  return Math.round(minutes * 60);
}

export function parseDurationToSeconds(input: string): number | null {
  const value = decimalStringToNumber(input);
  if (value === null || value <= 0) return null;
  return Math.round(value * 60);
}

/** `1:05:03`, `12:30` or `4:20` depending on magnitude. */
export function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Compact duration for dense list rows, e.g. `1h 05m` or `45m`. */
export function formatDurationShort(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '';
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm === 0 ? `${h}h` : `${h}h ${String(rm).padStart(2, '0')}m`;
}

/** Short duration for a single set, where `45s` and `2:30` both read naturally. */
export function formatSetDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return formatDuration(seconds);
}

export type { WeightUnit };
