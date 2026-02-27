
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model Tenant
 * 
 */
export type Tenant = $Result.DefaultSelection<Prisma.$TenantPayload>
/**
 * Model User
 * 
 */
export type User = $Result.DefaultSelection<Prisma.$UserPayload>
/**
 * Model Borrower
 * 
 */
export type Borrower = $Result.DefaultSelection<Prisma.$BorrowerPayload>
/**
 * Model Loan
 * 
 */
export type Loan = $Result.DefaultSelection<Prisma.$LoanPayload>
/**
 * Model RepaymentSchedule
 * 
 */
export type RepaymentSchedule = $Result.DefaultSelection<Prisma.$RepaymentSchedulePayload>
/**
 * Model Repayment
 * 
 */
export type Repayment = $Result.DefaultSelection<Prisma.$RepaymentPayload>
/**
 * Model AuditLog
 * 
 */
export type AuditLog = $Result.DefaultSelection<Prisma.$AuditLogPayload>

/**
 * Enums
 */
export namespace $Enums {
  export const Role: {
  ADMIN: 'ADMIN',
  OPS: 'OPS',
  AUDITOR: 'AUDITOR'
};

export type Role = (typeof Role)[keyof typeof Role]


export const LoanStatus: {
  DRAFT: 'DRAFT',
  DISBURSED: 'DISBURSED',
  CLOSED: 'CLOSED',
  DEFAULTED: 'DEFAULTED'
};

export type LoanStatus = (typeof LoanStatus)[keyof typeof LoanStatus]


export const InterestMethod: {
  FLAT: 'FLAT',
  REDUCING_BALANCE: 'REDUCING_BALANCE'
};

export type InterestMethod = (typeof InterestMethod)[keyof typeof InterestMethod]

}

export type Role = $Enums.Role

export const Role: typeof $Enums.Role

export type LoanStatus = $Enums.LoanStatus

export const LoanStatus: typeof $Enums.LoanStatus

export type InterestMethod = $Enums.InterestMethod

