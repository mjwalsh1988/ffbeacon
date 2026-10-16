// Builds the week 3, 2026 redo in the game-by-game format from the bundle and
// the published edition. Prose written by hand; every id, slug and figure on
// a card comes from the bundle.
import { readFileSync, writeFileSync } from "node:fs";

const dir = "C:/Users/mjwal/AppData/Local/Temp/claude/C--Users-mjwal-OneDrive-Desktop-ffbeacon/341a5170-228a-456a-90be-7b043e125454/scratchpad";
const bundle = JSON.parse(readFileSync(`${dir}/week3-bundle.json`, "utf8"));
const current = JSON.parse(readFileSync(`${dir}/week3-current.json`, "utf8"));
const lines = bundle.datasets.game_player_lines.rows;

// Name to slug, from the card rows first and the bundle's Relay players second.
const slugByName = new Map();
for (const p of Object.values(bundle.players)) slugByName.set(p.full_name, p.slug);
for (const r of lines) slugByName.set(r.name, r.slug);
const missing = new Set();
const link = (text) =>
  text.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
    const slug = slugByName.get(name);
    if (!slug) {
      missing.add(name);
      return name;
    }
    return `[${name}](/players/${slug})`;
  });
const idOf = (game, name) => {
  const r = lines.find((l) => l.game_key === game && l.name === name);
  if (!r) throw new Error(`no card row for ${name} in ${game}`);
  return r.player_id;
};
const assert = (cond, msg) => {
  if (!cond) throw new Error(`fact check failed: ${msg}`);
};

// Fact checks against the bundle for every superlative the prose claims.
const maxBy = (key) => [...lines].sort((a, b) => Number(b[key] ?? 0) - Number(a[key] ?? 0))[0];
assert(maxBy("pass_yd").name === "Matthew Stafford", "Stafford had the most passing yards");
assert(maxBy("rec_yd").name === "Drake London", "London had the most receiving yards");
const games = bundle.datasets.week_games.rows;
assert(games.filter((g) => g.upset === "yes").length === 7, "seven upsets");
assert(games.filter((g) => g.total_result === "over").length === 8, "eight overs");
assert(games.filter((g) => String(g.cover_text).startsWith("Push")).length === 2, "two pushes");
const minCombined = [...games].sort((a, b) => a.combined_points - b.combined_points);
assert(minCombined[0].game_key === "TEN-NYG" && minCombined[1].combined_points - 19 === 15, "19 lowest by 15");
const overBy = games.map((g) => [g.game_key, g.combined_points - g.close_total]).sort((a, b) => b[1] - a[1]);
assert(overBy[0][0] === "SEA-WAS" && overBy[0][1] === 23.5, "SEA-WAS biggest over");
const dyn = [...lines].sort((a, b) => Number(b["dynasty-ppr-sflex.change"] ?? -1e9) - Number(a["dynasty-ppr-sflex.change"] ?? -1e9))[0];
assert(dyn.name === "Parker Washington", "Washington biggest dynasty jump among card players");
const dynLow = [...lines].sort((a, b) => Number(a["dynasty-ppr-sflex.change"] ?? 1e9) - Number(b["dynasty-ppr-sflex.change"] ?? 1e9))[0];
assert(dynLow.name === "Justin Herbert" && dynLow["dynasty-ppr-sflex.change"] === -1053, "Herbert biggest dynasty drop among card players");
// Neither is the week's biggest overall (Richardson and Dart did not play),
// so the prose says "of anyone who played".
assert(bundle.datasets.value_movers_up.rows[0].name === "Anthony Richardson" && bundle.datasets.value_movers_down.rows[0].name === "Jaxson Dart", "overall leaders did not play");

// The bench figures move as more leagues sync, so they are read from the
// bundle the card is stored from, never typed in.
const benchAward = (id) => bundle.datasets.week_awards.rows.find((r) => r.id === id);
const benchDetail = /Across (\d+) teams in (\d+) leagues/.exec(benchAward("bench_points").detail);
assert(benchDetail, "bench detail names teams and leagues");
const bench = {
  points: benchAward("bench_points").value,
  teams: Number(benchDetail[1]).toLocaleString("en-US"),
  leagues: benchDetail[2],
  flips: benchAward("bench_flips").value,
};
assert(benchAward("bench_costliest").value === "Brock Bowers sat for Kyle Pitts", "costliest bench call");

