import { parentRouteDependencies } from "../../_dependencies";
import { handleParentTaskBulk } from "../../../../../server/parent-routes";
import { publicErrorResponse } from "../../../../../server/error-safety";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try { return await handleParentTaskBulk(request, parentRouteDependencies()); } catch (error) { return publicErrorResponse(error); }
}
