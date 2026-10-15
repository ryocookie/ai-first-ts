// 失敗を戻り値で表す Result 型。domain / app 層は throw せずにこれを返す（ai-profile(no-throw) が強制する）。
// 判別は `result.ok` で行う: `if (!result.ok) return result;` のあと `result.value` が使える。

export type Ok<T> = { readonly ok: true; readonly value: T };
export type Err<E> = { readonly ok: false; readonly error: E };
export type Result<T, E> = Ok<T> | Err<E>;

export function ok<T>(value: T): Ok<T> {
  return { ok: true, value };
}

export function err<E>(error: E): Err<E> {
  return { ok: false, error };
}

/** 成功値だけを変換する。 */
export function map<T, U, E>(result: Result<T, E>, f: (value: T) => U): Result<U, E> {
  return result.ok ? ok(f(result.value)) : result;
}

/** 失敗値だけを変換する（例: ドメインエラーを API エラーに写す）。 */
export function mapErr<T, E, F>(result: Result<T, E>, f: (error: E) => F): Result<T, F> {
  return result.ok ? result : err(f(result.error));
}

/** 成功時に次の Result を返す処理へつなぐ。失敗はそのまま伝わる。 */
export function andThen<T, U, E, F>(
  result: Result<T, E>,
  f: (value: T) => Result<U, F>,
): Result<U, E | F> {
  return result.ok ? f(result.value) : result;
}

/** 失敗時は fallback を返す。失敗を握りつぶしてよい場面に限って使う。 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** throw しうる同期処理（ライブラリ呼び出し・JSON.parse など）を Result に変換する。 */
export function tryCatch<T, E>(fn: () => T, onError: (cause: unknown) => E): Result<T, E> {
  try {
    return ok(fn());
  } catch (cause) {
    return err(onError(cause));
  }
}

/** reject / throw しうる非同期処理を Result に変換する。 */
export async function tryCatchAsync<T, E>(
  fn: () => Promise<T>,
  onError: (cause: unknown) => E,
): Promise<Result<T, E>> {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(onError(cause));
  }
}
