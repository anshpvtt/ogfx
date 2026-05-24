import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";

type CookieToSet = { name: string; value: string; options?: any };

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const token_hash = requestUrl.searchParams.get("token_hash");
  const code = requestUrl.searchParams.get("code");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const next = requestUrl.searchParams.get("next") ?? "/dashboard";

  if (!code && (!token_hash || !type)) {
    return NextResponse.redirect(new URL(`/auth/login?error=missing_token`, requestUrl.origin));
  }

  const response = NextResponse.redirect(new URL(next, requestUrl.origin));
  const supabaseForCookies = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );

  const { error } = code
    ? await supabaseForCookies.auth.exchangeCodeForSession(code)
    : await supabaseForCookies.auth.verifyOtp({
        token_hash: token_hash!,
        type: type!,
      });

  if (error) {
    return NextResponse.redirect(new URL(`/auth/login?error=confirm_failed`, requestUrl.origin));
  }

  return response;
}
