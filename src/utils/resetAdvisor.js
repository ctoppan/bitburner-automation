/** @param {NS} ns **/
export async function main(ns) {
  const reserve = Number(ns.args[0] ?? 110e9)
  const daedalusMoneyGate = Number(ns.args[1] ?? 100e9)
  const daedalusHackGate = Number(ns.args[2] ?? 2500)
  const minPending = Math.max(1, Number(ns.args[3] ?? 5))
  const maxFutureBuysToSim = Math.max(1, Number(ns.args[4] ?? 5))
  const augPriceMultiplier = Number(ns.args[5] ?? 1.9)
  const gangKarmaTarget = Number(ns.args[6] ?? -54000)
  const gangHoldWindow = Math.max(0, Number(ns.args[7] ?? 15000))

  const player = ns.getPlayer()
  const factions = player.factions || []
  const hasDaedalus = factions.includes("Daedalus")
  const homeMoney = ns.getServerMoneyAvailable("home")
  const hack = ns.getHackingLevel()

  const lines = []
  lines.push("=== Reset Advisor ===")
  lines.push(`Home money:        ${fmtMoney(ns, homeMoney)}`)
  lines.push(`Reserve target:    ${fmtMoney(ns, reserve)}`)
  lines.push(`Daedalus money:    ${fmtMoney(ns, daedalusMoneyGate)}`)
  lines.push(`Hacking level:     ${ns.formatNumber(hack, 3)}`)
  lines.push(`Hack target:       ${ns.formatNumber(daedalusHackGate, 3)}`)
  lines.push(`Daedalus joined:   ${hasDaedalus ? "yes" : "no"}`)
  lines.push(`Min pending target ${minPending}`)
  lines.push(`Price multiplier:  x${augPriceMultiplier.toFixed(2)}`)

  const augSummary = getAugSummary(ns)
  lines.push("")
  lines.push("Augments:")
  lines.push(`  owned installed: ${augSummary.ownedInstalled.length}`)
  lines.push(`  owned total:     ${augSummary.ownedWithPending.length}`)
  lines.push(`  pending queued:  ${augSummary.pending.length}`)
  lines.push(`  pending cost:    ${fmtMoney(ns, augSummary.pendingCost)}`)
  lines.push(`  red pill queued: ${augSummary.hasRedPillPending ? "yes" : "no"}`)

  const inGang = safeInGang(ns)
  const karma = safeHeartBreak(ns)
  const karmaRemaining = Math.max(0, karma - gangKarmaTarget)
  const gangHoldActive = !inGang && karma > gangKarmaTarget && karmaRemaining <= gangHoldWindow

  lines.push("")
  lines.push("Gang unlock status:")
  lines.push(`  in gang:         ${inGang ? "yes" : "no"}`)
  lines.push(`  karma:           ${ns.formatNumber(karma, 6)}`)
  lines.push(`  target karma:    ${ns.formatNumber(gangKarmaTarget, 6)}`)
  lines.push(`  karma remaining: ${ns.formatNumber(karmaRemaining, 6)}`)
  lines.push(`  hold active:     ${gangHoldActive ? "yes" : "no"}`)

  const future = simulateFutureBuys(ns, {
    ownedWithPending: new Set(augSummary.ownedWithPending),
    factions,
    availableMoney: Math.max(0, homeMoney - reserve),
    maxBuys: maxFutureBuysToSim,
    priceMultiplier: augPriceMultiplier,
  })

  lines.push("")
  lines.push("Future buy simulation:")
  lines.push(`  money after reserve: ${fmtMoney(ns, Math.max(0, homeMoney - reserve))}`)
  lines.push(`  simulated buys:      ${future.buys.length}`)
  lines.push(`  simulated cost:      ${fmtMoney(ns, future.totalCost)}`)

  if (future.buys.length > 0) {
    for (const buy of future.buys) {
      lines.push(
        `  - ${buy.aug} | faction=${buy.faction} | cost=${fmtMoney(ns, buy.simulatedPrice)} | repReq=${ns.formatNumber(buy.repReq, 3)}`
      )
    }
  } else {
    lines.push("  - none affordable / eligible right now")
  }

  if (ns.gang && ns.gang.inGang()) {
    const gang = ns.gang.getGangInformation()
    const members = ns.gang.getMemberNames()
    lines.push("")
    lines.push("Gang:")
    lines.push(`  faction:         ${gang.faction}`)
    lines.push(`  members:         ${members.length}`)
    lines.push(`  respect:         ${ns.formatNumber(gang.respect, 3)}`)
    lines.push(`  wanted penalty:  ${(gang.wantedPenalty * 100).toFixed(2)}%`)
    lines.push(`  territory:       ${(gang.territory * 100).toFixed(2)}%`)
  }

  lines.push("")
  lines.push("Recommendation:")

  if (homeMoney < daedalusMoneyGate) {
    lines.push("- Keep pushing money. Do not raise reserve too high yet.")
  } else if (homeMoney < reserve) {
    lines.push("- You crossed the Daedalus floor, but current reserve is higher than cash. Avoid spending.")
  } else {
    lines.push("- Money objective met. Protect reserve and push rep.")
  }

  if (hack < daedalusHackGate) {
    lines.push("- Favor XP-heavy hacking until hack is stable above the target.")
  } else {
    lines.push("- Hacking objective met. Favor stable money batches and faction work.")
  }

  if (!hasDaedalus) {
    lines.push("- Daedalus not joined yet. Keep checking invite conditions.")
  } else {
    lines.push("- Daedalus joined. Narrow focus to rep and the aug package you want.")
  }

  if (gangHoldActive) {
    lines.push("- Close to gang unlock. Delay reset until gang is created unless there is an exceptional reason.")
  }

  const recommendation = decideResetReadiness({
    hasDaedalus,
    homeMoney,
    reserve,
    hack,
    daedalusHackGate,
    pendingCount: augSummary.pending.length,
    hasRedPillPending: augSummary.hasRedPillPending,
    futureBuys: future.buys.length,
    minPending,
    inGang,
    gangHoldActive,
  })

  lines.push("")
  lines.push(`Reset-ready: ${recommendation.status}`)
  lines.push(`Why: ${recommendation.reason}`)

  ns.tprint(lines.join("\n"))
}