const now = new Date().toISOString();
const recap =(game_key, headline, recap_md, funName, funText) => ({
  game_key,
  headline,
  recap_md: link(recap_md),
  fun_stat: funName ? { player_id: idOf(game_key, funName), text: funText } : null,
});

const gameRecaps = [
  recap(
    "ATL-GB",
    "Bijan Robinson runs over Green Bay on Thursday night",
    "Atlanta won by 21 as a 4.5-point underdog, and the game ran through [[Bijan Robinson]]: 29 carries, 194 rushing yards and two touchdowns for 35.3 PPR points, the second-best line of the week. Green Bay scored first on a Jordan Love throw to [[Christian Watson]] and never led again. [[Michael Penix]] needed only 25 throws for 256 yards, and a late two-point conversion carried the game past its 43.5 total. Love threw 53 times for 312 yards, volume that kept Watson and [[Matthew Golden]] above 20 PPR points each.",
    "Drake London",
    "Drake London caught nine of ten targets for 194 yards, the same number Bijan Robinson ran for and the most receiving yards of the week, and did not score.",
  ),
  recap(
    "LAC-BUF",
    "James Cook carries Buffalo past the Chargers in the fourth",
    "The Chargers led 10 to 0 after a quarter and 13 to 10 going into the fourth, and Buffalo won it on the ground. [[James Cook]] ran 24 times for 154 yards and the clinching 3-yard touchdown with 3:13 left, and [[Josh Allen]] scored both of Buffalo's other touchdowns from a yard out. The Bills covered the 7-point closing line by a point, and the game finished 10.5 points under its total. [[Justin Herbert]] threw for 226 yards and a touchdown to [[Keaton Mitchell]]; his Dynasty PPR SF value fell 1,053, the biggest drop of anyone who played this week.",
    "Josh Allen",
    "Josh Allen threw two interceptions, lost a fumble and threw no touchdown passes, and still scored 19.5 PPR points on two 1-yard runs.",
  ),
  recap(
    "CAR-CLE",
    "Harold Fannin wins it for Cleveland with 1:48 left",
    "Carolina moved the ball and kept settling: Ryan Fitzgerald kicked four field goals, from 35, 41, 53 and 37 yards, and the Panthers' only touchdown was an 8-yard throw from [[Bryce Young]] to [[John Metchie]] with 4:25 left. Cleveland answered with a 14-yard touchdown from Deshaun Watson to [[Harold Fannin]] and a two-point conversion, and won 21 to 18 as a small home underdog. Young threw 48 times for 291 yards; Watson passed for only 144 but added 45 on the ground for 20.3 PPR points.",
    "Harold Fannin",
    "Harold Fannin caught both of Cleveland's touchdowns, from 2 and 14 yards, and turned 51 receiving yards into 24.1 PPR points.",
  ),
  recap(
    "NYJ-DET",
    "Jahmyr Gibbs scores three and the Jets' comeback falls short",
    "The Jets erased a 24 to 10 deficit in the fourth quarter, tying it on a 23-yard touchdown from Geno Smith to [[Garrett Wilson]] and a two-point conversion with 4:06 left. Detroit answered with an 11-yard catch by [[Jahmyr Gibbs]] with 2:25 to go. Gibbs finished with two rushing scores, the receiving touchdown and 41.4 PPR points, the best line of the week. The Lions won by exactly the 7-point closing spread, a push. [[Breece Hall]] ran 13 times for 32 yards before leaving with a thigh injury.",
    "Geno Smith",
    "Geno Smith completed 31 of 37 passes, 84 percent, for 321 yards and three touchdowns, and lost.",
  ),
  recap(
    "HOU-IND",
    "Spencer Shrader's 53-yarder beats Houston with 16 seconds left",
    "Houston took its only lead with 1:48 left on a 1-yard [[Woody Marks]] run, and Indianapolis kicked its way back: Spencer Shrader made four field goals, including a 58-yarder before halftime and the 53-yard winner with 16 seconds to go. [[Keenan Allen]] scored the Colts' touchdown and 18.3 PPR points, more than double his 7.7 projection. It was a quiet day for the bigger names: [[C.J. Stroud]] threw for 167 yards, and Nico Collins sat out with a hamstring.",
    "Jonathan Taylor",
    "Jonathan Taylor carried 23 times and none of them went longer than 11 yards: 9.2 PPR points against a 19.9 projection.",
  ),
  recap(
    "NE-JAX",
    "Trevor Lawrence spreads it around and New England never scores a touchdown",
    "New England never reached the end zone: two Andy Borregales field goals were its only points, and Drake Maye threw two interceptions on 25 attempts. [[Trevor Lawrence]] threw three touchdowns to three receivers, Josh Cameron, [[Jakobi Meyers]] and [[Parker Washington]], and Chris Rodriguez and [[Bhayshul Tuten]] ran in two more. Meyers caught seven of eight targets for 19.4 PPR points on an 8.4 projection. A 3-point favourite won by 29.",
    "Parker Washington",
    "Parker Washington caught three passes for 40 yards and a touchdown, and his Dynasty PPR SF value rose 1,140, the biggest jump of anyone who played this week.",
  ),
  recap(
    "KC-MIA",
    "Kansas City covers in Miami on the day Achane's season ends",
    "[[Kenneth Walker]] scored on a 10-yard run and a 5-yard catch for 21.3 PPR points, and Kansas City covered a 10-point line with a Harrison Butker field goal and a late [[Travis Kelce]] touchdown. The fantasy story was on the other side: [[De'Von Achane]] tore his ACL on his third carry, and [[Ollie Gordon]] took over the backfield, scoring Miami's only touchdown and 14.5 PPR points on a 3.5 projection. Malik Willis threw for 210 yards and an interception.",
    "Patrick Mahomes",
    "Patrick Mahomes completed 20 of 24 passes, 83 percent, for 246 yards and two touchdowns.",
  ),
  recap(
    "TEN-NYG",
    "Four field goals and the lowest-scoring game of the week",
    "Nineteen points was the lowest total of the week by 15, and it went 18.5 under a closing total that was already the lowest on the board. Dominic Zvada kicked four field goals for every New York point; [[Jameis Winston]], starting for the injured Jaxson Dart, threw for 118 yards and scored 6.1 PPR points against a 14.3 projection. [[Cam Skattebo]] carried 20 times for 60 yards, and [[Tony Pollard]] ran for 74 on Tennessee's side.",
    "Wan'Dale Robinson",
    "Wan'Dale Robinson's 4-yard catch with 5:35 left was the only touchdown of the game, and his 18.7 PPR points led both teams.",
  ),
  recap(
    "CIN-PIT",
    "Chris Boswell's late kicks beat Cincinnati",
    "The game was tied 27 to 27 with 8:45 left after a Chris Boswell field goal, and his 33-yarder with 2:15 to go won it for Pittsburgh as a 3.5-point home underdog. [[Joe Burrow]] threw three touchdowns, one each to [[Ja'Marr Chase]], [[Tee Higgins]] and [[Mike Gesicki]], and Chase's 24.8 PPR points led both teams. [[Jaylen Warren]] ran 17 times for 127 yards with Rico Dowdle out. The 57 points went 14.5 over the total.",
    "Aaron Rodgers",
    "Aaron Rodgers threw touchdowns to three different receivers, Roman Wilson, Ben Skowronek and DK Metcalf, and scored 23.7 PPR points on a 14.3 projection.",
  ),
  recap(
    "SEA-WAS",
    "Washington wins as an 8.5-point underdog on a pick-six",
    "[[Marcus Mariota]], starting for Jayden Daniels, threw three touchdowns, and the game turned on a defensive score: with Washington up 27 to 24, linebacker Kain Medrano returned an interception 50 yards with 3:57 left. Seattle got within two on a [[Cooper Kupp]] touchdown and did not score again. [[Sam Darnold]] threw for 379 yards, four touchdowns and two interceptions in his return, 29.7 PPR points. The 64 points went 23.5 over a 40.5 total, the widest miss of any total this week.",
    "Jaxon Smith-Njigba",
    "Jaxon Smith-Njigba scored twice on 128 receiving yards and also completed his only pass for 14 yards: 35.4 PPR points, the best receiver line of the week.",
  ),
  recap(
    "ARI-SF",
    "Brock Purdy throws four as Arizona covers late",
    "San Francisco led 23 to 6 in the third quarter and then needed two [[George Kittle]] touchdowns to hold on; Chad Ryland's field goal with 34 seconds left let Arizona cover a 7.5-point line. [[Brock Purdy]] threw for 297 yards and four scores on 27 attempts, 31.3 PPR points, and Kittle caught two of them for 26.2. On the other side [[Jacoby Brissett]] threw 52 times and [[Michael Wilson]] turned 17 targets into 25.9 PPR points. Mike Evans left with a rib injury.",
    "Deebo Samuel",
    "Deebo Samuel scored on an 80-yard play without a catch: Purdy hit Mike Evans for 2 yards and Evans lateraled to Samuel, who took it the rest of the way.",
  ),
  recap(
    "MIN-TB",
    "A punt return and three long field goals win it in Tampa",
    "Minnesota's points came from everywhere but a steady offense: Will Reichard made field goals from 54, 56 and 43 yards, Myles Price returned a punt 86 yards for a touchdown, and [[Kyler Murray]] threw for 168 yards. Tampa Bay lost more than the game, because [[Baker Mayfield]] dislocated his right thumb and is expected to miss three weeks. [[Aaron Jones]] caught five passes and carried 17 times for 14.2 PPR points, and [[Bucky Irving]] scored 7.8 against a 14.7 projection.",
    "Jordan Addison",
    "Jordan Addison's 41-yard catch was Minnesota's only offensive touchdown, and it made his day: 20.0 PPR points on a 9.2 projection.",
  ),
  recap(
    "BAL-DAL",
    "Tyler Loop's 56-yarder wins it in Rio as time expires",
    "The game in Rio de Janeiro was tied 31 to 31 with seven seconds left after a Brandon Aubrey field goal, and Tyler Loop made a 56-yarder as time expired. Baltimore won by exactly the 3-point closing spread, a push. [[Derrick Henry]] scored twice on 26 carries, [[Lamar Jackson]] completed 15 of 20 for two touchdowns, and [[Zay Flowers]] returned from injury for 15.4 PPR points. [[CeeDee Lamb]] caught seven of eight targets for 112 yards and [[Javonte Williams]] ran for 98 and a score.",
    "Derrick Henry",
    "Derrick Henry's two touchdowns moved him past Marcus Allen into third on the NFL's career rushing touchdown list.",
  ),
  recap(
    "LV-NO",
    "Brock Bowers returns and Las Vegas scores the last 19 points",
    "New Orleans led 27 to 16 midway through the third quarter on four Tyler Shough touchdown passes, and Las Vegas scored the last 19 points: a 36-yard run by Mike Washington, then touchdown throws from [[Kirk Cousins]] to [[Cody White]] and [[Brock Bowers]]. Bowers, in his season debut, caught 10 of 13 targets for 116 yards and 27.6 PPR points, the top tight end line of the week. Shough's 24.8 PPR points came with two lost fumbles. [[Ashton Jeanty]] ran 19 times for 56 yards.",
    "Noah Fant",
    "Noah Fant caught four passes for 33 yards and two touchdowns: 19.3 PPR points against a 3.8 projection.",
  ),
  recap(
    "LAR-DEN",
    "Denver comes back from 16 down and Bo Nix wins it late",
    "The Rams led 16 to 0 at halftime on a [[Tyler Higbee]] touchdown and three Harrison Mevis field goals. Denver tied it with two [[Bo Nix]] touchdown passes and two two-point conversions, took the lead on Talanoa Hufanga's 66-yard interception return, lost it on a 48-yard catch by [[Konata Mumpfield]], and won it on a 1-yard Nix run with 47 seconds left. [[Davante Adams]] caught seven of 13 targets for 137 yards. Higbee scored 20.2 PPR points on a 1.6 projection, the biggest beat of the week.",
    "Matthew Stafford",
    "Matthew Stafford threw 55 passes for 390 yards, the most passing yards of the week, and lost.",
  ),
  recap(
    "PHI-CHI",
    "Case Keenum steps in and Chicago routs Philadelphia",
    "Starting for the injured Caleb Williams, [[Case Keenum]] threw touchdowns to [[Luther Burden]] and [[Kalif Raymond]] and ran one in himself, 24.5 PPR points on an 11.9 projection, and Chicago won by 20 as a 3-point home underdog. Philadelphia's only score was a Jalen Hurts run before halftime; Hurts threw for 153 yards and an interception and was cleared after a concussion evaluation. [[Saquon Barkley]] ran 15 times for 82 yards and scored 9.0 PPR points against a 15.9 projection.",
    "Kalif Raymond",
    "Kalif Raymond scored 21.0 PPR points on a 6.2 projection, with a 41-yard touchdown in the third quarter.",
  ),
];
assert(gameRecaps.length === 16, "16 recaps");
for (const g of games) assert(gameRecaps.some((r) => r.game_key === g.game_key), `recap for ${g.game_key}`);

