import { parentRouteDependencies } from "../_dependencies";
import { handleParentToday } from "../../../../server/parent-routes";
import { publicErrorResponse } from "../../../../server/error-safety";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try { return await handleParentToday(request, parentRouteDependencies()); } catch (error) { return publicErrorResponse(error); }
}
