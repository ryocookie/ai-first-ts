// Let drizzle bind values as parameters and let React escape text.
import { sql } from "drizzle-orm";
import { createElement } from "react";

export const byName = (name: string) => sql`select * from user where name = ${name}`;
export const bio = (text: string) => createElement("div", null, text);
export const template = String.raw`C:\path`;
