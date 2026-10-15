// expect: ai-profile(domain-purity)
// Domain code that reaches the outside world, reads the clock or randomness, or keeps mutable state.
import { readFileSync } from "node:fs";
import { z } from "zod";

import { unwrapOr } from "../../core/result";

export { ok } from "../../core";

let calls = 0;

export const Price = z.object({ amount: z.number().int().nonnegative() });

export function priceLabel(amount: number): string {
  calls += 1;
  console.log("priceLabel", calls);
  return `${unwrapOr({ ok: true, value: amount }, 0)} yen`;
}

export const newOrderId = () => crypto.randomUUID();
export const isExpired = (expiresAt: number) => expiresAt < Date.now();
export const today = () => new Date();
export const jitter = () => Math.random();
export const locale = () => navigator.language;
export const readConfig = () => readFileSync("config.json", "utf8");

export async function loadPrice(url: string): Promise<number> {
  const response = await fetch(url);
  return response.status;
}
