// vapor/examples/sokoban/levels.ts — Pocket Sokoban level data.
//
// 24 puzzles from MICROBAN by David W. Skinner. This file is a local const
// module imported by sokoban.tsx (the P1-d relative-path const import):
// the compiler folds its bindings, so on device only LEVEL_ROM actually
// costs ROM (one flat string); the compact LEVELS table is oracle/test use.
//
// SOURCE fetched 2026-09-17:
//   https://gitlab.synchro.net/phar/sbbs/-/raw/9e6f9042a685ad0a0b1e89ec43365639886b9552/xtrn/synkroban/levels/Microban.txt
// Author mirror: http://sneezingtiger.com/sokoban/levels/microbanText.html
// Verbatim upstream copyright header:
//   ; Microban (155 puzzles, revised April, 2000) ...
//   ; Copyright: David W Skinner
//   ; E-Mail: sasquatch@bentonrea.com
//   ; Web Site: http://users.bentonrea.com/~sasquatch/sokoban/
// No explicit SPDX license is stated in the .txt or on the mirror page;
// Microban is carried by sokoban distributions as freely available with
// attribution. The game keeps this credit on its title/help line:
//   LEVELS (C) DAVID W. SKINNER — sasquatch@bentonrea.com
//
// SELECTION: of the 155 Microban puzzles, 145 satisfy w<=18, h<=12; each
// was solved with an optimal-move BFS (P2 scout tooling), and the 24
// easiest were taken. Slot 1 is Microban #1 by requirement; slots 2..24
// follow in ascending optimal move count.
//
// GLYPHS (standard Microban charset, only these 7 appear):
//   # wall   (space) floor/void   . goal   $ box   * box-on-goal
//   @ player   + player-on-goal
// Trailing spaces pad each canonical row to its width and are VOID (never
// floor); the device blocks are wall-sealed so void is never entered.

// Slot play order (slot index -> Microban puzzle number):
//   0:1  1:44  2:2  3:21  4:31  5:40  6:30  7:4  8:56  9:5  10:17
//   11:52 12:25 13:9 14:34 15:28 16:51 17:24 18:32 19:103
//   20:15 21:38 22:53 23:67
export const LEVEL_COUNT = 24;

// ---- Canonical compact table (oracle, tests, docs, humans) ----------------
// 1160 chars across 162 rows. Device code never indexes this table, so the
// compiler emits no ROM for it.
export const LEVELS: readonly string[] = [
  // slot  1 = Microban #  1  6x7  boxes=2  optimal 33m/8p
  "####  ",
  "# .#  ",
  "#  ###",
  "#*@  #",
  "#  $ #",
  "#  ###",
  "####  ",
  // slot  2 = Microban # 44  5x3  boxes=1  optimal 1m/1p
  "#####",
  "#@$.#",
  "#####",
  // slot  3 = Microban #  2  6x7  boxes=3  optimal 16m/3p
  "######",
  "#    #",
  "# #@ #",
  "# $* #",
  "# .* #",
  "#    #",
  "######",
  // slot  4 = Microban # 21  7x6  boxes=2  optimal 17m/5p
  "####   ",
  "#  ####",
  "# . . #",
  "# $$#@#",
  "##    #",
  " ######",
  // slot  5 = Microban # 31  7x7  boxes=3  optimal 17m/6p
  "  #### ",
  " ##  # ",
  "##@$.##",
  "# $$  #",
  "# . . #",
  "###   #",
  "  #####",
  // slot  6 = Microban # 40  7x6  boxes=3  optimal 20m/7p
  " ##### ",
  " #   # ",
  "##   ##",
  "# $$$ #",
  "# .+. #",
  "#######",
  // slot  7 = Microban # 30  6x7  boxes=3  optimal 21m/5p
  "####  ",
  "#  ###",
  "# $$ #",
  "#... #",
  "# @$ #",
  "#   ##",
  "##### ",
  // slot  8 = Microban #  4  8x6  boxes=3  optimal 23m/7p
  "########",
  "#      #",
  "# .**$@#",
  "#      #",
  "#####  #",
  "    ####",
  // slot  9 = Microban # 56  7x6  boxes=2  optimal 23m/6p
  "#####  ",
  "#   ###",
  "#  $  #",
  "##* . #",
  " #   @#",
  " ######",
  // slot 10 = Microban #  5  8x7  boxes=4  optimal 25m/8p
  " #######",
  " #     #",
  " # .$. #",
  "## $@$ #",
  "#  .$. #",
  "#      #",
  "########",
  // slot 11 = Microban # 17  6x7  boxes=3  optimal 25m/9p
  "##### ",
  "# @ # ",
  "#...# ",
  "#$$$##",
  "#    #",
  "#    #",
  "######",
  // slot 12 = Microban # 52  6x8  boxes=4  optimal 26m/8p
  "  ####",
  "### @#",
  "#  $ #",
  "#  *.#",
  "#  *.#",
  "#  $ #",
  "###  #",
  "  ####",
  // slot 13 = Microban # 25  7x7  boxes=3  optimal 29m/7p
  " ####  ",
  " #  ###",
  " # $$ #",
  "##... #",
  "#  @$ #",
  "#   ###",
  "#####  ",
  // slot 14 = Microban #  9  6x7  boxes=2  optimal 30m/10p
  "##### ",
  "#.  ##",
  "#@$$ #",
  "##   #",
  " ##  #",
  "  ##.#",
  "   ###",
  // slot 15 = Microban # 34  9x6  boxes=4  optimal 30m/10p
  "  ####   ",
  "###  ####",
  "#       #",
  "#@$***. #",
  "#       #",
  "#########",
  // slot 16 = Microban # 28  7x7  boxes=2  optimal 33m/9p
  "#####  ",
  "#   #  ",
  "# @ #  ",
  "# $$###",
  "##. . #",
  " #    #",
  " ######",
  // slot 17 = Microban # 51  8x7  boxes=2  optimal 34m/8p
  "####    ",
  "#  ###  ",
  "#    ###",
  "#  $*@ #",
  "### .# #",
  "  #    #",
  "  ######",
  // slot 18 = Microban # 24  7x7  boxes=2  optimal 35m/9p
  "# #####",
  "  #   #",
  "###$$@#",
  "#   ###",
  "#     #",
  "# . . #",
  "#######",
  // slot 19 = Microban # 32  7x7  boxes=3  optimal 35m/9p
  " ####  ",
  "##  ###",
  "#     #",
  "#.**$@#",
  "#   ###",
  "##  #  ",
  " ####  ",
  // slot 20 = Microban #103  8x8  boxes=4  optimal 35m/12p
  "  ##### ",
  "  # . ##",
  "### $  #",
  "# . $#@#",
  "# #$ . #",
  "#  $ ###",
  "## . #  ",
  " #####  ",
  // slot 21 = Microban # 15  9x7  boxes=2  optimal 37m/14p
  "     ### ",
  "######@##",
  "#    .* #",
  "#   #   #",
  "#####$# #",
  "    #   #",
  "    #####",
  // slot 22 = Microban # 38  10x7  boxes=3  optimal 37m/8p
  "##########",
  "#        #",
  "# ##.### #",
  "# # $$ . #",
  "# . @$## #",
  "#####    #",
  "    ######",
  // slot 23 = Microban # 53  7x7  boxes=4  optimal 37m/12p
  " ##### ",
  "##. .##",
  "# * * #",
  "#  #  #",
  "# $ $ #",
  "## @ ##",
  " ##### ",
  // slot 24 = Microban # 67  7x8  boxes=3  optimal 37m/8p
  "#####  ",
  "#   ## ",
  "# #  # ",
  "#@$*.##",
  "##  . #",
  " # $# #",
  " ##   #",
  "  #####",
];

