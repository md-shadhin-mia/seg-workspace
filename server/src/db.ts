import postgres from 'postgres';

export type Sql = postgres.Sql<{}>;

export function createDb(url: string, max = 10, timeZone = 'UTC'): Sql {
  return postgres(url, {
    max,
    connection: { TimeZone: timeZone },
    transform: postgres.camel,
    onnotice: () => {},
    // Keep `date` columns as YYYY-MM-DD strings so due dates never shift across time zones.
    types: {
      date: { to: 1082, from: [1082], serialize: (v: string) => v, parse: (v: string) => v },
    },
  }) as unknown as Sql;
}
