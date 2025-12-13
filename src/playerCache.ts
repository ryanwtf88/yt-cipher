import { crypto } from "std/crypto/mod.ts";
import { ensureDir } from "std/fs/ensure_dir.ts";
import { join } from "std/path/mod.ts";
import { cacheSize, playerScriptFetches } from "./metrics.ts";

export const CACHE_DIR = join(Deno.cwd(), 'player_cache');

export async function getPlayerFilePath(playerUrl: string): Promise<string> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(playerUrl));
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
    const filePath = join(CACHE_DIR, `${hash}.js`);

    try {
        const stat = await Deno.stat(filePath);
        await Deno.utime(filePath, new Date(), stat.mtime ?? new Date());
        return filePath;
    } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
            console.log(`Cache miss for player: ${playerUrl}. Fetching...`);
            const response = await fetch(playerUrl);
            playerScriptFetches.labels({ player_url: playerUrl, status: String(response.status) }).inc();

            if (!response.ok) {
                throw new Error(`Failed to fetch player from ${playerUrl}: ${response.status}`);
            }

            const playerContent = await response.text();
            await Deno.writeTextFile(filePath, playerContent);

            let fileCount = 0;
            for await (const _ of Deno.readDir(CACHE_DIR)) {
                fileCount++;
            }
            cacheSize.labels({ cache_name: 'player' }).set(fileCount);

            console.log(`Saved player to cache: ${filePath}`);
            return filePath;
        }
        throw error;
    }
}

export async function initializeCache(): Promise<void> {
    await ensureDir(CACHE_DIR);

    let fileCount = 0;
    const fourteenDays = 14 * 24 * 60 * 60 * 1000;

    console.log(`Cleaning up player cache directory: ${CACHE_DIR}`);

    for await (const dirEntry of Deno.readDir(CACHE_DIR)) {
        if (dirEntry.isFile) {
            const filePath = join(CACHE_DIR, dirEntry.name);
            const stat = await Deno.stat(filePath);
            const lastAccessed = stat.atime?.getTime() ?? stat.mtime?.getTime() ?? stat.birthtime?.getTime();

            if (lastAccessed && (Date.now() - lastAccessed > fourteenDays)) {
                console.log(`Deleting stale player cache file: ${filePath}`);
                await Deno.remove(filePath);
            } else {
                fileCount++;
            }
        }
    }

    cacheSize.labels({ cache_name: 'player' }).set(fileCount);
    console.log(`Player cache directory ensured at: ${CACHE_DIR}`);
}
