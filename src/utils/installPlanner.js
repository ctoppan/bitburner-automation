/** @param {NS} ns **/
export async function main(ns) {
    const minPending = Math.max(1, Number(ns.args[0] ?? 5));
    const minPendingWithRedPill = Math.max(1, Number(ns.args[1] ?? 1));
    const reserve = Math.max(0, Number(ns.args[2] ?? 0));
    const gangKarmaTarget = Number(ns.args[3] ?? -54000);
    const gangHoldWindow = Math.max(0, Number(ns.args[4] ?? 15000));

    if (!hasPlannerApi(ns)) {
        ns.tprint("[installPlanner] Singularity API unavailable.");
        return;
    }

    const plan = buildInstallPlan(ns, {
        minPending,
        minPendingWithRedPill,
        reserve,
        gangKarmaTarget,
        gangHoldWindow,
    });

    ns.tprint(`[installPlanner] status=${plan.status}`);
    ns.tprint(`[installPlanner] reason=${plan.reason}`);
    ns.tprint(`[installPlanner] owned=${plan.ownedCount} pending=${plan.pendingCount}`);
    ns.tprint(`[installPlanner] pendingCost=${ns.formatNumber(plan.pendingCost)}`);
    ns.tprint(`[installPlanner] money=${ns.formatNumber(plan.money)}`);
    ns.tprint(`[installPlanner] reserve=${ns.formatNumber(plan.reserve)}`);
    ns.tprint(`[installPlanner] redPillQueued=${plan.hasRedPillPending}`);
    ns.tprint(`[installPlanner] neuroFluxQueued=${plan.neuroFluxPending}`);
    ns.tprint(`[installPlanner] inGang=${plan.inGang}`);
    ns.tprint(`[installPlanner] karma=${ns.formatNumber(plan.karma, 6)}`);
    ns.tprint(`[installPlanner] gangKarmaTarget=${ns.formatNumber(plan.gangKarmaTarget, 6)}`);
    ns.tprint(`[installPlanner] karmaRemaining=${ns.formatNumber(plan.karmaRemaining, 6)}`);
    ns.tprint(`[installPlanner] gangHoldActive=${plan.gangHoldActive}`);

    if (plan.pending.length > 0) {
        ns.tprint("[installPlanner] Pending augmentations:");
        for (const aug of plan.pending) {
            ns.tprint(
                `[installPlanner] ${aug.name} | price=${ns.formatNumber(aug.price)} | faction=${aug.faction || "unknown"}`
            );
        }
    }

    if (plan.missingRecommended.length > 0) {
        ns.tprint("[installPlanner] High-priority not yet queued:");
        for (const aug of plan.missingRecommended) {
            ns.tprint(
                `[installPlanner] ${aug.name} | price=${ns.formatNumber(aug.price)} | repReq=${ns.formatNumber(aug.repReq)}`
            );
        }
    }
}

export function buildInstallPlan(ns, opts = {}) {
    const minPending = Math.max(1, Number(opts.minPending ?? 5));
    const minPendingWithRedPill = Math.max(1, Number(opts.minPendingWithRedPill ?? 1));
    const reserve = Math.max(0, Number(opts.reserve ?? 0));
    const gangKarmaTarget = Number(opts.gangKarmaTarget ?? -54000);
    const gangHoldWindow = Math.max(0, Number(opts.gangHoldWindow ?? 15000));

    const ownedNoPending = new Set(getOwnedAugsSafe(ns, false));
    const ownedWithPending = new Set(getOwnedAugsSafe(ns, true));

    const pendingNames = [...ownedWithPending].filter((aug) => !ownedNoPending.has(aug));
    const pending = pendingNames.map((name) => ({
        name,
        price: getAugPriceSafe(ns, name),
        faction: findFactionSellingAug(ns, name),
    }));

    const pendingCount = pending.length;
    const pendingCost = pending.reduce((sum, aug) => sum + aug.price, 0);
    const money = ns.getServerMoneyAvailable("home");
    const hasRedPillPending = pendingNames.includes("The Red Pill");
    const neuroFluxPending = pendingNames.filter((x) => x === "NeuroFlux Governor").length;

    const allOwnedOrPending = ownedWithPending;
    const missingRecommended = getRecommendedUnqueuedAugs(ns, allOwnedOrPending);

    const inGang = safeInGang(ns);
    const karma = safeHeartBreak(ns);
    const karmaRemaining = Math.max(0, karma - gangKarmaTarget);
    const gangHoldActive = !inGang && karma > gangKarmaTarget && karmaRemaining <= gangHoldWindow;

    let status = "WAIT";
    let reason = "Not enough queued augmentations yet.";

    if (hasRedPillPending && pendingCount >= minPendingWithRedPill) {
        status = "INSTALL NOW";
        reason = "The Red Pill is queued.";
    } else if (pendingCount >= minPending) {
        status = "READY";
        reason = "Queued augment count reached threshold.";
    }

    if (money < reserve) {
        status = "WAIT";
        reason = `Money is below reserve threshold (${ns.formatNumber(reserve)}).`;
    }

    if (pendingCount === 0) {
        status = "WAIT";
        reason = "No augmentations queued.";
    }

    if (missingRecommended.length > 0 && status !== "INSTALL NOW") {
        const affordableMissing = missingRecommended.filter((aug) => aug.price <= Math.max(0, money - reserve));
        if (affordableMissing.length > 0) {
            status = "WAIT";
            reason = "High-priority augmentations are still affordable but not yet queued.";
        }
    }

    if (gangHoldActive) {
        status = "WAIT";
        reason = `Close to gang unlock. Remaining karma to target is only ${ns.formatNumber(karmaRemaining, 6)}.`;
    }

    return {
        status,
        reason,
        ownedCount: ownedNoPending.size,
        pendingCount,
        pendingCost,
        money,
        reserve,
        hasRedPillPending,
        neuroFluxPending,
        pending,
        missingRecommended,
        inGang,
        karma,
        gangKarmaTarget,
        karmaRemaining,
        gangHoldActive,
    };
}

