import { requireCompanionContext } from "../../../../server/auth-context";
import { publicErrorResponse } from "../../../../server/error-safety";
import { getCompanionToday } from "../../../../server/companion";
import { handleCompanionClaim } from "../../../../server/claim-routes";
import { jsonResponse } from "../../../../server/http-security";
import { companionRouteDependencies } from "../_dependencies";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const dependencies = companionRouteDependencies();
    const context = await requireCompanionContext(request, dependencies.db, {
      sessionSecret: dependencies.sessionSecret,
    });
    return jsonResponse(
      { today: await getCompanionToday(dependencies.db, context) },
      { status: 200 },
      { private: true },
    );
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  return handleCompanionClaim(request, companionRouteDependencies());
}
