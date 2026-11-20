import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { transaction, type DB } from "./db";
import type { Role, Tenant } from "@/lib/types";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const adminSupabase = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
export async function getUser(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!token) throw new HttpError(401, "Please sign in.");
  const { data, error } = await adminSupabase().auth.getUser(token);
  if (error || !data.user)
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  return data.user;
}
export type Context = { db: DB; tenant: Tenant; userId: string; role: Role };
export async function withTenant<T>(
  request: Request,
  handler: (ctx: Context) => Promise<T>,
  roles?: Role[],
) {
  const user = await getUser(request);
  const tenantId = z.uuid().parse(request.headers.get("x-tenant-id"));
  return transaction(async (db) => {
    const { rows } = await db.query(
      "select t.*,m.role from mori_tenants t join mori_memberships m on m.tenant_id=t.id where t.id=$1 and m.user_id=$2",
      [tenantId, user.id],
    );
    if (!rows[0])
      throw new HttpError(403, "You do not have access to this workspace.");
    if (roles && !roles.includes(rows[0].role))
      throw new HttpError(
        403,
        "This action requires a workspace administrator.",
      );
    return handler({
      db,
      tenant: rows[0],
      userId: user.id,
      role: rows[0].role,
    });
  }, user.id);
}
export function apiError(error: unknown) {
  if (error instanceof SyntaxError)
    return NextResponse.json(
      { error: "The request body is not valid JSON." },
      { status: 400 },
    );
  if (error instanceof HttpError)
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: error.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  // Log only SQL/network error codes; connection strings and tokens never go to the client/log.
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "INTERNAL";
  console.error("Mori request failed:", code);
  return NextResponse.json(
    {
      error:
        "The operation could not be completed. Check the connection status and try again.",
    },
    { status: 500 },
  );
}
export async function api(handler: () => Promise<unknown>) {
  try {
    return NextResponse.json(await handler(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}
