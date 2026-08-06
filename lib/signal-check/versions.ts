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

/**
 * 1.1.0 (both pins): the consolidation pass. Side totals gained an effective
 * value carrying the quality credit, the verdict now compares those rather than
 * the plain sums, and the built-in pile-on was superseded by it (still present,
 * off by default). Both the value math and the interpreter semantics moved, so
 * both pins move.
 */
export const VALUE_ENGINE_VERSION = "1.1.0";
export const RULE_INTERPRETER_VERSION = "1.1.0";
