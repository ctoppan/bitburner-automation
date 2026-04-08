/** @param {NS} ns **/
export async function main(ns) {
  ns.disableLog("sleep")
  ns.tprint(`[${ts()}] Starting initHacking.js`)

  const killAllScript = "/hacking/main/killAll.js"
  const xpDistributor = "/xp/xpDistributor.js"
  const stopXp = "/xp/stopXpGrind.js"
  const hackOrchestrator = "/bootstrap/hackOrchestrator.js"
  const gangManager = "/gang/gangManager_v2.js"
  const crimeManager = "/crime/crimeManager.js"
  const autoGangStarter = "/gang/autoGangStarter.js"
  const playerServers = "/hacking/playerServers.js"

  const xpTarget = "n00dles"
  const xpReserveRam = 256
  const xpAllowSpread = false

  const orchestratorHackThreshold = 150
  const orchestratorSwitchHackLevel = 175
  const orchestratorXpScanTop = 30
  const orchestratorMoneyScanTop = 25
  const pollMs = 15000

  killDuplicatesOnHome(ns)

  if (!ns.fileExists(killAllScript, "home")) {
    ns.tprint(`[${ts()}] ERROR: Missing ${killAllScript}`)
    return
  }

  if (!ns.fileExists(xpDistributor, "home")) {
    ns.tprint(`[${ts()}] ERROR: Missing ${xpDistributor}`)
    return
  }

  ns.tprint(`[${ts()}] Running cleanup with ${killAllScript}`)
  const killPid = ns.run(killAllScript, 1, ns.pid)
  if (killPid === 0) {
    ns.tprint(`[${ts()}] ERROR: Failed to start ${killAllScript}`)
    return
  }

  await ns.sleep(1000)

  ensureSingletonOnHome(ns, xpDistributor, [xpTarget, xpReserveRam, xpAllowSpread])
  await ns.sleep(250)

  if (hasGang(ns)) {
    ensureSingletonOnHome(ns, gangManager, [150e9, "money", "rep"])
  } else {
    ensureSingletonOnHome(ns, crimeManager, ["karma"])
    await ns.sleep(250)
    ensureSingletonOnHome(ns, autoGangStarter, ["Slum Snakes", 5000, -54000])
  }

  if (ns.fileExists(playerServers, "home")) {
    ensureSingletonOnHome(ns, playerServers, [])
  }

  while (true) {
    try {
      killManagedDuplicates(ns)

      if (hasGang(ns)) {
        ensureSingletonOnHome(ns, gangManager, [150e9, "money", "rep"])
      }

      if (ns.fileExists(playerServers, "home")) {
        ensureSingletonOnHome(ns, playerServers, [])
      }

      const shouldRunOrchestrator = ns.getHackingLevel() >= orchestratorHackThreshold
      const orchestratorRunning = isRunningAnywhere(ns, hackOrchestrator)
      const xpRunning =
        isRunningAnywhere(ns, "/xp/xpGrind.js") ||
        isRunningAnywhere(ns, xpDistributor)

      if (shouldRunOrchestrator) {
        if (!orchestratorRunning && ns.fileExists(hackOrchestrator, "home")) {
          ns.tprint(`[${ts()}] Switching to orchestrator mode.`)
          stopXpEverywhere(ns, stopXp, xpDistributor)
          await ns.sleep(500)
          ensureSingletonOnHome(ns, hackOrchestrator, [
            0.03,
            0.08,
            1024,
            orchestratorXpScanTop,
            orchestratorMoneyScanTop,
            orchestratorSwitchHackLevel,
            5000
          ])
        }
      } else {
        if (!xpRunning) {
          ns.tprint(`[${ts()}] Staying in XP mode.`)
          ensureSingletonOnHome(ns, xpDistributor, [xpTarget, xpReserveRam, xpAllowSpread])
        }
      }
    } catch (err) {
      ns.tprint(`[${ts()}] ERROR: ${String(err)}`)
    }

    await ns.sleep(pollMs)
  }
}

function hasGang(ns) {
  try {
    return !!ns.gang && ns.gang.inGang()
  } catch {
    return false
  }
}

function ensureSingletonOnHome(ns, script, args = []) {
  if (!ns.fileExists(script, "home")) return false

  const homeMatches = ns.ps("home").filter((p) => p.filename === script)

  if (homeMatches.length > 1) {
    homeMatches
      .sort((a, b) => a.pid - b.pid)
      .slice(1)
      .forEach((p) => {
        try { ns.kill(p.pid) } catch {}
      })
  }

  const exact = ns.ps("home").find((p) => p.filename === script && sameArgs(p.args, args))
  if (exact) return true

  const remaining = ns.ps("home").filter((p) => p.filename === script)
  for (const proc of remaining) {
    try { ns.kill(proc.pid) } catch {}
  }

  return ns.run(script, 1, ...args) !== 0
}

function stopXpEverywhere(ns, stopXpScript, xpDistributor) {
  if (ns.fileExists(stopXpScript, "home")) {
    ns.run(stopXpScript, 1)
  }

  for (const host of scanAll(ns)) {
    ns.scriptKill("/xp/xpGrind.js", host)
    ns.scriptKill(xpDistributor, host)
    ns.scriptKill("/hacking/spread-hack.js", host)
  }
}

function isRunningAnywhere(ns, script) {
  for (const host of scanAll(ns)) {
    if (ns.ps(host).some((p) => p.filename === script)) return true
  }
  return false
}

function sameArgs(actual, desired) {
  if (actual.length !== desired.length) return false
  for (let i = 0; i < actual.length; i++) {
    if (String(actual[i]) !== String(desired[i])) return false
  }
  return true
}

function scanAll(ns) {
  const seen = new Set(["home"])
  const queue = ["home"]

  while (queue.length > 0) {
    const host = queue.shift()
    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }
  }

  return [...seen]
}

function killDuplicatesOnHome(ns) {
  const self = ns.getScriptName()
  const me = ns.pid
  const matches = ns.ps("home").filter((p) => p.filename === self && p.pid !== me)
  for (const proc of matches) {
    try { ns.kill(proc.pid) } catch {}
  }
}

function killManagedDuplicates(ns) {
  const managed = [
    "/gang/gangManager_v2.js",
    "/hacking/playerServers.js",
    "/bootstrap/hackOrchestrator.js",
    "/xp/xpDistributor.js",
    "/crime/crimeManager.js",
    "/gang/autoGangStarter.js",
  ]

  for (const script of managed) {
    const matches = ns.ps("home").filter((p) => p.filename === script)
    if (matches.length > 1) {
      matches
        .sort((a, b) => a.pid - b.pid)
        .slice(1)
        .forEach((p) => {
          try { ns.kill(p.pid) } catch {}
        })
    }
  }
}

function ts() {
  return new Date().toLocaleTimeString()
}