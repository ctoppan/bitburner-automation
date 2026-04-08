/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("ALL");
  ns.tprint(`[${ts()}] Starting initHacking.js`);

  const killAllScript = "/hacking/main/killAll.js";
  const orchestratorScript = "/bootstrap/hackOrchestrator.js";
  const gangManager = "/gang/gangManager_v2.js";

  killDuplicateSelf(ns);

  if (!ns.fileExists(killAllScript, "home")) {
    ns.tprint(`[${ts()}] ERROR: Missing ${killAllScript}`);
    return;
  }

  if (!ns.fileExists(orchestratorScript, "home")) {
    ns.tprint(`[${ts()}] ERROR: Missing ${orchestratorScript}`);
    return;
  }

  ns.tprint(`[${ts()}] Running cleanup with ${killAllScript}`);
  const killPid = ns.run(killAllScript, 1, ns.pid);
  if (killPid === 0) {
    ns.tprint(`[${ts()}] ERROR: Failed to start ${killAllScript}`);
    return;
  }

  await ns.sleep(1500);

  // README-aligned defaults
  const orchestratorArgs = [0.03, 0.08, 1024, 30, 80, 250, 15000];

  if (!isRunningWithArgsOnHome(ns, orchestratorScript, orchestratorArgs)) {
    killAllInstancesOnHome(ns, orchestratorScript);
    const pid = ns.run(orchestratorScript, 1, ...orchestratorArgs);
    if (pid === 0) {
      ns.tprint(`[${ts()}] ERROR: Failed to start ${orchestratorScript}`);
      return;
    }
    ns.tprint(`[${ts()}] Started orchestrator.`);
  }

  // Start gang manager once if available. Do not keep re-spawning forever.
  if (hasGang(ns) && ns.fileExists(gangManager, "home")) {
    ensureSingletonOnHome(ns, gangManager, [110e9, "money", "rep"]);
  }

  ns.tprint(`[${ts()}] initHacking.js handoff complete.`);
}

function hasGang(ns) {
  try {
    return !!ns.gang && ns.gang.inGang();
  } catch {
    return false;
  }
}

function ensureSingletonOnHome(ns, script, args = []) {
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
    ns.run(script, 1, ...args);
  }
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

function killAllInstancesOnHome(ns, script) {
  for (const proc of ns.ps("home")) {
    if (proc.filename === script) {
      try { ns.kill(proc.pid); } catch {}
    }
  }
}

function isRunningWithArgsOnHome(ns, script, args = []) {
  return ns.ps("home").some((p) => p.filename === script && sameArgs(p.args, args));
}

function sameArgs(actual, desired) {
  if (actual.length !== desired.length) return false;
  for (let i = 0; i < actual.length; i++) {
    if (String(actual[i]) !== String(desired[i])) return false;
  }
  return true;
}

function ts() {
  return new Date().toLocaleTimeString();
}