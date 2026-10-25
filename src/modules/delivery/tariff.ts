// Distance tariff arithmetic (FSD DEL-03). Pure and exact: integer metres and
// integer RWF only, no binary floating point anywhere in the money path.
//
// fee = rounding * ceil((base + extraPerKm * max(0, km - includedKm)) / rounding)
//
// Evaluated with integers scaled by 1000 (metres), i.e. the fractional kilometre
// enters before monetary rounding, exactly as the specification requires.

export type TariffTerms = {
  baseRwf: number;
  includedMetres: number;
  extraRwfPerKm: number;
  roundingRwf: number;
};

function assertWholeNonNegative(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

export function assertValidTariff(terms: TariffTerms): void {
  assertWholeNonNegative("baseRwf", terms.baseRwf);
  assertWholeNonNegative("includedMetres", terms.includedMetres);
  assertWholeNonNegative("extraRwfPerKm", terms.extraRwfPerKm);
  assertWholeNonNegative("roundingRwf", terms.roundingRwf);
  if (terms.roundingRwf === 0) throw new RangeError("roundingRwf must be positive");
}

export function deliveryFeeRwf(distanceMetres: number, terms: TariffTerms): number {
  assertValidTariff(terms);
  assertWholeNonNegative("distanceMetres", distanceMetres);

  const extraMetres = BigInt(Math.max(0, distanceMetres - terms.includedMetres));
  // Amount in "RWF * 1000" units so that per-km pricing of fractional km stays exact.
  const scaled = BigInt(terms.baseRwf) * 1000n + BigInt(terms.extraRwfPerKm) * extraMetres;
  const unit = BigInt(terms.roundingRwf) * 1000n;
  const units = (scaled + unit - 1n) / unit; // ceil for non-negative integers
  const fee = units * BigInt(terms.roundingRwf);
  if (fee > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("fee exceeds safe integer range");
  return Number(fee);
}
