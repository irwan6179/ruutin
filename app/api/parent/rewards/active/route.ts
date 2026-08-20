import { parentRouteDependencies } from "../../_dependencies";
import { publicErrorResponse } from "../../../../../server/error-safety";
import { handleParentActiveReward } from "../../../../../server/reward-routes";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleParentActiveReward(request, parentRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
