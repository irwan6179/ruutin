import { settingsRouteDependencies } from "../_dependencies";
import {
  handleParentSettings,
} from "../../../../server/settings-routes";
import { publicErrorResponse } from "../../../../server/error-safety";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleParentSettings(request, settingsRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    return await handleParentSettings(request, settingsRouteDependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
