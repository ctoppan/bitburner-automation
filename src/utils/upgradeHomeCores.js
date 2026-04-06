/** @param {NS} ns **/
export async function main(ns) {
    if (!hasHomeApi(ns)) {
        ns.tprint("[upgradeHomeCores] Singularity home-upgrade API unavailable.");
        return;
    }

    const reserve = Math.max(0, Number(ns.args[0] ?? 0));
    const once = String(ns.args[1] ?? "true").toLowerCase() !== "false";

    do {
        const money = ns.getServerMoneyAvailable("home");
        const cost = getCoreCost(ns);

        if (!Number.isFinite(cost) || cost <= 0) {
            ns.tprint("[upgradeHomeCores] Could not read core upgrade cost.");
            return;
        }

        if (money - reserve < cost) {
            ns.tprint(
                `[upgradeHomeCores] Not enough money. cost=${ns.formatNumber(cost)} money=${ns.formatNumber(money)} reserve=${ns.formatNumber(reserve)}`
            );
            return;
        }

        const before = ns.getServer("home").cpuCores;
        const ok = tryUpgradeCores(ns);
        const after = ns.getServer("home").cpuCores;

        if (ok || after > before) {
            ns.tprint(
                `[upgradeHomeCores] Upgraded home cores: ${before} -> ${after}`
            );
        } else {
            ns.tprint("[upgradeHomeCores] Upgrade attempt failed.");
            return;
        }

        if (once) return;
        await ns.sleep(250);
    } while (true);
}

function hasHomeApi(ns) {
    try {
        return !!ns.singularity &&
            typeof ns.singularity.upgradeHomeCores === "function" &&
            typeof ns.singularity.getUpgradeHomeCoresCost === "function";
    } catch {
        return false;
    }
}

function getCoreCost(ns) {
    try {
        return Number(ns.singularity.getUpgradeHomeCoresCost());
    } catch {
        return NaN;
    }
}

function tryUpgradeCores(ns) {
    try {
        return !!ns.singularity.upgradeHomeCores();
    } catch {
        return false;
    }
}