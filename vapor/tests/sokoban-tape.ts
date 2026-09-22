// SOKOBAN interaction tape — one deterministic press sequence shared by
// oracle tests and three-console parity (gba/gb/nes).
//
// SHIP LOCATION: the Builder copies this file verbatim to
// vapor/tests/sokoban-tape.ts (the "../host/input.ts" import is written for
// that location). While it lives in repro/ it is data + documentation; the
// self-check parses it as text (repro/verify-tape.ts) rather than importing.
//
// Three input modes: MOVE (play), SELECT (level chooser), SOLVED.
// Every press is checked against an independent model (repro/verify-tape.ts).
// Slot order: 1=#1, 2=#44, 3=#2, 4=#21, 5=#31, 6=#40, 7=#30, 8=#4, 9=#56,
// 10=#5, 11=#17, 12=#52, 13=#25, 14=#9, 15=#34, 16=#28, 17=#51, 18=#24,
// 19=#32, 20=#103, 21=#15, 22=#38, 23=#53, 24=#67 (Microban numbers).
// Microban #1 BFS-optimal solve: 33 moves / 8 pushes
//   DLURRRDLULLDDRULURUULDRDDRRULDLUU

import { Button } from "../host/input.ts";

export const SOKOBAN_TAPE: readonly number[] = [
  Button.Left  , // 01: attempt push box-on-goal into wall [L] -> no-op: push blocked by wall at 0,3; moves=0
  Button.Up    , // 02: walk up corridor [U] -> walk to 2,2; moves=1
  Button.Up    , // 03: walk up corridor [U] -> walk to 2,1; moves=2
  Button.Up    , // 04: bump top wall [U] -> no-op: wall at 2,0; moves=2
  Button.Down  , // 05: walk back to start cell [D] -> walk to 2,2; moves=3
  Button.Down  , // 06: walk back to start cell [D] -> walk to 2,3; moves=4
  Button.Right , // 07: set up box-behind-box [R] -> walk to 3,3; moves=5
  Button.Right , // 08: set up box-behind-box [R] -> walk to 4,3; moves=6
  Button.Down  , // 09: set up box-behind-box [D] -> walk to 4,4; moves=7
  Button.Left  , // 10: set up box-behind-box [L] -> push to 3,4; moves=8
  Button.Left  , // 11: set up box-behind-box [L] -> push to 2,4; moves=9
  Button.Down  , // 12: set up box-behind-box [D] -> walk to 2,5; moves=10
  Button.Left  , // 13: set up box-behind-box [L] -> walk to 1,5; moves=11
  Button.Up    , // 14: attempt push box into another box [U] -> no-op: push blocked by box at 1,3; moves=11
  Button.Start , // 15: Start: restart level #1 -> restart slot 1 (#1); moves=0
  Button.Down  , // 16: three moves (walk, walk, push) [D] -> walk to 2,4; moves=1
  Button.Left  , // 17: three moves (walk, walk, push) [L] -> walk to 1,4; moves=2
  Button.Up    , // 18: three moves (walk, walk, push) [U] -> push to 1,3; moves=3
  Button.B     , // 19: B: undo one move -> undo to 1,4; moves=2; stack=2
  Button.Right , // 20: walk, push, blocked (deepen stack) [R] -> walk to 2,4; moves=3
  Button.Right , // 21: walk, push, blocked (deepen stack) [R] -> push to 3,4; moves=4
  Button.Right , // 22: walk, push, blocked (deepen stack) [R] -> no-op: push blocked by wall at 5,4; moves=4
  Button.B     , // 23: B: undo toward bottom (1/5) -> undo to 2,4; moves=3; stack=3
  Button.B     , // 24: B: undo toward bottom (2/5) -> undo to 1,4; moves=2; stack=2
  Button.B     , // 25: B: undo toward bottom (3/5) -> undo to 2,4; moves=1; stack=1
  Button.B     , // 26: B: undo toward bottom (4/5) -> undo to 2,3; moves=0; stack=0
  Button.B     , // 27: B: undo toward bottom (5/5) -> no-op: undo stack empty; moves=0
  Button.B     , // 28: B: undo past bottom = no-op -> no-op: undo stack empty; moves=0
  Button.Select, // 29: Select: open level chooser -> open chooser at slot 1
  Button.Left  , // 30: chooser Left: wrap slot 1 -> 24 -> chooser cursor -> slot 24 (#67)
  Button.Right , // 31: chooser Right: slot 24 -> 1 -> chooser cursor -> slot 1 (#1)
  Button.Right , // 32: chooser Right: slot 1 -> 2 (#44) -> chooser cursor -> slot 2 (#44)
  Button.A     , // 33: A: confirm slot 2 -> load #44 -> confirm chooser: load slot 2 (#44)
  Button.Select, // 34: Select: open chooser on slot 2 -> open chooser at slot 2
  Button.Left  , // 35: chooser L-equivalent: slot 2 -> 1 -> cursor -> slot 1 (#1). Left (not the L shoulder): GB/NES hardware has no L/R buttons (8-bit key register, runtime loops b<8), so the cross-console tape drives the -1 chooser action with the d-pad instead; L/R stay bound for GBA/Playdate.
  Button.Start , // 36: Start: confirm slot 1 -> load #1 -> confirm chooser: load slot 1 (#1)
  Button.Select, // 37: Select: open chooser at slot 1 -> open chooser at slot 1
  Button.Right , // 38: chooser Right: cursor to slot 2 -> chooser cursor -> slot 2 (#44)
  Button.B     , // 39: B: cancel chooser, remain on slot 1 -> cancel chooser; remain slot 1 (#1)
  Button.Start , // 40: Start: restart before clean solve -> restart slot 1 (#1); moves=0
  Button.Down  , // 41: solve Microban #1 (optimal 33m/8p) [D] -> walk to 2,4; moves=1
  Button.Left  , // 42: solve Microban #1 (optimal 33m/8p) [L] -> walk to 1,4; moves=2
  Button.Up    , // 43: solve Microban #1 (optimal 33m/8p) [U] -> push to 1,3; moves=3
  Button.Right , // 44: solve Microban #1 (optimal 33m/8p) [R] -> walk to 2,3; moves=4
  Button.Right , // 45: solve Microban #1 (optimal 33m/8p) [R] -> walk to 3,3; moves=5
  Button.Right , // 46: solve Microban #1 (optimal 33m/8p) [R] -> walk to 4,3; moves=6
  Button.Down  , // 47: solve Microban #1 (optimal 33m/8p) [D] -> walk to 4,4; moves=7
  Button.Left  , // 48: solve Microban #1 (optimal 33m/8p) [L] -> push to 3,4; moves=8
  Button.Up    , // 49: solve Microban #1 (optimal 33m/8p) [U] -> walk to 3,3; moves=9
  Button.Left  , // 50: solve Microban #1 (optimal 33m/8p) [L] -> walk to 2,3; moves=10
  Button.Left  , // 51: solve Microban #1 (optimal 33m/8p) [L] -> walk to 1,3; moves=11
  Button.Down  , // 52: solve Microban #1 (optimal 33m/8p) [D] -> walk to 1,4; moves=12
  Button.Down  , // 53: solve Microban #1 (optimal 33m/8p) [D] -> walk to 1,5; moves=13
  Button.Right , // 54: solve Microban #1 (optimal 33m/8p) [R] -> walk to 2,5; moves=14
  Button.Up    , // 55: solve Microban #1 (optimal 33m/8p) [U] -> push to 2,4; moves=15
  Button.Left  , // 56: solve Microban #1 (optimal 33m/8p) [L] -> walk to 1,4; moves=16
  Button.Up    , // 57: solve Microban #1 (optimal 33m/8p) [U] -> walk to 1,3; moves=17
  Button.Right , // 58: solve Microban #1 (optimal 33m/8p) [R] -> push to 2,3; moves=18
  Button.Up    , // 59: solve Microban #1 (optimal 33m/8p) [U] -> walk to 2,2; moves=19
  Button.Up    , // 60: solve Microban #1 (optimal 33m/8p) [U] -> walk to 2,1; moves=20
  Button.Left  , // 61: solve Microban #1 (optimal 33m/8p) [L] -> walk to 1,1; moves=21
  Button.Down  , // 62: solve Microban #1 (optimal 33m/8p) [D] -> push to 1,2; moves=22
  Button.Right , // 63: solve Microban #1 (optimal 33m/8p) [R] -> walk to 2,2; moves=23
  Button.Down  , // 64: solve Microban #1 (optimal 33m/8p) [D] -> walk to 2,3; moves=24
  Button.Down  , // 65: solve Microban #1 (optimal 33m/8p) [D] -> walk to 2,4; moves=25
  Button.Right , // 66: solve Microban #1 (optimal 33m/8p) [R] -> walk to 3,4; moves=26
  Button.Right , // 67: solve Microban #1 (optimal 33m/8p) [R] -> walk to 4,4; moves=27
  Button.Up    , // 68: solve Microban #1 (optimal 33m/8p) [U] -> walk to 4,3; moves=28
  Button.Left  , // 69: solve Microban #1 (optimal 33m/8p) [L] -> push to 3,3; moves=29
  Button.Down  , // 70: solve Microban #1 (optimal 33m/8p) [D] -> walk to 3,4; moves=30
  Button.Left  , // 71: solve Microban #1 (optimal 33m/8p) [L] -> walk to 2,4; moves=31
  Button.Up    , // 72: solve Microban #1 (optimal 33m/8p) [U] -> push to 2,3; moves=32
  Button.Up    , // 73: solve Microban #1 (optimal 33m/8p) [U] -> push to 2,2; moves=33 *** SOLVED ***
  Button.Up    , // 74: direction while SOLVED = frozen [U] -> no-op: frozen (SOLVED)
  Button.B     , // 75: B while SOLVED = frozen -> no-op: frozen (SOLVED)
  Button.Start , // 76: Start while SOLVED = frozen -> no-op: frozen (SOLVED)
  Button.Select, // 77: Select while SOLVED = frozen -> no-op: frozen (SOLVED)
  Button.Left  , // 78: frozen while SOLVED (d-pad unbound, like L). L itself is verified frozen in the oracle suite — it never reaches GB/NES.
  Button.A     , // 79: A: advance to slot 2 (#44) -> A: next -> slot 2 (#44); moves=0
  Button.Right , // 80: solve #44 tutorial (1 push) [R] -> push to 2,1; moves=1 *** SOLVED ***
  Button.A     , // 81: A: advance to slot 3 (#2) -> A: next -> slot 3 (#2); moves=0
  Button.Up    , // 82: start #2: walk up [U] -> walk to 3,1; moves=1
  Button.B     , // 83: B: undo that walk on #2 -> undo to 3,2; moves=0; stack=0
];

