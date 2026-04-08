/** @param {NS} ns **/
export async function main(ns) {
  const xpHackPct = Number(ns.args[0] ?? 0.03);
  const moneyHackPct = Number(ns.args[1] ?? 0.08);
  const homeReserveRam = Number(ns.args[2] ?? 1024);
  const xpSpacing = Number(ns.args[3] ?? 30);
  const moneySpacing = Number(ns.args[4] ?? 80);
  const switchHackLevel = Number(ns.args[5] ?? 2500);
  const pollMs = Math.max(5000, Number(ns.args[6] ?? 15000));

  const spreadHack = "/hacking/spread-hack.js";
  const xpGrind = "/xp/xpGrind.js";
  const xpDistributor = "/xp/xpDistributor.js";
  const controller = "/hacking/batch/overlapBatchController.js";
  const playerServers = "/hacking/playerServers.js";

  ns.disableLog("ALL");
  ns.clearLog();

  killDuplicateSelf(ns);

  let lastPhase = "";
  let lastControllerMode = "";

  while (true) {
    try {
      killDuplicateSelf(ns);

      const hackLevel = ns.getHackingLevel();
      const phase = hackLevel < switchHackLevel ? "XP" : "MONEY";

      // Keep infrastructure helper singleton
      if (ns.fileExists(playerServers, "home")) {
        ensureSingletonOnHome(ns, playerServers, []);
      }

      if (phase === "XP") {
        // README-aligned early phase:
        // spread-hack + xpGrind + xpDistributor + overlap controller
        ensureSingletonAnywhere(ns, spreadHack, [], "home");
        ensureSingletonAnywhere(ns, xpGrind, [], "home");
        ensureSingletonAnywhere(ns, xpDistributor, ["n00dles", 256, false], "home");

        const desiredControllerArgs = [xpHackPct, xpSpacing, homeReserveRam, 30];
        ensureSingletonAnywhere(ns, controller, desiredControllerArgs, "home");

        if (lastPhase !== phase || lastControllerMode !== "XP") {
          ns.tprint(`[orchestrator] XP phase active at hack ${hackLevel}.`);
        }

        lastControllerMode = "XP";
      } else {
        // README-aligned money phase:
        // stop XP helpers, keep controller in money mode
        killAllByScript(ns, spreadHack);
        killAllByScript(ns, xpGrind);
        killAllByScript(ns, xpDistributor);

        const desiredControllerArgs = [moneyHackPct, moneySpacing, homeReserveRam, 25];
        ensureSingletonAnywhere(ns, controller, desiredControllerArgs, "home");

        if (lastPhase !== phase || lastControllerMode !== "MONEY") {
          ns.tprint(`[orchestrator] MONEY phase active at hack ${hackLevel}.`);
        }

        lastControllerMode = "MONEY";
      }

      lastPhase = phase;

      ns.clearLog();
      ns.print(`[orchestrator] phase=${phase}`);
      ns.print(`[orchestrator] hack=${hackLevel}`);
      ns.print(`[orchestrator] switch=${switchHackLevel}`);
      ns.print(`[orchestrator] spreadHack=${isRunningAnywhere(ns, spreadHack) ? "on" : "off"}`);
      ns.print(`[orchestrator] xpGrind=${isRunningAnywhere(ns, xpGrind) ? "on" : "off"}`);
      ns.print(`[orchestrator] xpDistributor=${isRunningAnywhere(ns, xpDistributor) ? "on" : "off"}`);
      ns.print(`[orchestrator] controller=${findRunningArgs(ns, controller)}`);
      ns.print(`[orchestrator] playerServers=${isRunningAnywhere(ns, playerServers) ? "on" : "off"}`);
    } catch (err) {
      ns.print(`[orchestrator] ERROR: ${String(err)}`);
    }

    await ns.sleep(pollMs);
  }
}

function ensureSingletonOnHome(ns, script, args = []) {
  if (!ns.fileExists(script, "home")) return false;

  const matches = ns.ps("home").filter((p) => p.filename === script);
  let exactFound = false;

  for (const proc of matches) {
    if (!exactFound && sameArgs(proc.args, args)) {
      exactFound = true;
      continue;
    }
    try { ns.kill(proc.pid); } catch {}
  }

  if (!exactFound) {
    return ns.run(script, 1, ...args) !== 0;
  }

  return true;
}

function ensureSingletonAnywhere(ns, script, args = [], preferredHost = "home") {
  if (!ns.fileExists(script, "home")) return false;

  const all = scanAll(ns);
  const matches = [];

  for (const host of all) {
    for (const proc of ns.ps(host)) {
      if (proc.filename === script) {
        matches.push({ host, proc });
      }
    }
  }

  let exactFound = false;
  for (const { host, proc } of matches) {
    if (!exactFound && host === preferredHost && sameArgs(proc.args, args)) {
      exactFound = true;
      continue;
    }
    try { ns.kill(proc.pid); } catch {}
  }

  if (!exactFound) {
    return ns.exec(script, preferredHost, 1, ...args) !== 0;
  }

  return true;
}

function killAllByScript(ns, script) {
  for (const host of scanAll(ns)) {
    for (const proc of ns.ps(host)) {
      if (proc.filename === script) {
        try { ns.kill(proc.pid); } catch {}
      }
    }
  }
}

function isRunningAnywhere(ns, script) {
  for (const host of scanAll(ns)) {
    if (ns.ps(host).some((p) => p.filename === script)) return true;
  }
  return false;
}

function findRunningArgs(ns, script) {
  for (const host of scanAll(ns)) {
    const proc = ns.ps(host).find((p) => p.filename === script);
    if (proc) return `${host} :: ${proc.args.join(" ")}`;
  }
  return "off";
}

function killDuplicateSelf(ns) {
  const self = ns.getScriptName();
  const me = ns.pid;
  for (const proc of ns.ps("home")) {
    if (proc.filename === self && proc.pid !== me) {
      try { ns.kill(proc.pid); } catch {}
    }
  }
}

function scanAll(ns) {
  const seen = new Set(["home"]);
  const queue = ["home"];

  while (queue.length > 0) {
    const host = queue.shift();
    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return [...seen];
}

function sameArgs(actual, desired) {
  if (actual.length !== desired.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (String(actual[i]) !== String(desired[i])) return false;
  }
  return true;
}