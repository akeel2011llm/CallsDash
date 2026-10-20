import type * as Store from "../store";

type Fn = (...a: never[]) => unknown;
type Async<T> = { [K in keyof T]: T[K] extends Fn ? (...a: Parameters<T[K]>) => Promise<Awaited<ReturnType<T[K]>>> : never };

/** The async data contract used by pages and actions. Implemented by the demo store and by Postgres. */
export type Data = Async<typeof Store>;

export async function createDemoData(): Promise<Data> {
  const store = await import("../store");
  return Object.fromEntries(
    Object.entries(store).map(([k, f]) => [k, async (...a: unknown[]) => (f as (...x: unknown[]) => unknown)(...a)]),
  ) as unknown as Data;
}
