import { parentRouteDependencies } from "../../_dependencies";
import { handleParentDevices } from "../../../../../server/parent-routes";
import { publicErrorResponse } from "../../../../../server/error-safety";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ deviceId: string }> | { deviceId: string } };

async function deviceIdFrom(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.deviceId;
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try { return await handleParentDevices(request, parentRouteDependencies(), await deviceIdFrom(context)); } catch (error) { return publicErrorResponse(error); }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try { return await handleParentDevices(request, parentRouteDependencies(), await deviceIdFrom(context)); } catch (error) { return publicErrorResponse(error); }
}
