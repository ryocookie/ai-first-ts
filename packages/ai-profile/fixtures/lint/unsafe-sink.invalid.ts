// expect: ai-profile(unsafe-sink)
// These sinks skip escaping, so a validated string can still inject SQL or HTML.
import { sql } from "drizzle-orm";
import { createElement } from "react";

export const byName = (name: string) => sql.raw(`select * from user where name = '${name}'`);
export const bio = (html: string) =>
  createElement("div", { dangerouslySetInnerHTML: { __html: html } });
