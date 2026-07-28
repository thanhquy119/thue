export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runFastTaxDiscovery(controller, env));
  },
};

async function runFastTaxDiscovery(controller, env) {
  const baseUrl =
    env.THUE_RO_FAST_DISCOVERY_URL ||
    "https://thue-ro.vercel.app/api/cron/fast-tax-discovery";
  if (!env.DISCOVERY_CRON_SECRET) {
    throw new Error("Thiếu secret DISCOVERY_CRON_SECRET.");
  }

  const minute = new Date(controller.scheduledTime).getUTCMinutes();
  const url = new URL(baseUrl);
  if (minute % 15 !== 0) url.searchParams.set("notify_only", "1");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${env.DISCOVERY_CRON_SECRET}`,
      "user-agent": "thue-ro-cloudflare-discovery/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(
      `Thuế Rõ fast discovery trả HTTP ${response.status}: ${await response.text()}`,
    );
  }
  console.log(await response.text());
}
