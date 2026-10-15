// expect: ai-profile(untrusted-input)
// also: typescript(no-unsafe-assignment), typescript(no-unsafe-member-access)
// Each value reaches the program with a type no schema has checked.
import { type } from "@orpc/server";
import { z } from "zod";

type Order = { id: string; quantity: number };

export const order: Order = JSON.parse('{"id":"a","quantity":1}');

export async function readOrder(response: Response): Promise<Order> {
  return response.json();
}

export const apiKey = process.env["API_KEY"];

export const orderInput = type<Order>();
export const anyOrder = z.any();
export const customOrder = z.custom<Order>();
