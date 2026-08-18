import { getD1 } from "../../../db";
import { getServerConfig } from "../../../server/config";
import type { ParentRouteDependencies } from "../../../server/parent-routes";

export function parentRouteDependencies(): ParentRouteDependencies {
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  return { db: getD1(), sessionSecret: config.SESSION_SECRET };
}
