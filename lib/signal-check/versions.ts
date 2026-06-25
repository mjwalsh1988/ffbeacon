/**
 * Signal Check engine version pins.
 *
 * These strings are frozen into every saved analysis (signal_check_analyses)
 * so a permalink can advertise exactly which engine and interpreter produced
 * its verdict. Bump VALUE_ENGINE_VERSION when the value-engine math changes
 * (how raw FF Beacon values or pick values are resolved/derived). Bump
 * RULE_INTERPRETER_VERSION when the calibration/trade-shape interpreter
 * semantics change (condition matching, action application, compounding,
 * pile-on, stackability). Settings and ruleset content changes do NOT require
 * a bump; those are captured by the ruleset version pin instead.
 *
 * Use plain semver-ish strings. Never reformat history; only move forward.
 */

export const VALUE_ENGINE_VERSION = "1.0.0";
export const RULE_INTERPRETER_VERSION = "1.0.0";
