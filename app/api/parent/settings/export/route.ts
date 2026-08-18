import { settingsRouteDependencies } from "../../_dependencies";
import { handleParentHouseholdExport } from "../../../../../server/settings-routes";
import { publicErrorResponse } from "../../../../../server/error-safety";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleParentHouseholdExport(request, settingsRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