// ---- Device table -----------------------------------------------------------
// The device compiler gives module const arrays no numeric length and no
// per-element numeric metadata, so per-level w/h/row0 are unreadable on
// device. Instead every level occupies a FIXED, wall-sealed 10x8 block
// (all 24 fit; max level is 10x7 / 8 rows), centered inside its block:
//
//   LEVEL_ROM is ONE flat const string of 24*80 = 1920 chars.
//   char at slot s, row y, col x = LEVEL_ROM[s*80 + y*10 + x].
//
// Bounds stay inside the string, so every read is a real byte (the F2
// out-of-range divergence can never fire for the ROM table).
export const BW = 10;
export const BH = 8;
export const STRIDE = 80;
export const LEVEL_ROM = "  ####      # .#      #  ###    #*@  #    #  $ #    #  ###    ####                                    #####     #@$.#     #####                                   ######    #    #    # #@ #    # $* #    # .* #    #    #    ######                       ####      #  ####   # . . #   # $$#@#   ##    #    ######               ####     ##  #    ##@$.##   # $$  #   # . . #   ###   #     #####                        #####     #   #    ##   ##   # $$$ #   # .+. #   #######              ####      #  ###    # $$ #    #... #    # @$ #    #   ##    #####                        ########  #      #  # .**$@#  #      #  #####  #      ####                      #####     #   ###   #  $  #   ##* . #    #   @#    ######              #######   #     #   # .$. #  ## $@$ #  #  .$. #  #      #  ########             #####     # @ #     #...#     #$$$##    #    #    #    #    ######                ####    ### @#    #  $ #    #  *.#    #  *.#    #  $ #    ###  #      ####    ####      #  ###    # $$ #   ##... #   #  @$ #   #   ###   #####                #####     #.  ##    #@$$ #    ##   #     ##  #      ##.#       ###                        ####    ###  #### #       # #@$***. # #       # #########            #####     #   #     # @ #     # $$###   ##. . #    #    #    ######             ####      #  ###    #    ###  #  $*@ #  ### .# #    #    #    ######            # #####     #   #   ###$$@#   #   ###   #     #   # . . #   #######              ####     ##  ###   #     #   #.**$@#   #   ###   ##  #      ####                 #####     # . ##  ### $  #  # . $#@#  # #$ . #  #  $ ###  ## . #     #####        ###  ######@## #    .* # #   #   # #####$# #     #   #     #####           ###########        ## ##.### ## # $$ . ## . @$## ######    #    ######            #####    ##. .##   # * * #   #  #  #   # $ $ #   ## @ ##    #####              #####     #   ##    # #  #    #@$*.##   ##  . #    # $# #    ##   #     #####  ";
