import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { withTenant, apiError } from "@/server/auth";
import { encrypt } from "@/server/crypto";
import { graphVersion } from "@/server/facebook";
export async function POST(request: Request) {
  try {
    const info = await withTenant(
      request,
      async (ctx) => ({ tenantId: ctx.tenant.id, userId: ctx.userId }),
      ["head", "admin"],
    );
    const nonce = randomBytes(24).toString("hex");
    const state = encrypt(
      JSON.stringify({ ...info, nonce, exp: Date.now() + 10 * 60 * 1000 }),
    );
    const redirect = new URL(
      `https://www.facebook.com/${graphVersion()}/dialog/oauth`,
    );
    redirect.search = new URLSearchParams({
      client_id: process.env.FACEBOOK_APP_ID!,
      redirect_uri: `${process.env.APP_URL}/api/facebook/callback`,
      state,
      scope:
        "pages_show_list,pages_read_engagement,pages_manage_metadata,pages_messaging,ads_read,ads_management,business_management",
      response_type: "code",
    }).toString();
    const response = NextResponse.json({ url: redirect.toString() });
    response.cookies.set("mori_oauth_nonce", nonce, {
      httpOnly: true,
      secure: process.env.APP_URL?.startsWith("https:"),
      sameSite: "lax",
      maxAge: 600,
      path: "/api/facebook/callback",
    });
    return response;
  } catch (e) {
    return apiError(e);
  }
}
