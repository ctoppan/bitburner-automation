/** @param {NS} ns **/
export async function main(ns) {
    if (!hasHomeApi(ns)) {
        ns.tprint("[upgradeHomeRam] Singularity home-upgrade API unavailable.");
        return;
    }

    const reserve = Math.max(0, Number(ns.args[0] ?? 0));
    const once = String(ns.args[1] ?? "true").toLowerCase() !== "false";

    do {
        const money = ns.getServerMoneyAvailable("home");
        const cost = getRamCost(ns);

        if (!Number.isFinite(cost) || cost <= 0) {
            ns.tprint("[upgradeHomeRam] Could not read RAM upgrade cost.");
            return;
        }

        if (money - reserve < cost) {
            ns.tprint(
                `[upgradeHomeRam] Not enough money. cost=${ns.formatNumber(cost)} money=${ns.formatNumber(money)} reserve=${ns.formatNumber(reserve)}`
            );
            return;
        }

        const before = ns.getServerMaxRam("home");
        const ok = tryUpgradeRam(ns);
        const after = ns.getServerMaxRam("home");

        if (ok || after > before) {
            ns.tprint(
                `[upgradeHomeRam] Upgraded home RAM: ${ns.formatRam(before)} -> ${ns.formatRam(after)}`
            );
        } else {
            ns.tprint("[upgradeHomeRam] Upgrade attempt failed.");
            return;
        }

        if (once) return;
        await ns.sleep(250);
    } while (true);
}

function hasHomeApi(ns) {
    try {
        return !!ns.singularity &&
            typeof ns.singularity.upgradeHomeRam === "function" &&
            typeof ns.singularity.getUpgradeHomeRamCost === "function";
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

function tryUpgradeRam(ns) {
    try {
        return !!ns.singularity.upgradeHomeRam();
    } catch {
        return false;
    }
}