// Expected state after each press, generated by an independent three-mode
// sokoban model replayed over the shipped LEVEL_ROM flat table (the model
// is block-coordinate, not screen-coordinate, so it never imports the app):
//   SOKOBAN_MOVES_AFTER  move count on the title/SOLVED line
//   SOKOBAN_MODE_AFTER   0 MOVE, 1 SELECT (chooser visible), 2 SOLVED
//   SOKOBAN_SLOT_AFTER   0-based loaded play slot
// Presses 35/78 use the d-pad rather than the L shoulder (GB/NES have no
// shoulder buttons); the model gives them the same mode/slot outcome, and
// L/R themselves are pinned in the oracle suite.
export const SOKOBAN_MOVES_AFTER: readonly number[] = [
  0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 0, 1, 2, 3, 2, 3, 4, 4, 3, 2, 1, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
  25, 26, 27, 28, 29, 30, 31, 32, 33, 33, 33, 33, 33, 33, 0, 1, 0, 1, 0,
];

export const SOKOBAN_MODE_AFTER: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 2, 0, 0, 0,
];

export const SOKOBAN_SLOT_AFTER: readonly number[] = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 2,
];
export const SOKOBAN_HIST_BOUNDARY_TAPE: readonly number[] = [
  Button.Up    , // h 1
  Button.Up    , // h 2
  Button.Left  , // h 3
  Button.Down  , // h 4
  Button.Up    , // h 5
  Button.Down  , // h 6
  Button.Up    , // h 7
  Button.Down  , // h 8
  Button.Up    , // h 9
  Button.Down  , // h10
  Button.Up    , // h11
  Button.Down  , // h12
  Button.Up    , // h13
  Button.Down  , // h14
  Button.Up    , // h15
  Button.Down  , // h16
  Button.Up    , // h17
  Button.Down  , // h18
  Button.Up    , // h19
  Button.Down  , // h20
  Button.Up    , // h21
  Button.Down  , // h22
  Button.Up    , // h23
  Button.Down  , // h24
  Button.Up    , // h25
  Button.Down  , // h26
  Button.Up    , // h27
  Button.Down  , // h28
  Button.Up    , // h29
  Button.Down  , // h30
  Button.Up    , // h31
  Button.Down  , // h32
  Button.Up    , // h33
  Button.Down  , // h34
  Button.Up    , // h35
  Button.Down  , // h36
  Button.Up    , // h37
  Button.Down  , // h38
  Button.Up    , // h39
  Button.Down  , // h40
  Button.Up    , // h41
  Button.Down  , // h42
  Button.Up    , // h43
  Button.Down  , // h44
  Button.Up    , // h45
  Button.Down  , // h46
  Button.Up    , // h47
  Button.Down  , // h48
  Button.Up    , // h49
  Button.Down  , // h50
  Button.Up    , // h51
  Button.Down  , // h52
  Button.Right , // h53
  Button.Down  , // h54
  Button.Right , // h55
  Button.Right , // h56
  Button.Down  , // h57
  Button.Left  , // h58
  Button.Up    , // h59
  Button.Left  , // h60
  Button.Up    , // h61
  Button.Left  , // h62
  Button.Down  , // h63 *** push 63: recorded (hist 63)
  Button.Down  , // h64 *** push 64: recorded (hist 64 = full)
  Button.Right , // h65 *** push 65: REFUSED at the cap, no mutation
  Button.B     , // u 1: undo h64
  Button.B     , // u 2: undo h63
  Button.B     , // u 3: undo h62
  Button.B     , // u 4: undo h61
  Button.B     , // u 5: undo h60
  Button.B     , // u 6: undo h59
  Button.B     , // u 7: undo h58
  Button.B     , // u 8: undo h57
  Button.B     , // u 9: undo h56
  Button.B     , // u10: undo h55
  Button.B     , // u11: undo h54
  Button.B     , // u12: undo h53
  Button.B     , // u13: undo h52
  Button.B     , // u14: undo h51
  Button.B     , // u15: undo h50
  Button.B     , // u16: undo h49
  Button.B     , // u17: undo h48
  Button.B     , // u18: undo h47
  Button.B     , // u19: undo h46
  Button.B     , // u20: undo h45
  Button.B     , // u21: undo h44
  Button.B     , // u22: undo h43
  Button.B     , // u23: undo h42
  Button.B     , // u24: undo h41
  Button.B     , // u25: undo h40
  Button.B     , // u26: undo h39
  Button.B     , // u27: undo h38
  Button.B     , // u28: undo h37
  Button.B     , // u29: undo h36
  Button.B     , // u30: undo h35
  Button.B     , // u31: undo h34
  Button.B     , // u32: undo h33
  Button.B     , // u33: undo h32
  Button.B     , // u34: undo h31
  Button.B     , // u35: undo h30
  Button.B     , // u36: undo h29
  Button.B     , // u37: undo h28
  Button.B     , // u38: undo h27
  Button.B     , // u39: undo h26
  Button.B     , // u40: undo h25
  Button.B     , // u41: undo h24
  Button.B     , // u42: undo h23
  Button.B     , // u43: undo h22
  Button.B     , // u44: undo h21
  Button.B     , // u45: undo h20
  Button.B     , // u46: undo h19
  Button.B     , // u47: undo h18
  Button.B     , // u48: undo h17
  Button.B     , // u49: undo h16
  Button.B     , // u50: undo h15
  Button.B     , // u51: undo h14
  Button.B     , // u52: undo h13
  Button.B     , // u53: undo h12
  Button.B     , // u54: undo h11
  Button.B     , // u55: undo h10
  Button.B     , // u56: undo h9
  Button.B     , // u57: undo h8
  Button.B     , // u58: undo h7
  Button.B     , // u59: undo h6
  Button.B     , // u60: undo h5
  Button.B     , // u61: undo h4
  Button.B     , // u62: undo h3
  Button.B     , // u63: undo h2
  Button.B     , // u64: undo h1
  Button.B     , // u65: extra undo past the empty bottom is a no-op
];
