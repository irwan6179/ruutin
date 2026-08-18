import { parentRouteDependencies } from "../../_dependencies";
import { handleParentPairing } from "../../../../../server/parent-routes";
import { publicErrorResponse } from "../../../../../server/error-safety";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ challengeId: string }> | { challengeId: string } };

async function challengeIdFrom(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.challengeId;
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    return await handleParentPairing(
      request,
      parentRouteDependencies(),
      await challengeIdFrom(context),
    );
  } catch (error) {
    return publicErrorResponse(error);
  }
}
