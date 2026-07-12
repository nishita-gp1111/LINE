import "server-only";

import { parseEnv, type AppEnv } from "@/lib/env/schema";

let cachedEnv: AppEnv | undefined;

export function getServerEnv(): AppEnv {
  cachedEnv ??= parseEnv(process.env);
  return cachedEnv;
}
