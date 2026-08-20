import { parentRouteDependencies } from "../_dependencies";
import { publicErrorResponse } from "../../../../server/error-safety";
import { handleParentRewards } from "../../../../server/reward-routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleParentRewards(request, parentRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleParentRewards(request, parentRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
