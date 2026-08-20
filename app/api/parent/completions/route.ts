import { parentRouteDependencies } from "../_dependencies";
import { handleParentCompletion } from "../../../../server/claim-routes";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleParentCompletion(request, parentRouteDependencies());
}
