// ユーザーが所有するデータへの唯一のアクセス手段。全てのクエリに `userId = <ログイン中のユーザー>` を必ず付ける。
// 生の DB（drizzle のインスタンス・createDb・Database 型）は ai-profile(user-scope) が境界ファイル以外での
// import を禁止するため、アプリのコードはこのアクセサ経由でしかデータに触れられない。
// 対象は userId 列（NOT NULL の文字列）を持つテーブルだけで、それ以外のテーブルを渡すと型エラーになる。
//
// 他のテーブルの行を参照する列（todo_tag.todo_id など）は、userId を付けるだけでは守れない
// （自分の行から他人の todo を指せてしまう = IDOR）。そこで二重に塞ぐ:
// - 型: スキーマで参照列を `OwnedId<"todo">` にし、その値は `data.own(todo, id)` でしか作れないようにする。
// - 実行時: insert・update は外部キーの参照先が userId を持つテーブルなら、所有者の行であることを確かめる。
import {
  type AnyRelations,
  and,
  Column,
  eq,
  getTableColumns,
  type InferInsertModel,
  type InferSelectModel,
  is,
  type SQL,
} from "drizzle-orm";
import {
  type AnySQLiteColumn,
  getTableConfig,
  type SQLiteAsyncDatabase,
  type SQLiteTable,
  type SQLiteUpdateSetSource,
} from "drizzle-orm/sqlite-core";

import { err, ok, type Result, tryCatchAsync } from "../core/result";

/** 所有者を表す `userId` 列を持つテーブル。 */
export type UserOwnedTable = SQLiteTable & {
  readonly userId: AnySQLiteColumn<{ data: string; notNull: true }>;
};

declare const ownedBrand: unique symbol;
/**
 * テーブル TTable（SQL のテーブル名）の行のうち、スコープの所有者のものだと確かめた id。
 * 作れるのは `data.own` だけ。スキーマの参照列を `.$type<OwnedId<"todo">>()` にすると、
 * 外部入力の id（ただの string）をそのまま insert・update・where に渡すと型エラーになる。
 */
export type OwnedId<TTable extends string> = string & { readonly [ownedBrand]: TTable };

/** 文字列の主キー `id` を持つ、ユーザーが所有するテーブル。`data.own` に渡せる。 */
export type OwnedTable = UserOwnedTable & {
  readonly id: AnySQLiteColumn<{ data: string; notNull: true }>;
};

/** 別のユーザーの userId を書き込もうとした。 */
export type OwnerMismatch = { readonly type: "OwnerMismatch"; readonly message: string };
/** クエリの実行に失敗した。 */
export type DatabaseError = { readonly type: "DatabaseError"; readonly message: string };
/** 参照先の行が無いか、別のユーザーのもの（区別しない = 他人の id の存在を漏らさない）。 */
export type NotOwned = { readonly type: "NotOwned"; readonly message: string };
export type DataAccessError = OwnerMismatch | NotOwned | DatabaseError;

type Rows<T extends UserOwnedTable> = Promise<Result<InferSelectModel<T>[], DataAccessError>>;
/** 書き込んだ行数。 */
type Count = Promise<Result<number, DataAccessError>>;

export type UserScopedDb = {
  /** このアクセサが読み書きできるデータの所有者。insert の値の userId にはこれを渡す。 */
  readonly userId: string;
  /** 所有者の行のうち where に合うものを返す。 */
  select<T extends UserOwnedTable>(table: T, where?: SQL): Rows<T>;
  /** id が所有者の table の行なら OwnedId にして返す。無い・他人の行なら NotOwned。 */
  own<T extends OwnedTable>(
    table: T,
    id: string,
  ): Promise<Result<OwnedId<T["_"]["name"]>, NotOwned | DatabaseError>>;
  /**
   * 1行追加する。values.userId が所有者と違えば OwnerMismatch。
   * 外部キーの参照先が他のユーザーの行（または存在しない行）なら NotOwned。
   */
  insert<T extends UserOwnedTable>(table: T, values: InferInsertModel<T>): Count;
  /**
   * 所有者の行のうち where に合うものを更新する。userId を別のユーザーに変えようとすると OwnerMismatch。
   * 外部キーの列を他のユーザーの行（または存在しない行）に向けると NotOwned。
   */
  update<T extends UserOwnedTable>(table: T, set: SQLiteUpdateSetSource<T>, where?: SQL): Count;
  /** 所有者の行のうち where に合うものを削除する。 */
  delete<T extends UserOwnedTable>(table: T, where?: SQL): Count;
};

function databaseError(cause: unknown): DatabaseError {
  return { type: "DatabaseError", message: cause instanceof Error ? cause.message : String(cause) };
}

function ownerMismatch(userId: string): OwnerMismatch {
  return { type: "OwnerMismatch", message: `userId must be the scope owner (${userId}).` };
}

