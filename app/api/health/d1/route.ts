import { readD1Health } from "../../../../db";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, private",
};

export async function GET() {
  try {
    const health = await readD1Health();
    return Response.json(health, { headers: noStoreHeaders });
  } catch {
    // Keep binding/runtime details out of a public probe response.
    return Response.json(
      { database: "unavailable" },
      { status: 503, headers: noStoreHeaders },
    );
  }
}
