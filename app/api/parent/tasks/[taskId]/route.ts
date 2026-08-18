import { parentRouteDependencies } from "../../_dependencies";
import { handleParentTask } from "../../../../../server/parent-routes";
import { publicErrorResponse } from "../../../../../server/error-safety";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ taskId: string }> | { taskId: string } };

async function taskIdFrom(context: RouteContext): Promise<string> {
  const params = await context.params;
  return params.taskId;
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try { return await handleParentTask(request, parentRouteDependencies(), await taskIdFrom(context)); } catch (error) { return publicErrorResponse(error); }
}

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try { return await handleParentTask(request, parentRouteDependencies(), await taskIdFrom(context)); } catch (error) { return publicErrorResponse(error); }
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try { return await handleParentTask(request, parentRouteDependencies(), await taskIdFrom(context)); } catch (error) { return publicErrorResponse(error); }
}