function hasPlannerApi(ns) {
    try {
        return !!ns.singularity &&
            typeof ns.singularity.getOwnedAugmentations === "function" &&
            typeof ns.singularity.getAugmentationsFromFaction === "function" &&
            typeof ns.singularity.getAugmentationPrice === "function" &&
            typeof ns.singularity.getAugmentationRepReq === "function";
    } catch {
        return false;
    }
}

function getOwnedAugsSafe(ns, includePending) {
    try {
        return ns.singularity.getOwnedAugmentations(includePending) || [];
    } catch {
        return [];
    }
}

function getAugPriceSafe(ns, aug) {
    try {
        return Number(ns.singularity.getAugmentationPrice(aug) ?? 0);
    } catch {
        return 0;
    }
}

function getAugRepReqSafe(ns, aug) {
    try {
        return Number(ns.singularity.getAugmentationRepReq(aug) ?? 0);
    } catch {
        return 0;
    }
}

function getAugsFromFactionSafe(ns, faction) {
    try {
        return ns.singularity.getAugmentationsFromFaction(faction) || [];
    } catch {
        return [];
    }
}

function findFactionSellingAug(ns, aug) {
    const factions = ns.getPlayer().factions || [];
    for (const faction of factions) {
        const sold = getAugsFromFactionSafe(ns, faction);
        if (sold.includes(aug)) return faction;
    }
    return "";
}

function getRecommendedUnqueuedAugs(ns, ownedOrPending) {
    const factions = ns.getPlayer().factions || [];
    const seen = new Set();
    const out = [];

    for (const faction of factions) {
        const sold = getAugsFromFactionSafe(ns, faction);
        for (const aug of sold) {
            if (seen.has(aug)) continue;
            seen.add(aug);

            if (ownedOrPending.has(aug)) continue;
            if (aug === "NeuroFlux Governor") continue;

            const score = scoreRecommendedAugName(aug);
            if (score <= 0) continue;

            out.push({
                name: aug,
                faction,
                price: getAugPriceSafe(ns, aug),
                repReq: getAugRepReqSafe(ns, aug),
                score,
            });
        }
    }

    out.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.price !== b.price) return a.price - b.price;
        return a.name.localeCompare(b.name);
    });

    return out.slice(0, 8);
}

function scoreRecommendedAugName(name) {
    const aug = String(name || "").toLowerCase();

    if (aug === "the red pill") return 1000;

    let score = 0;

    if (aug.includes("neuroreceptor")) score += 120;
    if (aug.includes("neuralstimulator")) score += 90;
    if (aug.includes("cranial")) score += 80;
    if (aug.includes("bitwire")) score += 75;
    if (aug.includes("synaptic")) score += 70;
    if (aug.includes("cordiarc")) score += 60;
    if (aug.includes("datajack")) score += 60;
    if (aug.includes("nickofolas")) score += 50;
    if (aug.includes("cashroot")) score += 50;
    if (aug.includes("qlink")) score += 200;
    if (aug.includes("sptn-97")) score += 40;
    if (aug.includes("embedded netburner")) score += 45;
    if (aug.includes("artificial bio-neural")) score += 40;
    if (aug.includes("hacknet")) score += 10;

    return score;
}

function safeInGang(ns) {
    try {
        return !!ns.gang && ns.gang.inGang();
    } catch {
        return false;
    }
}

function safeHeartBreak(ns) {
    try {
        return ns.heart.break();
    } catch {
        return 0;
    }
}