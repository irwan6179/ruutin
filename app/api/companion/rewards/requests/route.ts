import { companionRouteDependencies } from "../../_dependencies";
import { publicErrorResponse } from "../../../../../server/error-safety";
import { handleCompanionRewardRequests } from "../../../../../server/reward-routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleCompanionRewardRequests(request, companionRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleCompanionRewardRequests(request, companionRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
