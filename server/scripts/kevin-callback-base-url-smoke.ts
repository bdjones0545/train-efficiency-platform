/**
 * Smoke: KEVIN_CALLBACK_BASE_URL resolve + path join + wrong-name guard.
 *
 *   npx tsx server/scripts/kevin-callback-base-url-smoke.ts
 */
import {
  KEVIN_CALLBACK_BASE_URL_DEFAULT,
  buildKevinCallbackUrl,
  getKevinCallbackBaseUrl,
  getKevinCallbackBaseUrlStatus,
  getKevinHermesWebhookUrl,
  isAbsoluteHttpUrl,
  normalizeKevinCallbackBaseUrl,
  whichKevinCallbackBaseUrlEnv,
} from "../../shared/kevin/callback-base-url";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

function main(): void {
  assert(normalizeKevinCallbackBaseUrl("https://app.trainefficiency.com/") === "https://app.trainefficiency.com", "strip slash");
  assert(normalizeKevinCallbackBaseUrl("not-a-url") === null, "reject relative");
  assert(normalizeKevinCallbackBaseUrl("") === null, "empty");
  assert(isAbsoluteHttpUrl("https://x.test/a"), "abs ok");
  assert(!isAbsoluteHttpUrl("/api/x"), "rel bad");

  const preferred = getKevinCallbackBaseUrl({
    KEVIN_CALLBACK_BASE_URL: "https://example.test/",
    TE_APP_BASE_URL: "https://ignored.test",
  });
  assert(preferred === "https://example.test", `preferred got ${preferred}`);
  assert(
    whichKevinCallbackBaseUrlEnv({ KEVIN_CALLBACK_BASE_URL: "https://example.test" }) ===
      "KEVIN_CALLBACK_BASE_URL",
    "which env preferred",
  );

  const fallbackTe = getKevinCallbackBaseUrl({ TE_APP_BASE_URL: "https://te.fallback/" });
  assert(fallbackTe === "https://te.fallback", fallbackTe);

  const def = getKevinCallbackBaseUrl({});
  assert(def === KEVIN_CALLBACK_BASE_URL_DEFAULT, def);
  assert(def === "https://trainefficiency.com", "default apex host");

  const joined = buildKevinCallbackUrl("/api/kevin/webhooks/hermes", {
    KEVIN_CALLBACK_BASE_URL: "https://app.trainefficiency.com",
  });
  assert(joined === "https://app.trainefficiency.com/api/kevin/webhooks/hermes", joined);

  const abs = buildKevinCallbackUrl("https://hooks.other.test/cb", {});
  assert(abs === "https://hooks.other.test/cb", abs);

  const st = getKevinCallbackBaseUrlStatus({
    KEVIN_CALLBACK_BASE_URL: "https://app.trainefficiency.com",
  });
  assert(
    Boolean(st.configured && st.sourceEnv === "KEVIN_CALLBACK_BASE_URL" && !st.usingDefault),
    "status preferred",
  );
  assert(
    getKevinHermesWebhookUrl({
      KEVIN_CALLBACK_BASE_URL: "https://app.trainefficiency.com",
    }).endsWith("/api/kevin/webhooks/hermes"),
    "webhook path",
  );

  // live process.env presence (no value print)
  const live = getKevinCallbackBaseUrlStatus(process.env as Record<string, string | undefined>);
  console.log(
    JSON.stringify(
      {
        ok: true,
        live: {
          configured: live.configured,
          sourceEnv: live.sourceEnv,
          usingDefault: live.usingDefault,
          baseUrl: live.baseUrl,
          hermesWebhookUrl: live.hermesWebhookUrl,
        },
        note: "KEVIN_CALLBACK_BASE_URL is TE origin for Kevin→TE callbacks; not KEVIN_HERMES_BASE_URL",
      },
      null,
      2,
    ),
  );
}

main();
