import { describe, expect, it, vi } from "vitest";
import { fetchKtcPlayers, ktcPlayerPoolUrl, ktcRankingsPageUrl } from "./ktc-fetch";

const PLAYER = { playerName: "Josh Allen", playerID: 1, position: "QB", superflexValues: { value: 9994 } };

/** The page KTC has served since 2026-11-24: an empty placeholder plus the pool version. */
const POOL_PAGE = `<script>
    var playersVersion = '2611241820-8e1084b1baae51c9';
    var playersArray = [];
    var ktcPoolReady = ktcFetchPlayerPool('dynasty', playersVersion, null).then(function (pool) { playersArray = pool; });
</script>`;

function htmlResponse(body: string, setCookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "text/html" });
  for (const c of setCookies) headers.append("set-cookie", c);
  return new Response(body, { status: 200, headers });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("fetchKtcPlayers", () => {
  it("uses a non-empty list embedded in the page without calling the pool", async () => {
    const fetchImpl = vi.fn(async () =>
      htmlResponse(`<script type="application/json" id="ktc-players">[${JSON.stringify(PLAYER)}]</script>`),
    );
    const out = await fetchKtcPlayers("dynasty", fetchImpl);
    expect(out).toEqual({ players: [PLAYER], source: "element" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks the pool with the page's version, cookies and the page as Referer when the page list is empty", async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(htmlResponse(POOL_PAGE, ["ARRAffinity=abc;Path=/;HttpOnly;Secure", "Other=1; Path=/"]))
      .mockResolvedValueOnce(jsonResponse([PLAYER]));
    const out = await fetchKtcPlayers("fantasy", fetchImpl);
    expect(out).toEqual({ players: [PLAYER], source: "player-pool" });

    expect(fetchImpl.mock.calls[0][0]).toBe(ktcRankingsPageUrl("fantasy"));
    const [poolUrl, poolInit] = fetchImpl.mock.calls[1];
    expect(poolUrl).toBe("https://keeptradecut.com/fantasy-rankings/player-pool?v=2611241820-8e1084b1baae51c9");
    const headers = poolInit?.headers as Record<string, string>;
    expect(headers.referer).toBe(ktcRankingsPageUrl("fantasy"));
    expect(headers.cookie).toBe("ARRAffinity=abc; Other=1");
  });

  it("still asks the pool, without a version, when the page names none", async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(htmlResponse("<script>var playersArray = [];</script>"))
      .mockResolvedValueOnce(jsonResponse([PLAYER]));
    await fetchKtcPlayers("dynasty", fetchImpl);
    expect(fetchImpl.mock.calls[1][0]).toBe(ktcPlayerPoolUrl("dynasty", null));
    expect(ktcPlayerPoolUrl("dynasty", null)).toBe("https://keeptradecut.com/dynasty-rankings/player-pool");
  });

  it("throws naming the step when the page fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("blocked", { status: 503 }));
    await expect(fetchKtcPlayers("dynasty", fetchImpl)).rejects.toThrow(/rankings page answered HTTP 503/);
  });

  it("throws naming the status when the pool refuses", async () => {
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(htmlResponse(POOL_PAGE))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
    await expect(fetchKtcPlayers("dynasty", fetchImpl)).rejects.toThrow(/player pool answered HTTP 403/);
  });

  it("refuses a pool response that a redirect delivered from another host", async () => {
    const moved = jsonResponse([PLAYER]);
    Object.defineProperty(moved, "url", { value: "https://example.com/pool" });
    const fetchImpl = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(htmlResponse(POOL_PAGE))
      .mockResolvedValueOnce(moved);
    await expect(fetchKtcPlayers("dynasty", fetchImpl)).rejects.toThrow(/redirected to example.com/);
  });

  it("throws when the pool returns something other than a non-empty array", async () => {
    for (const body of [[], { players: [] }]) {
      const fetchImpl = vi
        .fn<(input: string, init?: RequestInit) => Promise<Response>>()
        .mockResolvedValueOnce(htmlResponse(POOL_PAGE))
        .mockResolvedValueOnce(jsonResponse(body));
      await expect(fetchKtcPlayers("dynasty", fetchImpl)).rejects.toThrow(/player pool returned/);
    }
    const notJson = vi
      .fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(htmlResponse(POOL_PAGE))
      .mockResolvedValueOnce(new Response("<html>", { status: 200 }));
    await expect(fetchKtcPlayers("dynasty", notJson)).rejects.toThrow(/did not return JSON/);
  });
});
