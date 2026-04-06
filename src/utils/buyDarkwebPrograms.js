/** @param {NS} ns **/
export async function main(ns) {
    const programs = [
        "BruteSSH.exe",
        "FTPCrack.exe",
        "relaySMTP.exe",
        "HTTPWorm.exe",
        "SQLInject.exe",
    ];

    const result = buyDarkwebPrograms(ns, programs);

    ns.tprint(`Singularity available: ${result.hasSingularity}`);
    ns.tprint(`TOR owned: ${result.hasTor}`);
    ns.tprint(`TOR purchased now: ${result.boughtTor}`);
    ns.tprint(`Bought programs: ${result.bought.join(", ") || "none"}`);
    ns.tprint(`Missing after run: ${result.missing.join(", ") || "none"}`);
}

export function buyDarkwebPrograms(ns, programs = []) {
    const result = {
        hasSingularity: false,
        hasTor: false,
        boughtTor: false,
        bought: [],
        missing: [],
    };

    try {
        result.hasSingularity =
            !!ns.singularity &&
            typeof ns.singularity.purchaseTor === "function" &&
            typeof ns.singularity.purchaseProgram === "function";
    } catch {
        result.hasSingularity = false;
    }

    if (!result.hasSingularity) {
        result.missing = programs.filter((p) => !ns.fileExists(p, "home"));
        return result;
    }

    try {
        const player = ns.getPlayer();
        result.hasTor = !!player.tor;

        if (!result.hasTor) {
            result.boughtTor = !!ns.singularity.purchaseTor();
            result.hasTor = !!ns.getPlayer().tor;
        }
    } catch {}

    if (!result.hasTor) {
        result.missing = programs.filter((p) => !ns.fileExists(p, "home"));
        return result;
    }

    for (const program of programs) {
        try {
            if (ns.fileExists(program, "home")) {
                continue;
            }

            const ok = ns.singularity.purchaseProgram(program);
            if (ok || ns.fileExists(program, "home")) {
                result.bought.push(program);
            }
        } catch {}
    }

    result.missing = programs.filter((p) => !ns.fileExists(p, "home"));
    return result;
}