const sec = (id) => current.sections.find((s) => s.id === id);
const relaysOf = (...ids) => [...new Set(ids.flatMap((id) => sec(id).relay_ids))];
const citesOf = (...ids) => ids.flatMap((id) => sec(id).citations);

const sections = [
  {
    id: "week-3-in-numbers",
    heading: "Week 3 in numbers: Gibbs, seven upsets and 19 points left on the bench",
    icon: "scoreboard",
    eyebrow: "Week 3, part 1 of 6",
    body_md: link(
      `[[Jahmyr Gibbs]] had the week's best line at 41.4 PPR points, three touchdowns in a 31 to 24 win over the Jets, and three other players led their positions: [[Brock Purdy]] at quarterback with 31.3, [[Jaxon Smith-Njigba]] at receiver with 35.4 and [[Brock Bowers]] at tight end with 27.6 in his season debut.\n\nThe betting market had a harder week than the players. Seven of the sixteen games were won outright by the team the closing moneyline made the underdog, Washington beat Seattle as a 320 underdog, and Arizona and San Francisco finished 17.5 points over their total. Across ${bench.teams} teams in ${bench.leagues} leagues synced to FF Beacon, managers left ${bench.points} points a team on the bench, and ${bench.flips} of them lost a game their own bench would have won. The costliest single call was Brock Bowers on a bench behind Kyle Pitts.`,
    ),
    relay_ids: [],
    block_refs: ["awards", "scorers"],
    citations: [],
  },
  {
    id: "game-by-game",
    heading: "Game by game: every final, the line it beat, and who scored",
    icon: "calendar",
    eyebrow: "Week 3, part 2 of 6",
    body_md:
      "Each card below is one game: the final, the line it was played under and whether the favourite covered, the score the line implied against the score that happened, the best fantasy lines on both sides graded against the Sleeper projection, and whose value moved. Seven underdogs won outright, two games landed exactly on the spread, and the totals split evenly, eight over and eight under.\n\nThree reports sit behind the cards: Derrick Henry [passing Marcus Allen on the career rushing touchdown list](/brief/relay/derrick-henry-rushing-touchdowns-milestone), Brock Purdy's [93.7 QBR through three games](/brief/relay/purdy-qbr-first-three-games-elite-company), and Jalen Hurts [cleared after a concussion evaluation](/brief/relay/jalen-hurts-cleared-concussion-evaluation).",
    relay_ids: relaysOf("the-week-3-scoreboard"),
    block_refs: ["cards"],
    citations: [],
  },
  {
    id: "how-the-projections-did",
    heading: "How the projections did: a coin flip, and low at tight end",
    icon: "values",
    eyebrow: "Week 3, part 3 of 6",
    body_md:
      "The Sleeper projection was close to a coin flip in week 3: 144 of 282 graded players beat it, 51 percent, and the average miss was 4.9 PPR points. It ran low at tight end, where 65 percent of graded players beat it and the average tight end outscored his projection by 2.2 points, and slightly high at running back, the only position where fewer than half beat it.\n\nThe season lists are the part to use. A player who beats his projection every week is one the number keeps underrating, and one who falls short every week is one it keeps overrating; both are worth a second look before you set a lineup on the projection alone.",
    relay_ids: [],
    block_refs: ["projections"],
    citations: [],
  },
  {
    id: "injuries-and-availability",
    heading: "Injuries and availability: Achane, Caleb, Jefferson and the IDP losses",
    icon: "injury",
    eyebrow: "Week 3, part 4 of 6",
    body_md: link(
      [
        "The timeline below places every reported absence by its expected return. One line per player who matters for fantasy, dynasty first and redraft second:",
        "",
        "- [[De'Von Achane]]: [torn ACL, out for the season](/brief/relay/de-von-achane-torn-acl-out-season), on injured reserve. Dynasty value down 542 to 5,561; hold in dynasty, injured reserve slot or drop in redraft. [[Ollie Gordon]] is the claim.",
        "- [[Caleb Williams]]: [grade 2 hamstring strain, three to four weeks](/brief/relay/caleb-williams-hamstring-injury-three-four-weeks). Still 15th overall in Dynasty PPR SF at 7,548; hold in both formats.",
        "- [[Justin Jefferson]]: [ankle sprain with a chance to play Sunday](/brief/relay/justin-jefferson-ankle-sprain-dolphins) after 12 percent of the snaps in Tampa. Hold everywhere; check Friday's report.",
        "- [[Puka Nacua]]: [doubtful with a possible week 4 return](/brief/relay/puka-nacua-doubtful-groin-injury) after a second missed game with the groin; surgery has not been ruled out. Hold.",
        "- [[Mike Evans]]: [rib injury](/brief/relay/49ers-mike-evans-ruled-out-rib-injury), called day to day by Kyle Shanahan. Redraft value down 473.",
        "- [[Travis Etienne]]: [hamstring, length unknown](/brief/relay/saints-travis-etienne-hamstring-injury), injured reserve not ruled out. Redraft value down 799 to 3,928.",
        "- [[Breece Hall]]: [thigh, now described as a quad and week to week](/brief/relay/breece-hall-ruled-out-thigh-injury). Redraft down 1,041; dynasty up 218, because a week-to-week tag is noise over a career.",
        "- [[Nico Collins]]: [a decent chance to return against Dallas](/brief/relay/nico-collins-return-week-4-cowboys), 13.0 projected with a 56 percent beat rate.",
        "- [[Zay Flowers]]: [back and active](/brief/relay/zay-flowers-active-ravens-cowboys) for 15.4 PPR points; redraft value up 1,028.",
        "- Longer absences: [[Jonathon Brooks]] [at least six weeks after core muscle surgery](/brief/relay/jonathan-brooks-core-muscle-injury-ir), [[Alec Pierce]] [on injured reserve with a heel injury](/brief/relay/colts-alec-pierce-injured-reserve-heel), [[Andrei Iosivas]] [four to six weeks with a thumb](/brief/relay/bengals-iosivas-thumb-injury-four-six-weeks), [[David Njoku]] [on injured reserve](/brief/relay/chargers-njoku-ir-mvs-triplett-signed), [[Jonah Coleman]] [back in late October](/brief/relay/jonah-coleman-ir-high-ankle-sprain), and [[Jayden Reed]], [too early to say whether he plays again this season](/brief/relay/jayden-reed-neck-injury-testing-season-status).",
        "- IDP: [[Brian Burns]] [tore his ACL](/brief/relay/giants-brian-burns-acl-tear-season-ending), [[Nick Bosa]] [pulled a calf](/brief/relay/nick-bosa-calf-injury-49ers-cardinals) and stays off injured reserve, [[Myles Garrett]] faces [six weeks after knee surgery](/brief/relay/myles-garrett-6-week-knee-surgery-recovery), [[Leo Chenal]] [had neck surgery](/brief/relay/leo-chenal-neck-surgery) and [[Jaycee Horn]] [tore a quad](/brief/relay/jaycee-horn-torn-quad-out-indefinitely). No value source prices defensive players.",
      ].join("\n"),
    ),
    relay_ids: relaysOf("injuries-and-availability"),
    block_refs: ["tiles", "timeline", "planner", "achane-quote"],
    citations: citesOf("injuries-and-availability"),
  },
  {
    id: "moves-and-role-changes",
    heading: "Moves and role changes: Dart, McCarthy, Mayfield and three new starters",
    icon: "transaction",
    eyebrow: "Week 3, part 5 of 6",
    body_md: link(
      [
        "- [[Jaxson Dart]] had [knee surgery and is out for the regular season](/brief/relay/jaxson-dart-knee-surgery-out-regular-season). His Dynasty PPR SF value fell 1,393 while his redraft value moved only 121; drop in redraft without an injured reserve slot, hold or buy in dynasty superflex.",
        "- The Giants [acquired J.J. McCarthy for a 2027 fifth-round pick](/brief/relay/giants-acquire-jj-mccarthy-vikings-trade), and [[Jameis Winston]] stays the starter. [[J.J. McCarthy]] is a superflex stash only.",
        "- [[Baker Mayfield]] [misses three weeks](/brief/relay/baker-mayfield-three-weeks-thumb-injury) with the thumb, and undrafted rookie [[Jalon Daniels]] [starts against Green Bay](/brief/relay/jalon-daniels-starting-role-buccaneers), a one-week superflex fill at best.",
        "- [[Jayden Daniels]] stayed [off injured reserve as week to week](/brief/relay/jayden-daniels-not-ir-week-to-week); Marcus Mariota is the likelier week 4 starter. Hold Daniels everywhere.",
        "- [[Case Keenum]] [stays the Bears' starter](/brief/relay/bears-three-qbs-starter-monday) until Caleb Williams returns; a superflex start against the Jets.",
        "- [[Sam Darnold]] was [cleared](/brief/relay/sam-darnold-injury-report-cleared-seahawks-washington) and threw for 379 yards; start him in superflex.",
        "- Pittsburgh ruled out [[Rico Dowdle]] [with a toe injury](/brief/relay/steelers-dowdle-warren-injury-report-bengals); [[Jaylen Warren]] ran for 127 on 90 percent of the snaps. Start Warren while Dowdle is out.",
        "- Denver [cleared J.K. Dobbins and RJ Harvey](/brief/relay/broncos-jonah-coleman-ruled-out-rams-dobbins-harvey-cleared) with Coleman on reserve: [[RJ Harvey]] is the PPR flex, [[J.K. Dobbins]] the touchdown-dependent start.",
        "- Signings: the Eagles [signed Zach Ertz](/brief/relay/eagles-sign-zach-ertz), and Washington is [expected to sign Austin Ekeler](/brief/relay/commanders-sign-austin-ekeler), a deep-league watch only.",
      ].join("\n"),
    ),
    relay_ids: relaysOf("trades-signings-and-releases", "depth-chart-and-role-changes"),
    block_refs: ["lines"],
    citations: citesOf("trades-signings-and-releases", "depth-chart-and-role-changes"),
  },
  {
    id: "what-to-do-this-week",
    heading: "What to do this week: claims, holds, buys and sells",
    icon: "waiver",
    eyebrow: "Week 3, part 6 of 6",
    body_md: link(
      [
        "Every call is tied to a report above and to a number on the site; the cards below link each one to the tool that runs it.",
        "",
        "- Claim [[Ollie Gordon]] everywhere: 14.5 PPR points on 17 carries and an 84 percent snap share the day he took over. Run the bid through the [FAAB calculator](/tools/faab).",
        "- Claim [[Michael Penix]] in superflex: a redraft value up 1,335 and a 14.7-point projection against New Orleans.",
        "- Claim [[Case Keenum]] in superflex leagues that roster Caleb Williams, and drop him the week Williams practises in full.",
        "- Start [[Jaylen Warren]] while Dowdle is out; compare him with your flex in [Who Should I Start](/tools/who-should-i-start).",
        "- Hold Jefferson, Nacua and Caleb Williams everywhere; hold Dart and Achane in dynasty and move them to injured reserve slots in redraft.",
        "- Buy Dart in dynasty superflex if you can wait: the market charged 1,393 in dynasty and 121 in redraft, which prices this season, not the player. Check the offer in the [trade calculator](/tools/trade-calculator).",
        "- Sell Baker Mayfield in one-quarterback redraft and Travis Etienne in redraft if a contender needs a back now.",
      ].join("\n"),
    ),
    relay_ids: relaysOf("what-to-do-this-week"),
    block_refs: ["actions", "movers", "toggle", "rule"],
    citations: citesOf("what-to-do-this-week"),
  },
];