export const InterestMethod: typeof $Enums.InterestMethod

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Tenants
 * const tenants = await prisma.tenant.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Tenants
   * const tenants = await prisma.tenant.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb, ExtArgs>

      /**
   * `prisma.tenant`: Exposes CRUD operations for the **Tenant** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Tenants
    * const tenants = await prisma.tenant.findMany()
    * ```
    */
  get tenant(): Prisma.TenantDelegate<ExtArgs>;

  /**
   * `prisma.user`: Exposes CRUD operations for the **User** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Users
    * const users = await prisma.user.findMany()
    * ```
    */
  get user(): Prisma.UserDelegate<ExtArgs>;

  /**
   * `prisma.borrower`: Exposes CRUD operations for the **Borrower** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Borrowers
    * const borrowers = await prisma.borrower.findMany()
    * ```
    */
  get borrower(): Prisma.BorrowerDelegate<ExtArgs>;

  /**
   * `prisma.loan`: Exposes CRUD operations for the **Loan** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Loans
    * const loans = await prisma.loan.findMany()
    * ```
    */
  get loan(): Prisma.LoanDelegate<ExtArgs>;

  /**
   * `prisma.repaymentSchedule`: Exposes CRUD operations for the **RepaymentSchedule** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more RepaymentSchedules
    * const repaymentSchedules = await prisma.repaymentSchedule.findMany()
    * ```
    */
  get repaymentSchedule(): Prisma.RepaymentScheduleDelegate<ExtArgs>;

  /**
   * `prisma.repayment`: Exposes CRUD operations for the **Repayment** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Repayments
    * const repayments = await prisma.repayment.findMany()
    * ```
    */
  get repayment(): Prisma.RepaymentDelegate<ExtArgs>;

  /**
   * `prisma.auditLog`: Exposes CRUD operations for the **AuditLog** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more AuditLogs
    * const auditLogs = await prisma.auditLog.findMany()
    * ```
    */
  get auditLog(): Prisma.AuditLogDelegate<ExtArgs>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 5.22.0
   * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    Tenant: 'Tenant',
    User: 'User',
    Borrower: 'Borrower',
    Loan: 'Loan',
    RepaymentSchedule: 'RepaymentSchedule',
    Repayment: 'Repayment',
    AuditLog: 'AuditLog'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb extends $Utils.Fn<{extArgs: $Extensions.InternalArgs, clientOptions: PrismaClientOptions }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], this['params']['clientOptions']>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, ClientOptions = {}> = {
    meta: {
      modelProps: "tenant" | "user" | "borrower" | "loan" | "repaymentSchedule" | "repayment" | "auditLog"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      Tenant: {
        payload: Prisma.$TenantPayload<ExtArgs>
        fields: Prisma.TenantFieldRefs
        operations: {
          findUnique: {
            args: Prisma.TenantFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.TenantFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          findFirst: {
            args: Prisma.TenantFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.TenantFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          findMany: {
            args: Prisma.TenantFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>[]
          }
          create: {
            args: Prisma.TenantCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          createMany: {
            args: Prisma.TenantCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.TenantCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>[]
          }
          delete: {
            args: Prisma.TenantDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          update: {
            args: Prisma.TenantUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          deleteMany: {
            args: Prisma.TenantDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.TenantUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.TenantUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$TenantPayload>
          }
          aggregate: {
            args: Prisma.TenantAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateTenant>
          }
          groupBy: {
            args: Prisma.TenantGroupByArgs<ExtArgs>
            result: $Utils.Optional<TenantGroupByOutputType>[]
          }
          count: {
            args: Prisma.TenantCountArgs<ExtArgs>
            result: $Utils.Optional<TenantCountAggregateOutputType> | number
          }
        }
      }
      User: {
        payload: Prisma.$UserPayload<ExtArgs>
        fields: Prisma.UserFieldRefs
        operations: {
          findUnique: {
            args: Prisma.UserFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.UserFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findFirst: {
            args: Prisma.UserFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.UserFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          findMany: {
            args: Prisma.UserFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          create: {
            args: Prisma.UserCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          createMany: {
            args: Prisma.UserCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.UserCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>[]
          }
          delete: {
            args: Prisma.UserDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          update: {
            args: Prisma.UserUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          deleteMany: {
            args: Prisma.UserDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.UserUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.UserUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$UserPayload>
          }
          aggregate: {
            args: Prisma.UserAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateUser>
          }
          groupBy: {
            args: Prisma.UserGroupByArgs<ExtArgs>
            result: $Utils.Optional<UserGroupByOutputType>[]
          }
          count: {
            args: Prisma.UserCountArgs<ExtArgs>
            result: $Utils.Optional<UserCountAggregateOutputType> | number
          }
        }
      }
      Borrower: {
        payload: Prisma.$BorrowerPayload<ExtArgs>
        fields: Prisma.BorrowerFieldRefs
        operations: {
          findUnique: {
            args: Prisma.BorrowerFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BorrowerPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.BorrowerFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BorrowerPayload>
          }
          findFirst: {
            args: Prisma.BorrowerFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BorrowerPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.BorrowerFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BorrowerPayload>
          }
          findMany: {
            args: Prisma.BorrowerFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BorrowerPayload>[]
          }
          create: {
            args: Prisma.BorrowerCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BorrowerPayload>
          }
          createMany: {
            args: Prisma.BorrowerCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.BorrowerCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BorrowerPayload>[]
          }
          delete: {
            args: Prisma.BorrowerDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BorrowerPayload>
          }
          update: {
            args: Prisma.BorrowerUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BorrowerPayload>
          }
          deleteMany: {
            args: Prisma.BorrowerDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.BorrowerUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.BorrowerUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$BorrowerPayload>
          }
          aggregate: {
            args: Prisma.BorrowerAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateBorrower>
          }
          groupBy: {
            args: Prisma.BorrowerGroupByArgs<ExtArgs>
            result: $Utils.Optional<BorrowerGroupByOutputType>[]
          }
          count: {
            args: Prisma.BorrowerCountArgs<ExtArgs>
            result: $Utils.Optional<BorrowerCountAggregateOutputType> | number
          }
        }
      }
      Loan: {
        payload: Prisma.$LoanPayload<ExtArgs>
        fields: Prisma.LoanFieldRefs
        operations: {
          findUnique: {
            args: Prisma.LoanFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LoanPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.LoanFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LoanPayload>
          }
          findFirst: {
            args: Prisma.LoanFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LoanPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.LoanFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LoanPayload>
          }
          findMany: {
            args: Prisma.LoanFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LoanPayload>[]
          }
          create: {
            args: Prisma.LoanCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LoanPayload>
          }
          createMany: {
            args: Prisma.LoanCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.LoanCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LoanPayload>[]
          }
          delete: {
            args: Prisma.LoanDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LoanPayload>
          }
          update: {
            args: Prisma.LoanUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LoanPayload>
          }
          deleteMany: {
            args: Prisma.LoanDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.LoanUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.LoanUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$LoanPayload>
          }
          aggregate: {
            args: Prisma.LoanAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateLoan>
          }
          groupBy: {
            args: Prisma.LoanGroupByArgs<ExtArgs>
            result: $Utils.Optional<LoanGroupByOutputType>[]
          }
          count: {
            args: Prisma.LoanCountArgs<ExtArgs>
            result: $Utils.Optional<LoanCountAggregateOutputType> | number
          }
        }
      }
      RepaymentSchedule: {
        payload: Prisma.$RepaymentSchedulePayload<ExtArgs>
        fields: Prisma.RepaymentScheduleFieldRefs
        operations: {
          findUnique: {
            args: Prisma.RepaymentScheduleFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentSchedulePayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.RepaymentScheduleFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentSchedulePayload>
          }
          findFirst: {
            args: Prisma.RepaymentScheduleFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentSchedulePayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.RepaymentScheduleFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentSchedulePayload>
          }
          findMany: {
            args: Prisma.RepaymentScheduleFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentSchedulePayload>[]
          }
          create: {
            args: Prisma.RepaymentScheduleCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentSchedulePayload>
          }
          createMany: {
            args: Prisma.RepaymentScheduleCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.RepaymentScheduleCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentSchedulePayload>[]
          }
          delete: {
            args: Prisma.RepaymentScheduleDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentSchedulePayload>
          }
          update: {
            args: Prisma.RepaymentScheduleUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentSchedulePayload>
          }
          deleteMany: {
            args: Prisma.RepaymentScheduleDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.RepaymentScheduleUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.RepaymentScheduleUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentSchedulePayload>
          }
          aggregate: {
            args: Prisma.RepaymentScheduleAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateRepaymentSchedule>
          }
          groupBy: {
            args: Prisma.RepaymentScheduleGroupByArgs<ExtArgs>
            result: $Utils.Optional<RepaymentScheduleGroupByOutputType>[]
          }
          count: {
            args: Prisma.RepaymentScheduleCountArgs<ExtArgs>
            result: $Utils.Optional<RepaymentScheduleCountAggregateOutputType> | number
          }
        }
      }
      Repayment: {
        payload: Prisma.$RepaymentPayload<ExtArgs>
        fields: Prisma.RepaymentFieldRefs
        operations: {
          findUnique: {
            args: Prisma.RepaymentFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.RepaymentFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentPayload>
          }
          findFirst: {
            args: Prisma.RepaymentFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.RepaymentFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentPayload>
          }
          findMany: {
            args: Prisma.RepaymentFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentPayload>[]
          }
          create: {
            args: Prisma.RepaymentCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentPayload>
          }
          createMany: {
            args: Prisma.RepaymentCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.RepaymentCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentPayload>[]
          }
          delete: {
            args: Prisma.RepaymentDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentPayload>
          }
          update: {
            args: Prisma.RepaymentUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentPayload>
          }
          deleteMany: {
            args: Prisma.RepaymentDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.RepaymentUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.RepaymentUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$RepaymentPayload>
          }
          aggregate: {
            args: Prisma.RepaymentAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateRepayment>
          }
          groupBy: {
            args: Prisma.RepaymentGroupByArgs<ExtArgs>
            result: $Utils.Optional<RepaymentGroupByOutputType>[]
          }
          count: {
            args: Prisma.RepaymentCountArgs<ExtArgs>
            result: $Utils.Optional<RepaymentCountAggregateOutputType> | number
          }
        }
      }
      AuditLog: {
        payload: Prisma.$AuditLogPayload<ExtArgs>
        fields: Prisma.AuditLogFieldRefs
        operations: {
          findUnique: {
            args: Prisma.AuditLogFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.AuditLogFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          findFirst: {
            args: Prisma.AuditLogFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.AuditLogFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          findMany: {
            args: Prisma.AuditLogFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>[]
          }
          create: {
            args: Prisma.AuditLogCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          createMany: {
            args: Prisma.AuditLogCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.AuditLogCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>[]
          }
          delete: {
            args: Prisma.AuditLogDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          update: {
            args: Prisma.AuditLogUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          deleteMany: {
            args: Prisma.AuditLogDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.AuditLogUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.AuditLogUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$AuditLogPayload>
          }
          aggregate: {
            args: Prisma.AuditLogAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAuditLog>
          }
          groupBy: {
            args: Prisma.AuditLogGroupByArgs<ExtArgs>
            result: $Utils.Optional<AuditLogGroupByOutputType>[]
          }
          count: {
            args: Prisma.AuditLogCountArgs<ExtArgs>
            result: $Utils.Optional<AuditLogCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
  }


  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */


  /**
   * Count Type TenantCountOutputType
   */

  export type TenantCountOutputType = {
    users: number
    borrowers: number
    loans: number
    repayments: number
    auditLogs: number
  }

  export type TenantCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    users?: boolean | TenantCountOutputTypeCountUsersArgs
    borrowers?: boolean | TenantCountOutputTypeCountBorrowersArgs
    loans?: boolean | TenantCountOutputTypeCountLoansArgs
    repayments?: boolean | TenantCountOutputTypeCountRepaymentsArgs
    auditLogs?: boolean | TenantCountOutputTypeCountAuditLogsArgs
  }

  // Custom InputTypes
  /**
   * TenantCountOutputType without action
   */
  export type TenantCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the TenantCountOutputType
     */
    select?: TenantCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * TenantCountOutputType without action
   */
  export type TenantCountOutputTypeCountUsersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserWhereInput
  }

  /**
   * TenantCountOutputType without action
   */
  export type TenantCountOutputTypeCountBorrowersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: BorrowerWhereInput
  }

  /**
   * TenantCountOutputType without action
   */
  export type TenantCountOutputTypeCountLoansArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: LoanWhereInput
  }

  /**
   * TenantCountOutputType without action
   */
  export type TenantCountOutputTypeCountRepaymentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: RepaymentWhereInput
  }

  /**
   * TenantCountOutputType without action
   */
  export type TenantCountOutputTypeCountAuditLogsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AuditLogWhereInput
  }


  /**
   * Count Type UserCountOutputType
   */

  export type UserCountOutputType = {
    auditLogs: number
  }

  export type UserCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    auditLogs?: boolean | UserCountOutputTypeCountAuditLogsArgs
  }

  // Custom InputTypes
  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the UserCountOutputType
     */
    select?: UserCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * UserCountOutputType without action
   */
  export type UserCountOutputTypeCountAuditLogsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AuditLogWhereInput
  }


  /**
   * Count Type BorrowerCountOutputType
   */

  export type BorrowerCountOutputType = {
    loans: number
  }

  export type BorrowerCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    loans?: boolean | BorrowerCountOutputTypeCountLoansArgs
  }

  // Custom InputTypes
  /**
   * BorrowerCountOutputType without action
   */
  export type BorrowerCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the BorrowerCountOutputType
     */
    select?: BorrowerCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * BorrowerCountOutputType without action
   */
  export type BorrowerCountOutputTypeCountLoansArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: LoanWhereInput
  }


  /**
   * Count Type LoanCountOutputType
   */

  export type LoanCountOutputType = {
    schedules: number
    repayments: number
  }

  export type LoanCountOutputTypeSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    schedules?: boolean | LoanCountOutputTypeCountSchedulesArgs
    repayments?: boolean | LoanCountOutputTypeCountRepaymentsArgs
  }

  // Custom InputTypes
  /**
   * LoanCountOutputType without action
   */
  export type LoanCountOutputTypeDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the LoanCountOutputType
     */
    select?: LoanCountOutputTypeSelect<ExtArgs> | null
  }

  /**
   * LoanCountOutputType without action
   */
  export type LoanCountOutputTypeCountSchedulesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: RepaymentScheduleWhereInput
  }

  /**
   * LoanCountOutputType without action
   */
  export type LoanCountOutputTypeCountRepaymentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: RepaymentWhereInput
  }


  /**
   * Models
   */

  /**
   * Model Tenant
   */

  export type AggregateTenant = {
    _count: TenantCountAggregateOutputType | null
    _min: TenantMinAggregateOutputType | null
    _max: TenantMaxAggregateOutputType | null
  }

  export type TenantMinAggregateOutputType = {
    id: string | null
    name: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TenantMaxAggregateOutputType = {
    id: string | null
    name: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type TenantCountAggregateOutputType = {
    id: number
    name: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type TenantMinAggregateInputType = {
    id?: true
    name?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TenantMaxAggregateInputType = {
    id?: true
    name?: true
    createdAt?: true
    updatedAt?: true
  }

  export type TenantCountAggregateInputType = {
    id?: true
    name?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type TenantAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Tenant to aggregate.
     */
    where?: TenantWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tenants to fetch.
     */
    orderBy?: TenantOrderByWithRelationInput | TenantOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: TenantWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tenants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tenants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Tenants
    **/
    _count?: true | TenantCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: TenantMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: TenantMaxAggregateInputType
  }

  export type GetTenantAggregateType<T extends TenantAggregateArgs> = {
        [P in keyof T & keyof AggregateTenant]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateTenant[P]>
      : GetScalarType<T[P], AggregateTenant[P]>
  }




  export type TenantGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: TenantWhereInput
    orderBy?: TenantOrderByWithAggregationInput | TenantOrderByWithAggregationInput[]
    by: TenantScalarFieldEnum[] | TenantScalarFieldEnum
    having?: TenantScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: TenantCountAggregateInputType | true
    _min?: TenantMinAggregateInputType
    _max?: TenantMaxAggregateInputType
  }

  export type TenantGroupByOutputType = {
    id: string
    name: string
    createdAt: Date
    updatedAt: Date
    _count: TenantCountAggregateOutputType | null
    _min: TenantMinAggregateOutputType | null
    _max: TenantMaxAggregateOutputType | null
  }

  type GetTenantGroupByPayload<T extends TenantGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<TenantGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof TenantGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], TenantGroupByOutputType[P]>
            : GetScalarType<T[P], TenantGroupByOutputType[P]>
        }
      >
    >


  export type TenantSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    users?: boolean | Tenant$usersArgs<ExtArgs>
    borrowers?: boolean | Tenant$borrowersArgs<ExtArgs>
    loans?: boolean | Tenant$loansArgs<ExtArgs>
    repayments?: boolean | Tenant$repaymentsArgs<ExtArgs>
    auditLogs?: boolean | Tenant$auditLogsArgs<ExtArgs>
    _count?: boolean | TenantCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["tenant"]>

  export type TenantSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["tenant"]>

  export type TenantSelectScalar = {
    id?: boolean
    name?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type TenantInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    users?: boolean | Tenant$usersArgs<ExtArgs>
    borrowers?: boolean | Tenant$borrowersArgs<ExtArgs>
    loans?: boolean | Tenant$loansArgs<ExtArgs>
    repayments?: boolean | Tenant$repaymentsArgs<ExtArgs>
    auditLogs?: boolean | Tenant$auditLogsArgs<ExtArgs>
    _count?: boolean | TenantCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type TenantIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {}

  export type $TenantPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Tenant"
    objects: {
      users: Prisma.$UserPayload<ExtArgs>[]
      borrowers: Prisma.$BorrowerPayload<ExtArgs>[]
      loans: Prisma.$LoanPayload<ExtArgs>[]
      repayments: Prisma.$RepaymentPayload<ExtArgs>[]
      auditLogs: Prisma.$AuditLogPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["tenant"]>
    composites: {}
  }

  type TenantGetPayload<S extends boolean | null | undefined | TenantDefaultArgs> = $Result.GetResult<Prisma.$TenantPayload, S>

  type TenantCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<TenantFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: TenantCountAggregateInputType | true
    }

  export interface TenantDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Tenant'], meta: { name: 'Tenant' } }
    /**
     * Find zero or one Tenant that matches the filter.
     * @param {TenantFindUniqueArgs} args - Arguments to find a Tenant
     * @example
     * // Get one Tenant
     * const tenant = await prisma.tenant.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends TenantFindUniqueArgs>(args: SelectSubset<T, TenantFindUniqueArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Tenant that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {TenantFindUniqueOrThrowArgs} args - Arguments to find a Tenant
     * @example
     * // Get one Tenant
     * const tenant = await prisma.tenant.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends TenantFindUniqueOrThrowArgs>(args: SelectSubset<T, TenantFindUniqueOrThrowArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Tenant that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantFindFirstArgs} args - Arguments to find a Tenant
     * @example
     * // Get one Tenant
     * const tenant = await prisma.tenant.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends TenantFindFirstArgs>(args?: SelectSubset<T, TenantFindFirstArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Tenant that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantFindFirstOrThrowArgs} args - Arguments to find a Tenant
     * @example
     * // Get one Tenant
     * const tenant = await prisma.tenant.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends TenantFindFirstOrThrowArgs>(args?: SelectSubset<T, TenantFindFirstOrThrowArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Tenants that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Tenants
     * const tenants = await prisma.tenant.findMany()
     * 
     * // Get first 10 Tenants
     * const tenants = await prisma.tenant.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const tenantWithIdOnly = await prisma.tenant.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends TenantFindManyArgs>(args?: SelectSubset<T, TenantFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Tenant.
     * @param {TenantCreateArgs} args - Arguments to create a Tenant.
     * @example
     * // Create one Tenant
     * const Tenant = await prisma.tenant.create({
     *   data: {
     *     // ... data to create a Tenant
     *   }
     * })
     * 
     */
    create<T extends TenantCreateArgs>(args: SelectSubset<T, TenantCreateArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Tenants.
     * @param {TenantCreateManyArgs} args - Arguments to create many Tenants.
     * @example
     * // Create many Tenants
     * const tenant = await prisma.tenant.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends TenantCreateManyArgs>(args?: SelectSubset<T, TenantCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Tenants and returns the data saved in the database.
     * @param {TenantCreateManyAndReturnArgs} args - Arguments to create many Tenants.
     * @example
     * // Create many Tenants
     * const tenant = await prisma.tenant.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Tenants and only return the `id`
     * const tenantWithIdOnly = await prisma.tenant.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends TenantCreateManyAndReturnArgs>(args?: SelectSubset<T, TenantCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Tenant.
     * @param {TenantDeleteArgs} args - Arguments to delete one Tenant.
     * @example
     * // Delete one Tenant
     * const Tenant = await prisma.tenant.delete({
     *   where: {
     *     // ... filter to delete one Tenant
     *   }
     * })
     * 
     */
    delete<T extends TenantDeleteArgs>(args: SelectSubset<T, TenantDeleteArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Tenant.
     * @param {TenantUpdateArgs} args - Arguments to update one Tenant.
     * @example
     * // Update one Tenant
     * const tenant = await prisma.tenant.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends TenantUpdateArgs>(args: SelectSubset<T, TenantUpdateArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Tenants.
     * @param {TenantDeleteManyArgs} args - Arguments to filter Tenants to delete.
     * @example
     * // Delete a few Tenants
     * const { count } = await prisma.tenant.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends TenantDeleteManyArgs>(args?: SelectSubset<T, TenantDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Tenants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Tenants
     * const tenant = await prisma.tenant.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends TenantUpdateManyArgs>(args: SelectSubset<T, TenantUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Tenant.
     * @param {TenantUpsertArgs} args - Arguments to update or create a Tenant.
     * @example
     * // Update or create a Tenant
     * const tenant = await prisma.tenant.upsert({
     *   create: {
     *     // ... data to create a Tenant
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Tenant we want to update
     *   }
     * })
     */
    upsert<T extends TenantUpsertArgs>(args: SelectSubset<T, TenantUpsertArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Tenants.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantCountArgs} args - Arguments to filter Tenants to count.
     * @example
     * // Count the number of Tenants
     * const count = await prisma.tenant.count({
     *   where: {
     *     // ... the filter for the Tenants we want to count
     *   }
     * })
    **/
    count<T extends TenantCountArgs>(
      args?: Subset<T, TenantCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], TenantCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Tenant.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends TenantAggregateArgs>(args: Subset<T, TenantAggregateArgs>): Prisma.PrismaPromise<GetTenantAggregateType<T>>

    /**
     * Group by Tenant.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {TenantGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends TenantGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: TenantGroupByArgs['orderBy'] }
        : { orderBy?: TenantGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, TenantGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetTenantGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Tenant model
   */
  readonly fields: TenantFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Tenant.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__TenantClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    users<T extends Tenant$usersArgs<ExtArgs> = {}>(args?: Subset<T, Tenant$usersArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findMany"> | Null>
    borrowers<T extends Tenant$borrowersArgs<ExtArgs> = {}>(args?: Subset<T, Tenant$borrowersArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "findMany"> | Null>
    loans<T extends Tenant$loansArgs<ExtArgs> = {}>(args?: Subset<T, Tenant$loansArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "findMany"> | Null>
    repayments<T extends Tenant$repaymentsArgs<ExtArgs> = {}>(args?: Subset<T, Tenant$repaymentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "findMany"> | Null>
    auditLogs<T extends Tenant$auditLogsArgs<ExtArgs> = {}>(args?: Subset<T, Tenant$auditLogsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Tenant model
   */ 
  interface TenantFieldRefs {
    readonly id: FieldRef<"Tenant", 'String'>
    readonly name: FieldRef<"Tenant", 'String'>
    readonly createdAt: FieldRef<"Tenant", 'DateTime'>
    readonly updatedAt: FieldRef<"Tenant", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Tenant findUnique
   */
  export type TenantFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter, which Tenant to fetch.
     */
    where: TenantWhereUniqueInput
  }

  /**
   * Tenant findUniqueOrThrow
   */
  export type TenantFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter, which Tenant to fetch.
     */
    where: TenantWhereUniqueInput
  }

  /**
   * Tenant findFirst
   */
  export type TenantFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter, which Tenant to fetch.
     */
    where?: TenantWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tenants to fetch.
     */
    orderBy?: TenantOrderByWithRelationInput | TenantOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Tenants.
     */
    cursor?: TenantWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tenants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tenants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Tenants.
     */
    distinct?: TenantScalarFieldEnum | TenantScalarFieldEnum[]
  }

  /**
   * Tenant findFirstOrThrow
   */
  export type TenantFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter, which Tenant to fetch.
     */
    where?: TenantWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tenants to fetch.
     */
    orderBy?: TenantOrderByWithRelationInput | TenantOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Tenants.
     */
    cursor?: TenantWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tenants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tenants.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Tenants.
     */
    distinct?: TenantScalarFieldEnum | TenantScalarFieldEnum[]
  }

  /**
   * Tenant findMany
   */
  export type TenantFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter, which Tenants to fetch.
     */
    where?: TenantWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Tenants to fetch.
     */
    orderBy?: TenantOrderByWithRelationInput | TenantOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Tenants.
     */
    cursor?: TenantWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Tenants from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Tenants.
     */
    skip?: number
    distinct?: TenantScalarFieldEnum | TenantScalarFieldEnum[]
  }

  /**
   * Tenant create
   */
  export type TenantCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * The data needed to create a Tenant.
     */
    data: XOR<TenantCreateInput, TenantUncheckedCreateInput>
  }

  /**
   * Tenant createMany
   */
  export type TenantCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Tenants.
     */
    data: TenantCreateManyInput | TenantCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Tenant createManyAndReturn
   */
  export type TenantCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Tenants.
     */
    data: TenantCreateManyInput | TenantCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Tenant update
   */
  export type TenantUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * The data needed to update a Tenant.
     */
    data: XOR<TenantUpdateInput, TenantUncheckedUpdateInput>
    /**
     * Choose, which Tenant to update.
     */
    where: TenantWhereUniqueInput
  }

  /**
   * Tenant updateMany
   */
  export type TenantUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Tenants.
     */
    data: XOR<TenantUpdateManyMutationInput, TenantUncheckedUpdateManyInput>
    /**
     * Filter which Tenants to update
     */
    where?: TenantWhereInput
  }

  /**
   * Tenant upsert
   */
  export type TenantUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * The filter to search for the Tenant to update in case it exists.
     */
    where: TenantWhereUniqueInput
    /**
     * In case the Tenant found by the `where` argument doesn't exist, create a new Tenant with this data.
     */
    create: XOR<TenantCreateInput, TenantUncheckedCreateInput>
    /**
     * In case the Tenant was found with the provided `where` argument, update it with this data.
     */
    update: XOR<TenantUpdateInput, TenantUncheckedUpdateInput>
  }

  /**
   * Tenant delete
   */
  export type TenantDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
    /**
     * Filter which Tenant to delete.
     */
    where: TenantWhereUniqueInput
  }

  /**
   * Tenant deleteMany
   */
  export type TenantDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Tenants to delete
     */
    where?: TenantWhereInput
  }

  /**
   * Tenant.users
   */
  export type Tenant$usersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    where?: UserWhereInput
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    cursor?: UserWhereUniqueInput
    take?: number
    skip?: number
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * Tenant.borrowers
   */
  export type Tenant$borrowersArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
    where?: BorrowerWhereInput
    orderBy?: BorrowerOrderByWithRelationInput | BorrowerOrderByWithRelationInput[]
    cursor?: BorrowerWhereUniqueInput
    take?: number
    skip?: number
    distinct?: BorrowerScalarFieldEnum | BorrowerScalarFieldEnum[]
  }

  /**
   * Tenant.loans
   */
  export type Tenant$loansArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    where?: LoanWhereInput
    orderBy?: LoanOrderByWithRelationInput | LoanOrderByWithRelationInput[]
    cursor?: LoanWhereUniqueInput
    take?: number
    skip?: number
    distinct?: LoanScalarFieldEnum | LoanScalarFieldEnum[]
  }

  /**
   * Tenant.repayments
   */
  export type Tenant$repaymentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    where?: RepaymentWhereInput
    orderBy?: RepaymentOrderByWithRelationInput | RepaymentOrderByWithRelationInput[]
    cursor?: RepaymentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: RepaymentScalarFieldEnum | RepaymentScalarFieldEnum[]
  }

  /**
   * Tenant.auditLogs
   */
  export type Tenant$auditLogsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    where?: AuditLogWhereInput
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    cursor?: AuditLogWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AuditLogScalarFieldEnum | AuditLogScalarFieldEnum[]
  }

  /**
   * Tenant without action
   */
  export type TenantDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Tenant
     */
    select?: TenantSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: TenantInclude<ExtArgs> | null
  }


  /**
   * Model User
   */

  export type AggregateUser = {
    _count: UserCountAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  export type UserMinAggregateOutputType = {
    id: string | null
    tenantId: string | null
    email: string | null
    passwordHash: string | null
    role: $Enums.Role | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserMaxAggregateOutputType = {
    id: string | null
    tenantId: string | null
    email: string | null
    passwordHash: string | null
    role: $Enums.Role | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type UserCountAggregateOutputType = {
    id: number
    tenantId: number
    email: number
    passwordHash: number
    role: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type UserMinAggregateInputType = {
    id?: true
    tenantId?: true
    email?: true
    passwordHash?: true
    role?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserMaxAggregateInputType = {
    id?: true
    tenantId?: true
    email?: true
    passwordHash?: true
    role?: true
    createdAt?: true
    updatedAt?: true
  }

  export type UserCountAggregateInputType = {
    id?: true
    tenantId?: true
    email?: true
    passwordHash?: true
    role?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type UserAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which User to aggregate.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Users
    **/
    _count?: true | UserCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: UserMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: UserMaxAggregateInputType
  }

  export type GetUserAggregateType<T extends UserAggregateArgs> = {
        [P in keyof T & keyof AggregateUser]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateUser[P]>
      : GetScalarType<T[P], AggregateUser[P]>
  }




  export type UserGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: UserWhereInput
    orderBy?: UserOrderByWithAggregationInput | UserOrderByWithAggregationInput[]
    by: UserScalarFieldEnum[] | UserScalarFieldEnum
    having?: UserScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: UserCountAggregateInputType | true
    _min?: UserMinAggregateInputType
    _max?: UserMaxAggregateInputType
  }

  export type UserGroupByOutputType = {
    id: string
    tenantId: string
    email: string
    passwordHash: string
    role: $Enums.Role
    createdAt: Date
    updatedAt: Date
    _count: UserCountAggregateOutputType | null
    _min: UserMinAggregateOutputType | null
    _max: UserMaxAggregateOutputType | null
  }

  type GetUserGroupByPayload<T extends UserGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<UserGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof UserGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], UserGroupByOutputType[P]>
            : GetScalarType<T[P], UserGroupByOutputType[P]>
        }
      >
    >


  export type UserSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    tenantId?: boolean
    email?: boolean
    passwordHash?: boolean
    role?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    auditLogs?: boolean | User$auditLogsArgs<ExtArgs>
    _count?: boolean | UserCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["user"]>

  export type UserSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    tenantId?: boolean
    email?: boolean
    passwordHash?: boolean
    role?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["user"]>

  export type UserSelectScalar = {
    id?: boolean
    tenantId?: boolean
    email?: boolean
    passwordHash?: boolean
    role?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type UserInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    auditLogs?: boolean | User$auditLogsArgs<ExtArgs>
    _count?: boolean | UserCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type UserIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
  }

  export type $UserPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "User"
    objects: {
      tenant: Prisma.$TenantPayload<ExtArgs>
      auditLogs: Prisma.$AuditLogPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      tenantId: string
      email: string
      passwordHash: string
      role: $Enums.Role
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["user"]>
    composites: {}
  }

  type UserGetPayload<S extends boolean | null | undefined | UserDefaultArgs> = $Result.GetResult<Prisma.$UserPayload, S>

  type UserCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<UserFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: UserCountAggregateInputType | true
    }

  export interface UserDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['User'], meta: { name: 'User' } }
    /**
     * Find zero or one User that matches the filter.
     * @param {UserFindUniqueArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends UserFindUniqueArgs>(args: SelectSubset<T, UserFindUniqueArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one User that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {UserFindUniqueOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends UserFindUniqueOrThrowArgs>(args: SelectSubset<T, UserFindUniqueOrThrowArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first User that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends UserFindFirstArgs>(args?: SelectSubset<T, UserFindFirstArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first User that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindFirstOrThrowArgs} args - Arguments to find a User
     * @example
     * // Get one User
     * const user = await prisma.user.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends UserFindFirstOrThrowArgs>(args?: SelectSubset<T, UserFindFirstOrThrowArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Users that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Users
     * const users = await prisma.user.findMany()
     * 
     * // Get first 10 Users
     * const users = await prisma.user.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const userWithIdOnly = await prisma.user.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends UserFindManyArgs>(args?: SelectSubset<T, UserFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a User.
     * @param {UserCreateArgs} args - Arguments to create a User.
     * @example
     * // Create one User
     * const User = await prisma.user.create({
     *   data: {
     *     // ... data to create a User
     *   }
     * })
     * 
     */
    create<T extends UserCreateArgs>(args: SelectSubset<T, UserCreateArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Users.
     * @param {UserCreateManyArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const user = await prisma.user.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends UserCreateManyArgs>(args?: SelectSubset<T, UserCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Users and returns the data saved in the database.
     * @param {UserCreateManyAndReturnArgs} args - Arguments to create many Users.
     * @example
     * // Create many Users
     * const user = await prisma.user.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Users and only return the `id`
     * const userWithIdOnly = await prisma.user.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends UserCreateManyAndReturnArgs>(args?: SelectSubset<T, UserCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a User.
     * @param {UserDeleteArgs} args - Arguments to delete one User.
     * @example
     * // Delete one User
     * const User = await prisma.user.delete({
     *   where: {
     *     // ... filter to delete one User
     *   }
     * })
     * 
     */
    delete<T extends UserDeleteArgs>(args: SelectSubset<T, UserDeleteArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one User.
     * @param {UserUpdateArgs} args - Arguments to update one User.
     * @example
     * // Update one User
     * const user = await prisma.user.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends UserUpdateArgs>(args: SelectSubset<T, UserUpdateArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Users.
     * @param {UserDeleteManyArgs} args - Arguments to filter Users to delete.
     * @example
     * // Delete a few Users
     * const { count } = await prisma.user.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends UserDeleteManyArgs>(args?: SelectSubset<T, UserDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Users
     * const user = await prisma.user.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends UserUpdateManyArgs>(args: SelectSubset<T, UserUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one User.
     * @param {UserUpsertArgs} args - Arguments to update or create a User.
     * @example
     * // Update or create a User
     * const user = await prisma.user.upsert({
     *   create: {
     *     // ... data to create a User
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the User we want to update
     *   }
     * })
     */
    upsert<T extends UserUpsertArgs>(args: SelectSubset<T, UserUpsertArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Users.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserCountArgs} args - Arguments to filter Users to count.
     * @example
     * // Count the number of Users
     * const count = await prisma.user.count({
     *   where: {
     *     // ... the filter for the Users we want to count
     *   }
     * })
    **/
    count<T extends UserCountArgs>(
      args?: Subset<T, UserCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], UserCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends UserAggregateArgs>(args: Subset<T, UserAggregateArgs>): Prisma.PrismaPromise<GetUserAggregateType<T>>

    /**
     * Group by User.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {UserGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends UserGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: UserGroupByArgs['orderBy'] }
        : { orderBy?: UserGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, UserGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetUserGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the User model
   */
  readonly fields: UserFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for User.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__UserClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    tenant<T extends TenantDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TenantDefaultArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    auditLogs<T extends User$auditLogsArgs<ExtArgs> = {}>(args?: Subset<T, User$auditLogsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the User model
   */ 
  interface UserFieldRefs {
    readonly id: FieldRef<"User", 'String'>
    readonly tenantId: FieldRef<"User", 'String'>
    readonly email: FieldRef<"User", 'String'>
    readonly passwordHash: FieldRef<"User", 'String'>
    readonly role: FieldRef<"User", 'Role'>
    readonly createdAt: FieldRef<"User", 'DateTime'>
    readonly updatedAt: FieldRef<"User", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * User findUnique
   */
  export type UserFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User findUniqueOrThrow
   */
  export type UserFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User findFirst
   */
  export type UserFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User findFirstOrThrow
   */
  export type UserFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which User to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Users.
     */
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User findMany
   */
  export type UserFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter, which Users to fetch.
     */
    where?: UserWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Users to fetch.
     */
    orderBy?: UserOrderByWithRelationInput | UserOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Users.
     */
    cursor?: UserWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Users from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Users.
     */
    skip?: number
    distinct?: UserScalarFieldEnum | UserScalarFieldEnum[]
  }

  /**
   * User create
   */
  export type UserCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The data needed to create a User.
     */
    data: XOR<UserCreateInput, UserUncheckedCreateInput>
  }

  /**
   * User createMany
   */
  export type UserCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * User createManyAndReturn
   */
  export type UserCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Users.
     */
    data: UserCreateManyInput | UserCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * User update
   */
  export type UserUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The data needed to update a User.
     */
    data: XOR<UserUpdateInput, UserUncheckedUpdateInput>
    /**
     * Choose, which User to update.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User updateMany
   */
  export type UserUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Users.
     */
    data: XOR<UserUpdateManyMutationInput, UserUncheckedUpdateManyInput>
    /**
     * Filter which Users to update
     */
    where?: UserWhereInput
  }

  /**
   * User upsert
   */
  export type UserUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * The filter to search for the User to update in case it exists.
     */
    where: UserWhereUniqueInput
    /**
     * In case the User found by the `where` argument doesn't exist, create a new User with this data.
     */
    create: XOR<UserCreateInput, UserUncheckedCreateInput>
    /**
     * In case the User was found with the provided `where` argument, update it with this data.
     */
    update: XOR<UserUpdateInput, UserUncheckedUpdateInput>
  }

  /**
   * User delete
   */
  export type UserDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
    /**
     * Filter which User to delete.
     */
    where: UserWhereUniqueInput
  }

  /**
   * User deleteMany
   */
  export type UserDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Users to delete
     */
    where?: UserWhereInput
  }

  /**
   * User.auditLogs
   */
  export type User$auditLogsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    where?: AuditLogWhereInput
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    cursor?: AuditLogWhereUniqueInput
    take?: number
    skip?: number
    distinct?: AuditLogScalarFieldEnum | AuditLogScalarFieldEnum[]
  }

  /**
   * User without action
   */
  export type UserDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the User
     */
    select?: UserSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: UserInclude<ExtArgs> | null
  }


  /**
   * Model Borrower
   */

  export type AggregateBorrower = {
    _count: BorrowerCountAggregateOutputType | null
    _min: BorrowerMinAggregateOutputType | null
    _max: BorrowerMaxAggregateOutputType | null
  }

  export type BorrowerMinAggregateOutputType = {
    id: string | null
    tenantId: string | null
    firstName: string | null
    lastName: string | null
    phone: string | null
    address: string | null
    idNumber: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type BorrowerMaxAggregateOutputType = {
    id: string | null
    tenantId: string | null
    firstName: string | null
    lastName: string | null
    phone: string | null
    address: string | null
    idNumber: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type BorrowerCountAggregateOutputType = {
    id: number
    tenantId: number
    firstName: number
    lastName: number
    phone: number
    address: number
    idNumber: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type BorrowerMinAggregateInputType = {
    id?: true
    tenantId?: true
    firstName?: true
    lastName?: true
    phone?: true
    address?: true
    idNumber?: true
    createdAt?: true
    updatedAt?: true
  }

  export type BorrowerMaxAggregateInputType = {
    id?: true
    tenantId?: true
    firstName?: true
    lastName?: true
    phone?: true
    address?: true
    idNumber?: true
    createdAt?: true
    updatedAt?: true
  }

  export type BorrowerCountAggregateInputType = {
    id?: true
    tenantId?: true
    firstName?: true
    lastName?: true
    phone?: true
    address?: true
    idNumber?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type BorrowerAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Borrower to aggregate.
     */
    where?: BorrowerWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Borrowers to fetch.
     */
    orderBy?: BorrowerOrderByWithRelationInput | BorrowerOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: BorrowerWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Borrowers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Borrowers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Borrowers
    **/
    _count?: true | BorrowerCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: BorrowerMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: BorrowerMaxAggregateInputType
  }

  export type GetBorrowerAggregateType<T extends BorrowerAggregateArgs> = {
        [P in keyof T & keyof AggregateBorrower]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateBorrower[P]>
      : GetScalarType<T[P], AggregateBorrower[P]>
  }




  export type BorrowerGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: BorrowerWhereInput
    orderBy?: BorrowerOrderByWithAggregationInput | BorrowerOrderByWithAggregationInput[]
    by: BorrowerScalarFieldEnum[] | BorrowerScalarFieldEnum
    having?: BorrowerScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: BorrowerCountAggregateInputType | true
    _min?: BorrowerMinAggregateInputType
    _max?: BorrowerMaxAggregateInputType
  }

  export type BorrowerGroupByOutputType = {
    id: string
    tenantId: string
    firstName: string
    lastName: string
    phone: string | null
    address: string | null
    idNumber: string | null
    createdAt: Date
    updatedAt: Date
    _count: BorrowerCountAggregateOutputType | null
    _min: BorrowerMinAggregateOutputType | null
    _max: BorrowerMaxAggregateOutputType | null
  }

  type GetBorrowerGroupByPayload<T extends BorrowerGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<BorrowerGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof BorrowerGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], BorrowerGroupByOutputType[P]>
            : GetScalarType<T[P], BorrowerGroupByOutputType[P]>
        }
      >
    >


  export type BorrowerSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    tenantId?: boolean
    firstName?: boolean
    lastName?: boolean
    phone?: boolean
    address?: boolean
    idNumber?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    loans?: boolean | Borrower$loansArgs<ExtArgs>
    _count?: boolean | BorrowerCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["borrower"]>

  export type BorrowerSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    tenantId?: boolean
    firstName?: boolean
    lastName?: boolean
    phone?: boolean
    address?: boolean
    idNumber?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["borrower"]>

  export type BorrowerSelectScalar = {
    id?: boolean
    tenantId?: boolean
    firstName?: boolean
    lastName?: boolean
    phone?: boolean
    address?: boolean
    idNumber?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type BorrowerInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    loans?: boolean | Borrower$loansArgs<ExtArgs>
    _count?: boolean | BorrowerCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type BorrowerIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
  }

  export type $BorrowerPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Borrower"
    objects: {
      tenant: Prisma.$TenantPayload<ExtArgs>
      loans: Prisma.$LoanPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      tenantId: string
      firstName: string
      lastName: string
      phone: string | null
      address: string | null
      idNumber: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["borrower"]>
    composites: {}
  }

  type BorrowerGetPayload<S extends boolean | null | undefined | BorrowerDefaultArgs> = $Result.GetResult<Prisma.$BorrowerPayload, S>

  type BorrowerCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<BorrowerFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: BorrowerCountAggregateInputType | true
    }

  export interface BorrowerDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Borrower'], meta: { name: 'Borrower' } }
    /**
     * Find zero or one Borrower that matches the filter.
     * @param {BorrowerFindUniqueArgs} args - Arguments to find a Borrower
     * @example
     * // Get one Borrower
     * const borrower = await prisma.borrower.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends BorrowerFindUniqueArgs>(args: SelectSubset<T, BorrowerFindUniqueArgs<ExtArgs>>): Prisma__BorrowerClient<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Borrower that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {BorrowerFindUniqueOrThrowArgs} args - Arguments to find a Borrower
     * @example
     * // Get one Borrower
     * const borrower = await prisma.borrower.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends BorrowerFindUniqueOrThrowArgs>(args: SelectSubset<T, BorrowerFindUniqueOrThrowArgs<ExtArgs>>): Prisma__BorrowerClient<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Borrower that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BorrowerFindFirstArgs} args - Arguments to find a Borrower
     * @example
     * // Get one Borrower
     * const borrower = await prisma.borrower.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends BorrowerFindFirstArgs>(args?: SelectSubset<T, BorrowerFindFirstArgs<ExtArgs>>): Prisma__BorrowerClient<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Borrower that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BorrowerFindFirstOrThrowArgs} args - Arguments to find a Borrower
     * @example
     * // Get one Borrower
     * const borrower = await prisma.borrower.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends BorrowerFindFirstOrThrowArgs>(args?: SelectSubset<T, BorrowerFindFirstOrThrowArgs<ExtArgs>>): Prisma__BorrowerClient<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Borrowers that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BorrowerFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Borrowers
     * const borrowers = await prisma.borrower.findMany()
     * 
     * // Get first 10 Borrowers
     * const borrowers = await prisma.borrower.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const borrowerWithIdOnly = await prisma.borrower.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends BorrowerFindManyArgs>(args?: SelectSubset<T, BorrowerFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Borrower.
     * @param {BorrowerCreateArgs} args - Arguments to create a Borrower.
     * @example
     * // Create one Borrower
     * const Borrower = await prisma.borrower.create({
     *   data: {
     *     // ... data to create a Borrower
     *   }
     * })
     * 
     */
    create<T extends BorrowerCreateArgs>(args: SelectSubset<T, BorrowerCreateArgs<ExtArgs>>): Prisma__BorrowerClient<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Borrowers.
     * @param {BorrowerCreateManyArgs} args - Arguments to create many Borrowers.
     * @example
     * // Create many Borrowers
     * const borrower = await prisma.borrower.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends BorrowerCreateManyArgs>(args?: SelectSubset<T, BorrowerCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Borrowers and returns the data saved in the database.
     * @param {BorrowerCreateManyAndReturnArgs} args - Arguments to create many Borrowers.
     * @example
     * // Create many Borrowers
     * const borrower = await prisma.borrower.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Borrowers and only return the `id`
     * const borrowerWithIdOnly = await prisma.borrower.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends BorrowerCreateManyAndReturnArgs>(args?: SelectSubset<T, BorrowerCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Borrower.
     * @param {BorrowerDeleteArgs} args - Arguments to delete one Borrower.
     * @example
     * // Delete one Borrower
     * const Borrower = await prisma.borrower.delete({
     *   where: {
     *     // ... filter to delete one Borrower
     *   }
     * })
     * 
     */
    delete<T extends BorrowerDeleteArgs>(args: SelectSubset<T, BorrowerDeleteArgs<ExtArgs>>): Prisma__BorrowerClient<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Borrower.
     * @param {BorrowerUpdateArgs} args - Arguments to update one Borrower.
     * @example
     * // Update one Borrower
     * const borrower = await prisma.borrower.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends BorrowerUpdateArgs>(args: SelectSubset<T, BorrowerUpdateArgs<ExtArgs>>): Prisma__BorrowerClient<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Borrowers.
     * @param {BorrowerDeleteManyArgs} args - Arguments to filter Borrowers to delete.
     * @example
     * // Delete a few Borrowers
     * const { count } = await prisma.borrower.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends BorrowerDeleteManyArgs>(args?: SelectSubset<T, BorrowerDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Borrowers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BorrowerUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Borrowers
     * const borrower = await prisma.borrower.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends BorrowerUpdateManyArgs>(args: SelectSubset<T, BorrowerUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Borrower.
     * @param {BorrowerUpsertArgs} args - Arguments to update or create a Borrower.
     * @example
     * // Update or create a Borrower
     * const borrower = await prisma.borrower.upsert({
     *   create: {
     *     // ... data to create a Borrower
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Borrower we want to update
     *   }
     * })
     */
    upsert<T extends BorrowerUpsertArgs>(args: SelectSubset<T, BorrowerUpsertArgs<ExtArgs>>): Prisma__BorrowerClient<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Borrowers.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BorrowerCountArgs} args - Arguments to filter Borrowers to count.
     * @example
     * // Count the number of Borrowers
     * const count = await prisma.borrower.count({
     *   where: {
     *     // ... the filter for the Borrowers we want to count
     *   }
     * })
    **/
    count<T extends BorrowerCountArgs>(
      args?: Subset<T, BorrowerCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], BorrowerCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Borrower.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BorrowerAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends BorrowerAggregateArgs>(args: Subset<T, BorrowerAggregateArgs>): Prisma.PrismaPromise<GetBorrowerAggregateType<T>>

    /**
     * Group by Borrower.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {BorrowerGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends BorrowerGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: BorrowerGroupByArgs['orderBy'] }
        : { orderBy?: BorrowerGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, BorrowerGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetBorrowerGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Borrower model
   */
  readonly fields: BorrowerFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Borrower.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__BorrowerClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    tenant<T extends TenantDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TenantDefaultArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    loans<T extends Borrower$loansArgs<ExtArgs> = {}>(args?: Subset<T, Borrower$loansArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Borrower model
   */ 
  interface BorrowerFieldRefs {
    readonly id: FieldRef<"Borrower", 'String'>
    readonly tenantId: FieldRef<"Borrower", 'String'>
    readonly firstName: FieldRef<"Borrower", 'String'>
    readonly lastName: FieldRef<"Borrower", 'String'>
    readonly phone: FieldRef<"Borrower", 'String'>
    readonly address: FieldRef<"Borrower", 'String'>
    readonly idNumber: FieldRef<"Borrower", 'String'>
    readonly createdAt: FieldRef<"Borrower", 'DateTime'>
    readonly updatedAt: FieldRef<"Borrower", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Borrower findUnique
   */
  export type BorrowerFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
    /**
     * Filter, which Borrower to fetch.
     */
    where: BorrowerWhereUniqueInput
  }

  /**
   * Borrower findUniqueOrThrow
   */
  export type BorrowerFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
    /**
     * Filter, which Borrower to fetch.
     */
    where: BorrowerWhereUniqueInput
  }

  /**
   * Borrower findFirst
   */
  export type BorrowerFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
    /**
     * Filter, which Borrower to fetch.
     */
    where?: BorrowerWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Borrowers to fetch.
     */
    orderBy?: BorrowerOrderByWithRelationInput | BorrowerOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Borrowers.
     */
    cursor?: BorrowerWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Borrowers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Borrowers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Borrowers.
     */
    distinct?: BorrowerScalarFieldEnum | BorrowerScalarFieldEnum[]
  }

  /**
   * Borrower findFirstOrThrow
   */
  export type BorrowerFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
    /**
     * Filter, which Borrower to fetch.
     */
    where?: BorrowerWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Borrowers to fetch.
     */
    orderBy?: BorrowerOrderByWithRelationInput | BorrowerOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Borrowers.
     */
    cursor?: BorrowerWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Borrowers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Borrowers.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Borrowers.
     */
    distinct?: BorrowerScalarFieldEnum | BorrowerScalarFieldEnum[]
  }

  /**
   * Borrower findMany
   */
  export type BorrowerFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
    /**
     * Filter, which Borrowers to fetch.
     */
    where?: BorrowerWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Borrowers to fetch.
     */
    orderBy?: BorrowerOrderByWithRelationInput | BorrowerOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Borrowers.
     */
    cursor?: BorrowerWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Borrowers from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Borrowers.
     */
    skip?: number
    distinct?: BorrowerScalarFieldEnum | BorrowerScalarFieldEnum[]
  }

  /**
   * Borrower create
   */
  export type BorrowerCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
    /**
     * The data needed to create a Borrower.
     */
    data: XOR<BorrowerCreateInput, BorrowerUncheckedCreateInput>
  }

  /**
   * Borrower createMany
   */
  export type BorrowerCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Borrowers.
     */
    data: BorrowerCreateManyInput | BorrowerCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Borrower createManyAndReturn
   */
  export type BorrowerCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Borrowers.
     */
    data: BorrowerCreateManyInput | BorrowerCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Borrower update
   */
  export type BorrowerUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
    /**
     * The data needed to update a Borrower.
     */
    data: XOR<BorrowerUpdateInput, BorrowerUncheckedUpdateInput>
    /**
     * Choose, which Borrower to update.
     */
    where: BorrowerWhereUniqueInput
  }

  /**
   * Borrower updateMany
   */
  export type BorrowerUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Borrowers.
     */
    data: XOR<BorrowerUpdateManyMutationInput, BorrowerUncheckedUpdateManyInput>
    /**
     * Filter which Borrowers to update
     */
    where?: BorrowerWhereInput
  }

  /**
   * Borrower upsert
   */
  export type BorrowerUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
    /**
     * The filter to search for the Borrower to update in case it exists.
     */
    where: BorrowerWhereUniqueInput
    /**
     * In case the Borrower found by the `where` argument doesn't exist, create a new Borrower with this data.
     */
    create: XOR<BorrowerCreateInput, BorrowerUncheckedCreateInput>
    /**
     * In case the Borrower was found with the provided `where` argument, update it with this data.
     */
    update: XOR<BorrowerUpdateInput, BorrowerUncheckedUpdateInput>
  }

  /**
   * Borrower delete
   */
  export type BorrowerDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
    /**
     * Filter which Borrower to delete.
     */
    where: BorrowerWhereUniqueInput
  }

  /**
   * Borrower deleteMany
   */
  export type BorrowerDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Borrowers to delete
     */
    where?: BorrowerWhereInput
  }

  /**
   * Borrower.loans
   */
  export type Borrower$loansArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    where?: LoanWhereInput
    orderBy?: LoanOrderByWithRelationInput | LoanOrderByWithRelationInput[]
    cursor?: LoanWhereUniqueInput
    take?: number
    skip?: number
    distinct?: LoanScalarFieldEnum | LoanScalarFieldEnum[]
  }

  /**
   * Borrower without action
   */
  export type BorrowerDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Borrower
     */
    select?: BorrowerSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: BorrowerInclude<ExtArgs> | null
  }


  /**
   * Model Loan
   */

  export type AggregateLoan = {
    _count: LoanCountAggregateOutputType | null
    _avg: LoanAvgAggregateOutputType | null
    _sum: LoanSumAggregateOutputType | null
    _min: LoanMinAggregateOutputType | null
    _max: LoanMaxAggregateOutputType | null
  }

  export type LoanAvgAggregateOutputType = {
    principal: Decimal | null
    annualInterestRate: Decimal | null
    termMonths: number | null
  }

  export type LoanSumAggregateOutputType = {
    principal: Decimal | null
    annualInterestRate: Decimal | null
    termMonths: number | null
  }

  export type LoanMinAggregateOutputType = {
    id: string | null
    tenantId: string | null
    borrowerId: string | null
    status: $Enums.LoanStatus | null
    principal: Decimal | null
    annualInterestRate: Decimal | null
    termMonths: number | null
    interestMethod: $Enums.InterestMethod | null
    startDate: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type LoanMaxAggregateOutputType = {
    id: string | null
    tenantId: string | null
    borrowerId: string | null
    status: $Enums.LoanStatus | null
    principal: Decimal | null
    annualInterestRate: Decimal | null
    termMonths: number | null
    interestMethod: $Enums.InterestMethod | null
    startDate: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type LoanCountAggregateOutputType = {
    id: number
    tenantId: number
    borrowerId: number
    status: number
    principal: number
    annualInterestRate: number
    termMonths: number
    interestMethod: number
    startDate: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type LoanAvgAggregateInputType = {
    principal?: true
    annualInterestRate?: true
    termMonths?: true
  }

  export type LoanSumAggregateInputType = {
    principal?: true
    annualInterestRate?: true
    termMonths?: true
  }

  export type LoanMinAggregateInputType = {
    id?: true
    tenantId?: true
    borrowerId?: true
    status?: true
    principal?: true
    annualInterestRate?: true
    termMonths?: true
    interestMethod?: true
    startDate?: true
    createdAt?: true
    updatedAt?: true
  }

  export type LoanMaxAggregateInputType = {
    id?: true
    tenantId?: true
    borrowerId?: true
    status?: true
    principal?: true
    annualInterestRate?: true
    termMonths?: true
    interestMethod?: true
    startDate?: true
    createdAt?: true
    updatedAt?: true
  }

  export type LoanCountAggregateInputType = {
    id?: true
    tenantId?: true
    borrowerId?: true
    status?: true
    principal?: true
    annualInterestRate?: true
    termMonths?: true
    interestMethod?: true
    startDate?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type LoanAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Loan to aggregate.
     */
    where?: LoanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Loans to fetch.
     */
    orderBy?: LoanOrderByWithRelationInput | LoanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: LoanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Loans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Loans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Loans
    **/
    _count?: true | LoanCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: LoanAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: LoanSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: LoanMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: LoanMaxAggregateInputType
  }

  export type GetLoanAggregateType<T extends LoanAggregateArgs> = {
        [P in keyof T & keyof AggregateLoan]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateLoan[P]>
      : GetScalarType<T[P], AggregateLoan[P]>
  }




  export type LoanGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: LoanWhereInput
    orderBy?: LoanOrderByWithAggregationInput | LoanOrderByWithAggregationInput[]
    by: LoanScalarFieldEnum[] | LoanScalarFieldEnum
    having?: LoanScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: LoanCountAggregateInputType | true
    _avg?: LoanAvgAggregateInputType
    _sum?: LoanSumAggregateInputType
    _min?: LoanMinAggregateInputType
    _max?: LoanMaxAggregateInputType
  }

  export type LoanGroupByOutputType = {
    id: string
    tenantId: string
    borrowerId: string
    status: $Enums.LoanStatus
    principal: Decimal
    annualInterestRate: Decimal
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date
    createdAt: Date
    updatedAt: Date
    _count: LoanCountAggregateOutputType | null
    _avg: LoanAvgAggregateOutputType | null
    _sum: LoanSumAggregateOutputType | null
    _min: LoanMinAggregateOutputType | null
    _max: LoanMaxAggregateOutputType | null
  }

  type GetLoanGroupByPayload<T extends LoanGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<LoanGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof LoanGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], LoanGroupByOutputType[P]>
            : GetScalarType<T[P], LoanGroupByOutputType[P]>
        }
      >
    >


  export type LoanSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    tenantId?: boolean
    borrowerId?: boolean
    status?: boolean
    principal?: boolean
    annualInterestRate?: boolean
    termMonths?: boolean
    interestMethod?: boolean
    startDate?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    borrower?: boolean | BorrowerDefaultArgs<ExtArgs>
    schedules?: boolean | Loan$schedulesArgs<ExtArgs>
    repayments?: boolean | Loan$repaymentsArgs<ExtArgs>
    _count?: boolean | LoanCountOutputTypeDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["loan"]>

  export type LoanSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    tenantId?: boolean
    borrowerId?: boolean
    status?: boolean
    principal?: boolean
    annualInterestRate?: boolean
    termMonths?: boolean
    interestMethod?: boolean
    startDate?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    borrower?: boolean | BorrowerDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["loan"]>

  export type LoanSelectScalar = {
    id?: boolean
    tenantId?: boolean
    borrowerId?: boolean
    status?: boolean
    principal?: boolean
    annualInterestRate?: boolean
    termMonths?: boolean
    interestMethod?: boolean
    startDate?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type LoanInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    borrower?: boolean | BorrowerDefaultArgs<ExtArgs>
    schedules?: boolean | Loan$schedulesArgs<ExtArgs>
    repayments?: boolean | Loan$repaymentsArgs<ExtArgs>
    _count?: boolean | LoanCountOutputTypeDefaultArgs<ExtArgs>
  }
  export type LoanIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    borrower?: boolean | BorrowerDefaultArgs<ExtArgs>
  }

  export type $LoanPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Loan"
    objects: {
      tenant: Prisma.$TenantPayload<ExtArgs>
      borrower: Prisma.$BorrowerPayload<ExtArgs>
      schedules: Prisma.$RepaymentSchedulePayload<ExtArgs>[]
      repayments: Prisma.$RepaymentPayload<ExtArgs>[]
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      tenantId: string
      borrowerId: string
      status: $Enums.LoanStatus
      principal: Prisma.Decimal
      annualInterestRate: Prisma.Decimal
      termMonths: number
      interestMethod: $Enums.InterestMethod
      startDate: Date
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["loan"]>
    composites: {}
  }

  type LoanGetPayload<S extends boolean | null | undefined | LoanDefaultArgs> = $Result.GetResult<Prisma.$LoanPayload, S>

  type LoanCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<LoanFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: LoanCountAggregateInputType | true
    }

  export interface LoanDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Loan'], meta: { name: 'Loan' } }
    /**
     * Find zero or one Loan that matches the filter.
     * @param {LoanFindUniqueArgs} args - Arguments to find a Loan
     * @example
     * // Get one Loan
     * const loan = await prisma.loan.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends LoanFindUniqueArgs>(args: SelectSubset<T, LoanFindUniqueArgs<ExtArgs>>): Prisma__LoanClient<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Loan that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {LoanFindUniqueOrThrowArgs} args - Arguments to find a Loan
     * @example
     * // Get one Loan
     * const loan = await prisma.loan.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends LoanFindUniqueOrThrowArgs>(args: SelectSubset<T, LoanFindUniqueOrThrowArgs<ExtArgs>>): Prisma__LoanClient<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Loan that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LoanFindFirstArgs} args - Arguments to find a Loan
     * @example
     * // Get one Loan
     * const loan = await prisma.loan.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends LoanFindFirstArgs>(args?: SelectSubset<T, LoanFindFirstArgs<ExtArgs>>): Prisma__LoanClient<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Loan that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LoanFindFirstOrThrowArgs} args - Arguments to find a Loan
     * @example
     * // Get one Loan
     * const loan = await prisma.loan.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends LoanFindFirstOrThrowArgs>(args?: SelectSubset<T, LoanFindFirstOrThrowArgs<ExtArgs>>): Prisma__LoanClient<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Loans that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LoanFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Loans
     * const loans = await prisma.loan.findMany()
     * 
     * // Get first 10 Loans
     * const loans = await prisma.loan.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const loanWithIdOnly = await prisma.loan.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends LoanFindManyArgs>(args?: SelectSubset<T, LoanFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Loan.
     * @param {LoanCreateArgs} args - Arguments to create a Loan.
     * @example
     * // Create one Loan
     * const Loan = await prisma.loan.create({
     *   data: {
     *     // ... data to create a Loan
     *   }
     * })
     * 
     */
    create<T extends LoanCreateArgs>(args: SelectSubset<T, LoanCreateArgs<ExtArgs>>): Prisma__LoanClient<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Loans.
     * @param {LoanCreateManyArgs} args - Arguments to create many Loans.
     * @example
     * // Create many Loans
     * const loan = await prisma.loan.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends LoanCreateManyArgs>(args?: SelectSubset<T, LoanCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Loans and returns the data saved in the database.
     * @param {LoanCreateManyAndReturnArgs} args - Arguments to create many Loans.
     * @example
     * // Create many Loans
     * const loan = await prisma.loan.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Loans and only return the `id`
     * const loanWithIdOnly = await prisma.loan.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends LoanCreateManyAndReturnArgs>(args?: SelectSubset<T, LoanCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Loan.
     * @param {LoanDeleteArgs} args - Arguments to delete one Loan.
     * @example
     * // Delete one Loan
     * const Loan = await prisma.loan.delete({
     *   where: {
     *     // ... filter to delete one Loan
     *   }
     * })
     * 
     */
    delete<T extends LoanDeleteArgs>(args: SelectSubset<T, LoanDeleteArgs<ExtArgs>>): Prisma__LoanClient<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Loan.
     * @param {LoanUpdateArgs} args - Arguments to update one Loan.
     * @example
     * // Update one Loan
     * const loan = await prisma.loan.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends LoanUpdateArgs>(args: SelectSubset<T, LoanUpdateArgs<ExtArgs>>): Prisma__LoanClient<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Loans.
     * @param {LoanDeleteManyArgs} args - Arguments to filter Loans to delete.
     * @example
     * // Delete a few Loans
     * const { count } = await prisma.loan.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends LoanDeleteManyArgs>(args?: SelectSubset<T, LoanDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Loans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LoanUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Loans
     * const loan = await prisma.loan.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends LoanUpdateManyArgs>(args: SelectSubset<T, LoanUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Loan.
     * @param {LoanUpsertArgs} args - Arguments to update or create a Loan.
     * @example
     * // Update or create a Loan
     * const loan = await prisma.loan.upsert({
     *   create: {
     *     // ... data to create a Loan
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Loan we want to update
     *   }
     * })
     */
    upsert<T extends LoanUpsertArgs>(args: SelectSubset<T, LoanUpsertArgs<ExtArgs>>): Prisma__LoanClient<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Loans.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LoanCountArgs} args - Arguments to filter Loans to count.
     * @example
     * // Count the number of Loans
     * const count = await prisma.loan.count({
     *   where: {
     *     // ... the filter for the Loans we want to count
     *   }
     * })
    **/
    count<T extends LoanCountArgs>(
      args?: Subset<T, LoanCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], LoanCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Loan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LoanAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends LoanAggregateArgs>(args: Subset<T, LoanAggregateArgs>): Prisma.PrismaPromise<GetLoanAggregateType<T>>

    /**
     * Group by Loan.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {LoanGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends LoanGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: LoanGroupByArgs['orderBy'] }
        : { orderBy?: LoanGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, LoanGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetLoanGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Loan model
   */
  readonly fields: LoanFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Loan.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__LoanClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    tenant<T extends TenantDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TenantDefaultArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    borrower<T extends BorrowerDefaultArgs<ExtArgs> = {}>(args?: Subset<T, BorrowerDefaultArgs<ExtArgs>>): Prisma__BorrowerClient<$Result.GetResult<Prisma.$BorrowerPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    schedules<T extends Loan$schedulesArgs<ExtArgs> = {}>(args?: Subset<T, Loan$schedulesArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "findMany"> | Null>
    repayments<T extends Loan$repaymentsArgs<ExtArgs> = {}>(args?: Subset<T, Loan$repaymentsArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "findMany"> | Null>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Loan model
   */ 
  interface LoanFieldRefs {
    readonly id: FieldRef<"Loan", 'String'>
    readonly tenantId: FieldRef<"Loan", 'String'>
    readonly borrowerId: FieldRef<"Loan", 'String'>
    readonly status: FieldRef<"Loan", 'LoanStatus'>
    readonly principal: FieldRef<"Loan", 'Decimal'>
    readonly annualInterestRate: FieldRef<"Loan", 'Decimal'>
    readonly termMonths: FieldRef<"Loan", 'Int'>
    readonly interestMethod: FieldRef<"Loan", 'InterestMethod'>
    readonly startDate: FieldRef<"Loan", 'DateTime'>
    readonly createdAt: FieldRef<"Loan", 'DateTime'>
    readonly updatedAt: FieldRef<"Loan", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Loan findUnique
   */
  export type LoanFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    /**
     * Filter, which Loan to fetch.
     */
    where: LoanWhereUniqueInput
  }

  /**
   * Loan findUniqueOrThrow
   */
  export type LoanFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    /**
     * Filter, which Loan to fetch.
     */
    where: LoanWhereUniqueInput
  }

  /**
   * Loan findFirst
   */
  export type LoanFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    /**
     * Filter, which Loan to fetch.
     */
    where?: LoanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Loans to fetch.
     */
    orderBy?: LoanOrderByWithRelationInput | LoanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Loans.
     */
    cursor?: LoanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Loans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Loans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Loans.
     */
    distinct?: LoanScalarFieldEnum | LoanScalarFieldEnum[]
  }

  /**
   * Loan findFirstOrThrow
   */
  export type LoanFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    /**
     * Filter, which Loan to fetch.
     */
    where?: LoanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Loans to fetch.
     */
    orderBy?: LoanOrderByWithRelationInput | LoanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Loans.
     */
    cursor?: LoanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Loans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Loans.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Loans.
     */
    distinct?: LoanScalarFieldEnum | LoanScalarFieldEnum[]
  }

  /**
   * Loan findMany
   */
  export type LoanFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    /**
     * Filter, which Loans to fetch.
     */
    where?: LoanWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Loans to fetch.
     */
    orderBy?: LoanOrderByWithRelationInput | LoanOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Loans.
     */
    cursor?: LoanWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Loans from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Loans.
     */
    skip?: number
    distinct?: LoanScalarFieldEnum | LoanScalarFieldEnum[]
  }

  /**
   * Loan create
   */
  export type LoanCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    /**
     * The data needed to create a Loan.
     */
    data: XOR<LoanCreateInput, LoanUncheckedCreateInput>
  }

  /**
   * Loan createMany
   */
  export type LoanCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Loans.
     */
    data: LoanCreateManyInput | LoanCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Loan createManyAndReturn
   */
  export type LoanCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Loans.
     */
    data: LoanCreateManyInput | LoanCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Loan update
   */
  export type LoanUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    /**
     * The data needed to update a Loan.
     */
    data: XOR<LoanUpdateInput, LoanUncheckedUpdateInput>
    /**
     * Choose, which Loan to update.
     */
    where: LoanWhereUniqueInput
  }

  /**
   * Loan updateMany
   */
  export type LoanUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Loans.
     */
    data: XOR<LoanUpdateManyMutationInput, LoanUncheckedUpdateManyInput>
    /**
     * Filter which Loans to update
     */
    where?: LoanWhereInput
  }

  /**
   * Loan upsert
   */
  export type LoanUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    /**
     * The filter to search for the Loan to update in case it exists.
     */
    where: LoanWhereUniqueInput
    /**
     * In case the Loan found by the `where` argument doesn't exist, create a new Loan with this data.
     */
    create: XOR<LoanCreateInput, LoanUncheckedCreateInput>
    /**
     * In case the Loan was found with the provided `where` argument, update it with this data.
     */
    update: XOR<LoanUpdateInput, LoanUncheckedUpdateInput>
  }

  /**
   * Loan delete
   */
  export type LoanDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
    /**
     * Filter which Loan to delete.
     */
    where: LoanWhereUniqueInput
  }

  /**
   * Loan deleteMany
   */
  export type LoanDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Loans to delete
     */
    where?: LoanWhereInput
  }

  /**
   * Loan.schedules
   */
  export type Loan$schedulesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
    where?: RepaymentScheduleWhereInput
    orderBy?: RepaymentScheduleOrderByWithRelationInput | RepaymentScheduleOrderByWithRelationInput[]
    cursor?: RepaymentScheduleWhereUniqueInput
    take?: number
    skip?: number
    distinct?: RepaymentScheduleScalarFieldEnum | RepaymentScheduleScalarFieldEnum[]
  }

  /**
   * Loan.repayments
   */
  export type Loan$repaymentsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    where?: RepaymentWhereInput
    orderBy?: RepaymentOrderByWithRelationInput | RepaymentOrderByWithRelationInput[]
    cursor?: RepaymentWhereUniqueInput
    take?: number
    skip?: number
    distinct?: RepaymentScalarFieldEnum | RepaymentScalarFieldEnum[]
  }

  /**
   * Loan without action
   */
  export type LoanDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Loan
     */
    select?: LoanSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: LoanInclude<ExtArgs> | null
  }


  /**
   * Model RepaymentSchedule
   */

  export type AggregateRepaymentSchedule = {
    _count: RepaymentScheduleCountAggregateOutputType | null
    _avg: RepaymentScheduleAvgAggregateOutputType | null
    _sum: RepaymentScheduleSumAggregateOutputType | null
    _min: RepaymentScheduleMinAggregateOutputType | null
    _max: RepaymentScheduleMaxAggregateOutputType | null
  }

  export type RepaymentScheduleAvgAggregateOutputType = {
    installmentNumber: number | null
    principalAmount: Decimal | null
    interestAmount: Decimal | null
    totalAmount: Decimal | null
    outstandingPrincipal: Decimal | null
    paidPrincipal: Decimal | null
    paidInterest: Decimal | null
  }

  export type RepaymentScheduleSumAggregateOutputType = {
    installmentNumber: number | null
    principalAmount: Decimal | null
    interestAmount: Decimal | null
    totalAmount: Decimal | null
    outstandingPrincipal: Decimal | null
    paidPrincipal: Decimal | null
    paidInterest: Decimal | null
  }

  export type RepaymentScheduleMinAggregateOutputType = {
    id: string | null
    loanId: string | null
    installmentNumber: number | null
    dueDate: Date | null
    principalAmount: Decimal | null
    interestAmount: Decimal | null
    totalAmount: Decimal | null
    outstandingPrincipal: Decimal | null
    paidPrincipal: Decimal | null
    paidInterest: Decimal | null
    isPaid: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type RepaymentScheduleMaxAggregateOutputType = {
    id: string | null
    loanId: string | null
    installmentNumber: number | null
    dueDate: Date | null
    principalAmount: Decimal | null
    interestAmount: Decimal | null
    totalAmount: Decimal | null
    outstandingPrincipal: Decimal | null
    paidPrincipal: Decimal | null
    paidInterest: Decimal | null
    isPaid: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type RepaymentScheduleCountAggregateOutputType = {
    id: number
    loanId: number
    installmentNumber: number
    dueDate: number
    principalAmount: number
    interestAmount: number
    totalAmount: number
    outstandingPrincipal: number
    paidPrincipal: number
    paidInterest: number
    isPaid: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type RepaymentScheduleAvgAggregateInputType = {
    installmentNumber?: true
    principalAmount?: true
    interestAmount?: true
    totalAmount?: true
    outstandingPrincipal?: true
    paidPrincipal?: true
    paidInterest?: true
  }

  export type RepaymentScheduleSumAggregateInputType = {
    installmentNumber?: true
    principalAmount?: true
    interestAmount?: true
    totalAmount?: true
    outstandingPrincipal?: true
    paidPrincipal?: true
    paidInterest?: true
  }

  export type RepaymentScheduleMinAggregateInputType = {
    id?: true
    loanId?: true
    installmentNumber?: true
    dueDate?: true
    principalAmount?: true
    interestAmount?: true
    totalAmount?: true
    outstandingPrincipal?: true
    paidPrincipal?: true
    paidInterest?: true
    isPaid?: true
    createdAt?: true
    updatedAt?: true
  }

  export type RepaymentScheduleMaxAggregateInputType = {
    id?: true
    loanId?: true
    installmentNumber?: true
    dueDate?: true
    principalAmount?: true
    interestAmount?: true
    totalAmount?: true
    outstandingPrincipal?: true
    paidPrincipal?: true
    paidInterest?: true
    isPaid?: true
    createdAt?: true
    updatedAt?: true
  }

  export type RepaymentScheduleCountAggregateInputType = {
    id?: true
    loanId?: true
    installmentNumber?: true
    dueDate?: true
    principalAmount?: true
    interestAmount?: true
    totalAmount?: true
    outstandingPrincipal?: true
    paidPrincipal?: true
    paidInterest?: true
    isPaid?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type RepaymentScheduleAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RepaymentSchedule to aggregate.
     */
    where?: RepaymentScheduleWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RepaymentSchedules to fetch.
     */
    orderBy?: RepaymentScheduleOrderByWithRelationInput | RepaymentScheduleOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: RepaymentScheduleWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RepaymentSchedules from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RepaymentSchedules.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned RepaymentSchedules
    **/
    _count?: true | RepaymentScheduleCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: RepaymentScheduleAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: RepaymentScheduleSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: RepaymentScheduleMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: RepaymentScheduleMaxAggregateInputType
  }

  export type GetRepaymentScheduleAggregateType<T extends RepaymentScheduleAggregateArgs> = {
        [P in keyof T & keyof AggregateRepaymentSchedule]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateRepaymentSchedule[P]>
      : GetScalarType<T[P], AggregateRepaymentSchedule[P]>
  }




  export type RepaymentScheduleGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: RepaymentScheduleWhereInput
    orderBy?: RepaymentScheduleOrderByWithAggregationInput | RepaymentScheduleOrderByWithAggregationInput[]
    by: RepaymentScheduleScalarFieldEnum[] | RepaymentScheduleScalarFieldEnum
    having?: RepaymentScheduleScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: RepaymentScheduleCountAggregateInputType | true
    _avg?: RepaymentScheduleAvgAggregateInputType
    _sum?: RepaymentScheduleSumAggregateInputType
    _min?: RepaymentScheduleMinAggregateInputType
    _max?: RepaymentScheduleMaxAggregateInputType
  }

  export type RepaymentScheduleGroupByOutputType = {
    id: string
    loanId: string
    installmentNumber: number
    dueDate: Date
    principalAmount: Decimal
    interestAmount: Decimal
    totalAmount: Decimal
    outstandingPrincipal: Decimal
    paidPrincipal: Decimal
    paidInterest: Decimal
    isPaid: boolean
    createdAt: Date
    updatedAt: Date
    _count: RepaymentScheduleCountAggregateOutputType | null
    _avg: RepaymentScheduleAvgAggregateOutputType | null
    _sum: RepaymentScheduleSumAggregateOutputType | null
    _min: RepaymentScheduleMinAggregateOutputType | null
    _max: RepaymentScheduleMaxAggregateOutputType | null
  }

  type GetRepaymentScheduleGroupByPayload<T extends RepaymentScheduleGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<RepaymentScheduleGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof RepaymentScheduleGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], RepaymentScheduleGroupByOutputType[P]>
            : GetScalarType<T[P], RepaymentScheduleGroupByOutputType[P]>
        }
      >
    >


  export type RepaymentScheduleSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    loanId?: boolean
    installmentNumber?: boolean
    dueDate?: boolean
    principalAmount?: boolean
    interestAmount?: boolean
    totalAmount?: boolean
    outstandingPrincipal?: boolean
    paidPrincipal?: boolean
    paidInterest?: boolean
    isPaid?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    loan?: boolean | LoanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["repaymentSchedule"]>

  export type RepaymentScheduleSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    loanId?: boolean
    installmentNumber?: boolean
    dueDate?: boolean
    principalAmount?: boolean
    interestAmount?: boolean
    totalAmount?: boolean
    outstandingPrincipal?: boolean
    paidPrincipal?: boolean
    paidInterest?: boolean
    isPaid?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    loan?: boolean | LoanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["repaymentSchedule"]>

  export type RepaymentScheduleSelectScalar = {
    id?: boolean
    loanId?: boolean
    installmentNumber?: boolean
    dueDate?: boolean
    principalAmount?: boolean
    interestAmount?: boolean
    totalAmount?: boolean
    outstandingPrincipal?: boolean
    paidPrincipal?: boolean
    paidInterest?: boolean
    isPaid?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type RepaymentScheduleInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    loan?: boolean | LoanDefaultArgs<ExtArgs>
  }
  export type RepaymentScheduleIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    loan?: boolean | LoanDefaultArgs<ExtArgs>
  }

  export type $RepaymentSchedulePayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "RepaymentSchedule"
    objects: {
      loan: Prisma.$LoanPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      loanId: string
      installmentNumber: number
      dueDate: Date
      principalAmount: Prisma.Decimal
      interestAmount: Prisma.Decimal
      totalAmount: Prisma.Decimal
      outstandingPrincipal: Prisma.Decimal
      paidPrincipal: Prisma.Decimal
      paidInterest: Prisma.Decimal
      isPaid: boolean
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["repaymentSchedule"]>
    composites: {}
  }

  type RepaymentScheduleGetPayload<S extends boolean | null | undefined | RepaymentScheduleDefaultArgs> = $Result.GetResult<Prisma.$RepaymentSchedulePayload, S>

  type RepaymentScheduleCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<RepaymentScheduleFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: RepaymentScheduleCountAggregateInputType | true
    }

  export interface RepaymentScheduleDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['RepaymentSchedule'], meta: { name: 'RepaymentSchedule' } }
    /**
     * Find zero or one RepaymentSchedule that matches the filter.
     * @param {RepaymentScheduleFindUniqueArgs} args - Arguments to find a RepaymentSchedule
     * @example
     * // Get one RepaymentSchedule
     * const repaymentSchedule = await prisma.repaymentSchedule.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends RepaymentScheduleFindUniqueArgs>(args: SelectSubset<T, RepaymentScheduleFindUniqueArgs<ExtArgs>>): Prisma__RepaymentScheduleClient<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one RepaymentSchedule that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {RepaymentScheduleFindUniqueOrThrowArgs} args - Arguments to find a RepaymentSchedule
     * @example
     * // Get one RepaymentSchedule
     * const repaymentSchedule = await prisma.repaymentSchedule.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends RepaymentScheduleFindUniqueOrThrowArgs>(args: SelectSubset<T, RepaymentScheduleFindUniqueOrThrowArgs<ExtArgs>>): Prisma__RepaymentScheduleClient<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first RepaymentSchedule that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentScheduleFindFirstArgs} args - Arguments to find a RepaymentSchedule
     * @example
     * // Get one RepaymentSchedule
     * const repaymentSchedule = await prisma.repaymentSchedule.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends RepaymentScheduleFindFirstArgs>(args?: SelectSubset<T, RepaymentScheduleFindFirstArgs<ExtArgs>>): Prisma__RepaymentScheduleClient<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first RepaymentSchedule that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentScheduleFindFirstOrThrowArgs} args - Arguments to find a RepaymentSchedule
     * @example
     * // Get one RepaymentSchedule
     * const repaymentSchedule = await prisma.repaymentSchedule.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends RepaymentScheduleFindFirstOrThrowArgs>(args?: SelectSubset<T, RepaymentScheduleFindFirstOrThrowArgs<ExtArgs>>): Prisma__RepaymentScheduleClient<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more RepaymentSchedules that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentScheduleFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all RepaymentSchedules
     * const repaymentSchedules = await prisma.repaymentSchedule.findMany()
     * 
     * // Get first 10 RepaymentSchedules
     * const repaymentSchedules = await prisma.repaymentSchedule.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const repaymentScheduleWithIdOnly = await prisma.repaymentSchedule.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends RepaymentScheduleFindManyArgs>(args?: SelectSubset<T, RepaymentScheduleFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "findMany">>

    /**
     * Create a RepaymentSchedule.
     * @param {RepaymentScheduleCreateArgs} args - Arguments to create a RepaymentSchedule.
     * @example
     * // Create one RepaymentSchedule
     * const RepaymentSchedule = await prisma.repaymentSchedule.create({
     *   data: {
     *     // ... data to create a RepaymentSchedule
     *   }
     * })
     * 
     */
    create<T extends RepaymentScheduleCreateArgs>(args: SelectSubset<T, RepaymentScheduleCreateArgs<ExtArgs>>): Prisma__RepaymentScheduleClient<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many RepaymentSchedules.
     * @param {RepaymentScheduleCreateManyArgs} args - Arguments to create many RepaymentSchedules.
     * @example
     * // Create many RepaymentSchedules
     * const repaymentSchedule = await prisma.repaymentSchedule.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends RepaymentScheduleCreateManyArgs>(args?: SelectSubset<T, RepaymentScheduleCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many RepaymentSchedules and returns the data saved in the database.
     * @param {RepaymentScheduleCreateManyAndReturnArgs} args - Arguments to create many RepaymentSchedules.
     * @example
     * // Create many RepaymentSchedules
     * const repaymentSchedule = await prisma.repaymentSchedule.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many RepaymentSchedules and only return the `id`
     * const repaymentScheduleWithIdOnly = await prisma.repaymentSchedule.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends RepaymentScheduleCreateManyAndReturnArgs>(args?: SelectSubset<T, RepaymentScheduleCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a RepaymentSchedule.
     * @param {RepaymentScheduleDeleteArgs} args - Arguments to delete one RepaymentSchedule.
     * @example
     * // Delete one RepaymentSchedule
     * const RepaymentSchedule = await prisma.repaymentSchedule.delete({
     *   where: {
     *     // ... filter to delete one RepaymentSchedule
     *   }
     * })
     * 
     */
    delete<T extends RepaymentScheduleDeleteArgs>(args: SelectSubset<T, RepaymentScheduleDeleteArgs<ExtArgs>>): Prisma__RepaymentScheduleClient<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one RepaymentSchedule.
     * @param {RepaymentScheduleUpdateArgs} args - Arguments to update one RepaymentSchedule.
     * @example
     * // Update one RepaymentSchedule
     * const repaymentSchedule = await prisma.repaymentSchedule.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends RepaymentScheduleUpdateArgs>(args: SelectSubset<T, RepaymentScheduleUpdateArgs<ExtArgs>>): Prisma__RepaymentScheduleClient<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more RepaymentSchedules.
     * @param {RepaymentScheduleDeleteManyArgs} args - Arguments to filter RepaymentSchedules to delete.
     * @example
     * // Delete a few RepaymentSchedules
     * const { count } = await prisma.repaymentSchedule.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends RepaymentScheduleDeleteManyArgs>(args?: SelectSubset<T, RepaymentScheduleDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more RepaymentSchedules.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentScheduleUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many RepaymentSchedules
     * const repaymentSchedule = await prisma.repaymentSchedule.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends RepaymentScheduleUpdateManyArgs>(args: SelectSubset<T, RepaymentScheduleUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one RepaymentSchedule.
     * @param {RepaymentScheduleUpsertArgs} args - Arguments to update or create a RepaymentSchedule.
     * @example
     * // Update or create a RepaymentSchedule
     * const repaymentSchedule = await prisma.repaymentSchedule.upsert({
     *   create: {
     *     // ... data to create a RepaymentSchedule
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the RepaymentSchedule we want to update
     *   }
     * })
     */
    upsert<T extends RepaymentScheduleUpsertArgs>(args: SelectSubset<T, RepaymentScheduleUpsertArgs<ExtArgs>>): Prisma__RepaymentScheduleClient<$Result.GetResult<Prisma.$RepaymentSchedulePayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of RepaymentSchedules.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentScheduleCountArgs} args - Arguments to filter RepaymentSchedules to count.
     * @example
     * // Count the number of RepaymentSchedules
     * const count = await prisma.repaymentSchedule.count({
     *   where: {
     *     // ... the filter for the RepaymentSchedules we want to count
     *   }
     * })
    **/
    count<T extends RepaymentScheduleCountArgs>(
      args?: Subset<T, RepaymentScheduleCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], RepaymentScheduleCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a RepaymentSchedule.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentScheduleAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends RepaymentScheduleAggregateArgs>(args: Subset<T, RepaymentScheduleAggregateArgs>): Prisma.PrismaPromise<GetRepaymentScheduleAggregateType<T>>

    /**
     * Group by RepaymentSchedule.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentScheduleGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends RepaymentScheduleGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: RepaymentScheduleGroupByArgs['orderBy'] }
        : { orderBy?: RepaymentScheduleGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, RepaymentScheduleGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetRepaymentScheduleGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the RepaymentSchedule model
   */
  readonly fields: RepaymentScheduleFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for RepaymentSchedule.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__RepaymentScheduleClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    loan<T extends LoanDefaultArgs<ExtArgs> = {}>(args?: Subset<T, LoanDefaultArgs<ExtArgs>>): Prisma__LoanClient<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the RepaymentSchedule model
   */ 
  interface RepaymentScheduleFieldRefs {
    readonly id: FieldRef<"RepaymentSchedule", 'String'>
    readonly loanId: FieldRef<"RepaymentSchedule", 'String'>
    readonly installmentNumber: FieldRef<"RepaymentSchedule", 'Int'>
    readonly dueDate: FieldRef<"RepaymentSchedule", 'DateTime'>
    readonly principalAmount: FieldRef<"RepaymentSchedule", 'Decimal'>
    readonly interestAmount: FieldRef<"RepaymentSchedule", 'Decimal'>
    readonly totalAmount: FieldRef<"RepaymentSchedule", 'Decimal'>
    readonly outstandingPrincipal: FieldRef<"RepaymentSchedule", 'Decimal'>
    readonly paidPrincipal: FieldRef<"RepaymentSchedule", 'Decimal'>
    readonly paidInterest: FieldRef<"RepaymentSchedule", 'Decimal'>
    readonly isPaid: FieldRef<"RepaymentSchedule", 'Boolean'>
    readonly createdAt: FieldRef<"RepaymentSchedule", 'DateTime'>
    readonly updatedAt: FieldRef<"RepaymentSchedule", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * RepaymentSchedule findUnique
   */
  export type RepaymentScheduleFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
    /**
     * Filter, which RepaymentSchedule to fetch.
     */
    where: RepaymentScheduleWhereUniqueInput
  }

  /**
   * RepaymentSchedule findUniqueOrThrow
   */
  export type RepaymentScheduleFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
    /**
     * Filter, which RepaymentSchedule to fetch.
     */
    where: RepaymentScheduleWhereUniqueInput
  }

  /**
   * RepaymentSchedule findFirst
   */
  export type RepaymentScheduleFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
    /**
     * Filter, which RepaymentSchedule to fetch.
     */
    where?: RepaymentScheduleWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RepaymentSchedules to fetch.
     */
    orderBy?: RepaymentScheduleOrderByWithRelationInput | RepaymentScheduleOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RepaymentSchedules.
     */
    cursor?: RepaymentScheduleWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RepaymentSchedules from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RepaymentSchedules.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RepaymentSchedules.
     */
    distinct?: RepaymentScheduleScalarFieldEnum | RepaymentScheduleScalarFieldEnum[]
  }

  /**
   * RepaymentSchedule findFirstOrThrow
   */
  export type RepaymentScheduleFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
    /**
     * Filter, which RepaymentSchedule to fetch.
     */
    where?: RepaymentScheduleWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RepaymentSchedules to fetch.
     */
    orderBy?: RepaymentScheduleOrderByWithRelationInput | RepaymentScheduleOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for RepaymentSchedules.
     */
    cursor?: RepaymentScheduleWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RepaymentSchedules from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RepaymentSchedules.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of RepaymentSchedules.
     */
    distinct?: RepaymentScheduleScalarFieldEnum | RepaymentScheduleScalarFieldEnum[]
  }

  /**
   * RepaymentSchedule findMany
   */
  export type RepaymentScheduleFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
    /**
     * Filter, which RepaymentSchedules to fetch.
     */
    where?: RepaymentScheduleWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of RepaymentSchedules to fetch.
     */
    orderBy?: RepaymentScheduleOrderByWithRelationInput | RepaymentScheduleOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing RepaymentSchedules.
     */
    cursor?: RepaymentScheduleWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` RepaymentSchedules from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` RepaymentSchedules.
     */
    skip?: number
    distinct?: RepaymentScheduleScalarFieldEnum | RepaymentScheduleScalarFieldEnum[]
  }

  /**
   * RepaymentSchedule create
   */
  export type RepaymentScheduleCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
    /**
     * The data needed to create a RepaymentSchedule.
     */
    data: XOR<RepaymentScheduleCreateInput, RepaymentScheduleUncheckedCreateInput>
  }

  /**
   * RepaymentSchedule createMany
   */
  export type RepaymentScheduleCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many RepaymentSchedules.
     */
    data: RepaymentScheduleCreateManyInput | RepaymentScheduleCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * RepaymentSchedule createManyAndReturn
   */
  export type RepaymentScheduleCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many RepaymentSchedules.
     */
    data: RepaymentScheduleCreateManyInput | RepaymentScheduleCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * RepaymentSchedule update
   */
  export type RepaymentScheduleUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
    /**
     * The data needed to update a RepaymentSchedule.
     */
    data: XOR<RepaymentScheduleUpdateInput, RepaymentScheduleUncheckedUpdateInput>
    /**
     * Choose, which RepaymentSchedule to update.
     */
    where: RepaymentScheduleWhereUniqueInput
  }

  /**
   * RepaymentSchedule updateMany
   */
  export type RepaymentScheduleUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update RepaymentSchedules.
     */
    data: XOR<RepaymentScheduleUpdateManyMutationInput, RepaymentScheduleUncheckedUpdateManyInput>
    /**
     * Filter which RepaymentSchedules to update
     */
    where?: RepaymentScheduleWhereInput
  }

  /**
   * RepaymentSchedule upsert
   */
  export type RepaymentScheduleUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
    /**
     * The filter to search for the RepaymentSchedule to update in case it exists.
     */
    where: RepaymentScheduleWhereUniqueInput
    /**
     * In case the RepaymentSchedule found by the `where` argument doesn't exist, create a new RepaymentSchedule with this data.
     */
    create: XOR<RepaymentScheduleCreateInput, RepaymentScheduleUncheckedCreateInput>
    /**
     * In case the RepaymentSchedule was found with the provided `where` argument, update it with this data.
     */
    update: XOR<RepaymentScheduleUpdateInput, RepaymentScheduleUncheckedUpdateInput>
  }

  /**
   * RepaymentSchedule delete
   */
  export type RepaymentScheduleDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
    /**
     * Filter which RepaymentSchedule to delete.
     */
    where: RepaymentScheduleWhereUniqueInput
  }

  /**
   * RepaymentSchedule deleteMany
   */
  export type RepaymentScheduleDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which RepaymentSchedules to delete
     */
    where?: RepaymentScheduleWhereInput
  }

  /**
   * RepaymentSchedule without action
   */
  export type RepaymentScheduleDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the RepaymentSchedule
     */
    select?: RepaymentScheduleSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentScheduleInclude<ExtArgs> | null
  }


  /**
   * Model Repayment
   */

  export type AggregateRepayment = {
    _count: RepaymentCountAggregateOutputType | null
    _avg: RepaymentAvgAggregateOutputType | null
    _sum: RepaymentSumAggregateOutputType | null
    _min: RepaymentMinAggregateOutputType | null
    _max: RepaymentMaxAggregateOutputType | null
  }

  export type RepaymentAvgAggregateOutputType = {
    amount: Decimal | null
    principalPaid: Decimal | null
    interestPaid: Decimal | null
  }

  export type RepaymentSumAggregateOutputType = {
    amount: Decimal | null
    principalPaid: Decimal | null
    interestPaid: Decimal | null
  }

  export type RepaymentMinAggregateOutputType = {
    id: string | null
    tenantId: string | null
    loanId: string | null
    amount: Decimal | null
    principalPaid: Decimal | null
    interestPaid: Decimal | null
    date: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type RepaymentMaxAggregateOutputType = {
    id: string | null
    tenantId: string | null
    loanId: string | null
    amount: Decimal | null
    principalPaid: Decimal | null
    interestPaid: Decimal | null
    date: Date | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type RepaymentCountAggregateOutputType = {
    id: number
    tenantId: number
    loanId: number
    amount: number
    principalPaid: number
    interestPaid: number
    date: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type RepaymentAvgAggregateInputType = {
    amount?: true
    principalPaid?: true
    interestPaid?: true
  }

  export type RepaymentSumAggregateInputType = {
    amount?: true
    principalPaid?: true
    interestPaid?: true
  }

  export type RepaymentMinAggregateInputType = {
    id?: true
    tenantId?: true
    loanId?: true
    amount?: true
    principalPaid?: true
    interestPaid?: true
    date?: true
    createdAt?: true
    updatedAt?: true
  }

  export type RepaymentMaxAggregateInputType = {
    id?: true
    tenantId?: true
    loanId?: true
    amount?: true
    principalPaid?: true
    interestPaid?: true
    date?: true
    createdAt?: true
    updatedAt?: true
  }

  export type RepaymentCountAggregateInputType = {
    id?: true
    tenantId?: true
    loanId?: true
    amount?: true
    principalPaid?: true
    interestPaid?: true
    date?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type RepaymentAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Repayment to aggregate.
     */
    where?: RepaymentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Repayments to fetch.
     */
    orderBy?: RepaymentOrderByWithRelationInput | RepaymentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: RepaymentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Repayments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Repayments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned Repayments
    **/
    _count?: true | RepaymentCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: RepaymentAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: RepaymentSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: RepaymentMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: RepaymentMaxAggregateInputType
  }

  export type GetRepaymentAggregateType<T extends RepaymentAggregateArgs> = {
        [P in keyof T & keyof AggregateRepayment]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateRepayment[P]>
      : GetScalarType<T[P], AggregateRepayment[P]>
  }




  export type RepaymentGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: RepaymentWhereInput
    orderBy?: RepaymentOrderByWithAggregationInput | RepaymentOrderByWithAggregationInput[]
    by: RepaymentScalarFieldEnum[] | RepaymentScalarFieldEnum
    having?: RepaymentScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: RepaymentCountAggregateInputType | true
    _avg?: RepaymentAvgAggregateInputType
    _sum?: RepaymentSumAggregateInputType
    _min?: RepaymentMinAggregateInputType
    _max?: RepaymentMaxAggregateInputType
  }

  export type RepaymentGroupByOutputType = {
    id: string
    tenantId: string
    loanId: string
    amount: Decimal
    principalPaid: Decimal
    interestPaid: Decimal
    date: Date
    createdAt: Date
    updatedAt: Date
    _count: RepaymentCountAggregateOutputType | null
    _avg: RepaymentAvgAggregateOutputType | null
    _sum: RepaymentSumAggregateOutputType | null
    _min: RepaymentMinAggregateOutputType | null
    _max: RepaymentMaxAggregateOutputType | null
  }

  type GetRepaymentGroupByPayload<T extends RepaymentGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<RepaymentGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof RepaymentGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], RepaymentGroupByOutputType[P]>
            : GetScalarType<T[P], RepaymentGroupByOutputType[P]>
        }
      >
    >


  export type RepaymentSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    tenantId?: boolean
    loanId?: boolean
    amount?: boolean
    principalPaid?: boolean
    interestPaid?: boolean
    date?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    loan?: boolean | LoanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["repayment"]>

  export type RepaymentSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    tenantId?: boolean
    loanId?: boolean
    amount?: boolean
    principalPaid?: boolean
    interestPaid?: boolean
    date?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    loan?: boolean | LoanDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["repayment"]>

  export type RepaymentSelectScalar = {
    id?: boolean
    tenantId?: boolean
    loanId?: boolean
    amount?: boolean
    principalPaid?: boolean
    interestPaid?: boolean
    date?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }

  export type RepaymentInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    loan?: boolean | LoanDefaultArgs<ExtArgs>
  }
  export type RepaymentIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    loan?: boolean | LoanDefaultArgs<ExtArgs>
  }

  export type $RepaymentPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "Repayment"
    objects: {
      tenant: Prisma.$TenantPayload<ExtArgs>
      loan: Prisma.$LoanPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      tenantId: string
      loanId: string
      amount: Prisma.Decimal
      principalPaid: Prisma.Decimal
      interestPaid: Prisma.Decimal
      date: Date
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["repayment"]>
    composites: {}
  }

  type RepaymentGetPayload<S extends boolean | null | undefined | RepaymentDefaultArgs> = $Result.GetResult<Prisma.$RepaymentPayload, S>

  type RepaymentCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<RepaymentFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: RepaymentCountAggregateInputType | true
    }

  export interface RepaymentDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['Repayment'], meta: { name: 'Repayment' } }
    /**
     * Find zero or one Repayment that matches the filter.
     * @param {RepaymentFindUniqueArgs} args - Arguments to find a Repayment
     * @example
     * // Get one Repayment
     * const repayment = await prisma.repayment.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends RepaymentFindUniqueArgs>(args: SelectSubset<T, RepaymentFindUniqueArgs<ExtArgs>>): Prisma__RepaymentClient<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Repayment that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {RepaymentFindUniqueOrThrowArgs} args - Arguments to find a Repayment
     * @example
     * // Get one Repayment
     * const repayment = await prisma.repayment.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends RepaymentFindUniqueOrThrowArgs>(args: SelectSubset<T, RepaymentFindUniqueOrThrowArgs<ExtArgs>>): Prisma__RepaymentClient<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Repayment that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentFindFirstArgs} args - Arguments to find a Repayment
     * @example
     * // Get one Repayment
     * const repayment = await prisma.repayment.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends RepaymentFindFirstArgs>(args?: SelectSubset<T, RepaymentFindFirstArgs<ExtArgs>>): Prisma__RepaymentClient<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Repayment that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentFindFirstOrThrowArgs} args - Arguments to find a Repayment
     * @example
     * // Get one Repayment
     * const repayment = await prisma.repayment.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends RepaymentFindFirstOrThrowArgs>(args?: SelectSubset<T, RepaymentFindFirstOrThrowArgs<ExtArgs>>): Prisma__RepaymentClient<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Repayments that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Repayments
     * const repayments = await prisma.repayment.findMany()
     * 
     * // Get first 10 Repayments
     * const repayments = await prisma.repayment.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const repaymentWithIdOnly = await prisma.repayment.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends RepaymentFindManyArgs>(args?: SelectSubset<T, RepaymentFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Repayment.
     * @param {RepaymentCreateArgs} args - Arguments to create a Repayment.
     * @example
     * // Create one Repayment
     * const Repayment = await prisma.repayment.create({
     *   data: {
     *     // ... data to create a Repayment
     *   }
     * })
     * 
     */
    create<T extends RepaymentCreateArgs>(args: SelectSubset<T, RepaymentCreateArgs<ExtArgs>>): Prisma__RepaymentClient<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Repayments.
     * @param {RepaymentCreateManyArgs} args - Arguments to create many Repayments.
     * @example
     * // Create many Repayments
     * const repayment = await prisma.repayment.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends RepaymentCreateManyArgs>(args?: SelectSubset<T, RepaymentCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Repayments and returns the data saved in the database.
     * @param {RepaymentCreateManyAndReturnArgs} args - Arguments to create many Repayments.
     * @example
     * // Create many Repayments
     * const repayment = await prisma.repayment.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Repayments and only return the `id`
     * const repaymentWithIdOnly = await prisma.repayment.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends RepaymentCreateManyAndReturnArgs>(args?: SelectSubset<T, RepaymentCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Repayment.
     * @param {RepaymentDeleteArgs} args - Arguments to delete one Repayment.
     * @example
     * // Delete one Repayment
     * const Repayment = await prisma.repayment.delete({
     *   where: {
     *     // ... filter to delete one Repayment
     *   }
     * })
     * 
     */
    delete<T extends RepaymentDeleteArgs>(args: SelectSubset<T, RepaymentDeleteArgs<ExtArgs>>): Prisma__RepaymentClient<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Repayment.
     * @param {RepaymentUpdateArgs} args - Arguments to update one Repayment.
     * @example
     * // Update one Repayment
     * const repayment = await prisma.repayment.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends RepaymentUpdateArgs>(args: SelectSubset<T, RepaymentUpdateArgs<ExtArgs>>): Prisma__RepaymentClient<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Repayments.
     * @param {RepaymentDeleteManyArgs} args - Arguments to filter Repayments to delete.
     * @example
     * // Delete a few Repayments
     * const { count } = await prisma.repayment.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends RepaymentDeleteManyArgs>(args?: SelectSubset<T, RepaymentDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Repayments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Repayments
     * const repayment = await prisma.repayment.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends RepaymentUpdateManyArgs>(args: SelectSubset<T, RepaymentUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Repayment.
     * @param {RepaymentUpsertArgs} args - Arguments to update or create a Repayment.
     * @example
     * // Update or create a Repayment
     * const repayment = await prisma.repayment.upsert({
     *   create: {
     *     // ... data to create a Repayment
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Repayment we want to update
     *   }
     * })
     */
    upsert<T extends RepaymentUpsertArgs>(args: SelectSubset<T, RepaymentUpsertArgs<ExtArgs>>): Prisma__RepaymentClient<$Result.GetResult<Prisma.$RepaymentPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Repayments.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentCountArgs} args - Arguments to filter Repayments to count.
     * @example
     * // Count the number of Repayments
     * const count = await prisma.repayment.count({
     *   where: {
     *     // ... the filter for the Repayments we want to count
     *   }
     * })
    **/
    count<T extends RepaymentCountArgs>(
      args?: Subset<T, RepaymentCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], RepaymentCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Repayment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends RepaymentAggregateArgs>(args: Subset<T, RepaymentAggregateArgs>): Prisma.PrismaPromise<GetRepaymentAggregateType<T>>

    /**
     * Group by Repayment.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {RepaymentGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends RepaymentGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: RepaymentGroupByArgs['orderBy'] }
        : { orderBy?: RepaymentGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, RepaymentGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetRepaymentGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the Repayment model
   */
  readonly fields: RepaymentFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for Repayment.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__RepaymentClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    tenant<T extends TenantDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TenantDefaultArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    loan<T extends LoanDefaultArgs<ExtArgs> = {}>(args?: Subset<T, LoanDefaultArgs<ExtArgs>>): Prisma__LoanClient<$Result.GetResult<Prisma.$LoanPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the Repayment model
   */ 
  interface RepaymentFieldRefs {
    readonly id: FieldRef<"Repayment", 'String'>
    readonly tenantId: FieldRef<"Repayment", 'String'>
    readonly loanId: FieldRef<"Repayment", 'String'>
    readonly amount: FieldRef<"Repayment", 'Decimal'>
    readonly principalPaid: FieldRef<"Repayment", 'Decimal'>
    readonly interestPaid: FieldRef<"Repayment", 'Decimal'>
    readonly date: FieldRef<"Repayment", 'DateTime'>
    readonly createdAt: FieldRef<"Repayment", 'DateTime'>
    readonly updatedAt: FieldRef<"Repayment", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * Repayment findUnique
   */
  export type RepaymentFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    /**
     * Filter, which Repayment to fetch.
     */
    where: RepaymentWhereUniqueInput
  }

  /**
   * Repayment findUniqueOrThrow
   */
  export type RepaymentFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    /**
     * Filter, which Repayment to fetch.
     */
    where: RepaymentWhereUniqueInput
  }

  /**
   * Repayment findFirst
   */
  export type RepaymentFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    /**
     * Filter, which Repayment to fetch.
     */
    where?: RepaymentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Repayments to fetch.
     */
    orderBy?: RepaymentOrderByWithRelationInput | RepaymentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Repayments.
     */
    cursor?: RepaymentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Repayments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Repayments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Repayments.
     */
    distinct?: RepaymentScalarFieldEnum | RepaymentScalarFieldEnum[]
  }

  /**
   * Repayment findFirstOrThrow
   */
  export type RepaymentFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    /**
     * Filter, which Repayment to fetch.
     */
    where?: RepaymentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Repayments to fetch.
     */
    orderBy?: RepaymentOrderByWithRelationInput | RepaymentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for Repayments.
     */
    cursor?: RepaymentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Repayments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Repayments.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of Repayments.
     */
    distinct?: RepaymentScalarFieldEnum | RepaymentScalarFieldEnum[]
  }

  /**
   * Repayment findMany
   */
  export type RepaymentFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    /**
     * Filter, which Repayments to fetch.
     */
    where?: RepaymentWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of Repayments to fetch.
     */
    orderBy?: RepaymentOrderByWithRelationInput | RepaymentOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing Repayments.
     */
    cursor?: RepaymentWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` Repayments from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` Repayments.
     */
    skip?: number
    distinct?: RepaymentScalarFieldEnum | RepaymentScalarFieldEnum[]
  }

  /**
   * Repayment create
   */
  export type RepaymentCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    /**
     * The data needed to create a Repayment.
     */
    data: XOR<RepaymentCreateInput, RepaymentUncheckedCreateInput>
  }

  /**
   * Repayment createMany
   */
  export type RepaymentCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many Repayments.
     */
    data: RepaymentCreateManyInput | RepaymentCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * Repayment createManyAndReturn
   */
  export type RepaymentCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many Repayments.
     */
    data: RepaymentCreateManyInput | RepaymentCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * Repayment update
   */
  export type RepaymentUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    /**
     * The data needed to update a Repayment.
     */
    data: XOR<RepaymentUpdateInput, RepaymentUncheckedUpdateInput>
    /**
     * Choose, which Repayment to update.
     */
    where: RepaymentWhereUniqueInput
  }

  /**
   * Repayment updateMany
   */
  export type RepaymentUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update Repayments.
     */
    data: XOR<RepaymentUpdateManyMutationInput, RepaymentUncheckedUpdateManyInput>
    /**
     * Filter which Repayments to update
     */
    where?: RepaymentWhereInput
  }

  /**
   * Repayment upsert
   */
  export type RepaymentUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    /**
     * The filter to search for the Repayment to update in case it exists.
     */
    where: RepaymentWhereUniqueInput
    /**
     * In case the Repayment found by the `where` argument doesn't exist, create a new Repayment with this data.
     */
    create: XOR<RepaymentCreateInput, RepaymentUncheckedCreateInput>
    /**
     * In case the Repayment was found with the provided `where` argument, update it with this data.
     */
    update: XOR<RepaymentUpdateInput, RepaymentUncheckedUpdateInput>
  }

  /**
   * Repayment delete
   */
  export type RepaymentDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
    /**
     * Filter which Repayment to delete.
     */
    where: RepaymentWhereUniqueInput
  }

  /**
   * Repayment deleteMany
   */
  export type RepaymentDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which Repayments to delete
     */
    where?: RepaymentWhereInput
  }

  /**
   * Repayment without action
   */
  export type RepaymentDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the Repayment
     */
    select?: RepaymentSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: RepaymentInclude<ExtArgs> | null
  }


  /**
   * Model AuditLog
   */

  export type AggregateAuditLog = {
    _count: AuditLogCountAggregateOutputType | null
    _min: AuditLogMinAggregateOutputType | null
    _max: AuditLogMaxAggregateOutputType | null
  }

  export type AuditLogMinAggregateOutputType = {
    id: string | null
    tenantId: string | null
    userId: string | null
    action: string | null
    entity: string | null
    entityId: string | null
    createdAt: Date | null
  }

  export type AuditLogMaxAggregateOutputType = {
    id: string | null
    tenantId: string | null
    userId: string | null
    action: string | null
    entity: string | null
    entityId: string | null
    createdAt: Date | null
  }

  export type AuditLogCountAggregateOutputType = {
    id: number
    tenantId: number
    userId: number
    action: number
    entity: number
    entityId: number
    metadata: number
    createdAt: number
    _all: number
  }


  export type AuditLogMinAggregateInputType = {
    id?: true
    tenantId?: true
    userId?: true
    action?: true
    entity?: true
    entityId?: true
    createdAt?: true
  }

  export type AuditLogMaxAggregateInputType = {
    id?: true
    tenantId?: true
    userId?: true
    action?: true
    entity?: true
    entityId?: true
    createdAt?: true
  }

  export type AuditLogCountAggregateInputType = {
    id?: true
    tenantId?: true
    userId?: true
    action?: true
    entity?: true
    entityId?: true
    metadata?: true
    createdAt?: true
    _all?: true
  }

  export type AuditLogAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AuditLog to aggregate.
     */
    where?: AuditLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AuditLogs to fetch.
     */
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: AuditLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AuditLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AuditLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned AuditLogs
    **/
    _count?: true | AuditLogCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: AuditLogMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: AuditLogMaxAggregateInputType
  }

  export type GetAuditLogAggregateType<T extends AuditLogAggregateArgs> = {
        [P in keyof T & keyof AggregateAuditLog]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAuditLog[P]>
      : GetScalarType<T[P], AggregateAuditLog[P]>
  }




  export type AuditLogGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: AuditLogWhereInput
    orderBy?: AuditLogOrderByWithAggregationInput | AuditLogOrderByWithAggregationInput[]
    by: AuditLogScalarFieldEnum[] | AuditLogScalarFieldEnum
    having?: AuditLogScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: AuditLogCountAggregateInputType | true
    _min?: AuditLogMinAggregateInputType
    _max?: AuditLogMaxAggregateInputType
  }

  export type AuditLogGroupByOutputType = {
    id: string
    tenantId: string
    userId: string
    action: string
    entity: string
    entityId: string
    metadata: JsonValue | null
    createdAt: Date
    _count: AuditLogCountAggregateOutputType | null
    _min: AuditLogMinAggregateOutputType | null
    _max: AuditLogMaxAggregateOutputType | null
  }

  type GetAuditLogGroupByPayload<T extends AuditLogGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<AuditLogGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof AuditLogGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], AuditLogGroupByOutputType[P]>
            : GetScalarType<T[P], AuditLogGroupByOutputType[P]>
        }
      >
    >


  export type AuditLogSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    tenantId?: boolean
    userId?: boolean
    action?: boolean
    entity?: boolean
    entityId?: boolean
    metadata?: boolean
    createdAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["auditLog"]>

  export type AuditLogSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    tenantId?: boolean
    userId?: boolean
    action?: boolean
    entity?: boolean
    entityId?: boolean
    metadata?: boolean
    createdAt?: boolean
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }, ExtArgs["result"]["auditLog"]>

  export type AuditLogSelectScalar = {
    id?: boolean
    tenantId?: boolean
    userId?: boolean
    action?: boolean
    entity?: boolean
    entityId?: boolean
    metadata?: boolean
    createdAt?: boolean
  }

  export type AuditLogInclude<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }
  export type AuditLogIncludeCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    tenant?: boolean | TenantDefaultArgs<ExtArgs>
    user?: boolean | UserDefaultArgs<ExtArgs>
  }

  export type $AuditLogPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "AuditLog"
    objects: {
      tenant: Prisma.$TenantPayload<ExtArgs>
      user: Prisma.$UserPayload<ExtArgs>
    }
    scalars: $Extensions.GetPayloadResult<{
      id: string
      tenantId: string
      userId: string
      action: string
      entity: string
      entityId: string
      metadata: Prisma.JsonValue | null
      createdAt: Date
    }, ExtArgs["result"]["auditLog"]>
    composites: {}
  }

  type AuditLogGetPayload<S extends boolean | null | undefined | AuditLogDefaultArgs> = $Result.GetResult<Prisma.$AuditLogPayload, S>

  type AuditLogCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<AuditLogFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: AuditLogCountAggregateInputType | true
    }

  export interface AuditLogDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['AuditLog'], meta: { name: 'AuditLog' } }
    /**
     * Find zero or one AuditLog that matches the filter.
     * @param {AuditLogFindUniqueArgs} args - Arguments to find a AuditLog
     * @example
     * // Get one AuditLog
     * const auditLog = await prisma.auditLog.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends AuditLogFindUniqueArgs>(args: SelectSubset<T, AuditLogFindUniqueArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one AuditLog that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {AuditLogFindUniqueOrThrowArgs} args - Arguments to find a AuditLog
     * @example
     * // Get one AuditLog
     * const auditLog = await prisma.auditLog.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends AuditLogFindUniqueOrThrowArgs>(args: SelectSubset<T, AuditLogFindUniqueOrThrowArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first AuditLog that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogFindFirstArgs} args - Arguments to find a AuditLog
     * @example
     * // Get one AuditLog
     * const auditLog = await prisma.auditLog.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends AuditLogFindFirstArgs>(args?: SelectSubset<T, AuditLogFindFirstArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first AuditLog that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogFindFirstOrThrowArgs} args - Arguments to find a AuditLog
     * @example
     * // Get one AuditLog
     * const auditLog = await prisma.auditLog.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends AuditLogFindFirstOrThrowArgs>(args?: SelectSubset<T, AuditLogFindFirstOrThrowArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more AuditLogs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all AuditLogs
     * const auditLogs = await prisma.auditLog.findMany()
     * 
     * // Get first 10 AuditLogs
     * const auditLogs = await prisma.auditLog.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const auditLogWithIdOnly = await prisma.auditLog.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends AuditLogFindManyArgs>(args?: SelectSubset<T, AuditLogFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a AuditLog.
     * @param {AuditLogCreateArgs} args - Arguments to create a AuditLog.
     * @example
     * // Create one AuditLog
     * const AuditLog = await prisma.auditLog.create({
     *   data: {
     *     // ... data to create a AuditLog
     *   }
     * })
     * 
     */
    create<T extends AuditLogCreateArgs>(args: SelectSubset<T, AuditLogCreateArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many AuditLogs.
     * @param {AuditLogCreateManyArgs} args - Arguments to create many AuditLogs.
     * @example
     * // Create many AuditLogs
     * const auditLog = await prisma.auditLog.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends AuditLogCreateManyArgs>(args?: SelectSubset<T, AuditLogCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many AuditLogs and returns the data saved in the database.
     * @param {AuditLogCreateManyAndReturnArgs} args - Arguments to create many AuditLogs.
     * @example
     * // Create many AuditLogs
     * const auditLog = await prisma.auditLog.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many AuditLogs and only return the `id`
     * const auditLogWithIdOnly = await prisma.auditLog.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends AuditLogCreateManyAndReturnArgs>(args?: SelectSubset<T, AuditLogCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a AuditLog.
     * @param {AuditLogDeleteArgs} args - Arguments to delete one AuditLog.
     * @example
     * // Delete one AuditLog
     * const AuditLog = await prisma.auditLog.delete({
     *   where: {
     *     // ... filter to delete one AuditLog
     *   }
     * })
     * 
     */
    delete<T extends AuditLogDeleteArgs>(args: SelectSubset<T, AuditLogDeleteArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one AuditLog.
     * @param {AuditLogUpdateArgs} args - Arguments to update one AuditLog.
     * @example
     * // Update one AuditLog
     * const auditLog = await prisma.auditLog.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends AuditLogUpdateArgs>(args: SelectSubset<T, AuditLogUpdateArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more AuditLogs.
     * @param {AuditLogDeleteManyArgs} args - Arguments to filter AuditLogs to delete.
     * @example
     * // Delete a few AuditLogs
     * const { count } = await prisma.auditLog.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends AuditLogDeleteManyArgs>(args?: SelectSubset<T, AuditLogDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more AuditLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many AuditLogs
     * const auditLog = await prisma.auditLog.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends AuditLogUpdateManyArgs>(args: SelectSubset<T, AuditLogUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one AuditLog.
     * @param {AuditLogUpsertArgs} args - Arguments to update or create a AuditLog.
     * @example
     * // Update or create a AuditLog
     * const auditLog = await prisma.auditLog.upsert({
     *   create: {
     *     // ... data to create a AuditLog
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the AuditLog we want to update
     *   }
     * })
     */
    upsert<T extends AuditLogUpsertArgs>(args: SelectSubset<T, AuditLogUpsertArgs<ExtArgs>>): Prisma__AuditLogClient<$Result.GetResult<Prisma.$AuditLogPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of AuditLogs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogCountArgs} args - Arguments to filter AuditLogs to count.
     * @example
     * // Count the number of AuditLogs
     * const count = await prisma.auditLog.count({
     *   where: {
     *     // ... the filter for the AuditLogs we want to count
     *   }
     * })
    **/
    count<T extends AuditLogCountArgs>(
      args?: Subset<T, AuditLogCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], AuditLogCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a AuditLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends AuditLogAggregateArgs>(args: Subset<T, AuditLogAggregateArgs>): Prisma.PrismaPromise<GetAuditLogAggregateType<T>>

    /**
     * Group by AuditLog.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {AuditLogGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends AuditLogGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: AuditLogGroupByArgs['orderBy'] }
        : { orderBy?: AuditLogGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, AuditLogGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAuditLogGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the AuditLog model
   */
  readonly fields: AuditLogFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for AuditLog.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__AuditLogClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    tenant<T extends TenantDefaultArgs<ExtArgs> = {}>(args?: Subset<T, TenantDefaultArgs<ExtArgs>>): Prisma__TenantClient<$Result.GetResult<Prisma.$TenantPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    user<T extends UserDefaultArgs<ExtArgs> = {}>(args?: Subset<T, UserDefaultArgs<ExtArgs>>): Prisma__UserClient<$Result.GetResult<Prisma.$UserPayload<ExtArgs>, T, "findUniqueOrThrow"> | Null, Null, ExtArgs>
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the AuditLog model
   */ 
  interface AuditLogFieldRefs {
    readonly id: FieldRef<"AuditLog", 'String'>
    readonly tenantId: FieldRef<"AuditLog", 'String'>
    readonly userId: FieldRef<"AuditLog", 'String'>
    readonly action: FieldRef<"AuditLog", 'String'>
    readonly entity: FieldRef<"AuditLog", 'String'>
    readonly entityId: FieldRef<"AuditLog", 'String'>
    readonly metadata: FieldRef<"AuditLog", 'Json'>
    readonly createdAt: FieldRef<"AuditLog", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * AuditLog findUnique
   */
  export type AuditLogFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter, which AuditLog to fetch.
     */
    where: AuditLogWhereUniqueInput
  }

  /**
   * AuditLog findUniqueOrThrow
   */
  export type AuditLogFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter, which AuditLog to fetch.
     */
    where: AuditLogWhereUniqueInput
  }

  /**
   * AuditLog findFirst
   */
  export type AuditLogFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter, which AuditLog to fetch.
     */
    where?: AuditLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AuditLogs to fetch.
     */
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AuditLogs.
     */
    cursor?: AuditLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AuditLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AuditLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AuditLogs.
     */
    distinct?: AuditLogScalarFieldEnum | AuditLogScalarFieldEnum[]
  }

  /**
   * AuditLog findFirstOrThrow
   */
  export type AuditLogFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter, which AuditLog to fetch.
     */
    where?: AuditLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AuditLogs to fetch.
     */
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for AuditLogs.
     */
    cursor?: AuditLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AuditLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AuditLogs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of AuditLogs.
     */
    distinct?: AuditLogScalarFieldEnum | AuditLogScalarFieldEnum[]
  }

  /**
   * AuditLog findMany
   */
  export type AuditLogFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter, which AuditLogs to fetch.
     */
    where?: AuditLogWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of AuditLogs to fetch.
     */
    orderBy?: AuditLogOrderByWithRelationInput | AuditLogOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing AuditLogs.
     */
    cursor?: AuditLogWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` AuditLogs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` AuditLogs.
     */
    skip?: number
    distinct?: AuditLogScalarFieldEnum | AuditLogScalarFieldEnum[]
  }

  /**
   * AuditLog create
   */
  export type AuditLogCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * The data needed to create a AuditLog.
     */
    data: XOR<AuditLogCreateInput, AuditLogUncheckedCreateInput>
  }

  /**
   * AuditLog createMany
   */
  export type AuditLogCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many AuditLogs.
     */
    data: AuditLogCreateManyInput | AuditLogCreateManyInput[]
    skipDuplicates?: boolean
  }

  /**
   * AuditLog createManyAndReturn
   */
  export type AuditLogCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many AuditLogs.
     */
    data: AuditLogCreateManyInput | AuditLogCreateManyInput[]
    skipDuplicates?: boolean
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogIncludeCreateManyAndReturn<ExtArgs> | null
  }

  /**
   * AuditLog update
   */
  export type AuditLogUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * The data needed to update a AuditLog.
     */
    data: XOR<AuditLogUpdateInput, AuditLogUncheckedUpdateInput>
    /**
     * Choose, which AuditLog to update.
     */
    where: AuditLogWhereUniqueInput
  }

  /**
   * AuditLog updateMany
   */
  export type AuditLogUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update AuditLogs.
     */
    data: XOR<AuditLogUpdateManyMutationInput, AuditLogUncheckedUpdateManyInput>
    /**
     * Filter which AuditLogs to update
     */
    where?: AuditLogWhereInput
  }

  /**
   * AuditLog upsert
   */
  export type AuditLogUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * The filter to search for the AuditLog to update in case it exists.
     */
    where: AuditLogWhereUniqueInput
    /**
     * In case the AuditLog found by the `where` argument doesn't exist, create a new AuditLog with this data.
     */
    create: XOR<AuditLogCreateInput, AuditLogUncheckedCreateInput>
    /**
     * In case the AuditLog was found with the provided `where` argument, update it with this data.
     */
    update: XOR<AuditLogUpdateInput, AuditLogUncheckedUpdateInput>
  }

  /**
   * AuditLog delete
   */
  export type AuditLogDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
    /**
     * Filter which AuditLog to delete.
     */
    where: AuditLogWhereUniqueInput
  }

  /**
   * AuditLog deleteMany
   */
  export type AuditLogDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which AuditLogs to delete
     */
    where?: AuditLogWhereInput
  }

  /**
   * AuditLog without action
   */
  export type AuditLogDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the AuditLog
     */
    select?: AuditLogSelect<ExtArgs> | null
    /**
     * Choose, which related nodes to fetch as well
     */
    include?: AuditLogInclude<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    ReadUncommitted: 'ReadUncommitted',
    ReadCommitted: 'ReadCommitted',
    RepeatableRead: 'RepeatableRead',
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const TenantScalarFieldEnum: {
    id: 'id',
    name: 'name',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type TenantScalarFieldEnum = (typeof TenantScalarFieldEnum)[keyof typeof TenantScalarFieldEnum]


  export const UserScalarFieldEnum: {
    id: 'id',
    tenantId: 'tenantId',
    email: 'email',
    passwordHash: 'passwordHash',
    role: 'role',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type UserScalarFieldEnum = (typeof UserScalarFieldEnum)[keyof typeof UserScalarFieldEnum]


  export const BorrowerScalarFieldEnum: {
    id: 'id',
    tenantId: 'tenantId',
    firstName: 'firstName',
    lastName: 'lastName',
    phone: 'phone',
    address: 'address',
    idNumber: 'idNumber',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type BorrowerScalarFieldEnum = (typeof BorrowerScalarFieldEnum)[keyof typeof BorrowerScalarFieldEnum]


  export const LoanScalarFieldEnum: {
    id: 'id',
    tenantId: 'tenantId',
    borrowerId: 'borrowerId',
    status: 'status',
    principal: 'principal',
    annualInterestRate: 'annualInterestRate',
    termMonths: 'termMonths',
    interestMethod: 'interestMethod',
    startDate: 'startDate',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type LoanScalarFieldEnum = (typeof LoanScalarFieldEnum)[keyof typeof LoanScalarFieldEnum]


  export const RepaymentScheduleScalarFieldEnum: {
    id: 'id',
    loanId: 'loanId',
    installmentNumber: 'installmentNumber',
    dueDate: 'dueDate',
    principalAmount: 'principalAmount',
    interestAmount: 'interestAmount',
    totalAmount: 'totalAmount',
    outstandingPrincipal: 'outstandingPrincipal',
    paidPrincipal: 'paidPrincipal',
    paidInterest: 'paidInterest',
    isPaid: 'isPaid',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type RepaymentScheduleScalarFieldEnum = (typeof RepaymentScheduleScalarFieldEnum)[keyof typeof RepaymentScheduleScalarFieldEnum]


  export const RepaymentScalarFieldEnum: {
    id: 'id',
    tenantId: 'tenantId',
    loanId: 'loanId',
    amount: 'amount',
    principalPaid: 'principalPaid',
    interestPaid: 'interestPaid',
    date: 'date',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type RepaymentScalarFieldEnum = (typeof RepaymentScalarFieldEnum)[keyof typeof RepaymentScalarFieldEnum]


  export const AuditLogScalarFieldEnum: {
    id: 'id',
    tenantId: 'tenantId',
    userId: 'userId',
    action: 'action',
    entity: 'entity',
    entityId: 'entityId',
    metadata: 'metadata',
    createdAt: 'createdAt'
  };

  export type AuditLogScalarFieldEnum = (typeof AuditLogScalarFieldEnum)[keyof typeof AuditLogScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const NullableJsonNullValueInput: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull
  };

  export type NullableJsonNullValueInput = (typeof NullableJsonNullValueInput)[keyof typeof NullableJsonNullValueInput]


  export const QueryMode: {
    default: 'default',
    insensitive: 'insensitive'
  };

  export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  export const JsonNullValueFilter: {
    DbNull: typeof DbNull,
    JsonNull: typeof JsonNull,
    AnyNull: typeof AnyNull
  };

  export type JsonNullValueFilter = (typeof JsonNullValueFilter)[keyof typeof JsonNullValueFilter]


  /**
   * Field references 
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'String[]'
   */
  export type ListStringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String[]'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'DateTime[]'
   */
  export type ListDateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime[]'>
    


  /**
   * Reference to a field of type 'Role'
   */
  export type EnumRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Role'>
    


  /**
   * Reference to a field of type 'Role[]'
   */
  export type ListEnumRoleFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Role[]'>
    


  /**
   * Reference to a field of type 'LoanStatus'
   */
  export type EnumLoanStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'LoanStatus'>
    


  /**
   * Reference to a field of type 'LoanStatus[]'
   */
  export type ListEnumLoanStatusFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'LoanStatus[]'>
    


  /**
   * Reference to a field of type 'Decimal'
   */
  export type DecimalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Decimal'>
    


  /**
   * Reference to a field of type 'Decimal[]'
   */
  export type ListDecimalFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Decimal[]'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'Int[]'
   */
  export type ListIntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int[]'>
    


  /**
   * Reference to a field of type 'InterestMethod'
   */
  export type EnumInterestMethodFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'InterestMethod'>
    


  /**
   * Reference to a field of type 'InterestMethod[]'
   */
  export type ListEnumInterestMethodFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'InterestMethod[]'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    


  /**
   * Reference to a field of type 'Json'
   */
  export type JsonFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Json'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Float[]'
   */
  export type ListFloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float[]'>
    
  /**
   * Deep Input Types
   */


  export type TenantWhereInput = {
    AND?: TenantWhereInput | TenantWhereInput[]
    OR?: TenantWhereInput[]
    NOT?: TenantWhereInput | TenantWhereInput[]
    id?: StringFilter<"Tenant"> | string
    name?: StringFilter<"Tenant"> | string
    createdAt?: DateTimeFilter<"Tenant"> | Date | string
    updatedAt?: DateTimeFilter<"Tenant"> | Date | string
    users?: UserListRelationFilter
    borrowers?: BorrowerListRelationFilter
    loans?: LoanListRelationFilter
    repayments?: RepaymentListRelationFilter
    auditLogs?: AuditLogListRelationFilter
  }

  export type TenantOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    users?: UserOrderByRelationAggregateInput
    borrowers?: BorrowerOrderByRelationAggregateInput
    loans?: LoanOrderByRelationAggregateInput
    repayments?: RepaymentOrderByRelationAggregateInput
    auditLogs?: AuditLogOrderByRelationAggregateInput
  }

  export type TenantWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: TenantWhereInput | TenantWhereInput[]
    OR?: TenantWhereInput[]
    NOT?: TenantWhereInput | TenantWhereInput[]
    name?: StringFilter<"Tenant"> | string
    createdAt?: DateTimeFilter<"Tenant"> | Date | string
    updatedAt?: DateTimeFilter<"Tenant"> | Date | string
    users?: UserListRelationFilter
    borrowers?: BorrowerListRelationFilter
    loans?: LoanListRelationFilter
    repayments?: RepaymentListRelationFilter
    auditLogs?: AuditLogListRelationFilter
  }, "id">

  export type TenantOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: TenantCountOrderByAggregateInput
    _max?: TenantMaxOrderByAggregateInput
    _min?: TenantMinOrderByAggregateInput
  }

  export type TenantScalarWhereWithAggregatesInput = {
    AND?: TenantScalarWhereWithAggregatesInput | TenantScalarWhereWithAggregatesInput[]
    OR?: TenantScalarWhereWithAggregatesInput[]
    NOT?: TenantScalarWhereWithAggregatesInput | TenantScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Tenant"> | string
    name?: StringWithAggregatesFilter<"Tenant"> | string
    createdAt?: DateTimeWithAggregatesFilter<"Tenant"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Tenant"> | Date | string
  }

  export type UserWhereInput = {
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    id?: StringFilter<"User"> | string
    tenantId?: StringFilter<"User"> | string
    email?: StringFilter<"User"> | string
    passwordHash?: StringFilter<"User"> | string
    role?: EnumRoleFilter<"User"> | $Enums.Role
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
    tenant?: XOR<TenantRelationFilter, TenantWhereInput>
    auditLogs?: AuditLogListRelationFilter
  }

  export type UserOrderByWithRelationInput = {
    id?: SortOrder
    tenantId?: SortOrder
    email?: SortOrder
    passwordHash?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    tenant?: TenantOrderByWithRelationInput
    auditLogs?: AuditLogOrderByRelationAggregateInput
  }

  export type UserWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    email?: string
    AND?: UserWhereInput | UserWhereInput[]
    OR?: UserWhereInput[]
    NOT?: UserWhereInput | UserWhereInput[]
    tenantId?: StringFilter<"User"> | string
    passwordHash?: StringFilter<"User"> | string
    role?: EnumRoleFilter<"User"> | $Enums.Role
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
    tenant?: XOR<TenantRelationFilter, TenantWhereInput>
    auditLogs?: AuditLogListRelationFilter
  }, "id" | "email">

  export type UserOrderByWithAggregationInput = {
    id?: SortOrder
    tenantId?: SortOrder
    email?: SortOrder
    passwordHash?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: UserCountOrderByAggregateInput
    _max?: UserMaxOrderByAggregateInput
    _min?: UserMinOrderByAggregateInput
  }

  export type UserScalarWhereWithAggregatesInput = {
    AND?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    OR?: UserScalarWhereWithAggregatesInput[]
    NOT?: UserScalarWhereWithAggregatesInput | UserScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"User"> | string
    tenantId?: StringWithAggregatesFilter<"User"> | string
    email?: StringWithAggregatesFilter<"User"> | string
    passwordHash?: StringWithAggregatesFilter<"User"> | string
    role?: EnumRoleWithAggregatesFilter<"User"> | $Enums.Role
    createdAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"User"> | Date | string
  }

  export type BorrowerWhereInput = {
    AND?: BorrowerWhereInput | BorrowerWhereInput[]
    OR?: BorrowerWhereInput[]
    NOT?: BorrowerWhereInput | BorrowerWhereInput[]
    id?: StringFilter<"Borrower"> | string
    tenantId?: StringFilter<"Borrower"> | string
    firstName?: StringFilter<"Borrower"> | string
    lastName?: StringFilter<"Borrower"> | string
    phone?: StringNullableFilter<"Borrower"> | string | null
    address?: StringNullableFilter<"Borrower"> | string | null
    idNumber?: StringNullableFilter<"Borrower"> | string | null
    createdAt?: DateTimeFilter<"Borrower"> | Date | string
    updatedAt?: DateTimeFilter<"Borrower"> | Date | string
    tenant?: XOR<TenantRelationFilter, TenantWhereInput>
    loans?: LoanListRelationFilter
  }

  export type BorrowerOrderByWithRelationInput = {
    id?: SortOrder
    tenantId?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    phone?: SortOrderInput | SortOrder
    address?: SortOrderInput | SortOrder
    idNumber?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    tenant?: TenantOrderByWithRelationInput
    loans?: LoanOrderByRelationAggregateInput
  }

  export type BorrowerWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    idNumber?: string
    AND?: BorrowerWhereInput | BorrowerWhereInput[]
    OR?: BorrowerWhereInput[]
    NOT?: BorrowerWhereInput | BorrowerWhereInput[]
    tenantId?: StringFilter<"Borrower"> | string
    firstName?: StringFilter<"Borrower"> | string
    lastName?: StringFilter<"Borrower"> | string
    phone?: StringNullableFilter<"Borrower"> | string | null
    address?: StringNullableFilter<"Borrower"> | string | null
    createdAt?: DateTimeFilter<"Borrower"> | Date | string
    updatedAt?: DateTimeFilter<"Borrower"> | Date | string
    tenant?: XOR<TenantRelationFilter, TenantWhereInput>
    loans?: LoanListRelationFilter
  }, "id" | "idNumber">

  export type BorrowerOrderByWithAggregationInput = {
    id?: SortOrder
    tenantId?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    phone?: SortOrderInput | SortOrder
    address?: SortOrderInput | SortOrder
    idNumber?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: BorrowerCountOrderByAggregateInput
    _max?: BorrowerMaxOrderByAggregateInput
    _min?: BorrowerMinOrderByAggregateInput
  }

  export type BorrowerScalarWhereWithAggregatesInput = {
    AND?: BorrowerScalarWhereWithAggregatesInput | BorrowerScalarWhereWithAggregatesInput[]
    OR?: BorrowerScalarWhereWithAggregatesInput[]
    NOT?: BorrowerScalarWhereWithAggregatesInput | BorrowerScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Borrower"> | string
    tenantId?: StringWithAggregatesFilter<"Borrower"> | string
    firstName?: StringWithAggregatesFilter<"Borrower"> | string
    lastName?: StringWithAggregatesFilter<"Borrower"> | string
    phone?: StringNullableWithAggregatesFilter<"Borrower"> | string | null
    address?: StringNullableWithAggregatesFilter<"Borrower"> | string | null
    idNumber?: StringNullableWithAggregatesFilter<"Borrower"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"Borrower"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Borrower"> | Date | string
  }

  export type LoanWhereInput = {
    AND?: LoanWhereInput | LoanWhereInput[]
    OR?: LoanWhereInput[]
    NOT?: LoanWhereInput | LoanWhereInput[]
    id?: StringFilter<"Loan"> | string
    tenantId?: StringFilter<"Loan"> | string
    borrowerId?: StringFilter<"Loan"> | string
    status?: EnumLoanStatusFilter<"Loan"> | $Enums.LoanStatus
    principal?: DecimalFilter<"Loan"> | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFilter<"Loan"> | Decimal | DecimalJsLike | number | string
    termMonths?: IntFilter<"Loan"> | number
    interestMethod?: EnumInterestMethodFilter<"Loan"> | $Enums.InterestMethod
    startDate?: DateTimeFilter<"Loan"> | Date | string
    createdAt?: DateTimeFilter<"Loan"> | Date | string
    updatedAt?: DateTimeFilter<"Loan"> | Date | string
    tenant?: XOR<TenantRelationFilter, TenantWhereInput>
    borrower?: XOR<BorrowerRelationFilter, BorrowerWhereInput>
    schedules?: RepaymentScheduleListRelationFilter
    repayments?: RepaymentListRelationFilter
  }

  export type LoanOrderByWithRelationInput = {
    id?: SortOrder
    tenantId?: SortOrder
    borrowerId?: SortOrder
    status?: SortOrder
    principal?: SortOrder
    annualInterestRate?: SortOrder
    termMonths?: SortOrder
    interestMethod?: SortOrder
    startDate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    tenant?: TenantOrderByWithRelationInput
    borrower?: BorrowerOrderByWithRelationInput
    schedules?: RepaymentScheduleOrderByRelationAggregateInput
    repayments?: RepaymentOrderByRelationAggregateInput
  }

  export type LoanWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: LoanWhereInput | LoanWhereInput[]
    OR?: LoanWhereInput[]
    NOT?: LoanWhereInput | LoanWhereInput[]
    tenantId?: StringFilter<"Loan"> | string
    borrowerId?: StringFilter<"Loan"> | string
    status?: EnumLoanStatusFilter<"Loan"> | $Enums.LoanStatus
    principal?: DecimalFilter<"Loan"> | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFilter<"Loan"> | Decimal | DecimalJsLike | number | string
    termMonths?: IntFilter<"Loan"> | number
    interestMethod?: EnumInterestMethodFilter<"Loan"> | $Enums.InterestMethod
    startDate?: DateTimeFilter<"Loan"> | Date | string
    createdAt?: DateTimeFilter<"Loan"> | Date | string
    updatedAt?: DateTimeFilter<"Loan"> | Date | string
    tenant?: XOR<TenantRelationFilter, TenantWhereInput>
    borrower?: XOR<BorrowerRelationFilter, BorrowerWhereInput>
    schedules?: RepaymentScheduleListRelationFilter
    repayments?: RepaymentListRelationFilter
  }, "id">

  export type LoanOrderByWithAggregationInput = {
    id?: SortOrder
    tenantId?: SortOrder
    borrowerId?: SortOrder
    status?: SortOrder
    principal?: SortOrder
    annualInterestRate?: SortOrder
    termMonths?: SortOrder
    interestMethod?: SortOrder
    startDate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: LoanCountOrderByAggregateInput
    _avg?: LoanAvgOrderByAggregateInput
    _max?: LoanMaxOrderByAggregateInput
    _min?: LoanMinOrderByAggregateInput
    _sum?: LoanSumOrderByAggregateInput
  }

  export type LoanScalarWhereWithAggregatesInput = {
    AND?: LoanScalarWhereWithAggregatesInput | LoanScalarWhereWithAggregatesInput[]
    OR?: LoanScalarWhereWithAggregatesInput[]
    NOT?: LoanScalarWhereWithAggregatesInput | LoanScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Loan"> | string
    tenantId?: StringWithAggregatesFilter<"Loan"> | string
    borrowerId?: StringWithAggregatesFilter<"Loan"> | string
    status?: EnumLoanStatusWithAggregatesFilter<"Loan"> | $Enums.LoanStatus
    principal?: DecimalWithAggregatesFilter<"Loan"> | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalWithAggregatesFilter<"Loan"> | Decimal | DecimalJsLike | number | string
    termMonths?: IntWithAggregatesFilter<"Loan"> | number
    interestMethod?: EnumInterestMethodWithAggregatesFilter<"Loan"> | $Enums.InterestMethod
    startDate?: DateTimeWithAggregatesFilter<"Loan"> | Date | string
    createdAt?: DateTimeWithAggregatesFilter<"Loan"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Loan"> | Date | string
  }

  export type RepaymentScheduleWhereInput = {
    AND?: RepaymentScheduleWhereInput | RepaymentScheduleWhereInput[]
    OR?: RepaymentScheduleWhereInput[]
    NOT?: RepaymentScheduleWhereInput | RepaymentScheduleWhereInput[]
    id?: StringFilter<"RepaymentSchedule"> | string
    loanId?: StringFilter<"RepaymentSchedule"> | string
    installmentNumber?: IntFilter<"RepaymentSchedule"> | number
    dueDate?: DateTimeFilter<"RepaymentSchedule"> | Date | string
    principalAmount?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    isPaid?: BoolFilter<"RepaymentSchedule"> | boolean
    createdAt?: DateTimeFilter<"RepaymentSchedule"> | Date | string
    updatedAt?: DateTimeFilter<"RepaymentSchedule"> | Date | string
    loan?: XOR<LoanRelationFilter, LoanWhereInput>
  }

  export type RepaymentScheduleOrderByWithRelationInput = {
    id?: SortOrder
    loanId?: SortOrder
    installmentNumber?: SortOrder
    dueDate?: SortOrder
    principalAmount?: SortOrder
    interestAmount?: SortOrder
    totalAmount?: SortOrder
    outstandingPrincipal?: SortOrder
    paidPrincipal?: SortOrder
    paidInterest?: SortOrder
    isPaid?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    loan?: LoanOrderByWithRelationInput
  }

  export type RepaymentScheduleWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: RepaymentScheduleWhereInput | RepaymentScheduleWhereInput[]
    OR?: RepaymentScheduleWhereInput[]
    NOT?: RepaymentScheduleWhereInput | RepaymentScheduleWhereInput[]
    loanId?: StringFilter<"RepaymentSchedule"> | string
    installmentNumber?: IntFilter<"RepaymentSchedule"> | number
    dueDate?: DateTimeFilter<"RepaymentSchedule"> | Date | string
    principalAmount?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    isPaid?: BoolFilter<"RepaymentSchedule"> | boolean
    createdAt?: DateTimeFilter<"RepaymentSchedule"> | Date | string
    updatedAt?: DateTimeFilter<"RepaymentSchedule"> | Date | string
    loan?: XOR<LoanRelationFilter, LoanWhereInput>
  }, "id">

  export type RepaymentScheduleOrderByWithAggregationInput = {
    id?: SortOrder
    loanId?: SortOrder
    installmentNumber?: SortOrder
    dueDate?: SortOrder
    principalAmount?: SortOrder
    interestAmount?: SortOrder
    totalAmount?: SortOrder
    outstandingPrincipal?: SortOrder
    paidPrincipal?: SortOrder
    paidInterest?: SortOrder
    isPaid?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: RepaymentScheduleCountOrderByAggregateInput
    _avg?: RepaymentScheduleAvgOrderByAggregateInput
    _max?: RepaymentScheduleMaxOrderByAggregateInput
    _min?: RepaymentScheduleMinOrderByAggregateInput
    _sum?: RepaymentScheduleSumOrderByAggregateInput
  }

  export type RepaymentScheduleScalarWhereWithAggregatesInput = {
    AND?: RepaymentScheduleScalarWhereWithAggregatesInput | RepaymentScheduleScalarWhereWithAggregatesInput[]
    OR?: RepaymentScheduleScalarWhereWithAggregatesInput[]
    NOT?: RepaymentScheduleScalarWhereWithAggregatesInput | RepaymentScheduleScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"RepaymentSchedule"> | string
    loanId?: StringWithAggregatesFilter<"RepaymentSchedule"> | string
    installmentNumber?: IntWithAggregatesFilter<"RepaymentSchedule"> | number
    dueDate?: DateTimeWithAggregatesFilter<"RepaymentSchedule"> | Date | string
    principalAmount?: DecimalWithAggregatesFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalWithAggregatesFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalWithAggregatesFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalWithAggregatesFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalWithAggregatesFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalWithAggregatesFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    isPaid?: BoolWithAggregatesFilter<"RepaymentSchedule"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"RepaymentSchedule"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"RepaymentSchedule"> | Date | string
  }

  export type RepaymentWhereInput = {
    AND?: RepaymentWhereInput | RepaymentWhereInput[]
    OR?: RepaymentWhereInput[]
    NOT?: RepaymentWhereInput | RepaymentWhereInput[]
    id?: StringFilter<"Repayment"> | string
    tenantId?: StringFilter<"Repayment"> | string
    loanId?: StringFilter<"Repayment"> | string
    amount?: DecimalFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    date?: DateTimeFilter<"Repayment"> | Date | string
    createdAt?: DateTimeFilter<"Repayment"> | Date | string
    updatedAt?: DateTimeFilter<"Repayment"> | Date | string
    tenant?: XOR<TenantRelationFilter, TenantWhereInput>
    loan?: XOR<LoanRelationFilter, LoanWhereInput>
  }

  export type RepaymentOrderByWithRelationInput = {
    id?: SortOrder
    tenantId?: SortOrder
    loanId?: SortOrder
    amount?: SortOrder
    principalPaid?: SortOrder
    interestPaid?: SortOrder
    date?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    tenant?: TenantOrderByWithRelationInput
    loan?: LoanOrderByWithRelationInput
  }

  export type RepaymentWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: RepaymentWhereInput | RepaymentWhereInput[]
    OR?: RepaymentWhereInput[]
    NOT?: RepaymentWhereInput | RepaymentWhereInput[]
    tenantId?: StringFilter<"Repayment"> | string
    loanId?: StringFilter<"Repayment"> | string
    amount?: DecimalFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    date?: DateTimeFilter<"Repayment"> | Date | string
    createdAt?: DateTimeFilter<"Repayment"> | Date | string
    updatedAt?: DateTimeFilter<"Repayment"> | Date | string
    tenant?: XOR<TenantRelationFilter, TenantWhereInput>
    loan?: XOR<LoanRelationFilter, LoanWhereInput>
  }, "id">

  export type RepaymentOrderByWithAggregationInput = {
    id?: SortOrder
    tenantId?: SortOrder
    loanId?: SortOrder
    amount?: SortOrder
    principalPaid?: SortOrder
    interestPaid?: SortOrder
    date?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: RepaymentCountOrderByAggregateInput
    _avg?: RepaymentAvgOrderByAggregateInput
    _max?: RepaymentMaxOrderByAggregateInput
    _min?: RepaymentMinOrderByAggregateInput
    _sum?: RepaymentSumOrderByAggregateInput
  }

  export type RepaymentScalarWhereWithAggregatesInput = {
    AND?: RepaymentScalarWhereWithAggregatesInput | RepaymentScalarWhereWithAggregatesInput[]
    OR?: RepaymentScalarWhereWithAggregatesInput[]
    NOT?: RepaymentScalarWhereWithAggregatesInput | RepaymentScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"Repayment"> | string
    tenantId?: StringWithAggregatesFilter<"Repayment"> | string
    loanId?: StringWithAggregatesFilter<"Repayment"> | string
    amount?: DecimalWithAggregatesFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalWithAggregatesFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalWithAggregatesFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    date?: DateTimeWithAggregatesFilter<"Repayment"> | Date | string
    createdAt?: DateTimeWithAggregatesFilter<"Repayment"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"Repayment"> | Date | string
  }

  export type AuditLogWhereInput = {
    AND?: AuditLogWhereInput | AuditLogWhereInput[]
    OR?: AuditLogWhereInput[]
    NOT?: AuditLogWhereInput | AuditLogWhereInput[]
    id?: StringFilter<"AuditLog"> | string
    tenantId?: StringFilter<"AuditLog"> | string
    userId?: StringFilter<"AuditLog"> | string
    action?: StringFilter<"AuditLog"> | string
    entity?: StringFilter<"AuditLog"> | string
    entityId?: StringFilter<"AuditLog"> | string
    metadata?: JsonNullableFilter<"AuditLog">
    createdAt?: DateTimeFilter<"AuditLog"> | Date | string
    tenant?: XOR<TenantRelationFilter, TenantWhereInput>
    user?: XOR<UserRelationFilter, UserWhereInput>
  }

  export type AuditLogOrderByWithRelationInput = {
    id?: SortOrder
    tenantId?: SortOrder
    userId?: SortOrder
    action?: SortOrder
    entity?: SortOrder
    entityId?: SortOrder
    metadata?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    tenant?: TenantOrderByWithRelationInput
    user?: UserOrderByWithRelationInput
  }

  export type AuditLogWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: AuditLogWhereInput | AuditLogWhereInput[]
    OR?: AuditLogWhereInput[]
    NOT?: AuditLogWhereInput | AuditLogWhereInput[]
    tenantId?: StringFilter<"AuditLog"> | string
    userId?: StringFilter<"AuditLog"> | string
    action?: StringFilter<"AuditLog"> | string
    entity?: StringFilter<"AuditLog"> | string
    entityId?: StringFilter<"AuditLog"> | string
    metadata?: JsonNullableFilter<"AuditLog">
    createdAt?: DateTimeFilter<"AuditLog"> | Date | string
    tenant?: XOR<TenantRelationFilter, TenantWhereInput>
    user?: XOR<UserRelationFilter, UserWhereInput>
  }, "id">

  export type AuditLogOrderByWithAggregationInput = {
    id?: SortOrder
    tenantId?: SortOrder
    userId?: SortOrder
    action?: SortOrder
    entity?: SortOrder
    entityId?: SortOrder
    metadata?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: AuditLogCountOrderByAggregateInput
    _max?: AuditLogMaxOrderByAggregateInput
    _min?: AuditLogMinOrderByAggregateInput
  }

  export type AuditLogScalarWhereWithAggregatesInput = {
    AND?: AuditLogScalarWhereWithAggregatesInput | AuditLogScalarWhereWithAggregatesInput[]
    OR?: AuditLogScalarWhereWithAggregatesInput[]
    NOT?: AuditLogScalarWhereWithAggregatesInput | AuditLogScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"AuditLog"> | string
    tenantId?: StringWithAggregatesFilter<"AuditLog"> | string
    userId?: StringWithAggregatesFilter<"AuditLog"> | string
    action?: StringWithAggregatesFilter<"AuditLog"> | string
    entity?: StringWithAggregatesFilter<"AuditLog"> | string
    entityId?: StringWithAggregatesFilter<"AuditLog"> | string
    metadata?: JsonNullableWithAggregatesFilter<"AuditLog">
    createdAt?: DateTimeWithAggregatesFilter<"AuditLog"> | Date | string
  }

  export type TenantCreateInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutTenantInput
    borrowers?: BorrowerCreateNestedManyWithoutTenantInput
    loans?: LoanCreateNestedManyWithoutTenantInput
    repayments?: RepaymentCreateNestedManyWithoutTenantInput
    auditLogs?: AuditLogCreateNestedManyWithoutTenantInput
  }

  export type TenantUncheckedCreateInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutTenantInput
    borrowers?: BorrowerUncheckedCreateNestedManyWithoutTenantInput
    loans?: LoanUncheckedCreateNestedManyWithoutTenantInput
    repayments?: RepaymentUncheckedCreateNestedManyWithoutTenantInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutTenantInput
  }

  export type TenantUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutTenantNestedInput
    borrowers?: BorrowerUpdateManyWithoutTenantNestedInput
    loans?: LoanUpdateManyWithoutTenantNestedInput
    repayments?: RepaymentUpdateManyWithoutTenantNestedInput
    auditLogs?: AuditLogUpdateManyWithoutTenantNestedInput
  }

  export type TenantUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutTenantNestedInput
    borrowers?: BorrowerUncheckedUpdateManyWithoutTenantNestedInput
    loans?: LoanUncheckedUpdateManyWithoutTenantNestedInput
    repayments?: RepaymentUncheckedUpdateManyWithoutTenantNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutTenantNestedInput
  }

  export type TenantCreateManyInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type TenantUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type TenantUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserCreateInput = {
    id?: string
    email: string
    passwordHash: string
    role?: $Enums.Role
    createdAt?: Date | string
    updatedAt?: Date | string
    tenant: TenantCreateNestedOneWithoutUsersInput
    auditLogs?: AuditLogCreateNestedManyWithoutUserInput
  }

  export type UserUncheckedCreateInput = {
    id?: string
    tenantId: string
    email: string
    passwordHash: string
    role?: $Enums.Role
    createdAt?: Date | string
    updatedAt?: Date | string
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutUserInput
  }

  export type UserUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    passwordHash?: StringFieldUpdateOperationsInput | string
    role?: EnumRoleFieldUpdateOperationsInput | $Enums.Role
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutUsersNestedInput
    auditLogs?: AuditLogUpdateManyWithoutUserNestedInput
  }

  export type UserUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    passwordHash?: StringFieldUpdateOperationsInput | string
    role?: EnumRoleFieldUpdateOperationsInput | $Enums.Role
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    auditLogs?: AuditLogUncheckedUpdateManyWithoutUserNestedInput
  }

  export type UserCreateManyInput = {
    id?: string
    tenantId: string
    email: string
    passwordHash: string
    role?: $Enums.Role
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    passwordHash?: StringFieldUpdateOperationsInput | string
    role?: EnumRoleFieldUpdateOperationsInput | $Enums.Role
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    passwordHash?: StringFieldUpdateOperationsInput | string
    role?: EnumRoleFieldUpdateOperationsInput | $Enums.Role
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BorrowerCreateInput = {
    id?: string
    firstName: string
    lastName: string
    phone?: string | null
    address?: string | null
    idNumber?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    tenant: TenantCreateNestedOneWithoutBorrowersInput
    loans?: LoanCreateNestedManyWithoutBorrowerInput
  }

  export type BorrowerUncheckedCreateInput = {
    id?: string
    tenantId: string
    firstName: string
    lastName: string
    phone?: string | null
    address?: string | null
    idNumber?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    loans?: LoanUncheckedCreateNestedManyWithoutBorrowerInput
  }

  export type BorrowerUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    idNumber?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutBorrowersNestedInput
    loans?: LoanUpdateManyWithoutBorrowerNestedInput
  }

  export type BorrowerUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    idNumber?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    loans?: LoanUncheckedUpdateManyWithoutBorrowerNestedInput
  }

  export type BorrowerCreateManyInput = {
    id?: string
    tenantId: string
    firstName: string
    lastName: string
    phone?: string | null
    address?: string | null
    idNumber?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BorrowerUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    idNumber?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BorrowerUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    idNumber?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LoanCreateInput = {
    id?: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    tenant: TenantCreateNestedOneWithoutLoansInput
    borrower: BorrowerCreateNestedOneWithoutLoansInput
    schedules?: RepaymentScheduleCreateNestedManyWithoutLoanInput
    repayments?: RepaymentCreateNestedManyWithoutLoanInput
  }

  export type LoanUncheckedCreateInput = {
    id?: string
    tenantId: string
    borrowerId: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    schedules?: RepaymentScheduleUncheckedCreateNestedManyWithoutLoanInput
    repayments?: RepaymentUncheckedCreateNestedManyWithoutLoanInput
  }

  export type LoanUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutLoansNestedInput
    borrower?: BorrowerUpdateOneRequiredWithoutLoansNestedInput
    schedules?: RepaymentScheduleUpdateManyWithoutLoanNestedInput
    repayments?: RepaymentUpdateManyWithoutLoanNestedInput
  }

  export type LoanUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    borrowerId?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    schedules?: RepaymentScheduleUncheckedUpdateManyWithoutLoanNestedInput
    repayments?: RepaymentUncheckedUpdateManyWithoutLoanNestedInput
  }

  export type LoanCreateManyInput = {
    id?: string
    tenantId: string
    borrowerId: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type LoanUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LoanUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    borrowerId?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentScheduleCreateInput = {
    id?: string
    installmentNumber: number
    dueDate: Date | string
    principalAmount: Decimal | DecimalJsLike | number | string
    interestAmount: Decimal | DecimalJsLike | number | string
    totalAmount: Decimal | DecimalJsLike | number | string
    outstandingPrincipal: Decimal | DecimalJsLike | number | string
    paidPrincipal?: Decimal | DecimalJsLike | number | string
    paidInterest?: Decimal | DecimalJsLike | number | string
    isPaid?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
    loan: LoanCreateNestedOneWithoutSchedulesInput
  }

  export type RepaymentScheduleUncheckedCreateInput = {
    id?: string
    loanId: string
    installmentNumber: number
    dueDate: Date | string
    principalAmount: Decimal | DecimalJsLike | number | string
    interestAmount: Decimal | DecimalJsLike | number | string
    totalAmount: Decimal | DecimalJsLike | number | string
    outstandingPrincipal: Decimal | DecimalJsLike | number | string
    paidPrincipal?: Decimal | DecimalJsLike | number | string
    paidInterest?: Decimal | DecimalJsLike | number | string
    isPaid?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentScheduleUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    installmentNumber?: IntFieldUpdateOperationsInput | number
    dueDate?: DateTimeFieldUpdateOperationsInput | Date | string
    principalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    isPaid?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    loan?: LoanUpdateOneRequiredWithoutSchedulesNestedInput
  }

  export type RepaymentScheduleUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    loanId?: StringFieldUpdateOperationsInput | string
    installmentNumber?: IntFieldUpdateOperationsInput | number
    dueDate?: DateTimeFieldUpdateOperationsInput | Date | string
    principalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    isPaid?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentScheduleCreateManyInput = {
    id?: string
    loanId: string
    installmentNumber: number
    dueDate: Date | string
    principalAmount: Decimal | DecimalJsLike | number | string
    interestAmount: Decimal | DecimalJsLike | number | string
    totalAmount: Decimal | DecimalJsLike | number | string
    outstandingPrincipal: Decimal | DecimalJsLike | number | string
    paidPrincipal?: Decimal | DecimalJsLike | number | string
    paidInterest?: Decimal | DecimalJsLike | number | string
    isPaid?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentScheduleUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    installmentNumber?: IntFieldUpdateOperationsInput | number
    dueDate?: DateTimeFieldUpdateOperationsInput | Date | string
    principalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    isPaid?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentScheduleUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    loanId?: StringFieldUpdateOperationsInput | string
    installmentNumber?: IntFieldUpdateOperationsInput | number
    dueDate?: DateTimeFieldUpdateOperationsInput | Date | string
    principalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    isPaid?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentCreateInput = {
    id?: string
    amount: Decimal | DecimalJsLike | number | string
    principalPaid?: Decimal | DecimalJsLike | number | string
    interestPaid?: Decimal | DecimalJsLike | number | string
    date?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    tenant: TenantCreateNestedOneWithoutRepaymentsInput
    loan: LoanCreateNestedOneWithoutRepaymentsInput
  }

  export type RepaymentUncheckedCreateInput = {
    id?: string
    tenantId: string
    loanId: string
    amount: Decimal | DecimalJsLike | number | string
    principalPaid?: Decimal | DecimalJsLike | number | string
    interestPaid?: Decimal | DecimalJsLike | number | string
    date?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutRepaymentsNestedInput
    loan?: LoanUpdateOneRequiredWithoutRepaymentsNestedInput
  }

  export type RepaymentUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    loanId?: StringFieldUpdateOperationsInput | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentCreateManyInput = {
    id?: string
    tenantId: string
    loanId: string
    amount: Decimal | DecimalJsLike | number | string
    principalPaid?: Decimal | DecimalJsLike | number | string
    interestPaid?: Decimal | DecimalJsLike | number | string
    date?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    loanId?: StringFieldUpdateOperationsInput | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogCreateInput = {
    id?: string
    action: string
    entity: string
    entityId: string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    tenant: TenantCreateNestedOneWithoutAuditLogsInput
    user: UserCreateNestedOneWithoutAuditLogsInput
  }

  export type AuditLogUncheckedCreateInput = {
    id?: string
    tenantId: string
    userId: string
    action: string
    entity: string
    entityId: string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type AuditLogUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    entity?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutAuditLogsNestedInput
    user?: UserUpdateOneRequiredWithoutAuditLogsNestedInput
  }

  export type AuditLogUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    entity?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogCreateManyInput = {
    id?: string
    tenantId: string
    userId: string
    action: string
    entity: string
    entityId: string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type AuditLogUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    entity?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    entity?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type UserListRelationFilter = {
    every?: UserWhereInput
    some?: UserWhereInput
    none?: UserWhereInput
  }

  export type BorrowerListRelationFilter = {
    every?: BorrowerWhereInput
    some?: BorrowerWhereInput
    none?: BorrowerWhereInput
  }

  export type LoanListRelationFilter = {
    every?: LoanWhereInput
    some?: LoanWhereInput
    none?: LoanWhereInput
  }

  export type RepaymentListRelationFilter = {
    every?: RepaymentWhereInput
    some?: RepaymentWhereInput
    none?: RepaymentWhereInput
  }

  export type AuditLogListRelationFilter = {
    every?: AuditLogWhereInput
    some?: AuditLogWhereInput
    none?: AuditLogWhereInput
  }

  export type UserOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type BorrowerOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type LoanOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type RepaymentOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type AuditLogOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type TenantCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TenantMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type TenantMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type EnumRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.Role | EnumRoleFieldRefInput<$PrismaModel>
    in?: $Enums.Role[] | ListEnumRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.Role[] | ListEnumRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumRoleFilter<$PrismaModel> | $Enums.Role
  }

  export type TenantRelationFilter = {
    is?: TenantWhereInput
    isNot?: TenantWhereInput
  }

  export type UserCountOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    email?: SortOrder
    passwordHash?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserMaxOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    email?: SortOrder
    passwordHash?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type UserMinOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    email?: SortOrder
    passwordHash?: SortOrder
    role?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type EnumRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Role | EnumRoleFieldRefInput<$PrismaModel>
    in?: $Enums.Role[] | ListEnumRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.Role[] | ListEnumRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumRoleWithAggregatesFilter<$PrismaModel> | $Enums.Role
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumRoleFilter<$PrismaModel>
    _max?: NestedEnumRoleFilter<$PrismaModel>
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type BorrowerCountOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    phone?: SortOrder
    address?: SortOrder
    idNumber?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BorrowerMaxOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    phone?: SortOrder
    address?: SortOrder
    idNumber?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type BorrowerMinOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    firstName?: SortOrder
    lastName?: SortOrder
    phone?: SortOrder
    address?: SortOrder
    idNumber?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    mode?: QueryMode
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type EnumLoanStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.LoanStatus | EnumLoanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.LoanStatus[] | ListEnumLoanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.LoanStatus[] | ListEnumLoanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumLoanStatusFilter<$PrismaModel> | $Enums.LoanStatus
  }

  export type DecimalFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type EnumInterestMethodFilter<$PrismaModel = never> = {
    equals?: $Enums.InterestMethod | EnumInterestMethodFieldRefInput<$PrismaModel>
    in?: $Enums.InterestMethod[] | ListEnumInterestMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.InterestMethod[] | ListEnumInterestMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumInterestMethodFilter<$PrismaModel> | $Enums.InterestMethod
  }

  export type BorrowerRelationFilter = {
    is?: BorrowerWhereInput
    isNot?: BorrowerWhereInput
  }

  export type RepaymentScheduleListRelationFilter = {
    every?: RepaymentScheduleWhereInput
    some?: RepaymentScheduleWhereInput
    none?: RepaymentScheduleWhereInput
  }

  export type RepaymentScheduleOrderByRelationAggregateInput = {
    _count?: SortOrder
  }

  export type LoanCountOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    borrowerId?: SortOrder
    status?: SortOrder
    principal?: SortOrder
    annualInterestRate?: SortOrder
    termMonths?: SortOrder
    interestMethod?: SortOrder
    startDate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type LoanAvgOrderByAggregateInput = {
    principal?: SortOrder
    annualInterestRate?: SortOrder
    termMonths?: SortOrder
  }

  export type LoanMaxOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    borrowerId?: SortOrder
    status?: SortOrder
    principal?: SortOrder
    annualInterestRate?: SortOrder
    termMonths?: SortOrder
    interestMethod?: SortOrder
    startDate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type LoanMinOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    borrowerId?: SortOrder
    status?: SortOrder
    principal?: SortOrder
    annualInterestRate?: SortOrder
    termMonths?: SortOrder
    interestMethod?: SortOrder
    startDate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type LoanSumOrderByAggregateInput = {
    principal?: SortOrder
    annualInterestRate?: SortOrder
    termMonths?: SortOrder
  }

  export type EnumLoanStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.LoanStatus | EnumLoanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.LoanStatus[] | ListEnumLoanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.LoanStatus[] | ListEnumLoanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumLoanStatusWithAggregatesFilter<$PrismaModel> | $Enums.LoanStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumLoanStatusFilter<$PrismaModel>
    _max?: NestedEnumLoanStatusFilter<$PrismaModel>
  }

  export type DecimalWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalWithAggregatesFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedDecimalFilter<$PrismaModel>
    _sum?: NestedDecimalFilter<$PrismaModel>
    _min?: NestedDecimalFilter<$PrismaModel>
    _max?: NestedDecimalFilter<$PrismaModel>
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type EnumInterestMethodWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.InterestMethod | EnumInterestMethodFieldRefInput<$PrismaModel>
    in?: $Enums.InterestMethod[] | ListEnumInterestMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.InterestMethod[] | ListEnumInterestMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumInterestMethodWithAggregatesFilter<$PrismaModel> | $Enums.InterestMethod
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumInterestMethodFilter<$PrismaModel>
    _max?: NestedEnumInterestMethodFilter<$PrismaModel>
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type LoanRelationFilter = {
    is?: LoanWhereInput
    isNot?: LoanWhereInput
  }

  export type RepaymentScheduleCountOrderByAggregateInput = {
    id?: SortOrder
    loanId?: SortOrder
    installmentNumber?: SortOrder
    dueDate?: SortOrder
    principalAmount?: SortOrder
    interestAmount?: SortOrder
    totalAmount?: SortOrder
    outstandingPrincipal?: SortOrder
    paidPrincipal?: SortOrder
    paidInterest?: SortOrder
    isPaid?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type RepaymentScheduleAvgOrderByAggregateInput = {
    installmentNumber?: SortOrder
    principalAmount?: SortOrder
    interestAmount?: SortOrder
    totalAmount?: SortOrder
    outstandingPrincipal?: SortOrder
    paidPrincipal?: SortOrder
    paidInterest?: SortOrder
  }

  export type RepaymentScheduleMaxOrderByAggregateInput = {
    id?: SortOrder
    loanId?: SortOrder
    installmentNumber?: SortOrder
    dueDate?: SortOrder
    principalAmount?: SortOrder
    interestAmount?: SortOrder
    totalAmount?: SortOrder
    outstandingPrincipal?: SortOrder
    paidPrincipal?: SortOrder
    paidInterest?: SortOrder
    isPaid?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type RepaymentScheduleMinOrderByAggregateInput = {
    id?: SortOrder
    loanId?: SortOrder
    installmentNumber?: SortOrder
    dueDate?: SortOrder
    principalAmount?: SortOrder
    interestAmount?: SortOrder
    totalAmount?: SortOrder
    outstandingPrincipal?: SortOrder
    paidPrincipal?: SortOrder
    paidInterest?: SortOrder
    isPaid?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type RepaymentScheduleSumOrderByAggregateInput = {
    installmentNumber?: SortOrder
    principalAmount?: SortOrder
    interestAmount?: SortOrder
    totalAmount?: SortOrder
    outstandingPrincipal?: SortOrder
    paidPrincipal?: SortOrder
    paidInterest?: SortOrder
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type RepaymentCountOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    loanId?: SortOrder
    amount?: SortOrder
    principalPaid?: SortOrder
    interestPaid?: SortOrder
    date?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type RepaymentAvgOrderByAggregateInput = {
    amount?: SortOrder
    principalPaid?: SortOrder
    interestPaid?: SortOrder
  }

  export type RepaymentMaxOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    loanId?: SortOrder
    amount?: SortOrder
    principalPaid?: SortOrder
    interestPaid?: SortOrder
    date?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type RepaymentMinOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    loanId?: SortOrder
    amount?: SortOrder
    principalPaid?: SortOrder
    interestPaid?: SortOrder
    date?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type RepaymentSumOrderByAggregateInput = {
    amount?: SortOrder
    principalPaid?: SortOrder
    interestPaid?: SortOrder
  }
  export type JsonNullableFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type UserRelationFilter = {
    is?: UserWhereInput
    isNot?: UserWhereInput
  }

  export type AuditLogCountOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    userId?: SortOrder
    action?: SortOrder
    entity?: SortOrder
    entityId?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
  }

  export type AuditLogMaxOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    userId?: SortOrder
    action?: SortOrder
    entity?: SortOrder
    entityId?: SortOrder
    createdAt?: SortOrder
  }

  export type AuditLogMinOrderByAggregateInput = {
    id?: SortOrder
    tenantId?: SortOrder
    userId?: SortOrder
    action?: SortOrder
    entity?: SortOrder
    entityId?: SortOrder
    createdAt?: SortOrder
  }
  export type JsonNullableWithAggregatesFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, Exclude<keyof Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>,
        Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<JsonNullableWithAggregatesFilterBase<$PrismaModel>>, 'path'>>

  export type JsonNullableWithAggregatesFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedJsonNullableFilter<$PrismaModel>
    _max?: NestedJsonNullableFilter<$PrismaModel>
  }

  export type UserCreateNestedManyWithoutTenantInput = {
    create?: XOR<UserCreateWithoutTenantInput, UserUncheckedCreateWithoutTenantInput> | UserCreateWithoutTenantInput[] | UserUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: UserCreateOrConnectWithoutTenantInput | UserCreateOrConnectWithoutTenantInput[]
    createMany?: UserCreateManyTenantInputEnvelope
    connect?: UserWhereUniqueInput | UserWhereUniqueInput[]
  }

  export type BorrowerCreateNestedManyWithoutTenantInput = {
    create?: XOR<BorrowerCreateWithoutTenantInput, BorrowerUncheckedCreateWithoutTenantInput> | BorrowerCreateWithoutTenantInput[] | BorrowerUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: BorrowerCreateOrConnectWithoutTenantInput | BorrowerCreateOrConnectWithoutTenantInput[]
    createMany?: BorrowerCreateManyTenantInputEnvelope
    connect?: BorrowerWhereUniqueInput | BorrowerWhereUniqueInput[]
  }

  export type LoanCreateNestedManyWithoutTenantInput = {
    create?: XOR<LoanCreateWithoutTenantInput, LoanUncheckedCreateWithoutTenantInput> | LoanCreateWithoutTenantInput[] | LoanUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: LoanCreateOrConnectWithoutTenantInput | LoanCreateOrConnectWithoutTenantInput[]
    createMany?: LoanCreateManyTenantInputEnvelope
    connect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
  }

  export type RepaymentCreateNestedManyWithoutTenantInput = {
    create?: XOR<RepaymentCreateWithoutTenantInput, RepaymentUncheckedCreateWithoutTenantInput> | RepaymentCreateWithoutTenantInput[] | RepaymentUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: RepaymentCreateOrConnectWithoutTenantInput | RepaymentCreateOrConnectWithoutTenantInput[]
    createMany?: RepaymentCreateManyTenantInputEnvelope
    connect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
  }

  export type AuditLogCreateNestedManyWithoutTenantInput = {
    create?: XOR<AuditLogCreateWithoutTenantInput, AuditLogUncheckedCreateWithoutTenantInput> | AuditLogCreateWithoutTenantInput[] | AuditLogUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutTenantInput | AuditLogCreateOrConnectWithoutTenantInput[]
    createMany?: AuditLogCreateManyTenantInputEnvelope
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
  }

  export type UserUncheckedCreateNestedManyWithoutTenantInput = {
    create?: XOR<UserCreateWithoutTenantInput, UserUncheckedCreateWithoutTenantInput> | UserCreateWithoutTenantInput[] | UserUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: UserCreateOrConnectWithoutTenantInput | UserCreateOrConnectWithoutTenantInput[]
    createMany?: UserCreateManyTenantInputEnvelope
    connect?: UserWhereUniqueInput | UserWhereUniqueInput[]
  }

  export type BorrowerUncheckedCreateNestedManyWithoutTenantInput = {
    create?: XOR<BorrowerCreateWithoutTenantInput, BorrowerUncheckedCreateWithoutTenantInput> | BorrowerCreateWithoutTenantInput[] | BorrowerUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: BorrowerCreateOrConnectWithoutTenantInput | BorrowerCreateOrConnectWithoutTenantInput[]
    createMany?: BorrowerCreateManyTenantInputEnvelope
    connect?: BorrowerWhereUniqueInput | BorrowerWhereUniqueInput[]
  }

  export type LoanUncheckedCreateNestedManyWithoutTenantInput = {
    create?: XOR<LoanCreateWithoutTenantInput, LoanUncheckedCreateWithoutTenantInput> | LoanCreateWithoutTenantInput[] | LoanUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: LoanCreateOrConnectWithoutTenantInput | LoanCreateOrConnectWithoutTenantInput[]
    createMany?: LoanCreateManyTenantInputEnvelope
    connect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
  }

  export type RepaymentUncheckedCreateNestedManyWithoutTenantInput = {
    create?: XOR<RepaymentCreateWithoutTenantInput, RepaymentUncheckedCreateWithoutTenantInput> | RepaymentCreateWithoutTenantInput[] | RepaymentUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: RepaymentCreateOrConnectWithoutTenantInput | RepaymentCreateOrConnectWithoutTenantInput[]
    createMany?: RepaymentCreateManyTenantInputEnvelope
    connect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
  }

  export type AuditLogUncheckedCreateNestedManyWithoutTenantInput = {
    create?: XOR<AuditLogCreateWithoutTenantInput, AuditLogUncheckedCreateWithoutTenantInput> | AuditLogCreateWithoutTenantInput[] | AuditLogUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutTenantInput | AuditLogCreateOrConnectWithoutTenantInput[]
    createMany?: AuditLogCreateManyTenantInputEnvelope
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type UserUpdateManyWithoutTenantNestedInput = {
    create?: XOR<UserCreateWithoutTenantInput, UserUncheckedCreateWithoutTenantInput> | UserCreateWithoutTenantInput[] | UserUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: UserCreateOrConnectWithoutTenantInput | UserCreateOrConnectWithoutTenantInput[]
    upsert?: UserUpsertWithWhereUniqueWithoutTenantInput | UserUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: UserCreateManyTenantInputEnvelope
    set?: UserWhereUniqueInput | UserWhereUniqueInput[]
    disconnect?: UserWhereUniqueInput | UserWhereUniqueInput[]
    delete?: UserWhereUniqueInput | UserWhereUniqueInput[]
    connect?: UserWhereUniqueInput | UserWhereUniqueInput[]
    update?: UserUpdateWithWhereUniqueWithoutTenantInput | UserUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: UserUpdateManyWithWhereWithoutTenantInput | UserUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: UserScalarWhereInput | UserScalarWhereInput[]
  }

  export type BorrowerUpdateManyWithoutTenantNestedInput = {
    create?: XOR<BorrowerCreateWithoutTenantInput, BorrowerUncheckedCreateWithoutTenantInput> | BorrowerCreateWithoutTenantInput[] | BorrowerUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: BorrowerCreateOrConnectWithoutTenantInput | BorrowerCreateOrConnectWithoutTenantInput[]
    upsert?: BorrowerUpsertWithWhereUniqueWithoutTenantInput | BorrowerUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: BorrowerCreateManyTenantInputEnvelope
    set?: BorrowerWhereUniqueInput | BorrowerWhereUniqueInput[]
    disconnect?: BorrowerWhereUniqueInput | BorrowerWhereUniqueInput[]
    delete?: BorrowerWhereUniqueInput | BorrowerWhereUniqueInput[]
    connect?: BorrowerWhereUniqueInput | BorrowerWhereUniqueInput[]
    update?: BorrowerUpdateWithWhereUniqueWithoutTenantInput | BorrowerUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: BorrowerUpdateManyWithWhereWithoutTenantInput | BorrowerUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: BorrowerScalarWhereInput | BorrowerScalarWhereInput[]
  }

  export type LoanUpdateManyWithoutTenantNestedInput = {
    create?: XOR<LoanCreateWithoutTenantInput, LoanUncheckedCreateWithoutTenantInput> | LoanCreateWithoutTenantInput[] | LoanUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: LoanCreateOrConnectWithoutTenantInput | LoanCreateOrConnectWithoutTenantInput[]
    upsert?: LoanUpsertWithWhereUniqueWithoutTenantInput | LoanUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: LoanCreateManyTenantInputEnvelope
    set?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    disconnect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    delete?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    connect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    update?: LoanUpdateWithWhereUniqueWithoutTenantInput | LoanUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: LoanUpdateManyWithWhereWithoutTenantInput | LoanUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: LoanScalarWhereInput | LoanScalarWhereInput[]
  }

  export type RepaymentUpdateManyWithoutTenantNestedInput = {
    create?: XOR<RepaymentCreateWithoutTenantInput, RepaymentUncheckedCreateWithoutTenantInput> | RepaymentCreateWithoutTenantInput[] | RepaymentUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: RepaymentCreateOrConnectWithoutTenantInput | RepaymentCreateOrConnectWithoutTenantInput[]
    upsert?: RepaymentUpsertWithWhereUniqueWithoutTenantInput | RepaymentUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: RepaymentCreateManyTenantInputEnvelope
    set?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    disconnect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    delete?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    connect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    update?: RepaymentUpdateWithWhereUniqueWithoutTenantInput | RepaymentUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: RepaymentUpdateManyWithWhereWithoutTenantInput | RepaymentUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: RepaymentScalarWhereInput | RepaymentScalarWhereInput[]
  }

  export type AuditLogUpdateManyWithoutTenantNestedInput = {
    create?: XOR<AuditLogCreateWithoutTenantInput, AuditLogUncheckedCreateWithoutTenantInput> | AuditLogCreateWithoutTenantInput[] | AuditLogUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutTenantInput | AuditLogCreateOrConnectWithoutTenantInput[]
    upsert?: AuditLogUpsertWithWhereUniqueWithoutTenantInput | AuditLogUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: AuditLogCreateManyTenantInputEnvelope
    set?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    disconnect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    delete?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    update?: AuditLogUpdateWithWhereUniqueWithoutTenantInput | AuditLogUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: AuditLogUpdateManyWithWhereWithoutTenantInput | AuditLogUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
  }

  export type UserUncheckedUpdateManyWithoutTenantNestedInput = {
    create?: XOR<UserCreateWithoutTenantInput, UserUncheckedCreateWithoutTenantInput> | UserCreateWithoutTenantInput[] | UserUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: UserCreateOrConnectWithoutTenantInput | UserCreateOrConnectWithoutTenantInput[]
    upsert?: UserUpsertWithWhereUniqueWithoutTenantInput | UserUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: UserCreateManyTenantInputEnvelope
    set?: UserWhereUniqueInput | UserWhereUniqueInput[]
    disconnect?: UserWhereUniqueInput | UserWhereUniqueInput[]
    delete?: UserWhereUniqueInput | UserWhereUniqueInput[]
    connect?: UserWhereUniqueInput | UserWhereUniqueInput[]
    update?: UserUpdateWithWhereUniqueWithoutTenantInput | UserUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: UserUpdateManyWithWhereWithoutTenantInput | UserUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: UserScalarWhereInput | UserScalarWhereInput[]
  }

  export type BorrowerUncheckedUpdateManyWithoutTenantNestedInput = {
    create?: XOR<BorrowerCreateWithoutTenantInput, BorrowerUncheckedCreateWithoutTenantInput> | BorrowerCreateWithoutTenantInput[] | BorrowerUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: BorrowerCreateOrConnectWithoutTenantInput | BorrowerCreateOrConnectWithoutTenantInput[]
    upsert?: BorrowerUpsertWithWhereUniqueWithoutTenantInput | BorrowerUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: BorrowerCreateManyTenantInputEnvelope
    set?: BorrowerWhereUniqueInput | BorrowerWhereUniqueInput[]
    disconnect?: BorrowerWhereUniqueInput | BorrowerWhereUniqueInput[]
    delete?: BorrowerWhereUniqueInput | BorrowerWhereUniqueInput[]
    connect?: BorrowerWhereUniqueInput | BorrowerWhereUniqueInput[]
    update?: BorrowerUpdateWithWhereUniqueWithoutTenantInput | BorrowerUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: BorrowerUpdateManyWithWhereWithoutTenantInput | BorrowerUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: BorrowerScalarWhereInput | BorrowerScalarWhereInput[]
  }

  export type LoanUncheckedUpdateManyWithoutTenantNestedInput = {
    create?: XOR<LoanCreateWithoutTenantInput, LoanUncheckedCreateWithoutTenantInput> | LoanCreateWithoutTenantInput[] | LoanUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: LoanCreateOrConnectWithoutTenantInput | LoanCreateOrConnectWithoutTenantInput[]
    upsert?: LoanUpsertWithWhereUniqueWithoutTenantInput | LoanUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: LoanCreateManyTenantInputEnvelope
    set?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    disconnect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    delete?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    connect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    update?: LoanUpdateWithWhereUniqueWithoutTenantInput | LoanUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: LoanUpdateManyWithWhereWithoutTenantInput | LoanUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: LoanScalarWhereInput | LoanScalarWhereInput[]
  }

  export type RepaymentUncheckedUpdateManyWithoutTenantNestedInput = {
    create?: XOR<RepaymentCreateWithoutTenantInput, RepaymentUncheckedCreateWithoutTenantInput> | RepaymentCreateWithoutTenantInput[] | RepaymentUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: RepaymentCreateOrConnectWithoutTenantInput | RepaymentCreateOrConnectWithoutTenantInput[]
    upsert?: RepaymentUpsertWithWhereUniqueWithoutTenantInput | RepaymentUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: RepaymentCreateManyTenantInputEnvelope
    set?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    disconnect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    delete?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    connect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    update?: RepaymentUpdateWithWhereUniqueWithoutTenantInput | RepaymentUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: RepaymentUpdateManyWithWhereWithoutTenantInput | RepaymentUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: RepaymentScalarWhereInput | RepaymentScalarWhereInput[]
  }

  export type AuditLogUncheckedUpdateManyWithoutTenantNestedInput = {
    create?: XOR<AuditLogCreateWithoutTenantInput, AuditLogUncheckedCreateWithoutTenantInput> | AuditLogCreateWithoutTenantInput[] | AuditLogUncheckedCreateWithoutTenantInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutTenantInput | AuditLogCreateOrConnectWithoutTenantInput[]
    upsert?: AuditLogUpsertWithWhereUniqueWithoutTenantInput | AuditLogUpsertWithWhereUniqueWithoutTenantInput[]
    createMany?: AuditLogCreateManyTenantInputEnvelope
    set?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    disconnect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    delete?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    update?: AuditLogUpdateWithWhereUniqueWithoutTenantInput | AuditLogUpdateWithWhereUniqueWithoutTenantInput[]
    updateMany?: AuditLogUpdateManyWithWhereWithoutTenantInput | AuditLogUpdateManyWithWhereWithoutTenantInput[]
    deleteMany?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
  }

  export type TenantCreateNestedOneWithoutUsersInput = {
    create?: XOR<TenantCreateWithoutUsersInput, TenantUncheckedCreateWithoutUsersInput>
    connectOrCreate?: TenantCreateOrConnectWithoutUsersInput
    connect?: TenantWhereUniqueInput
  }

  export type AuditLogCreateNestedManyWithoutUserInput = {
    create?: XOR<AuditLogCreateWithoutUserInput, AuditLogUncheckedCreateWithoutUserInput> | AuditLogCreateWithoutUserInput[] | AuditLogUncheckedCreateWithoutUserInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutUserInput | AuditLogCreateOrConnectWithoutUserInput[]
    createMany?: AuditLogCreateManyUserInputEnvelope
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
  }

  export type AuditLogUncheckedCreateNestedManyWithoutUserInput = {
    create?: XOR<AuditLogCreateWithoutUserInput, AuditLogUncheckedCreateWithoutUserInput> | AuditLogCreateWithoutUserInput[] | AuditLogUncheckedCreateWithoutUserInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutUserInput | AuditLogCreateOrConnectWithoutUserInput[]
    createMany?: AuditLogCreateManyUserInputEnvelope
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
  }

  export type EnumRoleFieldUpdateOperationsInput = {
    set?: $Enums.Role
  }

  export type TenantUpdateOneRequiredWithoutUsersNestedInput = {
    create?: XOR<TenantCreateWithoutUsersInput, TenantUncheckedCreateWithoutUsersInput>
    connectOrCreate?: TenantCreateOrConnectWithoutUsersInput
    upsert?: TenantUpsertWithoutUsersInput
    connect?: TenantWhereUniqueInput
    update?: XOR<XOR<TenantUpdateToOneWithWhereWithoutUsersInput, TenantUpdateWithoutUsersInput>, TenantUncheckedUpdateWithoutUsersInput>
  }

  export type AuditLogUpdateManyWithoutUserNestedInput = {
    create?: XOR<AuditLogCreateWithoutUserInput, AuditLogUncheckedCreateWithoutUserInput> | AuditLogCreateWithoutUserInput[] | AuditLogUncheckedCreateWithoutUserInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutUserInput | AuditLogCreateOrConnectWithoutUserInput[]
    upsert?: AuditLogUpsertWithWhereUniqueWithoutUserInput | AuditLogUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: AuditLogCreateManyUserInputEnvelope
    set?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    disconnect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    delete?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    update?: AuditLogUpdateWithWhereUniqueWithoutUserInput | AuditLogUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: AuditLogUpdateManyWithWhereWithoutUserInput | AuditLogUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
  }

  export type AuditLogUncheckedUpdateManyWithoutUserNestedInput = {
    create?: XOR<AuditLogCreateWithoutUserInput, AuditLogUncheckedCreateWithoutUserInput> | AuditLogCreateWithoutUserInput[] | AuditLogUncheckedCreateWithoutUserInput[]
    connectOrCreate?: AuditLogCreateOrConnectWithoutUserInput | AuditLogCreateOrConnectWithoutUserInput[]
    upsert?: AuditLogUpsertWithWhereUniqueWithoutUserInput | AuditLogUpsertWithWhereUniqueWithoutUserInput[]
    createMany?: AuditLogCreateManyUserInputEnvelope
    set?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    disconnect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    delete?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    connect?: AuditLogWhereUniqueInput | AuditLogWhereUniqueInput[]
    update?: AuditLogUpdateWithWhereUniqueWithoutUserInput | AuditLogUpdateWithWhereUniqueWithoutUserInput[]
    updateMany?: AuditLogUpdateManyWithWhereWithoutUserInput | AuditLogUpdateManyWithWhereWithoutUserInput[]
    deleteMany?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
  }

  export type TenantCreateNestedOneWithoutBorrowersInput = {
    create?: XOR<TenantCreateWithoutBorrowersInput, TenantUncheckedCreateWithoutBorrowersInput>
    connectOrCreate?: TenantCreateOrConnectWithoutBorrowersInput
    connect?: TenantWhereUniqueInput
  }

  export type LoanCreateNestedManyWithoutBorrowerInput = {
    create?: XOR<LoanCreateWithoutBorrowerInput, LoanUncheckedCreateWithoutBorrowerInput> | LoanCreateWithoutBorrowerInput[] | LoanUncheckedCreateWithoutBorrowerInput[]
    connectOrCreate?: LoanCreateOrConnectWithoutBorrowerInput | LoanCreateOrConnectWithoutBorrowerInput[]
    createMany?: LoanCreateManyBorrowerInputEnvelope
    connect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
  }

  export type LoanUncheckedCreateNestedManyWithoutBorrowerInput = {
    create?: XOR<LoanCreateWithoutBorrowerInput, LoanUncheckedCreateWithoutBorrowerInput> | LoanCreateWithoutBorrowerInput[] | LoanUncheckedCreateWithoutBorrowerInput[]
    connectOrCreate?: LoanCreateOrConnectWithoutBorrowerInput | LoanCreateOrConnectWithoutBorrowerInput[]
    createMany?: LoanCreateManyBorrowerInputEnvelope
    connect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type TenantUpdateOneRequiredWithoutBorrowersNestedInput = {
    create?: XOR<TenantCreateWithoutBorrowersInput, TenantUncheckedCreateWithoutBorrowersInput>
    connectOrCreate?: TenantCreateOrConnectWithoutBorrowersInput
    upsert?: TenantUpsertWithoutBorrowersInput
    connect?: TenantWhereUniqueInput
    update?: XOR<XOR<TenantUpdateToOneWithWhereWithoutBorrowersInput, TenantUpdateWithoutBorrowersInput>, TenantUncheckedUpdateWithoutBorrowersInput>
  }

  export type LoanUpdateManyWithoutBorrowerNestedInput = {
    create?: XOR<LoanCreateWithoutBorrowerInput, LoanUncheckedCreateWithoutBorrowerInput> | LoanCreateWithoutBorrowerInput[] | LoanUncheckedCreateWithoutBorrowerInput[]
    connectOrCreate?: LoanCreateOrConnectWithoutBorrowerInput | LoanCreateOrConnectWithoutBorrowerInput[]
    upsert?: LoanUpsertWithWhereUniqueWithoutBorrowerInput | LoanUpsertWithWhereUniqueWithoutBorrowerInput[]
    createMany?: LoanCreateManyBorrowerInputEnvelope
    set?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    disconnect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    delete?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    connect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    update?: LoanUpdateWithWhereUniqueWithoutBorrowerInput | LoanUpdateWithWhereUniqueWithoutBorrowerInput[]
    updateMany?: LoanUpdateManyWithWhereWithoutBorrowerInput | LoanUpdateManyWithWhereWithoutBorrowerInput[]
    deleteMany?: LoanScalarWhereInput | LoanScalarWhereInput[]
  }

  export type LoanUncheckedUpdateManyWithoutBorrowerNestedInput = {
    create?: XOR<LoanCreateWithoutBorrowerInput, LoanUncheckedCreateWithoutBorrowerInput> | LoanCreateWithoutBorrowerInput[] | LoanUncheckedCreateWithoutBorrowerInput[]
    connectOrCreate?: LoanCreateOrConnectWithoutBorrowerInput | LoanCreateOrConnectWithoutBorrowerInput[]
    upsert?: LoanUpsertWithWhereUniqueWithoutBorrowerInput | LoanUpsertWithWhereUniqueWithoutBorrowerInput[]
    createMany?: LoanCreateManyBorrowerInputEnvelope
    set?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    disconnect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    delete?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    connect?: LoanWhereUniqueInput | LoanWhereUniqueInput[]
    update?: LoanUpdateWithWhereUniqueWithoutBorrowerInput | LoanUpdateWithWhereUniqueWithoutBorrowerInput[]
    updateMany?: LoanUpdateManyWithWhereWithoutBorrowerInput | LoanUpdateManyWithWhereWithoutBorrowerInput[]
    deleteMany?: LoanScalarWhereInput | LoanScalarWhereInput[]
  }

  export type TenantCreateNestedOneWithoutLoansInput = {
    create?: XOR<TenantCreateWithoutLoansInput, TenantUncheckedCreateWithoutLoansInput>
    connectOrCreate?: TenantCreateOrConnectWithoutLoansInput
    connect?: TenantWhereUniqueInput
  }

  export type BorrowerCreateNestedOneWithoutLoansInput = {
    create?: XOR<BorrowerCreateWithoutLoansInput, BorrowerUncheckedCreateWithoutLoansInput>
    connectOrCreate?: BorrowerCreateOrConnectWithoutLoansInput
    connect?: BorrowerWhereUniqueInput
  }

  export type RepaymentScheduleCreateNestedManyWithoutLoanInput = {
    create?: XOR<RepaymentScheduleCreateWithoutLoanInput, RepaymentScheduleUncheckedCreateWithoutLoanInput> | RepaymentScheduleCreateWithoutLoanInput[] | RepaymentScheduleUncheckedCreateWithoutLoanInput[]
    connectOrCreate?: RepaymentScheduleCreateOrConnectWithoutLoanInput | RepaymentScheduleCreateOrConnectWithoutLoanInput[]
    createMany?: RepaymentScheduleCreateManyLoanInputEnvelope
    connect?: RepaymentScheduleWhereUniqueInput | RepaymentScheduleWhereUniqueInput[]
  }

  export type RepaymentCreateNestedManyWithoutLoanInput = {
    create?: XOR<RepaymentCreateWithoutLoanInput, RepaymentUncheckedCreateWithoutLoanInput> | RepaymentCreateWithoutLoanInput[] | RepaymentUncheckedCreateWithoutLoanInput[]
    connectOrCreate?: RepaymentCreateOrConnectWithoutLoanInput | RepaymentCreateOrConnectWithoutLoanInput[]
    createMany?: RepaymentCreateManyLoanInputEnvelope
    connect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
  }

  export type RepaymentScheduleUncheckedCreateNestedManyWithoutLoanInput = {
    create?: XOR<RepaymentScheduleCreateWithoutLoanInput, RepaymentScheduleUncheckedCreateWithoutLoanInput> | RepaymentScheduleCreateWithoutLoanInput[] | RepaymentScheduleUncheckedCreateWithoutLoanInput[]
    connectOrCreate?: RepaymentScheduleCreateOrConnectWithoutLoanInput | RepaymentScheduleCreateOrConnectWithoutLoanInput[]
    createMany?: RepaymentScheduleCreateManyLoanInputEnvelope
    connect?: RepaymentScheduleWhereUniqueInput | RepaymentScheduleWhereUniqueInput[]
  }

  export type RepaymentUncheckedCreateNestedManyWithoutLoanInput = {
    create?: XOR<RepaymentCreateWithoutLoanInput, RepaymentUncheckedCreateWithoutLoanInput> | RepaymentCreateWithoutLoanInput[] | RepaymentUncheckedCreateWithoutLoanInput[]
    connectOrCreate?: RepaymentCreateOrConnectWithoutLoanInput | RepaymentCreateOrConnectWithoutLoanInput[]
    createMany?: RepaymentCreateManyLoanInputEnvelope
    connect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
  }

  export type EnumLoanStatusFieldUpdateOperationsInput = {
    set?: $Enums.LoanStatus
  }

  export type DecimalFieldUpdateOperationsInput = {
    set?: Decimal | DecimalJsLike | number | string
    increment?: Decimal | DecimalJsLike | number | string
    decrement?: Decimal | DecimalJsLike | number | string
    multiply?: Decimal | DecimalJsLike | number | string
    divide?: Decimal | DecimalJsLike | number | string
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type EnumInterestMethodFieldUpdateOperationsInput = {
    set?: $Enums.InterestMethod
  }

  export type TenantUpdateOneRequiredWithoutLoansNestedInput = {
    create?: XOR<TenantCreateWithoutLoansInput, TenantUncheckedCreateWithoutLoansInput>
    connectOrCreate?: TenantCreateOrConnectWithoutLoansInput
    upsert?: TenantUpsertWithoutLoansInput
    connect?: TenantWhereUniqueInput
    update?: XOR<XOR<TenantUpdateToOneWithWhereWithoutLoansInput, TenantUpdateWithoutLoansInput>, TenantUncheckedUpdateWithoutLoansInput>
  }

  export type BorrowerUpdateOneRequiredWithoutLoansNestedInput = {
    create?: XOR<BorrowerCreateWithoutLoansInput, BorrowerUncheckedCreateWithoutLoansInput>
    connectOrCreate?: BorrowerCreateOrConnectWithoutLoansInput
    upsert?: BorrowerUpsertWithoutLoansInput
    connect?: BorrowerWhereUniqueInput
    update?: XOR<XOR<BorrowerUpdateToOneWithWhereWithoutLoansInput, BorrowerUpdateWithoutLoansInput>, BorrowerUncheckedUpdateWithoutLoansInput>
  }

  export type RepaymentScheduleUpdateManyWithoutLoanNestedInput = {
    create?: XOR<RepaymentScheduleCreateWithoutLoanInput, RepaymentScheduleUncheckedCreateWithoutLoanInput> | RepaymentScheduleCreateWithoutLoanInput[] | RepaymentScheduleUncheckedCreateWithoutLoanInput[]
    connectOrCreate?: RepaymentScheduleCreateOrConnectWithoutLoanInput | RepaymentScheduleCreateOrConnectWithoutLoanInput[]
    upsert?: RepaymentScheduleUpsertWithWhereUniqueWithoutLoanInput | RepaymentScheduleUpsertWithWhereUniqueWithoutLoanInput[]
    createMany?: RepaymentScheduleCreateManyLoanInputEnvelope
    set?: RepaymentScheduleWhereUniqueInput | RepaymentScheduleWhereUniqueInput[]
    disconnect?: RepaymentScheduleWhereUniqueInput | RepaymentScheduleWhereUniqueInput[]
    delete?: RepaymentScheduleWhereUniqueInput | RepaymentScheduleWhereUniqueInput[]
    connect?: RepaymentScheduleWhereUniqueInput | RepaymentScheduleWhereUniqueInput[]
    update?: RepaymentScheduleUpdateWithWhereUniqueWithoutLoanInput | RepaymentScheduleUpdateWithWhereUniqueWithoutLoanInput[]
    updateMany?: RepaymentScheduleUpdateManyWithWhereWithoutLoanInput | RepaymentScheduleUpdateManyWithWhereWithoutLoanInput[]
    deleteMany?: RepaymentScheduleScalarWhereInput | RepaymentScheduleScalarWhereInput[]
  }

  export type RepaymentUpdateManyWithoutLoanNestedInput = {
    create?: XOR<RepaymentCreateWithoutLoanInput, RepaymentUncheckedCreateWithoutLoanInput> | RepaymentCreateWithoutLoanInput[] | RepaymentUncheckedCreateWithoutLoanInput[]
    connectOrCreate?: RepaymentCreateOrConnectWithoutLoanInput | RepaymentCreateOrConnectWithoutLoanInput[]
    upsert?: RepaymentUpsertWithWhereUniqueWithoutLoanInput | RepaymentUpsertWithWhereUniqueWithoutLoanInput[]
    createMany?: RepaymentCreateManyLoanInputEnvelope
    set?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    disconnect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    delete?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    connect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    update?: RepaymentUpdateWithWhereUniqueWithoutLoanInput | RepaymentUpdateWithWhereUniqueWithoutLoanInput[]
    updateMany?: RepaymentUpdateManyWithWhereWithoutLoanInput | RepaymentUpdateManyWithWhereWithoutLoanInput[]
    deleteMany?: RepaymentScalarWhereInput | RepaymentScalarWhereInput[]
  }

  export type RepaymentScheduleUncheckedUpdateManyWithoutLoanNestedInput = {
    create?: XOR<RepaymentScheduleCreateWithoutLoanInput, RepaymentScheduleUncheckedCreateWithoutLoanInput> | RepaymentScheduleCreateWithoutLoanInput[] | RepaymentScheduleUncheckedCreateWithoutLoanInput[]
    connectOrCreate?: RepaymentScheduleCreateOrConnectWithoutLoanInput | RepaymentScheduleCreateOrConnectWithoutLoanInput[]
    upsert?: RepaymentScheduleUpsertWithWhereUniqueWithoutLoanInput | RepaymentScheduleUpsertWithWhereUniqueWithoutLoanInput[]
    createMany?: RepaymentScheduleCreateManyLoanInputEnvelope
    set?: RepaymentScheduleWhereUniqueInput | RepaymentScheduleWhereUniqueInput[]
    disconnect?: RepaymentScheduleWhereUniqueInput | RepaymentScheduleWhereUniqueInput[]
    delete?: RepaymentScheduleWhereUniqueInput | RepaymentScheduleWhereUniqueInput[]
    connect?: RepaymentScheduleWhereUniqueInput | RepaymentScheduleWhereUniqueInput[]
    update?: RepaymentScheduleUpdateWithWhereUniqueWithoutLoanInput | RepaymentScheduleUpdateWithWhereUniqueWithoutLoanInput[]
    updateMany?: RepaymentScheduleUpdateManyWithWhereWithoutLoanInput | RepaymentScheduleUpdateManyWithWhereWithoutLoanInput[]
    deleteMany?: RepaymentScheduleScalarWhereInput | RepaymentScheduleScalarWhereInput[]
  }

  export type RepaymentUncheckedUpdateManyWithoutLoanNestedInput = {
    create?: XOR<RepaymentCreateWithoutLoanInput, RepaymentUncheckedCreateWithoutLoanInput> | RepaymentCreateWithoutLoanInput[] | RepaymentUncheckedCreateWithoutLoanInput[]
    connectOrCreate?: RepaymentCreateOrConnectWithoutLoanInput | RepaymentCreateOrConnectWithoutLoanInput[]
    upsert?: RepaymentUpsertWithWhereUniqueWithoutLoanInput | RepaymentUpsertWithWhereUniqueWithoutLoanInput[]
    createMany?: RepaymentCreateManyLoanInputEnvelope
    set?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    disconnect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    delete?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    connect?: RepaymentWhereUniqueInput | RepaymentWhereUniqueInput[]
    update?: RepaymentUpdateWithWhereUniqueWithoutLoanInput | RepaymentUpdateWithWhereUniqueWithoutLoanInput[]
    updateMany?: RepaymentUpdateManyWithWhereWithoutLoanInput | RepaymentUpdateManyWithWhereWithoutLoanInput[]
    deleteMany?: RepaymentScalarWhereInput | RepaymentScalarWhereInput[]
  }

  export type LoanCreateNestedOneWithoutSchedulesInput = {
    create?: XOR<LoanCreateWithoutSchedulesInput, LoanUncheckedCreateWithoutSchedulesInput>
    connectOrCreate?: LoanCreateOrConnectWithoutSchedulesInput
    connect?: LoanWhereUniqueInput
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type LoanUpdateOneRequiredWithoutSchedulesNestedInput = {
    create?: XOR<LoanCreateWithoutSchedulesInput, LoanUncheckedCreateWithoutSchedulesInput>
    connectOrCreate?: LoanCreateOrConnectWithoutSchedulesInput
    upsert?: LoanUpsertWithoutSchedulesInput
    connect?: LoanWhereUniqueInput
    update?: XOR<XOR<LoanUpdateToOneWithWhereWithoutSchedulesInput, LoanUpdateWithoutSchedulesInput>, LoanUncheckedUpdateWithoutSchedulesInput>
  }

  export type TenantCreateNestedOneWithoutRepaymentsInput = {
    create?: XOR<TenantCreateWithoutRepaymentsInput, TenantUncheckedCreateWithoutRepaymentsInput>
    connectOrCreate?: TenantCreateOrConnectWithoutRepaymentsInput
    connect?: TenantWhereUniqueInput
  }

  export type LoanCreateNestedOneWithoutRepaymentsInput = {
    create?: XOR<LoanCreateWithoutRepaymentsInput, LoanUncheckedCreateWithoutRepaymentsInput>
    connectOrCreate?: LoanCreateOrConnectWithoutRepaymentsInput
    connect?: LoanWhereUniqueInput
  }

  export type TenantUpdateOneRequiredWithoutRepaymentsNestedInput = {
    create?: XOR<TenantCreateWithoutRepaymentsInput, TenantUncheckedCreateWithoutRepaymentsInput>
    connectOrCreate?: TenantCreateOrConnectWithoutRepaymentsInput
    upsert?: TenantUpsertWithoutRepaymentsInput
    connect?: TenantWhereUniqueInput
    update?: XOR<XOR<TenantUpdateToOneWithWhereWithoutRepaymentsInput, TenantUpdateWithoutRepaymentsInput>, TenantUncheckedUpdateWithoutRepaymentsInput>
  }

  export type LoanUpdateOneRequiredWithoutRepaymentsNestedInput = {
    create?: XOR<LoanCreateWithoutRepaymentsInput, LoanUncheckedCreateWithoutRepaymentsInput>
    connectOrCreate?: LoanCreateOrConnectWithoutRepaymentsInput
    upsert?: LoanUpsertWithoutRepaymentsInput
    connect?: LoanWhereUniqueInput
    update?: XOR<XOR<LoanUpdateToOneWithWhereWithoutRepaymentsInput, LoanUpdateWithoutRepaymentsInput>, LoanUncheckedUpdateWithoutRepaymentsInput>
  }

  export type TenantCreateNestedOneWithoutAuditLogsInput = {
    create?: XOR<TenantCreateWithoutAuditLogsInput, TenantUncheckedCreateWithoutAuditLogsInput>
    connectOrCreate?: TenantCreateOrConnectWithoutAuditLogsInput
    connect?: TenantWhereUniqueInput
  }

  export type UserCreateNestedOneWithoutAuditLogsInput = {
    create?: XOR<UserCreateWithoutAuditLogsInput, UserUncheckedCreateWithoutAuditLogsInput>
    connectOrCreate?: UserCreateOrConnectWithoutAuditLogsInput
    connect?: UserWhereUniqueInput
  }

  export type TenantUpdateOneRequiredWithoutAuditLogsNestedInput = {
    create?: XOR<TenantCreateWithoutAuditLogsInput, TenantUncheckedCreateWithoutAuditLogsInput>
    connectOrCreate?: TenantCreateOrConnectWithoutAuditLogsInput
    upsert?: TenantUpsertWithoutAuditLogsInput
    connect?: TenantWhereUniqueInput
    update?: XOR<XOR<TenantUpdateToOneWithWhereWithoutAuditLogsInput, TenantUpdateWithoutAuditLogsInput>, TenantUncheckedUpdateWithoutAuditLogsInput>
  }

  export type UserUpdateOneRequiredWithoutAuditLogsNestedInput = {
    create?: XOR<UserCreateWithoutAuditLogsInput, UserUncheckedCreateWithoutAuditLogsInput>
    connectOrCreate?: UserCreateOrConnectWithoutAuditLogsInput
    upsert?: UserUpsertWithoutAuditLogsInput
    connect?: UserWhereUniqueInput
    update?: XOR<XOR<UserUpdateToOneWithWhereWithoutAuditLogsInput, UserUpdateWithoutAuditLogsInput>, UserUncheckedUpdateWithoutAuditLogsInput>
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[] | ListStringFieldRefInput<$PrismaModel>
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel>
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    notIn?: Date[] | string[] | ListDateTimeFieldRefInput<$PrismaModel>
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedEnumRoleFilter<$PrismaModel = never> = {
    equals?: $Enums.Role | EnumRoleFieldRefInput<$PrismaModel>
    in?: $Enums.Role[] | ListEnumRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.Role[] | ListEnumRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumRoleFilter<$PrismaModel> | $Enums.Role
  }

  export type NestedEnumRoleWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.Role | EnumRoleFieldRefInput<$PrismaModel>
    in?: $Enums.Role[] | ListEnumRoleFieldRefInput<$PrismaModel>
    notIn?: $Enums.Role[] | ListEnumRoleFieldRefInput<$PrismaModel>
    not?: NestedEnumRoleWithAggregatesFilter<$PrismaModel> | $Enums.Role
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumRoleFilter<$PrismaModel>
    _max?: NestedEnumRoleFilter<$PrismaModel>
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    notIn?: string[] | ListStringFieldRefInput<$PrismaModel> | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel> | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedEnumLoanStatusFilter<$PrismaModel = never> = {
    equals?: $Enums.LoanStatus | EnumLoanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.LoanStatus[] | ListEnumLoanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.LoanStatus[] | ListEnumLoanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumLoanStatusFilter<$PrismaModel> | $Enums.LoanStatus
  }

  export type NestedDecimalFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string
  }

  export type NestedEnumInterestMethodFilter<$PrismaModel = never> = {
    equals?: $Enums.InterestMethod | EnumInterestMethodFieldRefInput<$PrismaModel>
    in?: $Enums.InterestMethod[] | ListEnumInterestMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.InterestMethod[] | ListEnumInterestMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumInterestMethodFilter<$PrismaModel> | $Enums.InterestMethod
  }

  export type NestedEnumLoanStatusWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.LoanStatus | EnumLoanStatusFieldRefInput<$PrismaModel>
    in?: $Enums.LoanStatus[] | ListEnumLoanStatusFieldRefInput<$PrismaModel>
    notIn?: $Enums.LoanStatus[] | ListEnumLoanStatusFieldRefInput<$PrismaModel>
    not?: NestedEnumLoanStatusWithAggregatesFilter<$PrismaModel> | $Enums.LoanStatus
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumLoanStatusFilter<$PrismaModel>
    _max?: NestedEnumLoanStatusFilter<$PrismaModel>
  }

  export type NestedDecimalWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    in?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    notIn?: Decimal[] | DecimalJsLike[] | number[] | string[] | ListDecimalFieldRefInput<$PrismaModel>
    lt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    lte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gt?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    gte?: Decimal | DecimalJsLike | number | string | DecimalFieldRefInput<$PrismaModel>
    not?: NestedDecimalWithAggregatesFilter<$PrismaModel> | Decimal | DecimalJsLike | number | string
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedDecimalFilter<$PrismaModel>
    _sum?: NestedDecimalFilter<$PrismaModel>
    _min?: NestedDecimalFilter<$PrismaModel>
    _max?: NestedDecimalFilter<$PrismaModel>
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[] | ListIntFieldRefInput<$PrismaModel>
    notIn?: number[] | ListIntFieldRefInput<$PrismaModel>
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[] | ListFloatFieldRefInput<$PrismaModel>
    notIn?: number[] | ListFloatFieldRefInput<$PrismaModel>
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedEnumInterestMethodWithAggregatesFilter<$PrismaModel = never> = {
    equals?: $Enums.InterestMethod | EnumInterestMethodFieldRefInput<$PrismaModel>
    in?: $Enums.InterestMethod[] | ListEnumInterestMethodFieldRefInput<$PrismaModel>
    notIn?: $Enums.InterestMethod[] | ListEnumInterestMethodFieldRefInput<$PrismaModel>
    not?: NestedEnumInterestMethodWithAggregatesFilter<$PrismaModel> | $Enums.InterestMethod
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedEnumInterestMethodFilter<$PrismaModel>
    _max?: NestedEnumInterestMethodFilter<$PrismaModel>
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }
  export type NestedJsonNullableFilter<$PrismaModel = never> = 
    | PatchUndefined<
        Either<Required<NestedJsonNullableFilterBase<$PrismaModel>>, Exclude<keyof Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>,
        Required<NestedJsonNullableFilterBase<$PrismaModel>>
      >
    | OptionalFlat<Omit<Required<NestedJsonNullableFilterBase<$PrismaModel>>, 'path'>>

  export type NestedJsonNullableFilterBase<$PrismaModel = never> = {
    equals?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
    path?: string[]
    string_contains?: string | StringFieldRefInput<$PrismaModel>
    string_starts_with?: string | StringFieldRefInput<$PrismaModel>
    string_ends_with?: string | StringFieldRefInput<$PrismaModel>
    array_contains?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_starts_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    array_ends_with?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | null
    lt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    lte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gt?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    gte?: InputJsonValue | JsonFieldRefInput<$PrismaModel>
    not?: InputJsonValue | JsonFieldRefInput<$PrismaModel> | JsonNullValueFilter
  }

  export type UserCreateWithoutTenantInput = {
    id?: string
    email: string
    passwordHash: string
    role?: $Enums.Role
    createdAt?: Date | string
    updatedAt?: Date | string
    auditLogs?: AuditLogCreateNestedManyWithoutUserInput
  }

  export type UserUncheckedCreateWithoutTenantInput = {
    id?: string
    email: string
    passwordHash: string
    role?: $Enums.Role
    createdAt?: Date | string
    updatedAt?: Date | string
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutUserInput
  }

  export type UserCreateOrConnectWithoutTenantInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutTenantInput, UserUncheckedCreateWithoutTenantInput>
  }

  export type UserCreateManyTenantInputEnvelope = {
    data: UserCreateManyTenantInput | UserCreateManyTenantInput[]
    skipDuplicates?: boolean
  }

  export type BorrowerCreateWithoutTenantInput = {
    id?: string
    firstName: string
    lastName: string
    phone?: string | null
    address?: string | null
    idNumber?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    loans?: LoanCreateNestedManyWithoutBorrowerInput
  }

  export type BorrowerUncheckedCreateWithoutTenantInput = {
    id?: string
    firstName: string
    lastName: string
    phone?: string | null
    address?: string | null
    idNumber?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    loans?: LoanUncheckedCreateNestedManyWithoutBorrowerInput
  }

  export type BorrowerCreateOrConnectWithoutTenantInput = {
    where: BorrowerWhereUniqueInput
    create: XOR<BorrowerCreateWithoutTenantInput, BorrowerUncheckedCreateWithoutTenantInput>
  }

  export type BorrowerCreateManyTenantInputEnvelope = {
    data: BorrowerCreateManyTenantInput | BorrowerCreateManyTenantInput[]
    skipDuplicates?: boolean
  }

  export type LoanCreateWithoutTenantInput = {
    id?: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    borrower: BorrowerCreateNestedOneWithoutLoansInput
    schedules?: RepaymentScheduleCreateNestedManyWithoutLoanInput
    repayments?: RepaymentCreateNestedManyWithoutLoanInput
  }

  export type LoanUncheckedCreateWithoutTenantInput = {
    id?: string
    borrowerId: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    schedules?: RepaymentScheduleUncheckedCreateNestedManyWithoutLoanInput
    repayments?: RepaymentUncheckedCreateNestedManyWithoutLoanInput
  }

  export type LoanCreateOrConnectWithoutTenantInput = {
    where: LoanWhereUniqueInput
    create: XOR<LoanCreateWithoutTenantInput, LoanUncheckedCreateWithoutTenantInput>
  }

  export type LoanCreateManyTenantInputEnvelope = {
    data: LoanCreateManyTenantInput | LoanCreateManyTenantInput[]
    skipDuplicates?: boolean
  }

  export type RepaymentCreateWithoutTenantInput = {
    id?: string
    amount: Decimal | DecimalJsLike | number | string
    principalPaid?: Decimal | DecimalJsLike | number | string
    interestPaid?: Decimal | DecimalJsLike | number | string
    date?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    loan: LoanCreateNestedOneWithoutRepaymentsInput
  }

  export type RepaymentUncheckedCreateWithoutTenantInput = {
    id?: string
    loanId: string
    amount: Decimal | DecimalJsLike | number | string
    principalPaid?: Decimal | DecimalJsLike | number | string
    interestPaid?: Decimal | DecimalJsLike | number | string
    date?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentCreateOrConnectWithoutTenantInput = {
    where: RepaymentWhereUniqueInput
    create: XOR<RepaymentCreateWithoutTenantInput, RepaymentUncheckedCreateWithoutTenantInput>
  }

  export type RepaymentCreateManyTenantInputEnvelope = {
    data: RepaymentCreateManyTenantInput | RepaymentCreateManyTenantInput[]
    skipDuplicates?: boolean
  }

  export type AuditLogCreateWithoutTenantInput = {
    id?: string
    action: string
    entity: string
    entityId: string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    user: UserCreateNestedOneWithoutAuditLogsInput
  }

  export type AuditLogUncheckedCreateWithoutTenantInput = {
    id?: string
    userId: string
    action: string
    entity: string
    entityId: string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type AuditLogCreateOrConnectWithoutTenantInput = {
    where: AuditLogWhereUniqueInput
    create: XOR<AuditLogCreateWithoutTenantInput, AuditLogUncheckedCreateWithoutTenantInput>
  }

  export type AuditLogCreateManyTenantInputEnvelope = {
    data: AuditLogCreateManyTenantInput | AuditLogCreateManyTenantInput[]
    skipDuplicates?: boolean
  }

  export type UserUpsertWithWhereUniqueWithoutTenantInput = {
    where: UserWhereUniqueInput
    update: XOR<UserUpdateWithoutTenantInput, UserUncheckedUpdateWithoutTenantInput>
    create: XOR<UserCreateWithoutTenantInput, UserUncheckedCreateWithoutTenantInput>
  }

  export type UserUpdateWithWhereUniqueWithoutTenantInput = {
    where: UserWhereUniqueInput
    data: XOR<UserUpdateWithoutTenantInput, UserUncheckedUpdateWithoutTenantInput>
  }

  export type UserUpdateManyWithWhereWithoutTenantInput = {
    where: UserScalarWhereInput
    data: XOR<UserUpdateManyMutationInput, UserUncheckedUpdateManyWithoutTenantInput>
  }

  export type UserScalarWhereInput = {
    AND?: UserScalarWhereInput | UserScalarWhereInput[]
    OR?: UserScalarWhereInput[]
    NOT?: UserScalarWhereInput | UserScalarWhereInput[]
    id?: StringFilter<"User"> | string
    tenantId?: StringFilter<"User"> | string
    email?: StringFilter<"User"> | string
    passwordHash?: StringFilter<"User"> | string
    role?: EnumRoleFilter<"User"> | $Enums.Role
    createdAt?: DateTimeFilter<"User"> | Date | string
    updatedAt?: DateTimeFilter<"User"> | Date | string
  }

  export type BorrowerUpsertWithWhereUniqueWithoutTenantInput = {
    where: BorrowerWhereUniqueInput
    update: XOR<BorrowerUpdateWithoutTenantInput, BorrowerUncheckedUpdateWithoutTenantInput>
    create: XOR<BorrowerCreateWithoutTenantInput, BorrowerUncheckedCreateWithoutTenantInput>
  }

  export type BorrowerUpdateWithWhereUniqueWithoutTenantInput = {
    where: BorrowerWhereUniqueInput
    data: XOR<BorrowerUpdateWithoutTenantInput, BorrowerUncheckedUpdateWithoutTenantInput>
  }

  export type BorrowerUpdateManyWithWhereWithoutTenantInput = {
    where: BorrowerScalarWhereInput
    data: XOR<BorrowerUpdateManyMutationInput, BorrowerUncheckedUpdateManyWithoutTenantInput>
  }

  export type BorrowerScalarWhereInput = {
    AND?: BorrowerScalarWhereInput | BorrowerScalarWhereInput[]
    OR?: BorrowerScalarWhereInput[]
    NOT?: BorrowerScalarWhereInput | BorrowerScalarWhereInput[]
    id?: StringFilter<"Borrower"> | string
    tenantId?: StringFilter<"Borrower"> | string
    firstName?: StringFilter<"Borrower"> | string
    lastName?: StringFilter<"Borrower"> | string
    phone?: StringNullableFilter<"Borrower"> | string | null
    address?: StringNullableFilter<"Borrower"> | string | null
    idNumber?: StringNullableFilter<"Borrower"> | string | null
    createdAt?: DateTimeFilter<"Borrower"> | Date | string
    updatedAt?: DateTimeFilter<"Borrower"> | Date | string
  }

  export type LoanUpsertWithWhereUniqueWithoutTenantInput = {
    where: LoanWhereUniqueInput
    update: XOR<LoanUpdateWithoutTenantInput, LoanUncheckedUpdateWithoutTenantInput>
    create: XOR<LoanCreateWithoutTenantInput, LoanUncheckedCreateWithoutTenantInput>
  }

  export type LoanUpdateWithWhereUniqueWithoutTenantInput = {
    where: LoanWhereUniqueInput
    data: XOR<LoanUpdateWithoutTenantInput, LoanUncheckedUpdateWithoutTenantInput>
  }

  export type LoanUpdateManyWithWhereWithoutTenantInput = {
    where: LoanScalarWhereInput
    data: XOR<LoanUpdateManyMutationInput, LoanUncheckedUpdateManyWithoutTenantInput>
  }

  export type LoanScalarWhereInput = {
    AND?: LoanScalarWhereInput | LoanScalarWhereInput[]
    OR?: LoanScalarWhereInput[]
    NOT?: LoanScalarWhereInput | LoanScalarWhereInput[]
    id?: StringFilter<"Loan"> | string
    tenantId?: StringFilter<"Loan"> | string
    borrowerId?: StringFilter<"Loan"> | string
    status?: EnumLoanStatusFilter<"Loan"> | $Enums.LoanStatus
    principal?: DecimalFilter<"Loan"> | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFilter<"Loan"> | Decimal | DecimalJsLike | number | string
    termMonths?: IntFilter<"Loan"> | number
    interestMethod?: EnumInterestMethodFilter<"Loan"> | $Enums.InterestMethod
    startDate?: DateTimeFilter<"Loan"> | Date | string
    createdAt?: DateTimeFilter<"Loan"> | Date | string
    updatedAt?: DateTimeFilter<"Loan"> | Date | string
  }

  export type RepaymentUpsertWithWhereUniqueWithoutTenantInput = {
    where: RepaymentWhereUniqueInput
    update: XOR<RepaymentUpdateWithoutTenantInput, RepaymentUncheckedUpdateWithoutTenantInput>
    create: XOR<RepaymentCreateWithoutTenantInput, RepaymentUncheckedCreateWithoutTenantInput>
  }

  export type RepaymentUpdateWithWhereUniqueWithoutTenantInput = {
    where: RepaymentWhereUniqueInput
    data: XOR<RepaymentUpdateWithoutTenantInput, RepaymentUncheckedUpdateWithoutTenantInput>
  }

  export type RepaymentUpdateManyWithWhereWithoutTenantInput = {
    where: RepaymentScalarWhereInput
    data: XOR<RepaymentUpdateManyMutationInput, RepaymentUncheckedUpdateManyWithoutTenantInput>
  }

  export type RepaymentScalarWhereInput = {
    AND?: RepaymentScalarWhereInput | RepaymentScalarWhereInput[]
    OR?: RepaymentScalarWhereInput[]
    NOT?: RepaymentScalarWhereInput | RepaymentScalarWhereInput[]
    id?: StringFilter<"Repayment"> | string
    tenantId?: StringFilter<"Repayment"> | string
    loanId?: StringFilter<"Repayment"> | string
    amount?: DecimalFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFilter<"Repayment"> | Decimal | DecimalJsLike | number | string
    date?: DateTimeFilter<"Repayment"> | Date | string
    createdAt?: DateTimeFilter<"Repayment"> | Date | string
    updatedAt?: DateTimeFilter<"Repayment"> | Date | string
  }

  export type AuditLogUpsertWithWhereUniqueWithoutTenantInput = {
    where: AuditLogWhereUniqueInput
    update: XOR<AuditLogUpdateWithoutTenantInput, AuditLogUncheckedUpdateWithoutTenantInput>
    create: XOR<AuditLogCreateWithoutTenantInput, AuditLogUncheckedCreateWithoutTenantInput>
  }

  export type AuditLogUpdateWithWhereUniqueWithoutTenantInput = {
    where: AuditLogWhereUniqueInput
    data: XOR<AuditLogUpdateWithoutTenantInput, AuditLogUncheckedUpdateWithoutTenantInput>
  }

  export type AuditLogUpdateManyWithWhereWithoutTenantInput = {
    where: AuditLogScalarWhereInput
    data: XOR<AuditLogUpdateManyMutationInput, AuditLogUncheckedUpdateManyWithoutTenantInput>
  }

  export type AuditLogScalarWhereInput = {
    AND?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
    OR?: AuditLogScalarWhereInput[]
    NOT?: AuditLogScalarWhereInput | AuditLogScalarWhereInput[]
    id?: StringFilter<"AuditLog"> | string
    tenantId?: StringFilter<"AuditLog"> | string
    userId?: StringFilter<"AuditLog"> | string
    action?: StringFilter<"AuditLog"> | string
    entity?: StringFilter<"AuditLog"> | string
    entityId?: StringFilter<"AuditLog"> | string
    metadata?: JsonNullableFilter<"AuditLog">
    createdAt?: DateTimeFilter<"AuditLog"> | Date | string
  }

  export type TenantCreateWithoutUsersInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    borrowers?: BorrowerCreateNestedManyWithoutTenantInput
    loans?: LoanCreateNestedManyWithoutTenantInput
    repayments?: RepaymentCreateNestedManyWithoutTenantInput
    auditLogs?: AuditLogCreateNestedManyWithoutTenantInput
  }

  export type TenantUncheckedCreateWithoutUsersInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    borrowers?: BorrowerUncheckedCreateNestedManyWithoutTenantInput
    loans?: LoanUncheckedCreateNestedManyWithoutTenantInput
    repayments?: RepaymentUncheckedCreateNestedManyWithoutTenantInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutTenantInput
  }

  export type TenantCreateOrConnectWithoutUsersInput = {
    where: TenantWhereUniqueInput
    create: XOR<TenantCreateWithoutUsersInput, TenantUncheckedCreateWithoutUsersInput>
  }

  export type AuditLogCreateWithoutUserInput = {
    id?: string
    action: string
    entity: string
    entityId: string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
    tenant: TenantCreateNestedOneWithoutAuditLogsInput
  }

  export type AuditLogUncheckedCreateWithoutUserInput = {
    id?: string
    tenantId: string
    action: string
    entity: string
    entityId: string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type AuditLogCreateOrConnectWithoutUserInput = {
    where: AuditLogWhereUniqueInput
    create: XOR<AuditLogCreateWithoutUserInput, AuditLogUncheckedCreateWithoutUserInput>
  }

  export type AuditLogCreateManyUserInputEnvelope = {
    data: AuditLogCreateManyUserInput | AuditLogCreateManyUserInput[]
    skipDuplicates?: boolean
  }

  export type TenantUpsertWithoutUsersInput = {
    update: XOR<TenantUpdateWithoutUsersInput, TenantUncheckedUpdateWithoutUsersInput>
    create: XOR<TenantCreateWithoutUsersInput, TenantUncheckedCreateWithoutUsersInput>
    where?: TenantWhereInput
  }

  export type TenantUpdateToOneWithWhereWithoutUsersInput = {
    where?: TenantWhereInput
    data: XOR<TenantUpdateWithoutUsersInput, TenantUncheckedUpdateWithoutUsersInput>
  }

  export type TenantUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    borrowers?: BorrowerUpdateManyWithoutTenantNestedInput
    loans?: LoanUpdateManyWithoutTenantNestedInput
    repayments?: RepaymentUpdateManyWithoutTenantNestedInput
    auditLogs?: AuditLogUpdateManyWithoutTenantNestedInput
  }

  export type TenantUncheckedUpdateWithoutUsersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    borrowers?: BorrowerUncheckedUpdateManyWithoutTenantNestedInput
    loans?: LoanUncheckedUpdateManyWithoutTenantNestedInput
    repayments?: RepaymentUncheckedUpdateManyWithoutTenantNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutTenantNestedInput
  }

  export type AuditLogUpsertWithWhereUniqueWithoutUserInput = {
    where: AuditLogWhereUniqueInput
    update: XOR<AuditLogUpdateWithoutUserInput, AuditLogUncheckedUpdateWithoutUserInput>
    create: XOR<AuditLogCreateWithoutUserInput, AuditLogUncheckedCreateWithoutUserInput>
  }

  export type AuditLogUpdateWithWhereUniqueWithoutUserInput = {
    where: AuditLogWhereUniqueInput
    data: XOR<AuditLogUpdateWithoutUserInput, AuditLogUncheckedUpdateWithoutUserInput>
  }

  export type AuditLogUpdateManyWithWhereWithoutUserInput = {
    where: AuditLogScalarWhereInput
    data: XOR<AuditLogUpdateManyMutationInput, AuditLogUncheckedUpdateManyWithoutUserInput>
  }

  export type TenantCreateWithoutBorrowersInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutTenantInput
    loans?: LoanCreateNestedManyWithoutTenantInput
    repayments?: RepaymentCreateNestedManyWithoutTenantInput
    auditLogs?: AuditLogCreateNestedManyWithoutTenantInput
  }

  export type TenantUncheckedCreateWithoutBorrowersInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutTenantInput
    loans?: LoanUncheckedCreateNestedManyWithoutTenantInput
    repayments?: RepaymentUncheckedCreateNestedManyWithoutTenantInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutTenantInput
  }

  export type TenantCreateOrConnectWithoutBorrowersInput = {
    where: TenantWhereUniqueInput
    create: XOR<TenantCreateWithoutBorrowersInput, TenantUncheckedCreateWithoutBorrowersInput>
  }

  export type LoanCreateWithoutBorrowerInput = {
    id?: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    tenant: TenantCreateNestedOneWithoutLoansInput
    schedules?: RepaymentScheduleCreateNestedManyWithoutLoanInput
    repayments?: RepaymentCreateNestedManyWithoutLoanInput
  }

  export type LoanUncheckedCreateWithoutBorrowerInput = {
    id?: string
    tenantId: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    schedules?: RepaymentScheduleUncheckedCreateNestedManyWithoutLoanInput
    repayments?: RepaymentUncheckedCreateNestedManyWithoutLoanInput
  }

  export type LoanCreateOrConnectWithoutBorrowerInput = {
    where: LoanWhereUniqueInput
    create: XOR<LoanCreateWithoutBorrowerInput, LoanUncheckedCreateWithoutBorrowerInput>
  }

  export type LoanCreateManyBorrowerInputEnvelope = {
    data: LoanCreateManyBorrowerInput | LoanCreateManyBorrowerInput[]
    skipDuplicates?: boolean
  }

  export type TenantUpsertWithoutBorrowersInput = {
    update: XOR<TenantUpdateWithoutBorrowersInput, TenantUncheckedUpdateWithoutBorrowersInput>
    create: XOR<TenantCreateWithoutBorrowersInput, TenantUncheckedCreateWithoutBorrowersInput>
    where?: TenantWhereInput
  }

  export type TenantUpdateToOneWithWhereWithoutBorrowersInput = {
    where?: TenantWhereInput
    data: XOR<TenantUpdateWithoutBorrowersInput, TenantUncheckedUpdateWithoutBorrowersInput>
  }

  export type TenantUpdateWithoutBorrowersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutTenantNestedInput
    loans?: LoanUpdateManyWithoutTenantNestedInput
    repayments?: RepaymentUpdateManyWithoutTenantNestedInput
    auditLogs?: AuditLogUpdateManyWithoutTenantNestedInput
  }

  export type TenantUncheckedUpdateWithoutBorrowersInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutTenantNestedInput
    loans?: LoanUncheckedUpdateManyWithoutTenantNestedInput
    repayments?: RepaymentUncheckedUpdateManyWithoutTenantNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutTenantNestedInput
  }

  export type LoanUpsertWithWhereUniqueWithoutBorrowerInput = {
    where: LoanWhereUniqueInput
    update: XOR<LoanUpdateWithoutBorrowerInput, LoanUncheckedUpdateWithoutBorrowerInput>
    create: XOR<LoanCreateWithoutBorrowerInput, LoanUncheckedCreateWithoutBorrowerInput>
  }

  export type LoanUpdateWithWhereUniqueWithoutBorrowerInput = {
    where: LoanWhereUniqueInput
    data: XOR<LoanUpdateWithoutBorrowerInput, LoanUncheckedUpdateWithoutBorrowerInput>
  }

  export type LoanUpdateManyWithWhereWithoutBorrowerInput = {
    where: LoanScalarWhereInput
    data: XOR<LoanUpdateManyMutationInput, LoanUncheckedUpdateManyWithoutBorrowerInput>
  }

  export type TenantCreateWithoutLoansInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutTenantInput
    borrowers?: BorrowerCreateNestedManyWithoutTenantInput
    repayments?: RepaymentCreateNestedManyWithoutTenantInput
    auditLogs?: AuditLogCreateNestedManyWithoutTenantInput
  }

  export type TenantUncheckedCreateWithoutLoansInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutTenantInput
    borrowers?: BorrowerUncheckedCreateNestedManyWithoutTenantInput
    repayments?: RepaymentUncheckedCreateNestedManyWithoutTenantInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutTenantInput
  }

  export type TenantCreateOrConnectWithoutLoansInput = {
    where: TenantWhereUniqueInput
    create: XOR<TenantCreateWithoutLoansInput, TenantUncheckedCreateWithoutLoansInput>
  }

  export type BorrowerCreateWithoutLoansInput = {
    id?: string
    firstName: string
    lastName: string
    phone?: string | null
    address?: string | null
    idNumber?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    tenant: TenantCreateNestedOneWithoutBorrowersInput
  }

  export type BorrowerUncheckedCreateWithoutLoansInput = {
    id?: string
    tenantId: string
    firstName: string
    lastName: string
    phone?: string | null
    address?: string | null
    idNumber?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BorrowerCreateOrConnectWithoutLoansInput = {
    where: BorrowerWhereUniqueInput
    create: XOR<BorrowerCreateWithoutLoansInput, BorrowerUncheckedCreateWithoutLoansInput>
  }

  export type RepaymentScheduleCreateWithoutLoanInput = {
    id?: string
    installmentNumber: number
    dueDate: Date | string
    principalAmount: Decimal | DecimalJsLike | number | string
    interestAmount: Decimal | DecimalJsLike | number | string
    totalAmount: Decimal | DecimalJsLike | number | string
    outstandingPrincipal: Decimal | DecimalJsLike | number | string
    paidPrincipal?: Decimal | DecimalJsLike | number | string
    paidInterest?: Decimal | DecimalJsLike | number | string
    isPaid?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentScheduleUncheckedCreateWithoutLoanInput = {
    id?: string
    installmentNumber: number
    dueDate: Date | string
    principalAmount: Decimal | DecimalJsLike | number | string
    interestAmount: Decimal | DecimalJsLike | number | string
    totalAmount: Decimal | DecimalJsLike | number | string
    outstandingPrincipal: Decimal | DecimalJsLike | number | string
    paidPrincipal?: Decimal | DecimalJsLike | number | string
    paidInterest?: Decimal | DecimalJsLike | number | string
    isPaid?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentScheduleCreateOrConnectWithoutLoanInput = {
    where: RepaymentScheduleWhereUniqueInput
    create: XOR<RepaymentScheduleCreateWithoutLoanInput, RepaymentScheduleUncheckedCreateWithoutLoanInput>
  }

  export type RepaymentScheduleCreateManyLoanInputEnvelope = {
    data: RepaymentScheduleCreateManyLoanInput | RepaymentScheduleCreateManyLoanInput[]
    skipDuplicates?: boolean
  }

  export type RepaymentCreateWithoutLoanInput = {
    id?: string
    amount: Decimal | DecimalJsLike | number | string
    principalPaid?: Decimal | DecimalJsLike | number | string
    interestPaid?: Decimal | DecimalJsLike | number | string
    date?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    tenant: TenantCreateNestedOneWithoutRepaymentsInput
  }

  export type RepaymentUncheckedCreateWithoutLoanInput = {
    id?: string
    tenantId: string
    amount: Decimal | DecimalJsLike | number | string
    principalPaid?: Decimal | DecimalJsLike | number | string
    interestPaid?: Decimal | DecimalJsLike | number | string
    date?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentCreateOrConnectWithoutLoanInput = {
    where: RepaymentWhereUniqueInput
    create: XOR<RepaymentCreateWithoutLoanInput, RepaymentUncheckedCreateWithoutLoanInput>
  }

  export type RepaymentCreateManyLoanInputEnvelope = {
    data: RepaymentCreateManyLoanInput | RepaymentCreateManyLoanInput[]
    skipDuplicates?: boolean
  }

  export type TenantUpsertWithoutLoansInput = {
    update: XOR<TenantUpdateWithoutLoansInput, TenantUncheckedUpdateWithoutLoansInput>
    create: XOR<TenantCreateWithoutLoansInput, TenantUncheckedCreateWithoutLoansInput>
    where?: TenantWhereInput
  }

  export type TenantUpdateToOneWithWhereWithoutLoansInput = {
    where?: TenantWhereInput
    data: XOR<TenantUpdateWithoutLoansInput, TenantUncheckedUpdateWithoutLoansInput>
  }

  export type TenantUpdateWithoutLoansInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutTenantNestedInput
    borrowers?: BorrowerUpdateManyWithoutTenantNestedInput
    repayments?: RepaymentUpdateManyWithoutTenantNestedInput
    auditLogs?: AuditLogUpdateManyWithoutTenantNestedInput
  }

  export type TenantUncheckedUpdateWithoutLoansInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutTenantNestedInput
    borrowers?: BorrowerUncheckedUpdateManyWithoutTenantNestedInput
    repayments?: RepaymentUncheckedUpdateManyWithoutTenantNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutTenantNestedInput
  }

  export type BorrowerUpsertWithoutLoansInput = {
    update: XOR<BorrowerUpdateWithoutLoansInput, BorrowerUncheckedUpdateWithoutLoansInput>
    create: XOR<BorrowerCreateWithoutLoansInput, BorrowerUncheckedCreateWithoutLoansInput>
    where?: BorrowerWhereInput
  }

  export type BorrowerUpdateToOneWithWhereWithoutLoansInput = {
    where?: BorrowerWhereInput
    data: XOR<BorrowerUpdateWithoutLoansInput, BorrowerUncheckedUpdateWithoutLoansInput>
  }

  export type BorrowerUpdateWithoutLoansInput = {
    id?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    idNumber?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutBorrowersNestedInput
  }

  export type BorrowerUncheckedUpdateWithoutLoansInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    idNumber?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentScheduleUpsertWithWhereUniqueWithoutLoanInput = {
    where: RepaymentScheduleWhereUniqueInput
    update: XOR<RepaymentScheduleUpdateWithoutLoanInput, RepaymentScheduleUncheckedUpdateWithoutLoanInput>
    create: XOR<RepaymentScheduleCreateWithoutLoanInput, RepaymentScheduleUncheckedCreateWithoutLoanInput>
  }

  export type RepaymentScheduleUpdateWithWhereUniqueWithoutLoanInput = {
    where: RepaymentScheduleWhereUniqueInput
    data: XOR<RepaymentScheduleUpdateWithoutLoanInput, RepaymentScheduleUncheckedUpdateWithoutLoanInput>
  }

  export type RepaymentScheduleUpdateManyWithWhereWithoutLoanInput = {
    where: RepaymentScheduleScalarWhereInput
    data: XOR<RepaymentScheduleUpdateManyMutationInput, RepaymentScheduleUncheckedUpdateManyWithoutLoanInput>
  }

  export type RepaymentScheduleScalarWhereInput = {
    AND?: RepaymentScheduleScalarWhereInput | RepaymentScheduleScalarWhereInput[]
    OR?: RepaymentScheduleScalarWhereInput[]
    NOT?: RepaymentScheduleScalarWhereInput | RepaymentScheduleScalarWhereInput[]
    id?: StringFilter<"RepaymentSchedule"> | string
    loanId?: StringFilter<"RepaymentSchedule"> | string
    installmentNumber?: IntFilter<"RepaymentSchedule"> | number
    dueDate?: DateTimeFilter<"RepaymentSchedule"> | Date | string
    principalAmount?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalFilter<"RepaymentSchedule"> | Decimal | DecimalJsLike | number | string
    isPaid?: BoolFilter<"RepaymentSchedule"> | boolean
    createdAt?: DateTimeFilter<"RepaymentSchedule"> | Date | string
    updatedAt?: DateTimeFilter<"RepaymentSchedule"> | Date | string
  }

  export type RepaymentUpsertWithWhereUniqueWithoutLoanInput = {
    where: RepaymentWhereUniqueInput
    update: XOR<RepaymentUpdateWithoutLoanInput, RepaymentUncheckedUpdateWithoutLoanInput>
    create: XOR<RepaymentCreateWithoutLoanInput, RepaymentUncheckedCreateWithoutLoanInput>
  }

  export type RepaymentUpdateWithWhereUniqueWithoutLoanInput = {
    where: RepaymentWhereUniqueInput
    data: XOR<RepaymentUpdateWithoutLoanInput, RepaymentUncheckedUpdateWithoutLoanInput>
  }

  export type RepaymentUpdateManyWithWhereWithoutLoanInput = {
    where: RepaymentScalarWhereInput
    data: XOR<RepaymentUpdateManyMutationInput, RepaymentUncheckedUpdateManyWithoutLoanInput>
  }

  export type LoanCreateWithoutSchedulesInput = {
    id?: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    tenant: TenantCreateNestedOneWithoutLoansInput
    borrower: BorrowerCreateNestedOneWithoutLoansInput
    repayments?: RepaymentCreateNestedManyWithoutLoanInput
  }

  export type LoanUncheckedCreateWithoutSchedulesInput = {
    id?: string
    tenantId: string
    borrowerId: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    repayments?: RepaymentUncheckedCreateNestedManyWithoutLoanInput
  }

  export type LoanCreateOrConnectWithoutSchedulesInput = {
    where: LoanWhereUniqueInput
    create: XOR<LoanCreateWithoutSchedulesInput, LoanUncheckedCreateWithoutSchedulesInput>
  }

  export type LoanUpsertWithoutSchedulesInput = {
    update: XOR<LoanUpdateWithoutSchedulesInput, LoanUncheckedUpdateWithoutSchedulesInput>
    create: XOR<LoanCreateWithoutSchedulesInput, LoanUncheckedCreateWithoutSchedulesInput>
    where?: LoanWhereInput
  }

  export type LoanUpdateToOneWithWhereWithoutSchedulesInput = {
    where?: LoanWhereInput
    data: XOR<LoanUpdateWithoutSchedulesInput, LoanUncheckedUpdateWithoutSchedulesInput>
  }

  export type LoanUpdateWithoutSchedulesInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutLoansNestedInput
    borrower?: BorrowerUpdateOneRequiredWithoutLoansNestedInput
    repayments?: RepaymentUpdateManyWithoutLoanNestedInput
  }

  export type LoanUncheckedUpdateWithoutSchedulesInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    borrowerId?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    repayments?: RepaymentUncheckedUpdateManyWithoutLoanNestedInput
  }

  export type TenantCreateWithoutRepaymentsInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutTenantInput
    borrowers?: BorrowerCreateNestedManyWithoutTenantInput
    loans?: LoanCreateNestedManyWithoutTenantInput
    auditLogs?: AuditLogCreateNestedManyWithoutTenantInput
  }

  export type TenantUncheckedCreateWithoutRepaymentsInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutTenantInput
    borrowers?: BorrowerUncheckedCreateNestedManyWithoutTenantInput
    loans?: LoanUncheckedCreateNestedManyWithoutTenantInput
    auditLogs?: AuditLogUncheckedCreateNestedManyWithoutTenantInput
  }

  export type TenantCreateOrConnectWithoutRepaymentsInput = {
    where: TenantWhereUniqueInput
    create: XOR<TenantCreateWithoutRepaymentsInput, TenantUncheckedCreateWithoutRepaymentsInput>
  }

  export type LoanCreateWithoutRepaymentsInput = {
    id?: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    tenant: TenantCreateNestedOneWithoutLoansInput
    borrower: BorrowerCreateNestedOneWithoutLoansInput
    schedules?: RepaymentScheduleCreateNestedManyWithoutLoanInput
  }

  export type LoanUncheckedCreateWithoutRepaymentsInput = {
    id?: string
    tenantId: string
    borrowerId: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
    schedules?: RepaymentScheduleUncheckedCreateNestedManyWithoutLoanInput
  }

  export type LoanCreateOrConnectWithoutRepaymentsInput = {
    where: LoanWhereUniqueInput
    create: XOR<LoanCreateWithoutRepaymentsInput, LoanUncheckedCreateWithoutRepaymentsInput>
  }

  export type TenantUpsertWithoutRepaymentsInput = {
    update: XOR<TenantUpdateWithoutRepaymentsInput, TenantUncheckedUpdateWithoutRepaymentsInput>
    create: XOR<TenantCreateWithoutRepaymentsInput, TenantUncheckedCreateWithoutRepaymentsInput>
    where?: TenantWhereInput
  }

  export type TenantUpdateToOneWithWhereWithoutRepaymentsInput = {
    where?: TenantWhereInput
    data: XOR<TenantUpdateWithoutRepaymentsInput, TenantUncheckedUpdateWithoutRepaymentsInput>
  }

  export type TenantUpdateWithoutRepaymentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutTenantNestedInput
    borrowers?: BorrowerUpdateManyWithoutTenantNestedInput
    loans?: LoanUpdateManyWithoutTenantNestedInput
    auditLogs?: AuditLogUpdateManyWithoutTenantNestedInput
  }

  export type TenantUncheckedUpdateWithoutRepaymentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutTenantNestedInput
    borrowers?: BorrowerUncheckedUpdateManyWithoutTenantNestedInput
    loans?: LoanUncheckedUpdateManyWithoutTenantNestedInput
    auditLogs?: AuditLogUncheckedUpdateManyWithoutTenantNestedInput
  }

  export type LoanUpsertWithoutRepaymentsInput = {
    update: XOR<LoanUpdateWithoutRepaymentsInput, LoanUncheckedUpdateWithoutRepaymentsInput>
    create: XOR<LoanCreateWithoutRepaymentsInput, LoanUncheckedCreateWithoutRepaymentsInput>
    where?: LoanWhereInput
  }

  export type LoanUpdateToOneWithWhereWithoutRepaymentsInput = {
    where?: LoanWhereInput
    data: XOR<LoanUpdateWithoutRepaymentsInput, LoanUncheckedUpdateWithoutRepaymentsInput>
  }

  export type LoanUpdateWithoutRepaymentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutLoansNestedInput
    borrower?: BorrowerUpdateOneRequiredWithoutLoansNestedInput
    schedules?: RepaymentScheduleUpdateManyWithoutLoanNestedInput
  }

  export type LoanUncheckedUpdateWithoutRepaymentsInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    borrowerId?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    schedules?: RepaymentScheduleUncheckedUpdateManyWithoutLoanNestedInput
  }

  export type TenantCreateWithoutAuditLogsInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserCreateNestedManyWithoutTenantInput
    borrowers?: BorrowerCreateNestedManyWithoutTenantInput
    loans?: LoanCreateNestedManyWithoutTenantInput
    repayments?: RepaymentCreateNestedManyWithoutTenantInput
  }

  export type TenantUncheckedCreateWithoutAuditLogsInput = {
    id?: string
    name: string
    createdAt?: Date | string
    updatedAt?: Date | string
    users?: UserUncheckedCreateNestedManyWithoutTenantInput
    borrowers?: BorrowerUncheckedCreateNestedManyWithoutTenantInput
    loans?: LoanUncheckedCreateNestedManyWithoutTenantInput
    repayments?: RepaymentUncheckedCreateNestedManyWithoutTenantInput
  }

  export type TenantCreateOrConnectWithoutAuditLogsInput = {
    where: TenantWhereUniqueInput
    create: XOR<TenantCreateWithoutAuditLogsInput, TenantUncheckedCreateWithoutAuditLogsInput>
  }

  export type UserCreateWithoutAuditLogsInput = {
    id?: string
    email: string
    passwordHash: string
    role?: $Enums.Role
    createdAt?: Date | string
    updatedAt?: Date | string
    tenant: TenantCreateNestedOneWithoutUsersInput
  }

  export type UserUncheckedCreateWithoutAuditLogsInput = {
    id?: string
    tenantId: string
    email: string
    passwordHash: string
    role?: $Enums.Role
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type UserCreateOrConnectWithoutAuditLogsInput = {
    where: UserWhereUniqueInput
    create: XOR<UserCreateWithoutAuditLogsInput, UserUncheckedCreateWithoutAuditLogsInput>
  }

  export type TenantUpsertWithoutAuditLogsInput = {
    update: XOR<TenantUpdateWithoutAuditLogsInput, TenantUncheckedUpdateWithoutAuditLogsInput>
    create: XOR<TenantCreateWithoutAuditLogsInput, TenantUncheckedCreateWithoutAuditLogsInput>
    where?: TenantWhereInput
  }

  export type TenantUpdateToOneWithWhereWithoutAuditLogsInput = {
    where?: TenantWhereInput
    data: XOR<TenantUpdateWithoutAuditLogsInput, TenantUncheckedUpdateWithoutAuditLogsInput>
  }

  export type TenantUpdateWithoutAuditLogsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUpdateManyWithoutTenantNestedInput
    borrowers?: BorrowerUpdateManyWithoutTenantNestedInput
    loans?: LoanUpdateManyWithoutTenantNestedInput
    repayments?: RepaymentUpdateManyWithoutTenantNestedInput
  }

  export type TenantUncheckedUpdateWithoutAuditLogsInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    users?: UserUncheckedUpdateManyWithoutTenantNestedInput
    borrowers?: BorrowerUncheckedUpdateManyWithoutTenantNestedInput
    loans?: LoanUncheckedUpdateManyWithoutTenantNestedInput
    repayments?: RepaymentUncheckedUpdateManyWithoutTenantNestedInput
  }

  export type UserUpsertWithoutAuditLogsInput = {
    update: XOR<UserUpdateWithoutAuditLogsInput, UserUncheckedUpdateWithoutAuditLogsInput>
    create: XOR<UserCreateWithoutAuditLogsInput, UserUncheckedCreateWithoutAuditLogsInput>
    where?: UserWhereInput
  }

  export type UserUpdateToOneWithWhereWithoutAuditLogsInput = {
    where?: UserWhereInput
    data: XOR<UserUpdateWithoutAuditLogsInput, UserUncheckedUpdateWithoutAuditLogsInput>
  }

  export type UserUpdateWithoutAuditLogsInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    passwordHash?: StringFieldUpdateOperationsInput | string
    role?: EnumRoleFieldUpdateOperationsInput | $Enums.Role
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutUsersNestedInput
  }

  export type UserUncheckedUpdateWithoutAuditLogsInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    passwordHash?: StringFieldUpdateOperationsInput | string
    role?: EnumRoleFieldUpdateOperationsInput | $Enums.Role
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type UserCreateManyTenantInput = {
    id?: string
    email: string
    passwordHash: string
    role?: $Enums.Role
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type BorrowerCreateManyTenantInput = {
    id?: string
    firstName: string
    lastName: string
    phone?: string | null
    address?: string | null
    idNumber?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type LoanCreateManyTenantInput = {
    id?: string
    borrowerId: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentCreateManyTenantInput = {
    id?: string
    loanId: string
    amount: Decimal | DecimalJsLike | number | string
    principalPaid?: Decimal | DecimalJsLike | number | string
    interestPaid?: Decimal | DecimalJsLike | number | string
    date?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type AuditLogCreateManyTenantInput = {
    id?: string
    userId: string
    action: string
    entity: string
    entityId: string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type UserUpdateWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    passwordHash?: StringFieldUpdateOperationsInput | string
    role?: EnumRoleFieldUpdateOperationsInput | $Enums.Role
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    auditLogs?: AuditLogUpdateManyWithoutUserNestedInput
  }

  export type UserUncheckedUpdateWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    passwordHash?: StringFieldUpdateOperationsInput | string
    role?: EnumRoleFieldUpdateOperationsInput | $Enums.Role
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    auditLogs?: AuditLogUncheckedUpdateManyWithoutUserNestedInput
  }

  export type UserUncheckedUpdateManyWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    email?: StringFieldUpdateOperationsInput | string
    passwordHash?: StringFieldUpdateOperationsInput | string
    role?: EnumRoleFieldUpdateOperationsInput | $Enums.Role
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type BorrowerUpdateWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    idNumber?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    loans?: LoanUpdateManyWithoutBorrowerNestedInput
  }

  export type BorrowerUncheckedUpdateWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    idNumber?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    loans?: LoanUncheckedUpdateManyWithoutBorrowerNestedInput
  }

  export type BorrowerUncheckedUpdateManyWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    firstName?: StringFieldUpdateOperationsInput | string
    lastName?: StringFieldUpdateOperationsInput | string
    phone?: NullableStringFieldUpdateOperationsInput | string | null
    address?: NullableStringFieldUpdateOperationsInput | string | null
    idNumber?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LoanUpdateWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    borrower?: BorrowerUpdateOneRequiredWithoutLoansNestedInput
    schedules?: RepaymentScheduleUpdateManyWithoutLoanNestedInput
    repayments?: RepaymentUpdateManyWithoutLoanNestedInput
  }

  export type LoanUncheckedUpdateWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    borrowerId?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    schedules?: RepaymentScheduleUncheckedUpdateManyWithoutLoanNestedInput
    repayments?: RepaymentUncheckedUpdateManyWithoutLoanNestedInput
  }

  export type LoanUncheckedUpdateManyWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    borrowerId?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentUpdateWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    loan?: LoanUpdateOneRequiredWithoutRepaymentsNestedInput
  }

  export type RepaymentUncheckedUpdateWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    loanId?: StringFieldUpdateOperationsInput | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentUncheckedUpdateManyWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    loanId?: StringFieldUpdateOperationsInput | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogUpdateWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    entity?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    user?: UserUpdateOneRequiredWithoutAuditLogsNestedInput
  }

  export type AuditLogUncheckedUpdateWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    entity?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogUncheckedUpdateManyWithoutTenantInput = {
    id?: StringFieldUpdateOperationsInput | string
    userId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    entity?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogCreateManyUserInput = {
    id?: string
    tenantId: string
    action: string
    entity: string
    entityId: string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: Date | string
  }

  export type AuditLogUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    entity?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutAuditLogsNestedInput
  }

  export type AuditLogUncheckedUpdateWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    entity?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type AuditLogUncheckedUpdateManyWithoutUserInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    action?: StringFieldUpdateOperationsInput | string
    entity?: StringFieldUpdateOperationsInput | string
    entityId?: StringFieldUpdateOperationsInput | string
    metadata?: NullableJsonNullValueInput | InputJsonValue
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type LoanCreateManyBorrowerInput = {
    id?: string
    tenantId: string
    status?: $Enums.LoanStatus
    principal: Decimal | DecimalJsLike | number | string
    annualInterestRate: Decimal | DecimalJsLike | number | string
    termMonths: number
    interestMethod: $Enums.InterestMethod
    startDate: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type LoanUpdateWithoutBorrowerInput = {
    id?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutLoansNestedInput
    schedules?: RepaymentScheduleUpdateManyWithoutLoanNestedInput
    repayments?: RepaymentUpdateManyWithoutLoanNestedInput
  }

  export type LoanUncheckedUpdateWithoutBorrowerInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    schedules?: RepaymentScheduleUncheckedUpdateManyWithoutLoanNestedInput
    repayments?: RepaymentUncheckedUpdateManyWithoutLoanNestedInput
  }

  export type LoanUncheckedUpdateManyWithoutBorrowerInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    status?: EnumLoanStatusFieldUpdateOperationsInput | $Enums.LoanStatus
    principal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    annualInterestRate?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    termMonths?: IntFieldUpdateOperationsInput | number
    interestMethod?: EnumInterestMethodFieldUpdateOperationsInput | $Enums.InterestMethod
    startDate?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentScheduleCreateManyLoanInput = {
    id?: string
    installmentNumber: number
    dueDate: Date | string
    principalAmount: Decimal | DecimalJsLike | number | string
    interestAmount: Decimal | DecimalJsLike | number | string
    totalAmount: Decimal | DecimalJsLike | number | string
    outstandingPrincipal: Decimal | DecimalJsLike | number | string
    paidPrincipal?: Decimal | DecimalJsLike | number | string
    paidInterest?: Decimal | DecimalJsLike | number | string
    isPaid?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentCreateManyLoanInput = {
    id?: string
    tenantId: string
    amount: Decimal | DecimalJsLike | number | string
    principalPaid?: Decimal | DecimalJsLike | number | string
    interestPaid?: Decimal | DecimalJsLike | number | string
    date?: Date | string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type RepaymentScheduleUpdateWithoutLoanInput = {
    id?: StringFieldUpdateOperationsInput | string
    installmentNumber?: IntFieldUpdateOperationsInput | number
    dueDate?: DateTimeFieldUpdateOperationsInput | Date | string
    principalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    isPaid?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentScheduleUncheckedUpdateWithoutLoanInput = {
    id?: StringFieldUpdateOperationsInput | string
    installmentNumber?: IntFieldUpdateOperationsInput | number
    dueDate?: DateTimeFieldUpdateOperationsInput | Date | string
    principalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    isPaid?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentScheduleUncheckedUpdateManyWithoutLoanInput = {
    id?: StringFieldUpdateOperationsInput | string
    installmentNumber?: IntFieldUpdateOperationsInput | number
    dueDate?: DateTimeFieldUpdateOperationsInput | Date | string
    principalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    totalAmount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    outstandingPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidPrincipal?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    paidInterest?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    isPaid?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentUpdateWithoutLoanInput = {
    id?: StringFieldUpdateOperationsInput | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    tenant?: TenantUpdateOneRequiredWithoutRepaymentsNestedInput
  }

  export type RepaymentUncheckedUpdateWithoutLoanInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type RepaymentUncheckedUpdateManyWithoutLoanInput = {
    id?: StringFieldUpdateOperationsInput | string
    tenantId?: StringFieldUpdateOperationsInput | string
    amount?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    principalPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    interestPaid?: DecimalFieldUpdateOperationsInput | Decimal | DecimalJsLike | number | string
    date?: DateTimeFieldUpdateOperationsInput | Date | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use TenantCountOutputTypeDefaultArgs instead
     */
    export type TenantCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TenantCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use UserCountOutputTypeDefaultArgs instead
     */
    export type UserCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = UserCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use BorrowerCountOutputTypeDefaultArgs instead
     */
    export type BorrowerCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = BorrowerCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use LoanCountOutputTypeDefaultArgs instead
     */
    export type LoanCountOutputTypeArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = LoanCountOutputTypeDefaultArgs<ExtArgs>
    /**
     * @deprecated Use TenantDefaultArgs instead
     */
    export type TenantArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = TenantDefaultArgs<ExtArgs>
    /**
     * @deprecated Use UserDefaultArgs instead
     */
    export type UserArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = UserDefaultArgs<ExtArgs>
    /**
     * @deprecated Use BorrowerDefaultArgs instead
     */
    export type BorrowerArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = BorrowerDefaultArgs<ExtArgs>
    /**
     * @deprecated Use LoanDefaultArgs instead
     */
    export type LoanArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = LoanDefaultArgs<ExtArgs>
    /**
     * @deprecated Use RepaymentScheduleDefaultArgs instead
     */
    export type RepaymentScheduleArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = RepaymentScheduleDefaultArgs<ExtArgs>
    /**
     * @deprecated Use RepaymentDefaultArgs instead
     */
    export type RepaymentArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = RepaymentDefaultArgs<ExtArgs>
    /**
     * @deprecated Use AuditLogDefaultArgs instead
     */
    export type AuditLogArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = AuditLogDefaultArgs<ExtArgs>

  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}