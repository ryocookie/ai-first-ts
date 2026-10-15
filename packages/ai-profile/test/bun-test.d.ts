// `bun test` の組み込みモジュール bun:test の型（プロファイルが使ってよい API だけ）。
// 型パッケージ（@types/bun）は allowlist にないため、使う範囲だけをここで宣言する。
// 実行時は Bun 本体の実装が使われるので、ここにない API を使うと型エラーになる（追加はこのファイルに足す）。
// test.only / test.skip / test.todo などテストを外す API は ai-profile(test-focus) が禁止するので宣言しない。
declare module "bun:test" {
  type TestBody = () => void | Promise<void>;

  export function test(name: string, fn: TestBody): void;
  export function it(name: string, fn: TestBody): void;
  export function describe(name: string, fn: () => void): void;
  export function beforeEach(fn: TestBody): void;
  export function afterEach(fn: TestBody): void;

  interface Matchers<T> {
    readonly not: Matchers<T>;
    /** Object.is で比較する（プリミティブ・同一参照）。 */
    toBe(expected: T): void;
    /** 再帰的に値を比較する（undefined のプロパティは無視）。 */
    toEqual(expected: T): void;
    /** 再帰的に値を比較する（undefined のプロパティ・クラスも区別する）。 */
    toStrictEqual(expected: T): void;
    /** expected に書いたプロパティだけを再帰的に比較する。 */
    toMatchObject(expected: object): void;
    toHaveLength(length: number): void;
    toContain(item: unknown): void;
    toBeUndefined(): void;
    toBeTrue(): void;
    toBeFalse(): void;
  }

  interface AsyncMatchers {
    toEqual(expected: unknown): Promise<void>;
    /** reject の理由（ORPCError など）が expected のプロパティを持つ。 */
    toMatchObject(expected: object): Promise<void>;
  }

  interface Expect {
    <T>(actual: T): Matchers<T> & {
      readonly resolves: AsyncMatchers;
      readonly rejects: AsyncMatchers;
    };
    /** このテストで expect が count 回呼ばれることを要求する（分岐の取りこぼしを防ぐ）。 */
    assertions(count: number): void;
  }

  export const expect: Expect;
}
