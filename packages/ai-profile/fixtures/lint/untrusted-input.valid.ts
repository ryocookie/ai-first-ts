// Receive external input as unknown and turn it into a typed value only through a Zod schema.
import { parseJson, readJson, type Result, validate } from "@ai-first-ts/ai-profile/core";
import type { InvalidInput, InvalidJson } from "@ai-first-ts/ai-profile/core";
import { z } from "zod";

const Order = z.object({ id: z.string(), quantity: z.int().positive() });
type Order = z.infer<typeof Order>;

export function orderFromLlm(text: string): Result<Order, InvalidJson | InvalidInput> {
  return parseJson(Order, text);
}

export function readOrder(response: Response): Promise<Result<Order, InvalidJson | InvalidInput>> {
  return readJson(Order, response);
}

export function orderFromQuery(params: URLSearchParams): Result<Order, InvalidInput> {
  return validate(Order, { id: params.get("id"), quantity: Number(params.get("quantity")) });
}

export const isOrder = z.custom<Order>((value) => Order.safeParse(value).success);
export const reply = Response.json({ ok: true });
