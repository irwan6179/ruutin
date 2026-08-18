import { parentRouteDependencies } from "../_dependencies";
import { handleParentClaims } from "../../../../server/claim-routes";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleParentClaims(request, parentRouteDependencies());
}

export async function POST(request: Request): Promise<Response> {
  return handleParentClaims(request, parentRouteDependencies());
}
