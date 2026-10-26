// Node 22+ loopback-only driver for our isolated Electron instance, not a user session.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.argv[2] ?? "");
const meta = JSON.parse(await readFile(path.join(root, "fixture.json"), "utf8"));
if (meta.kind !== "okf-enforcer-e2e" || meta.fixtureRoot !== root || !Number.isInteger(meta.debugPort)) throw new Error("Invalid fixture marker");
const targets = await (await fetch(`http://127.0.0.1:${meta.debugPort}/json/list`)).json();
const pages = targets.filter((target) => target.type === "page" && target.url.startsWith("app://obsidian.md/"));
if (pages.length !== 1) throw new Error(`Expected one isolated Obsidian page, got ${JSON.stringify(targets)}`);
const wsUrl = new URL(pages[0].webSocketDebuggerUrl);
if (wsUrl.hostname !== "127.0.0.1" && wsUrl.hostname !== "localhost") throw new Error("Refusing non-loopback debugging");
const socket = new WebSocket(wsUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let id = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  const receiver = pending.get(message.id); if (!receiver) return;
  pending.delete(message.id); clearTimeout(receiver.timer);
  if (message.error) receiver.reject(new Error(JSON.stringify(message.error))); else receiver.resolve(message.result);
});
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const next = ++id;
    const timer = setTimeout(() => { pending.delete(next); reject(new Error(`Timed out: ${method}`)); }, 120000);
    pending.set(next, { resolve, reject, timer }); socket.send(JSON.stringify({ id: next, method, params }));
  });
}
async function evaluate(expression) {
  const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}
try {
  const info = await evaluate(`(()=>{let apiVersion,userData;try{apiVersion=require('obsidian').apiVersion;userData=require('electron').remote?.app?.getPath('userData')}catch{}return{title:document.title,vault:globalThis.app?.vault?.adapter?.getBasePath?.(),apiVersion,userData}})()`);
  const mode = process.argv[3] ?? "info";
  if (mode !== "info" && (!info.vault || path.resolve(info.vault) !== path.resolve(meta.vault))) throw new Error(`Wrong vault: ${JSON.stringify(info)}`);
  if (mode === "info") console.log(JSON.stringify(info, null, 2));
  else if (mode === "eval") console.log(JSON.stringify(await evaluate(process.argv[4]), null, 2));
  else if (mode === "receipt") console.log(JSON.stringify(await evaluate(`app.plugins.plugins['okf-api-e2e-consumer']?.lastReceipt ?? null`), null, 2));
  else if (mode === "run") console.log(JSON.stringify(await evaluate(`app.plugins.plugins['okf-api-e2e-consumer'].run()`), null, 2));
  else if (mode === "reload") console.log(await evaluate(`setTimeout(()=>location.reload(),0);'reload scheduled'`));
  else if (mode === "screenshot") {
    const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const output = path.join(meta.evidenceDir, "obsidian.png"); await writeFile(output, Buffer.from(screenshot.data, "base64")); console.log(output);
  } else throw new Error("Unknown fixture-driver command");
} finally { socket.close(); }
