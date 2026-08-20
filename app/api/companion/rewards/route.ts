import { requireCompanionContext } from "../../../../server/auth-context";
import { publicErrorResponse } from "../../../../server/error-safety";
import { getCompanionRewards } from "../../../../server/companion";
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
      { rewards: await getCompanionRewards(dependencies.db, context) },
      { status: 200 },
      { private: true },
    );
  } catch (error) {
    return publicErrorResponse(error);
  }
}
