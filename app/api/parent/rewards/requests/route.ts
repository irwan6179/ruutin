import { parentRouteDependencies } from "../../_dependencies";
import { publicErrorResponse } from "../../../../../server/error-safety";
import { handleParentRewardRequests } from "../../../../../server/reward-routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleParentRewardRequests(request, parentRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleParentRewardRequests(request, parentRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
