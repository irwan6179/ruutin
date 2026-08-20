import { parentRouteDependencies } from "../../_dependencies";
import { handleParentProfile } from "../../../../../server/parent-routes";
import { publicErrorResponse } from "../../../../../server/error-safety";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ profileId: string }> | { profileId: string } };

async function profileIdFrom(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.profileId;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try { return await handleParentProfile(request, parentRouteDependencies(), await profileIdFrom(context)); } catch (error) { return publicErrorResponse(error); }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try { return await handleParentProfile(request, parentRouteDependencies(), await profileIdFrom(context)); } catch (error) { return publicErrorResponse(error); }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try { return await handleParentProfile(request, parentRouteDependencies(), await profileIdFrom(context)); } catch (error) { return publicErrorResponse(error); }
}
