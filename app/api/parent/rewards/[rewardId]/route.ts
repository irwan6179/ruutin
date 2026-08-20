import { parentRouteDependencies } from "../../_dependencies";
import { publicErrorResponse } from "../../../../../server/error-safety";
import { handleParentReward } from "../../../../../server/reward-routes";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ rewardId: string }> | { rewardId: string } };

async function rewardIdFrom(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.rewardId;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    return await handleParentReward(request, parentRouteDependencies(), await rewardIdFrom(context));
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    return await handleParentReward(request, parentRouteDependencies(), await rewardIdFrom(context));
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    return await handleParentReward(request, parentRouteDependencies(), await rewardIdFrom(context));
  } catch (error) {
    return publicErrorResponse(error);
  }
}
