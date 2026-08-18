import { getD1 } from "../../../db";
import { getServerConfig } from "../../../server/config";
import { createEmailSender } from "../../../server/email-adapter";
import type { ParentRouteDependencies } from "../../../server/parent-routes";
import type { SettingsRouteDependencies } from "../../../server/settings-routes";

export function parentRouteDependencies(): ParentRouteDependencies {
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  return {
    db: getD1(),
    sessionSecret: config.SESSION_SECRET,
    authHmacSecret: config.AUTH_HMAC_SECRET,
  };
}

export function settingsRouteDependencies(): SettingsRouteDependencies {
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  return {
    db: getD1(),
    sessionSecret: config.SESSION_SECRET,
    authHmacSecret: config.AUTH_HMAC_SECRET,
    emailSender: createEmailSender(config),
  };
}
