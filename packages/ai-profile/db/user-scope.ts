// ユーザーが所有するデータへの唯一のアクセス手段。全てのクエリに `userId = <ログイン中のユーザー>` を必ず付ける。
// 生の DB（drizzle のインスタンス・createDb・Database 型）は ai-profile(user-scope) が境界ファイル以外での
// import を禁止するため、アプリのコードはこのアクセサ経由でしかデータに触れられない。
// 対象は userId 列（NOT NULL の文字列）を持つテーブルだけで、それ以外のテーブルを渡すと型エラーになる。
import {
  type AnyRelations,
  and,
  eq,
  type InferInsertModel,
  type InferSelectModel,
  type SQL,
} from "drizzle-orm";
import type {
  AnySQLiteColumn,
  SQLiteAsyncDatabase,
  SQLiteTable,
  SQLiteUpdateSetSource,
} from "drizzle-orm/sqlite-core";

import { err, type Result, tryCatchAsync } from "../core/result";

/** 所有者を表す `userId` 列を持つテーブル。 */
export type UserOwnedTable = SQLiteTable & {
  readonly userId: AnySQLiteColumn<{ data: string; notNull: true }>;
};

/** 別のユーザーの userId を書き込もうとした。 */
export type OwnerMismatch = { readonly type: "OwnerMismatch"; readonly message: string };
/** クエリの実行に失敗した。 */
export type DatabaseError = { readonly type: "DatabaseError"; readonly message: string };
export type DataAccessError = OwnerMismatch | DatabaseError;

type Rows<T extends UserOwnedTable> = Promise<Result<InferSelectModel<T>[], DataAccessError>>;
/** 書き込んだ行数。 */
type Count = Promise<Result<number, DataAccessError>>;

export type UserScopedDb = {
  /** このアクセサが読み書きできるデータの所有者。insert の値の userId にはこれを渡す。 */
  readonly userId: string;
  /** 所有者の行のうち where に合うものを返す。 */
  select<T extends UserOwnedTable>(table: T, where?: SQL): Rows<T>;
  /** 1行追加する。values.userId が所有者と違えば OwnerMismatch。 */
  insert<T extends UserOwnedTable>(table: T, values: InferInsertModel<T>): Count;
  /** 所有者の行のうち where に合うものを更新する。userId を別のユーザーに変えようとすると OwnerMismatch。 */
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
  return {
    userId,
    select: (table, where) =>
      tryCatchAsync(() => db.select().from(table).where(owned(table, where)), databaseError),
    insert: async (table, values) => {
      if (Reflect.get(values, "userId") !== userId) {
        return err(ownerMismatch(userId));
      }
      return count(() => db.insert(table).values(values).returning({ userId: table.userId }));
    },
    update: async (table, set, where) => {
      if (Reflect.has(set, "userId") && Reflect.get(set, "userId") !== userId) {
        return err(ownerMismatch(userId));
      }
      return count(() =>
        db.update(table).set(set).where(owned(table, where)).returning({ userId: table.userId }),
      );
    },
    delete: (table, where) =>
      count(() => db.delete(table).where(owned(table, where)).returning({ userId: table.userId })),
  };
}