function notOwned(message: string): NotOwned {
  return { type: "NotOwned", message };
}

/** 行が見つかった id だけを OwnedId と認める（見つからなければ false）。 */
function isFound<TTable extends string>(
  rows: readonly unknown[],
  _id: string,
): _id is OwnedId<TTable> {
  return rows.length > 0;
}

/** 外部キーのうち、参照先が所有者を持つテーブル（userId 列がある）のもの。値の取り出しに使う JS のキーも返す。 */
function ownedReferences(table: SQLiteTable) {
  const keys = new Map(
    Object.entries(getTableColumns(table)).map(([key, column]) => [column, key]),
  );
  return getTableConfig(table).foreignKeys.flatMap((foreignKey) => {
    const { columns, foreignColumns, foreignTable } = foreignKey.reference();
    const owner: unknown = Reflect.get(foreignTable, "userId");
    if (!is(owner, Column)) {
      return [];
    }
    const pairs = columns.flatMap((column, index) => {
      const key = keys.get(column);
      const foreign = foreignColumns[index];
      return key === undefined || foreign === undefined ? [] : [{ key, column, foreign }];
    });
    return [{ foreignTable, owner, pairs }];
  });
}

/**
 * db を userId のユーザーに限定したアクセサにする。
 * userId は認証済みセッションから取ること。呼び出せるのは lint/data-access-boundaries.mjs の境界ファイルだけ。
 */
export function userScoped<TRunResult, TRelations extends AnyRelations>(
  db: SQLiteAsyncDatabase<"async", TRunResult, TRelations>,
  userId: string,
): UserScopedDb {
  const owned = (table: UserOwnedTable, where: SQL | undefined) =>
    and(eq(table.userId, userId), where);
  // 書き込みは所有者列だけを returning して行数を返す（行全体の型は汎用には表せないため）。
  const count = (written: () => Promise<readonly unknown[]>): Count =>
    tryCatchAsync(async () => (await written()).length, databaseError);
  /**
   * values（insert の値か update の set）が外部キーで指す行が、全て所有者のものかを確かめる。
   * 値を指定していない（undefined）・null の参照は書き込まないので確かめない。
   */
  const referencesOwned = async (
    table: SQLiteTable,
    values: object,
  ): Promise<Result<true, NotOwned | DatabaseError>> => {
    for (const { foreignTable, owner, pairs } of ownedReferences(table)) {
      const given = pairs.map((pair) => {
        const value: unknown = Reflect.get(values, pair.key);
        return { ...pair, value };
      });
      if (given.length === 0 || given.some(({ value }) => value === undefined || value === null)) {
        continue;
      }
      const found = await tryCatchAsync(
        () =>
          db
            .select({ owner })
            .from(foreignTable)
            .where(and(eq(owner, userId), ...given.map(({ foreign, value }) => eq(foreign, value))))
            .limit(1),
        databaseError,
      );
      if (!found.ok) {
        return found;
      }
      if (found.value.length === 0) {
        const columns = given.map(({ column }) => column.name).join(", ");
        return err(
          notOwned(
            `${getTableConfig(table).name}.${columns} must reference a row owned by the scope owner. ` +
              "Pass an id returned by data.own(table, id).",
          ),
        );
      }
    }
    return ok(true);
  };
  return {
    userId,
    select: (table, where) =>
      tryCatchAsync(() => db.select().from(table).where(owned(table, where)), databaseError),
    own: async (table, id) => {
      const rows = await tryCatchAsync(
        () =>
          db
            .select({ id: table.id })
            .from(table)
            .where(owned(table, eq(table.id, id)))
            .limit(1),
        databaseError,
      );
      if (!rows.ok) {
        return rows;
      }
      return isFound(rows.value, id)
        ? ok(id)
        : err(
            notOwned(
              `No ${getTableConfig(table).name} row with this id is owned by the scope owner.`,
            ),
          );
    },
    insert: async (table, values) => {
      if (Reflect.get(values, "userId") !== userId) {
        return err(ownerMismatch(userId));
      }
      const references = await referencesOwned(table, values);
      if (!references.ok) {
        return references;
      }
      return count(() => db.insert(table).values(values).returning({ userId: table.userId }));
    },
    update: async (table, set, where) => {
      if (Reflect.has(set, "userId") && Reflect.get(set, "userId") !== userId) {
        return err(ownerMismatch(userId));
      }
      const references = await referencesOwned(table, set);
      if (!references.ok) {
        return references;
      }
      return count(() =>
        db.update(table).set(set).where(owned(table, where)).returning({ userId: table.userId }),
      );
    },
    delete: (table, where) =>
      count(() => db.delete(table).where(owned(table, where)).returning({ userId: table.userId })),
  };
}
