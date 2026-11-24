import { describe, expect, it } from "vitest";
import { extractKtcPlayers, extractKtcPlayersVersion } from "./ktc-page";

const PLAYER = { playerName: "Josh Allen", playerID: 1, position: "QB", superflexValues: { value: 9994 } };

describe("extractKtcPlayers", () => {
  it("reads the ktc-players element, the layout KTC has served since 2026-09-08", () => {
    const html = `<body>
    <script type="application/json" id="ktc-players">[${JSON.stringify(PLAYER)}]</script>
    <script>
        var leagueType = 1;
        var playersArray = JSON.parse(document.getElementById('ktc-players').textContent);
    </script>`;
    const out = extractKtcPlayers(html);
    expect(out?.layout).toBe("element");
    expect(out?.players).toEqual([PLAYER]);
  });

  it("still reads the old inline literal", () => {
    const html = `<script>var playersArray = [${JSON.stringify(PLAYER)}];</script>`;
    const out = extractKtcPlayers(html);
    expect(out?.layout).toBe("legacy-literal");
    expect(out?.players).toEqual([PLAYER]);
  });

  it("does not mistake the JSON.parse line for a literal", () => {
    // The exact line that made the old regex find nothing.
    const html = `<script>var playersArray = JSON.parse(document.getElementById('ktc-players').textContent);</script>`;
    expect(extractKtcPlayers(html)).toBeNull();
  });

  it("accepts single quotes and extra attributes on the element", () => {
    const html = `<script data-x="1" id='ktc-players' type='application/json'>[]</script>`;
    expect(extractKtcPlayers(html)).toEqual({ players: [], layout: "element" });
  });

  it("returns null for a page with neither layout, or a body that is not an array", () => {
    expect(extractKtcPlayers("<html><title>Just a moment</title></html>")).toBeNull();
    expect(extractKtcPlayers(`<script id="ktc-players">{"a":1}</script>`)).toBeNull();
    expect(extractKtcPlayers(`<script id="ktc-players">not json</script>`)).toBeNull();
  });

  it("reads the 2026-11-24 placeholder as an empty legacy list, which the fetcher treats as go to the pool", () => {
    const html = `<script>
    var playersVersion = '2611241820-8e1084b1baae51c9';
    var playersArray = [];
    var ktcPoolReady = ktcFetchPlayerPool('dynasty', playersVersion, null).then(function (pool) { playersArray = pool; });
    </script>`;
    expect(extractKtcPlayers(html)).toEqual({ players: [], layout: "legacy-literal" });
  });
});

describe("extractKtcPlayersVersion", () => {
  it("reads the playersVersion global in either quote style", () => {
    expect(extractKtcPlayersVersion(`var playersVersion = '2611241820-8e1084b1baae51c9';`)).toBe(
      "2611241820-8e1084b1baae51c9",
    );
    expect(extractKtcPlayersVersion(`var playersVersion="abc-1";`)).toBe("abc-1");
  });

  it("does not confuse the histories version for it, and returns null when absent", () => {
    expect(extractKtcPlayersVersion(`var historiesVersion = '261124-95eefa093e1e86b4';`)).toBeNull();
    expect(extractKtcPlayersVersion("<html></html>")).toBeNull();
    expect(extractKtcPlayersVersion(`var playersVersion = 'a b<script>';`)).toBeNull();
  });
});
