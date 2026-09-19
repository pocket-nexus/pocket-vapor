// SOKOBAN interaction tape — slice P2① (board + movement + level load).
//
// The first 14 presses of the full 83-key tape designed in the P2 scout
// report: every press is MOVE-mode (undo/restart/select/solve arrive in
// slice P2②), covering the movement rules shipped here:
//
//   01    push a box-on-goal toward a wall          -> blocked, moves 0
//   02-03 walk up the corridor (onto the goal)      -> moves 1, 2 (+)
//   04    bump the top wall                         -> blocked, moves 2
//   05-09 walk around the room                      -> moves 3..7
//   10-11 push one box twice, box-behind-box setup  -> moves 8, 9
//   12-13 walk                                      -> moves 10, 11
//   14    push a box into the other box             -> blocked, moves 11
//
// Coordinates are the centred 10x8 block: player starts at (4,3), a
// box-on-goal '*' sits at (3,3) and the free box '$' at (5,4).
// SOKOBAN_MOVES_AFTER is the move count the title shows after each press.

import { Button } from "../host/input.ts";

export const SOKOBAN_TAPE: readonly number[] = [
  Button.Left, // 01: ahead (3,3) is '*', beyond (2,3) is '#' -> blocked
  Button.Up, // 02: walk (4,3) -> (4,2)
  Button.Up, // 03: walk (4,2) -> goal (4,1), '@' becomes '+'
  Button.Up, // 04: ahead (4,0) is '#' -> blocked
  Button.Down, // 05: walk (4,1) -> (4,2); the goal cell reverts to '.'
  Button.Down, // 06: walk (4,2) -> (4,3)
  Button.Right, // 07: walk (4,3) -> (5,3)
  Button.Right, // 08: walk (5,3) -> (6,3)
  Button.Down, // 09: walk (6,3) -> (6,4)
  Button.Left, // 10: push box (5,4) -> (4,4), walk to (5,4)
  Button.Left, // 11: push that box (4,4) -> (3,4), walk to (4,4)
  Button.Down, // 12: walk (4,4) -> (4,5)
  Button.Left, // 13: walk (4,5) -> (3,5)
  Button.Up, // 14: ahead (3,4) is a box, beyond (3,3) is '*' -> blocked
];

/** Move count the title must show after each press (tape order). */
export const SOKOBAN_MOVES_AFTER: readonly number[] = [
  0, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11,
];
