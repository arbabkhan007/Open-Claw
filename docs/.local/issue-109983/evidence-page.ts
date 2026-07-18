import { renderTelegramMiniAppPage } from "../../../extensions/telegram/src/miniapp/page.js";

const html = renderTelegramMiniAppPage({ accountId: "test-account", scriptNonce: "test-nonce" });
console.log("HTML length:", html.length);
console.log("Contains body cancel:", html.includes("body?.cancel()"));
console.log("Contains auth POST:", html.includes('method: "POST"'));
