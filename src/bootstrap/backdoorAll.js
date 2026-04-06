/** @param {NS} ns **/
export async function main(ns) {
    const mode = String(ns.args[0] ?? "important").toLowerCase();

    if (!hasBackdoorApi(ns)) {
        ns.tprint("[backdoorAll] Singularity backdoor API unavailable.");
        return;
    }

    const all = getAllServers(ns);
    const important = [
        "CSEC",
        "avmnite-02h",
        "I.I.I.I",
        "run4theh111z",
        "The-Cave",
    ];

    const targets = mode === "all"
        ? all.filter((s) => s !== "home")
        : important.filter((s) => ns.serverExists(s));

    let done = 0;
    let skipped = 0;
    let failed = 0;

    for (const host of targets) {
        if (!ns.serverExists(host)) {
            skipped++;
            continue;
        }

        const server = ns.getServer(host);
        if (server.backdoorInstalled) {
            ns.tprint(`[backdoorAll] Already backdoored: ${host}`);
            skipped++;
            continue;
        }

        if (!ensureRoot(ns, host)) {
            ns.tprint(`[backdoorAll] Cannot root yet: ${host}`);
            failed++;
            continue;
        }

        const path = findPath(ns, "home", host);
        if (!path) {
            ns.tprint(`[backdoorAll] No path found: ${host}`);
            failed++;
            continue;
        }

        const ok = await connectPath(ns, path);
        if (!ok) {
            ns.tprint(`[backdoorAll] Failed to connect path: ${host}`);
            failed++;
            await safeConnectHome(ns);
            continue;
        }

        try {
            ns.tprint(`[backdoorAll] Installing backdoor on ${host}...`);
            await ns.singularity.installBackdoor();

            const updated = ns.getServer(host);
            if (updated.backdoorInstalled) {
                done++;
                ns.tprint(`[backdoorAll] Backdoored ${host}`);
            } else {
                failed++;
                ns.tprint(`[backdoorAll] Backdoor did not register on ${host}`);
            }
        } catch (err) {
            failed++;
            ns.tprint(`[backdoorAll] Failed on ${host}: ${String(err)}`);
        }

        await safeConnectHome(ns);
        await ns.sleep(100);
    }

    ns.tprint(`[backdoorAll] done | installed=${done} skipped=${skipped} failed=${failed}`);
}

function hasBackdoorApi(ns) {
    try {
        return !!ns.singularity &&
            typeof ns.singularity.connect === "function" &&
            typeof ns.singularity.installBackdoor === "function";
    } catch {
        return false;
    }
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

function findPath(ns, start, target) {
    const queue = [[start]];
    const seen = new Set([start]);

    while (queue.length > 0) {
        const path = queue.shift();
        const host = path[path.length - 1];

        if (host === target) return path;

        for (const next of ns.scan(host)) {
            if (!seen.has(next)) {
                seen.add(next);
                queue.push([...path, next]);
            }
        }
    }

    return null;
}

async function connectPath(ns, path) {
    await safeConnectHome(ns);

    for (let i = 1; i < path.length; i++) {
        const ok = ns.singularity.connect(path[i]);
        if (!ok) return false;
        await ns.sleep(10);
    }

    return true;
}

async function safeConnectHome(ns) {
    try {
        ns.singularity.connect("home");
    } catch {}
    await ns.sleep(10);
}

function ensureRoot(ns, host) {
    if (ns.hasRootAccess(host)) return true;

    openPorts(ns, host);

    try {
        ns.nuke(host);
    } catch {}

    return ns.hasRootAccess(host);
}

function openPorts(ns, host) {
    if (ns.fileExists("BruteSSH.exe", "home")) {
        try { ns.brutessh(host); } catch {}
    }
    if (ns.fileExists("FTPCrack.exe", "home")) {
        try { ns.ftpcrack(host); } catch {}
    }
    if (ns.fileExists("relaySMTP.exe", "home")) {
        try { ns.relaysmtp(host); } catch {}
    }
    if (ns.fileExists("HTTPWorm.exe", "home")) {
        try { ns.httpworm(host); } catch {}
    }
    if (ns.fileExists("SQLInject.exe", "home")) {
        try { ns.sqlinject(host); } catch {}
    }
}