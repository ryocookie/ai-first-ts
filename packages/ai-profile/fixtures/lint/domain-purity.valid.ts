// Pure domain code: everything it needs arrives as arguments, and failures are returned as Result.
import { err, ok, type Result } from "@ai-first-ts/ai-profile/core";
import { z } from "zod";

export const Coupon = z.object({
  code: z.string().min(1),
  percentOff: z.number().int().min(1).max(100),
  expiresAt: z.date(),
});
export type Coupon = z.infer<typeof Coupon>;

export type CouponError = { type: "Expired" } | { type: "BelowMinimum"; minimum: number };

const MINIMUM_TOTAL = 1000;

// The current time is passed in by the app layer instead of being read here.
export function applyCoupon(total: number, coupon: Coupon, now: Date): Result<number, CouponError> {
  if (coupon.expiresAt.getTime() <= now.getTime()) {
    return err({ type: "Expired" });
  }
  if (total < MINIMUM_TOTAL) {
    return err({ type: "BelowMinimum", minimum: MINIMUM_TOTAL });
  }
  return ok(Math.round((total * (100 - coupon.percentOff)) / 100));
}

// Parsing a given value and pure Math members are deterministic.
export const expiry = (iso: string) => new Date(iso);
export const endOfYear = (year: number) => new Date(Date.UTC(year, 11, 31));
export const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

// A local binding that shadows a global name is not the global.
export function summarize(document: { lines: readonly string[] }): number {
  return document.lines.length;
}
