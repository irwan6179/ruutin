import { headers } from "next/headers";
import { cache } from "react";
import { getD1 } from "../../db";
import { getServerConfig } from "../../server/config";
import {
  AuthorizationError,
  parentContextFromSession,
  resolveParentSession,
  type ParentContext,
  type ParentSessionContext,
} from "../../server/auth-context";

export type ParentPageContext = {
  request: Request;
  session: ParentSessionContext;
  parent: ParentContext | null;
};

export const getParentPageContext = cache(async (): Promise<ParentPageContext> => {
  const requestHeaders = await headers();
  const cookie = requestHeaders.get("cookie") ?? "";
  const request = new Request("https://ruutin.local/app", { headers: { Cookie: cookie } });
  const config = getServerConfig();
  if (!config) throw new AuthorizationError();
  const db = getD1();
  const session = await resolveParentSession(request, db, { sessionSecret: config.SESSION_SECRET });
  if (!session) throw new AuthorizationError();
  const parent = parentContextFromSession(session);
  return { request, session, parent };
});
