import { getD1 } from "../../../db";
import { getServerConfig } from "../../../server/config";

export function companionRouteDependencies() {
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  return { db: getD1(), sessionSecret: config.SESSION_SECRET };
}
