import { parentRouteDependencies } from "../../_dependencies";
import { handleParentTaskReorder } from "../../../../../server/parent-routes";
import { publicErrorResponse } from "../../../../../server/error-safety";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try { return await handleParentTaskReorder(request, parentRouteDependencies()); } catch (error) { return publicErrorResponse(error); }
}
