import { describe, expect, it } from "vitest";
import { idpColumnPatch, idpColumnsFromMetadata, parseSeasons } from "./backfill-idp-stat-columns";

const METADATA = {
  opponent: "PHI",
  stats: { def_snp: 60, tm_def_snp: 64, idp_tkl: 15, idp_tkl_solo: 11, idp_tkl_ast: 4, idp_sack: 1 },
};

describe("backfill-idp-stat-columns (IDP-110)", () => {
  it("maps stored metadata through the sync's own mapper", () => {
    const cols = idpColumnsFromMetadata(METADATA);
    expect(cols.idp_tkl).toBe(15);
    expect(cols.idp_sack).toBe(1);
    expect(cols.idp_int).toBeNull();
    expect(cols.def_snap_pct).toBeCloseTo(60 / 64, 10);
  });

  it("maps nothing for a row with no metadata", () => {
    const cols = idpColumnsFromMetadata(null);
    expect(Object.values(cols).every((v) => v === null)).toBe(true);
  });

  it("writes only when a value differs, comparing stored strings as numbers", () => {
    const mapped = idpColumnsFromMetadata(METADATA);
    const stored = Object.fromEntries(
      Object.entries(mapped).map(([k, v]) => [k, v === null ? null : String(v)]),
    );
    expect(idpColumnPatch(stored, mapped)).toBeNull();
    expect(idpColumnPatch({}, mapped)).toMatchObject({ idp_tkl: 15, idp_sack: 1 });
    expect(idpColumnPatch({ ...stored, idp_tkl: "14" }, mapped)).toEqual({ idp_tkl: 15 });
  });

  it("reads one season or defaults to all", () => {
    expect(parseSeasons(["--season", "2025"])).toEqual([2025]);
    expect(parseSeasons([]).length).toBeGreaterThan(5);
    expect(() => parseSeasons(["--season", "abc"])).toThrow();
  });
});
