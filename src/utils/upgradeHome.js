/** @param {NS} ns **/
export async function main(ns) {
    if (!hasHomeApi(ns)) {
        ns.tprint("[upgradeHome] Singularity home-upgrade API unavailable.");
        return;
    }

    const reserve = Math.max(0, Number(ns.args[0] ?? 0));
    const loop = String(ns.args[1] ?? "false").toLowerCase() === "true";

    do {
        const money = ns.getServerMoneyAvailable("home");
        const ramCost = getRamCost(ns);
        const coreCost = getCoreCost(ns);

        const choices = [
            { type: "ram", cost: ramCost },
            { type: "cores", cost: coreCost },
        ].filter((x) => Number.isFinite(x.cost) && x.cost > 0);

        if (choices.length === 0) {
            ns.tprint("[upgradeHome] No valid upgrade costs available.");
            return;
        }

        choices.sort((a, b) => a.cost - b.cost);
        const pick = choices[0];

        if (money - reserve < pick.cost) {
            ns.tprint(
                `[upgradeHome] Not enough money. next=${pick.type} cost=${ns.formatNumber(pick.cost)} money=${ns.formatNumber(money)} reserve=${ns.formatNumber(reserve)}`
            );
            return;
        }

        if (pick.type === "ram") {
            const before = ns.getServerMaxRam("home");
            const ok = tryUpgradeRam(ns);
            const after = ns.getServerMaxRam("home");

            if (!ok && after <= before) {
                ns.tprint("[upgradeHome] RAM upgrade failed.");
                return;
            }

            ns.tprint(`[upgradeHome] RAM: ${ns.formatRam(before)} -> ${ns.formatRam(after)}`);
        } else {
            const before = ns.getServer("home").cpuCores;
            const ok = tryUpgradeCores(ns);
            const after = ns.getServer("home").cpuCores;

            if (!ok && after <= before) {
                ns.tprint("[upgradeHome] Core upgrade failed.");
                return;
            }

            ns.tprint(`[upgradeHome] Cores: ${before} -> ${after}`);
        }

        if (!loop) return;
        await ns.sleep(500);
    } while (true);
}

function hasHomeApi(ns) {
    try {
        return !!ns.singularity &&
            typeof ns.singularity.upgradeHomeRam === "function" &&
            typeof ns.singularity.getUpgradeHomeRamCost === "function" &&
            typeof ns.singularity.upgradeHomeCores === "function" &&
            typeof ns.singularity.getUpgradeHomeCoresCost === "function";
    } catch {
        return false;
    }
}

function getRamCost(ns) {
    try {
        return Number(ns.singularity.getUpgradeHomeRamCost());
    } catch {
        return NaN;
    }
}

function getCoreCost(ns) {
    try {
        return Number(ns.singularity.getUpgradeHomeCoresCost());
    } catch {
        return NaN;
    }
}

function tryUpgradeRam(ns) {
    try {
        return !!ns.singularity.upgradeHomeRam();
    } catch {
        return false;
    }
}

function tryUpgradeCores(ns) {
    try {
        return !!ns.singularity.upgradeHomeCores();
    } catch {
        return false;
    }
}