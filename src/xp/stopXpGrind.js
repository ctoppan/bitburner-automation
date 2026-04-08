/** @param {NS} ns **/
export async function main(ns) {
  const workerNames = new Set([
    "xp/xpGrind.js",
    "/xp/xpGrind.js",
    "xp/xpDistributor.js",
    "/xp/xpDistributor.js",
    "hacking/spread-hack.js",
    "/hacking/spread-hack.js",
  ])

  const seen = new Set(["home"])
  const queue = ["home"]
  let killed = 0

  while (queue.length > 0) {
    const host = queue.shift()

    for (const next of ns.scan(host)) {
      if (!seen.has(next)) {
        seen.add(next)
        queue.push(next)
      }
    }

    for (const proc of ns.ps(host)) {
      if (workerNames.has(String(proc.filename))) {
        try {
          if (ns.kill(proc.pid)) killed++
        } catch {}
      }
    }
  }

  ns.tprint(`Stopped ${killed} XP-related processes.`)
}