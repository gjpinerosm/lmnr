import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from "nuqs";

// pastHours/startDate/endDate are the params DateRangeFilter (mode="url") reads and writes.
export const useGraphParams = () =>
  useQueryStates({
    pastHours: parseAsString,
    startDate: parseAsString,
    endDate: parseAsString,
    metric: parseAsStringLiteral(["tokens", "cost"] as const).withDefault("tokens"),
    live: parseAsBoolean.withDefault(true),
    liveProject: parseAsString,
  });
