/** @param {NS} ns */
export async function main(ns) {
  const url = "https://raw.githubusercontent.com/ctoppan/bitburner-automation/main/src/bootstrap/start.js";
  const file = "bootstrap/start.js";

  // Clean old file
  if (ns.fileExists(file, "home")) {
    ns.rm(file, "home");
  }

  const ok = await ns.wget(`${url}?ts=${Date.now()}`, file);

  if (!ok || !ns.fileExists(file, "home")) {
    ns.tprint("[install] Failed to download start.js");
    return;
  }

  ns.tprint("[install] Downloaded start.js, launching...");
  ns.spawn(file, 1);
}