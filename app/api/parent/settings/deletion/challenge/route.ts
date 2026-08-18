import { settingsRouteDependencies } from "../../../_dependencies";
import { handleHouseholdDeletionChallenge } from "../../../../../../server/settings-routes";
import { publicErrorResponse } from "../../../../../../server/error-safety";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleHouseholdDeletionChallenge(request, settingsRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
