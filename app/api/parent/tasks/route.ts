import { parentRouteDependencies } from "../_dependencies";
import { handleParentTasks } from "../../../../server/parent-routes";
import { publicErrorResponse } from "../../../../server/error-safety";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try { return await handleParentTasks(request, parentRouteDependencies()); } catch (error) { return publicErrorResponse(error); }
}

export async function POST(request: Request): Promise<Response> {
  try { return await handleParentTasks(request, parentRouteDependencies()); } catch (error) { return publicErrorResponse(error); }
}
