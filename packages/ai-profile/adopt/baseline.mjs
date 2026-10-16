// ベースライン: 導入した時点の違反を「ファイル → 診断コード → 件数」で記録し、それより増えた分だけを落とす。
// 行番号は記録しない（前後の行を編集しただけで既存の違反が「新しい違反」に見えないようにするため）。
// 変更したファイル（基準のブランチとの差分）は、ベースラインにあっても違反ゼロでなければならない。
// ベースラインはゲートファイルで、verify --update-baseline は減らす方向にしか書き換えない。

const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * @typedef {{ file: string, code: string, line: number, column: number, message: string, hint?: string | undefined }} Violation
 * @typedef {Record<string, Record<string, number>>} Counts
 */

/** @param {Violation[]} violations */
export function countViolations(violations) {
  /** @type {Counts} */
  const counts = {};
  for (const v of violations) {
    const byCode = (counts[v.file] ??= {});
    byCode[v.code] = (byCode[v.code] ?? 0) + 1;
  }
  return sortCounts(counts);
}

/** ファイル名・コードの順に並べ、件数 0 を除く（差分が安定するように）。 */
export function sortCounts(counts) {
  /** @type {Counts} */
  const sorted = {};
  for (const file of Object.keys(counts).sort()) {
    const byCode = counts[file] ?? {};
    const codes = Object.keys(byCode)
      .filter((c) => (byCode[c] ?? 0) > 0)
      .sort();
    if (codes.length > 0) {
      sorted[file] = Object.fromEntries(codes.map((c) => [c, byCode[c] ?? 0]));
    }
  }
  return sorted;
}

/**
 * ベースラインのファイルの中身を検査して件数を取り出す。
 * @param {unknown} value
 * @returns {{ counts: Counts, problems: string[] }}
 */
export function parseBaseline(value) {
  const problems = [];
  /** @type {Counts} */
  const counts = {};
  const violations = isRecord(value) ? value.violations : undefined;
  if (!isRecord(violations)) {
    return { counts, problems: ["violations（ファイル → 診断コード → 件数）がない。"] };
  }
  for (const [file, byCode] of Object.entries(violations)) {
    if (!isRecord(byCode)) {
      problems.push(`violations["${file}"] が「診断コード → 件数」のオブジェクトでない。`);
      continue;
    }
    for (const [code, count] of Object.entries(byCode)) {
      if (!Number.isInteger(count) || Number(count) < 1) {
        problems.push(`violations["${file}"]["${code}"] が 1 以上の整数でない。`);
        continue;
      }
      (counts[file] ??= {})[code] = Number(count);
    }
  }
  return { counts, problems };
}

/** @param {Counts} counts */
export function formatBaseline(counts) {
  return `${JSON.stringify(
    {
      $comment:
        "ai-profile の導入時からある違反。これより増えた分と、変更したファイルの違反は verify が落とす。" +
        "減らすのは bun packages/ai-profile/adopt/verify.mjs --update-baseline。増やす変更は人間の承認制（ゲートファイル）。",
      violations: sortCounts(counts),
    },
    null,
    2,
  )}\n`;
}

/**
 * 今の違反をベースラインと比べる。
 * @param {Counts} baseline
 * @param {Violation[]} violations 今の違反
 * @param {(file: string) => boolean} touched 基準のブランチから変更したファイルか
 */
export function compareWithBaseline(baseline, violations, touched) {
  const current = countViolations(violations);
  /** @type {Violation[]} 落とす違反 */
  const failing = [];
  for (const [file, byCode] of Object.entries(current)) {
    for (const [code, count] of Object.entries(byCode)) {
      const allowed = touched(file) ? 0 : (baseline[file]?.[code] ?? 0);
      if (count > allowed) {
        const inFile = violations.filter((v) => v.file === file && v.code === code);
        // どの行が「増えた分」かは区別できないため、そのファイルのそのコードの違反を全て示す。
        failing.push(...inFile.map((v) => ({ ...v, allowed, count })));
      }
    }
  }
  // ベースラインより減ったもの（--update-baseline で反映できる）。
  const shrinkable = [];
  for (const [file, byCode] of Object.entries(baseline)) {
    for (const [code, count] of Object.entries(byCode)) {
      const now = current[file]?.[code] ?? 0;
      if (now < count) {
        shrinkable.push({ file, code, from: count, to: now });
      }
    }
  }
  return { current, failing, shrinkable };
}

/**
 * ベースラインを今の違反に合わせて減らす（増やさない）。
 * @param {Counts} baseline
 * @param {Counts} current
 */
export function shrinkBaseline(baseline, current) {
  /** @type {Counts} */
  const result = {};
  for (const [file, byCode] of Object.entries(baseline)) {
    for (const [code, count] of Object.entries(byCode)) {
      const now = Math.min(count, current[file]?.[code] ?? 0);
      if (now > 0) {
        (result[file] ??= {})[code] = now;
      }
    }
  }
  return sortCounts(result);
}

/**
 * 基準のブランチのベースラインから増えたエントリ（gate(baseline) が使う）。
 * @param {Counts} current
 * @param {Counts} previous
 */
export function findGrowth(current, previous) {
  const growth = [];
  for (const [file, byCode] of Object.entries(current)) {
    for (const [code, count] of Object.entries(byCode)) {
      const before = previous[file]?.[code] ?? 0;
      if (count > before) {
        growth.push({ file, code, from: before, to: count });
      }
    }
  }
  return growth;
}