function getAugSummary(ns) {
  const ownedInstalled = getOwnedAugsSafe(ns, false)
  const ownedWithPending = getOwnedAugsSafe(ns, true)
  const installedSet = new Set(ownedInstalled)
  const pending = ownedWithPending.filter((aug) => !installedSet.has(aug))

  let pendingCost = 0
  for (const aug of pending) {
    pendingCost += getAugPriceSafe(ns, aug)
  }

  return {
    ownedInstalled,
    ownedWithPending,
    pending,
    pendingCost,
    hasRedPillPending: pending.includes("The Red Pill"),
  }
}

function simulateFutureBuys(ns, opts) {
  const ownedWithPending = opts.ownedWithPending
  const factions = opts.factions || []
  const availableMoney = Math.max(0, Number(opts.availableMoney ?? 0))
  const maxBuys = Math.max(1, Number(opts.maxBuys ?? 5))
  const priceMultiplier = Number(opts.priceMultiplier ?? 1.9)

  const market = buildMarket(ns, factions, ownedWithPending)
    .filter((x) => scoreCandidate(ns, x) > 0)
    .sort((a, b) => {
      const aScore = scoreCandidate(ns, a)
      const bScore = scoreCandidate(ns, b)
      if (bScore !== aScore) return bScore - aScore
      if (a.price !== b.price) return a.price - b.price
      return a.aug.localeCompare(b.aug)
    })

  let moneyLeft = availableMoney
  let multiplierPow = 0
  const buys = []
  const purchased = new Set()

  while (buys.length < maxBuys) {
    let picked = null

    for (const candidate of market) {
      if (ownedWithPending.has(candidate.aug) || purchased.has(candidate.aug)) continue
      if (getFactionRepSafe(ns, candidate.faction) < candidate.repReq) continue

      const prereqsMet = candidate.prereqs.every((p) => ownedWithPending.has(p) || purchased.has(p))
      if (!prereqsMet) continue

      const simulatedPrice = candidate.price * Math.pow(priceMultiplier, multiplierPow)
      if (simulatedPrice > moneyLeft) continue

      picked = {
        ...candidate,
        simulatedPrice,
      }
      break
    }

    if (!picked) break

    buys.push(picked)
    purchased.add(picked.aug)
    moneyLeft -= picked.simulatedPrice
    multiplierPow++
  }

  return {
    buys,
    totalCost: buys.reduce((sum, x) => sum +