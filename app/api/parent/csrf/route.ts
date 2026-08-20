import { handleParentCsrfBootstrap } from "../../../../server/parent-routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleParentCsrfBootstrap(request);
}
