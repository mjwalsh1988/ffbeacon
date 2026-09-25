import { describe, expect, it } from "vitest";
import { extractKtcPlayers } from "./ktc-page";

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
});
