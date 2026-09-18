import DecimalJs from "decimal.js";

/**
 * A private decimal.js clone so that precision settings never leak into (or
 * from) other libraries that bundle their own copy, such as Prisma.
 */
export const Decimal = DecimalJs.clone({ precision: 40, rounding: DecimalJs.ROUND_HALF_EVEN });
export type Decimal = InstanceType<typeof Decimal>;

/** Anything that can be turned into a Decimal: numbers, numeric strings, or decimal-like objects (Prisma Decimal). */
export type DecimalInput = string | number | { toString(): string };

export function toDecimal(value: DecimalInput): Decimal {
  if (typeof value === "number" || typeof value === "string") {
    return new Decimal(value);
  }
  return new Decimal(value.toString());
}

export function toDecimalOrNull(value: DecimalInput | null | undefined): Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  return toDecimal(value);
}

export const ZERO = new Decimal(0);

export function sum(values: Iterable<DecimalInput>): Decimal {
  let total = ZERO;
  for (const v of values) total = total.plus(toDecimal(v));
  return total;
}

/** Serialize for the UI boundary: a plain JS number (charts, KPI maths). */
export function toNumber(value: DecimalInput | null | undefined): number | null {
  const d = toDecimalOrNull(value);
  return d ? d.toNumber() : null;
}

/** Serialize for the UI boundary: an exact decimal string (form inputs, CSV). */
export function toPlainString(value: DecimalInput | null | undefined): string | null {
  const d = toDecimalOrNull(value);
  return d ? d.toFixed() : null;
}