const oldBlock = (id) => current.blocks.find((b) => b.id === id);
const blocks = [
  {
    id: "awards",
    kind: "week_awards",
    dataset_id: "week_awards",
    caption: "Week 3 in numbers",
    conclusion: `Gibbs led the week at 41.4, the underdog won seven of sixteen games, and managers in synced leagues left ${bench.points} points a team on the bench.`,
    options: {},
  },
  {
    id: "cards",
    kind: "game_cards",
    dataset_id: "week_games",
    caption: "Every game of week 3",
    conclusion: "Seven underdogs won outright, two games pushed against the spread, and eight of sixteen went over the total.",
    options: {},
  },
  {
    id: "projections",
    kind: "projection_report",
    dataset_id: "projection_report",
    caption: "How the Sleeper projection did in week 3",
    conclusion: "Close to a coin flip overall at 51 percent, and low at tight end, where 65 percent of graded players beat it.",
    options: {},
  },
  ...["tiles", "scorers", "timeline", "planner", "achane-quote", "lines", "actions", "movers", "toggle", "rule"].map(oldBlock),
];

{ const sc = blocks.find((b) => b.id === "scorers"); sc.options = { ...sc.options, limit: 6 }; }
// A Relay's status now reaches its subjects only, so the timeline no longer
// carries the backups named in passing, and the tile count fell with it.
{
  const tiles = Object.fromEntries(bundle.datasets.week_stat_tiles.rows.map((r) => [r.id, r.value]));
  assert(tiles.reports === "124" && tiles.injuries === "83" && tiles.ruled_out === "31", "124, 83, 31");
  const tl = bundle.datasets.injury_timeline.rows;
  const wk = (n) => tl.find((r) => r.name === n)?.expected_return_week;
  assert(wk("Nico Collins") === 4 && wk("Baker Mayfield") === 6 && wk("Jonathon Brooks") === 9, "Collins 4, Mayfield 6, Brooks 9");
  assert(Math.min(...tl.filter((r) => r.expected_return_week !== null).map((r) => r.expected_return_week)) === 4, "Collins first back");
  assert(!tl.some((r) => ["Ollie Gordon", "J.K. Dobbins", "RJ Harvey", "Sam Darnold"].includes(r.name)), "no cleared or replacement player on the timeline");
  blocks.find((b) => b.id === "tiles").conclusion = "A heavy week: 124 reports, 83 of them injuries, and 31 players ruled out or placed on reserve.";
  blocks.find((b) => b.id === "timeline").conclusion = "Nico Collins is first back in week 4, Baker Mayfield around week 6 and Jonathon Brooks around week 9.";
}
// The movers chart reads value_movers_up, so it draws risers only; the live
// edition's conclusion described the fallers, which this chart never shows.
{
  const mv = blocks.find((b) => b.id === "movers");
  const up = bundle.datasets.value_movers_up.rows;
  if (up[0].name !== "Anthony Richardson" || up[0].change_7d !== 1961 || up[1].name !== "Parker Washington" || up[1].change_7d !== 1140) {
    throw new Error(`movers changed: ${up.slice(0, 2).map((r) => `${r.name} ${r.change_7d}`).join(", ")}`);
  }
  mv.caption = "Biggest Dynasty PPR SF value risers of the week";
  mv.conclusion = "Anthony Richardson rose 1,961, the biggest move of the week, with Parker Washington next at 1,140.";
}
const research_log = [
  ...current.research_log,
  ...games.map((g) => ({
    claim: `Scoring plays and box score for ${g.away} at ${g.home}, final ${g.away} ${g.away_score}, ${g.home} ${g.home_score}.`,
    url: g.recap_url,
    fetched_at: now,
    note: "Game recap research for the game card: scoring sequence, quarterbacks, leaders.",
    kind: "check",
  })),
];

