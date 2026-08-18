import { settingsRouteDependencies } from "../../_dependencies";
import { handleHouseholdDeletion } from "../../../../../server/settings-routes";
import { publicErrorResponse } from "../../../../../server/error-safety";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleHouseholdDeletion(request, settingsRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
