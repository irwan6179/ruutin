import { getD1 } from "../../../db";
import { getServerConfig } from "../../../server/config";
import {
  handleExperienceEvent,
  type ExperienceEventDependencies,
} from "../../../server/experience-events";
import { publicErrorResponse } from "../../../server/error-safety";

export const dynamic = "force-dynamic";

function dependencies(): ExperienceEventDependencies {
  const config = getServerConfig();
  if (!config) throw new Error("Server configuration is unavailable");
  return {
    db: getD1(),
    sessionSecret: config.SESSION_SECRET,
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleExperienceEvent(request, dependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    return await handleExperienceEvent(request, dependencies());
  } catch (error) {
    return publicErrorResponse(error);
  }
}