const faq = current.faq.slice(0, 3);

const draft = {
  edition: current.edition,
  title: current.title,
  slug: current.slug,
  meta_description: "Week 3 game by game: every final against its line, the projection report card, Achane's torn ACL, Dart's surgery, and the waiver claims to make.",
  tl_dr:
    "Week 3 was a bad week for favourites and quarterbacks. Seven underdogs won outright, Washington beat Seattle as an 8.5-point underdog on a pick-six, and Jahmyr Gibbs led all players with 41.4 PPR points. De'Von Achane tore his ACL, Jaxson Dart had season-ending knee surgery that sent the Giants trading for J.J. McCarthy, and Caleb Williams and Baker Mayfield each face about three weeks out, while Case Keenum, Sam Darnold and a returning Brock Bowers all posted big lines. Every game has its own card below, with the line it was played under, the best fantasy lines against their projections and whose value moved, then the injuries, the moves and the claims to make in Dynasty PPR SF and Redraft 1QB PPR.",
  format_note: current.format_note,
  sections,
  blocks,
  games: gameRecaps,
  editor_take: null,
  faq,
  players: current.players,
  teams: current.teams,
  research_log,
  run: { source: "manual", run_id: null, model: "claude-opus-5-5" },
};

if (missing.size > 0) console.log("names with no slug (left as plain text):", [...missing].join(", "));
writeFileSync(`${dir}/week3-draft.json`, JSON.stringify(draft, null, 2));
const words = (s) => s.split(/\s+/).filter(Boolean).length;
let total = words(draft.tl_dr);
for (const s of sections) total += words(s.body_md);
for (const g of gameRecaps) total += words(g.headline) + words(g.recap_md) + (g.fun_stat ? words(g.fun_stat.text) : 0);
for (const f of faq) total += words(f.answer_md);
console.log("approx words", total, "recap words", gameRecaps.map((g) => words(g.recap_md)).join(","));
