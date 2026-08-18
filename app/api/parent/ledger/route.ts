import { parentRouteDependencies } from "../_dependencies";
import { handleParentLedger } from "../../../../server/claim-routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleParentLedger(request, parentRouteDependencies());
}

export async function POST(request: Request): Promise<Response> {
  return handleParentLedger(request, parentRouteDependencies());
}
