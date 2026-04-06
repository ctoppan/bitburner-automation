/** @param {NS} ns **/
export async function main(ns) {
    const servers = getAllServers(ns).filter((s) => s !== "home");
    let rooted = 0;
    let alreadyRooted = 0;
    let skipped = 0;

    for (const host of servers) {
        if (!ns.serverExists(host)) continue;

        if (ns.hasRootAccess(host)) {
            alreadyRooted++;
            continue;
        }

        const opened = openPorts(ns, host);
        const needed = ns.getServerNumPortsRequired(host);
        const hackReq = ns.getServerRequiredHackingLevel(host);
        const hackLvl = ns.getHackingLevel();

        if (opened >= needed && hackLvl >= hackReq) {
            try {
                ns.nuke(host);
            } catch {}

            if (ns.hasRootAccess(host)) {
                rooted++;
                ns.tprint(`[rootAll] Rooted ${host}`);
            } else {
                skipped++;
            }
        } else {
            skipped++;
        }
    }

    ns.tprint(
        `[rootAll] done | rooted=${rooted} alreadyRooted=${alreadyRooted} skipped=${skipped}`
    );
}

function getAllServers(ns) {
    const seen = new Set(["home"]);
    const queue = ["home"];
    const out = ["home"];

    while (queue.length > 0) {
        const host = queue.shift();
        for (const next of ns.scan(host)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push(next);
                out.push(next);
            }
        }
    }

    return out.sort();
}

function openPorts(ns, host) {
    let opened = 0;

    if (ns.fileExists("BruteSSH.exe", "home")) {
        try { ns.brutessh(host); opened++; } catch {}
    }
    if (ns.fileExists("FTPCrack.exe", "home")) {
        try { ns.ftpcrack(host); opened++; } catch {}
    }
    if (ns.fileExists("relaySMTP.exe", "home")) {
        try { ns.relaysmtp(host); opened++; } catch {}
    }
    if (ns.fileExists("HTTPWorm.exe", "home")) {
        try { ns.httpworm(host); opened++; } catch {}
    }
    if (ns.fileExists("SQLInject.exe", "home")) {
        try { ns.sqlinject(host); opened++; } catch {}
    }

    return opened;
}