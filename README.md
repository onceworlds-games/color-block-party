# Tack

Top-down sailboat racing for up to ten, where the wind is the track and every sail casts a shadow.

Play it at [onceworlds.com/play/tack](https://onceworlds.com/play/tack).

## How to play

Race round the marks and across the finish before everyone else. No boat sails straight into the wind, so you
zigzag upwind with tacks, and steering settles into the groove (the fastest angle) on its own. The wind is never
the same twice: gusts roll across as dark ripples, lulls go glassy, and the direction swings. Every sail leaves a
cone of tired air downwind: stay out of theirs and put them in yours. Cross the line after the gun, not before.
Under racing rules, port gives way to starboard, windward to leeward, the boat astern to the one ahead, and a
boat tacking to everyone; a collision costs the boat at fault a two-second stall, and so does touching a mark.

| | Keyboard | Touch | Gamepad |
|---|---|---|---|
| Steer | A / D or the arrow keys (press again in the groove to steer past it) | The stick | Left stick |
| Tack or gybe | Space | Tack | A |
| Hike out | Shift or H (hold) | Hike (hold) | B or a trigger |
| The whole course, with every boat's track | Tab (hold) | | |
| Zoom | `[` `]` or the mouse wheel | Automatic | |

## Modes

- **Fleet racing** on public and friends servers. The host sets the course (Auto or one of twelve), laps, weather,
  the fleet (humans only, or rival skippers filling it to six or ten), casual or racing rules, and one design or
  mixed classes. Late arrivals watch the leader until the next race.
- **Time trial**: you against the ghost of your best run, alone in fixed Classic conditions (12 knots, two laps)
  so the boards are fair. Bronze, silver and gold against the par of a good skipper.
- **Career**: eight cups of three races against rival skippers of rising skill, from the Harbour Cup to the
  Admiralty Cup.
- **The lesson**: a first race with the race officer's prompts.

## The water

- Six weathers: Light Airs, Moderate, Fresh, Shifty, Squall (a front with a big shift arrives mid-race) and Fog
  (you see about ninety metres).
- Twelve courses: windward-leewards, a triangle, a trapezoid, a slalom, a sprint, a channel, and coastal courses
  round islands, with shoals and tidal streams on some.
- Four classes, each with its weather: the Dinghy (shifty winds), the Skiff (fresh, it planes), the Catboat (light
  airs, points high) and the Catamaran (fast on a reach, slow to tack).
- Rival skippers in four skills (Deckhand, Mate, Skipper, Legend) and four temperaments.

## Multiplayer

Every page builds the same course, wind and gusts from the match's seed and the room's clock, and sails its own
boat, sending where it is twenty times a second; the host's page sails the rival skippers and keeps the race
record (finishes are checked, then the results go to everyone). A reload puts your boat back where it was, a new
host carries the skippers on, and a boat whose sailor leaves retires and is gone after fifteen seconds.

## Progress

Each race earns experience toward Captain levels, which open sail colours, sail patterns, burgees, wake styles,
horns, boat names and classes. Medals are kept per course.

Badges: `first-race`, `clean-tack`, `wind-thief`, `photo-finish`, `perfect-start`, `no-fouls`, `gust-rider`,
`ghost-buster`, `par-excellence`, `cup-winner`, `every-weather`, `captain`.

Leaderboards: `course-1` to `course-12` (time trial bests, lower is better), `fleet-wins` and `fleet-points`.

## How it's built

Plain ES modules and Canvas 2D, no build step: `game/` is served as it is.

- `game/js/sim/`: the simulation, pure and deterministic (no DOM): the seeded wind field, the polars of the four
  classes, boats and their tacks, shadows, the racing rules, courses, the race itself and the rival skippers. It
  runs at 30 steps a second and is what the tests and the balance harness drive.
- `game/js/render/`: the chart (paper, depth washes, contours, soundings, islands), the air (wisps, gusts, barbs),
  boats, wakes, marks and the HUD.
- `game/js/`: the app around them: the platform, input, the match over the network, solo races, career,
  progress, rewards, the lesson, the screens, sound (made in Web Audio) and the poster mode for store art.
- `game/fonts/`: Spectral and IBM Plex Mono (SIL Open Font License, licences alongside).
- `test/`: unit tests of the simulation and a multi-page match through a stand-in room.
- `scripts/`: the balance harness, the store art capture, a small static server and a headless Chrome driver.
- `store/`: the icon, thumbnails and badge icons, drawn by the game itself (`?poster=`).

## Run it locally

```sh
npm run dev       # the game on http://127.0.0.1:5173 (solo: no platform, rival skippers only)
npm test          # unit tests (Node 22+)
npm run balance   # the balance table; `npm run balance -- quick`, or one section: skills, classes, starts, courses, boats
npm run store     # captures store/ from the poster scenes (needs Chrome)
```

To try it on Onceworlds itself, run the platform locally and use `onceworlds dev` from the
[Onceworlds CLI](https://www.npmjs.com/package/@onceworlds/cli) in this folder.

## License

MIT. See `LICENSE`. The fonts are under the SIL Open Font License.
