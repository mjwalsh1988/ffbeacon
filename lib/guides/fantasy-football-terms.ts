/**
 * Content for the "Fantasy football terms" guide at /guides/fantasy-football-terms.
 *
 * The copy lives here rather than inline in the page for three reasons:
 *   1. The page renders each term twice, once as visible prose and once as a
 *      schema.org DefinedTerm inside the JSON-LD block. One array keeps those two
 *      from drifting apart, which is the usual way glossary structured data ends
 *      up lying about the page.
 *   2. Term counts shown in the copy are derived, never typed by hand.
 *   3. Anchor ids are declared next to the term they belong to, so an id can be
 *      audited for stability (an id is a permanent URL; renaming one breaks every
 *      link anyone ever shared).
 *
 * WRITING RULES FOR THIS FILE.
 * The first sentence of every `body[0]` is a standalone definition of the form
 * "X is ..." or "X stands for ...". That is deliberate: it is the sentence a
 * search snippet, an answer engine, or a screen reader user skimming by heading
 * will take, and it has to make sense with zero surrounding context. Everything
 * after that first sentence adds the part a bare dictionary would leave out.
 *
 * Definitions describe the game, not this website, except in the final section.
 * Anything that describes FF Beacon behavior must be true of the current build.
 */

export type GlossaryLink = {
  href: string;
  label: string;
};

export type GlossaryTerm = {
  /** Anchor id. Permanent once shipped: it is part of a shareable URL. */
  id: string;
  /** The term as a reader would say it out loud. */
  term: string;
  /** Expansion or common alternate name, rendered beside the term. */
  aka?: string;
  /** Paragraphs. `body[0]` opens with a standalone definition sentence. */
  body: string[];
  /** Optional internal link that puts the term to work somewhere on the site. */
  link?: GlossaryLink;
};

export type GlossarySection = {
  /** Anchor id for the section heading. */
  id: string;
  /** Full section heading. */
  title: string;
  /** Shorter label for the jump-to nav. */
  navLabel: string;
  /** One line under the heading, setting up what the section covers. */
  intro: string;
  terms: GlossaryTerm[];
};

export const GLOSSARY_SECTIONS: GlossarySection[] = [
  {
    id: "scoring",
    title: "Scoring rules",
    navLabel: "Scoring rules",
    intro:
      "Scoring decides what everything else is worth. Two leagues can draft the same players and value them completely differently because of what happens on a catch.",
    terms: [
      {
        id: "ppr",
        term: "PPR",
        aka: "Points Per Reception",
        body: [
          "PPR stands for Points Per Reception. Every catch is worth one fantasy point on top of the usual points for yards and touchdowns.",
          "That single rule reshapes a draft board. A running back who catches 60 passes picks up 60 points he would not otherwise have, which is why pass-catching backs and high-volume slot receivers climb in PPR while touchdown-dependent runners slide. It is the most common scoring setting in fantasy football.",
        ],
        link: { href: "/rankings/redraft-ppr-std", label: "See PPR rankings" },
      },
      {
        id: "half-ppr",
        term: "Half PPR",
        aka: "0.5 PPR",
        body: [
          "Half PPR awards half a point per catch instead of a full point, sitting between Standard and full PPR.",
          "Leagues land here when they want receptions to count without letting them run the whole board. The practical effect is that the gap between a 90-catch receiver and a 40-catch runner closes by half. Same players, different order.",
        ],
        link: {
          href: "/rankings/redraft-half-std",
          label: "See half PPR rankings",
        },
      },
      {
        id: "standard-scoring",
        term: "Standard scoring",
        aka: "non-PPR",
        body: [
          "Standard scoring gives no points for catches at all. Players score on yardage and touchdowns only.",
          "This is the original fantasy format, and it tilts value hard toward volume runners and touchdown scorers. Fewer leagues use it now, but plenty of long-running home leagues never switched, so confirm it before you assume.",
        ],
      },
      {
        id: "te-premium",
        term: "TE Premium",
        aka: "TEP",
        body: [
          "TE Premium, usually shortened to TEP, gives tight ends extra points per catch on top of the league's normal reception value. A common setting is 1.5 points per reception, for tight ends only.",
          "The point is to make a position that historically produced two usable starters worth drafting. In TEP leagues the top tight ends jump several rounds, and the stream-and-pray approach that survives in PPR stops working.",
        ],
        link: {
          href: "/rankings/redraft-ppr-tep",
          label: "See TE Premium rankings",
        },
      },
      {
        id: "bonus-scoring",
        term: "Bonus scoring",
        body: [
          "A bonus is extra points for clearing a threshold in one game, most often 100 rushing or receiving yards, 300 passing yards, or a long touchdown.",
          "Bonuses reward big games over steady ones, so they quietly favor boom players over the reliable 70-yard grinder. Read the exact thresholds before deciding a bonus changes anything: a 3-point century bonus matters, a 0.5-point one does not.",
        ],
      },
      {
        id: "decimal-scoring",
        term: "Decimal scoring",
        body: [
          "Decimal scoring counts fractions of a yard instead of rounding, so 87 rushing yards scores 8.7 points rather than 8.",
          "It exists almost entirely to prevent ties. Beyond that it has no strategic effect, it just makes your weekly margin read as 121.46 to 118.92.",
        ],
      },
      {
        id: "points-per-game",
        term: "Points per game",
        aka: "PPG, PPR/G",
        body: [
          "Points per game is a player's average score across the games he actually played, rather than a season total.",
          "Totals punish anyone who missed time for a reason that may never repeat. Per-game numbers put a receiver who played 11 weeks next to one who played 17 on the same footing, which is usually the comparison you wanted.",
        ],
      },
    ],
  },
  {
    id: "formats",
    title: "League formats",
    navLabel: "League formats",
    intro:
      "Scoring sets what a play is worth. The format sets what a roster is worth, and for how long you get to keep it.",
    terms: [
      {
        id: "redraft",
        term: "Redraft",
        body: [
          "Redraft is the classic format: everyone drafts a brand new team each season and keeps nobody from last year.",
          "Because a roster only has to survive one season, value is entirely about production right now. A 31-year-old on a good offense and a 22-year-old rookie are worth what they will score this fall and nothing else. Most casual leagues are redraft.",
        ],
      },
      {
        id: "dynasty",
        term: "Dynasty",
        body: [
          "In a dynasty league you keep your whole roster from year to year and draft only incoming rookies each offseason.",
          "That changes the math on everyone. A 23-year-old with three ascending seasons ahead of him can be worth more than a 30-year-old who will outscore him this year, and future rookie picks become real assets you can trade. Dynasty and redraft values differ enough that we rank them separately.",
        ],
        link: {
          href: "/rankings/dynasty-ppr-sflex",
          label: "See dynasty superflex rankings",
        },
      },
      {
        id: "keeper-league",
        term: "Keeper league",
        body: [
          "A keeper league sits between redraft and dynasty: you hold a small number of players from last season, usually one to four, and redraft everything else.",
          "Almost every keeper rule attaches a cost, like surrendering the round where you originally drafted the player. That cost is the whole game. A late-round pick who broke out is a keeper. A first-rounder who met expectations usually is not.",
        ],
      },
      {
        id: "best-ball",
        term: "Best Ball",
        body: [
          "Best Ball is a format with no weekly lineup decisions. You draft a team, and each week the platform automatically counts your highest scorers at each position.",
          "There are no waivers, no trades, and no benching the guy who then goes for 30. Since you cannot correct a mistake in-season, the draft carries more weight, and boom players who post three enormous weeks are worth more here than anywhere else.",
        ],
        link: {
          href: "/rankings/bestball-ppr-std",
          label: "See best ball rankings",
        },
      },
      {
        id: "superflex",
        term: "Superflex",
        aka: "SF",
        body: [
          "Superflex is a lineup slot that accepts a quarterback in addition to the usual running back, receiver, and tight end.",
          "Since nearly everyone fills it with a quarterback, most teams start two, and quarterback value climbs dramatically. If a set of rankings looks wrong to you, checking whether you are in a superflex league is the first thing to rule out. It is the largest single swing in fantasy valuation.",
        ],
        link: {
          href: "/rankings/dynasty-ppr-sflex",
          label: "See superflex rankings",
        },
      },
      {
        id: "2qb",
        term: "2QB",
        body: [
          "A 2QB league requires two starting quarterbacks with no option to fill the slot any other way.",
          "It behaves like superflex, only harder. In a 12-team 2QB league, 24 of roughly 32 starting quarterbacks are locked into lineups every week, so the position runs dry almost immediately.",
        ],
      },
      {
        id: "idp",
        term: "IDP",
        aka: "Individual Defensive Player",
        body: [
          "IDP leagues start real defensive players, linebackers, defensive backs, and linemen, instead of or alongside a single team defense.",
          "Tackles, sacks, and interceptions score. Linebackers who play every snap and live near the ball dominate most IDP scoring the same way a workhorse running back dominates offense.",
        ],
      },
      {
        id: "devy",
        term: "Devy",
        body: [
          "Devy, short for developmental, means you can roster college players before they ever reach the NFL.",
          "It is dynasty with a longer runway and considerably more homework. Devy rosters carry players who are two or three years away from scoring you a single point.",
        ],
      },
      {
        id: "auction-league",
        term: "Auction draft",
        body: [
          "In an auction draft nobody picks in order. Every manager gets the same budget, players are nominated one at a time, and the highest bidder gets them.",
          "It removes draft slot luck entirely. If you want the best player in the pool you can have him, you just have to pay for him. The skill is tracking who still has money and who is out.",
        ],
      },
      {
        id: "contract-league",
        term: "Salary cap league",
        aka: "contract league",
        body: [
          "A salary cap or contract league assigns players multi-year deals with a yearly cost charged against a team budget.",
          "You are weighing three things instead of one: talent, price, and how many years you are locked in. A very good player on a bad contract can be a genuine liability, which never happens in any other format.",
        ],
      },
      {
        id: "guillotine-league",
        term: "Guillotine league",
        aka: "chop league",
        body: [
          "In a guillotine league the lowest-scoring team each week is eliminated and its entire roster returns to the waiver pool, until one manager is left.",
          "There is no bad week you can absorb. Every eliminated roster floods the wire with startable players, so the format ends up being about managing waiver budget as much as drafting.",
        ],
      },
      {
        id: "orphan",
        term: "Orphan",
        body: [
          "An orphan is a team left behind when a manager quits a dynasty league mid-stream, taken over by someone new.",
          "Orphans are often free or discounted, and the roster is whatever the last manager built, good or bad. Taking a strong one is the cheapest way into an established league.",
        ],
      },
      {
        id: "commissioner",
        term: "Commissioner",
        body: [
          "The commissioner is the manager who runs a league: settings, scheduling, trade disputes, and dues.",
          "On FF Beacon, a league's commissioner (matched by Sleeper username) can force a refresh of that league's synced data, the same as a site admin.",
        ],
      },
    ],
  },
  {
    id: "roster",
    title: "Roster and lineup",
    navLabel: "Roster and lineup",
    intro:
      "These are the slots, labels, and abbreviations you will meet on a lineup screen, and the two or three that decide most weeks.",
    terms: [
      {
        id: "starting-lineup",
        term: "Starting lineup",
        body: [
          "Your starting lineup is the set of players whose scores actually count in a given week. Everyone else sits on your bench scoring nothing for you.",
          "Trace enough fantasy losses back far enough and most of them are a lineup decision rather than a draft one.",
        ],
      },
      {
        id: "flex",
        term: "FLEX",
        body: [
          "A flex is a lineup slot that accepts more than one position. The standard flex takes a running back, wide receiver, or tight end.",
          "Leagues vary the recipe: a WR/TE flex, a superflex that adds quarterbacks, or a second and third flex in deeper setups. Read the slot before you draft, because a league with two flexes needs a very different roster than one with none.",
        ],
      },
      {
        id: "bench",
        term: "Bench",
        body: [
          "The bench is roster space for players you are not starting: injured players, bye weeks, backups, and lottery tickets.",
          "Bench size quietly sets a league's difficulty. Deep benches let managers hoard handcuffs and prospects. Short benches force a real decision every single week.",
        ],
      },
      {
        id: "bye-week",
        term: "Bye week",
        body: [
          "A bye week is the one week each NFL team does not play. Every player on that team scores zero.",
          "Byes run from roughly week 5 through week 14. It is the most predictable problem in fantasy football and still the one most often discovered at 12:55 on a Sunday.",
        ],
      },
      {
        id: "ir-slot",
        term: "IR slot",
        aka: "injured reserve slot",
        body: [
          "An IR slot is roster space that holds an injured player without counting against your active roster limit.",
          "Leagues differ on which injury designations qualify, and most block you from starting anyone parked there. It is free roster space, so using it when you are eligible is close to automatic.",
        ],
      },
      {
        id: "taxi-squad",
        term: "Taxi squad",
        body: [
          "A taxi squad is dynasty roster space reserved for young developmental players, usually rookies and second-year players, who do not count against your active roster limit.",
          "Players on the taxi squad cannot be started until you promote them. Eligibility rules and whether rivals can poach an unprotected player vary a lot by league, so read yours before you stash anyone.",
        ],
      },
      {
        id: "handcuff",
        term: "Handcuff",
        body: [
          "A handcuff is the backup who would inherit a starter's workload if that starter got hurt, most often the running back directly behind a lead back.",
          "Rostering your own star's handcuff protects the investment. Rostering someone else's is a bet on their bad luck, and in a league where one back carries a team it can be worth the bench spot.",
        ],
      },
      {
        id: "depth-chart",
        term: "Depth chart",
        body: [
          "A depth chart is a team's internal pecking order at each position, from starter down through the backups.",
          "It is the fastest read on opportunity there is. A talented receiver sitting behind two established starters may never see the field enough to matter, and talent alone does not fix that.",
        ],
      },
      {
        id: "dst",
        term: "D/ST",
        aka: "team defense, DEF",
        body: [
          "D/ST is a single roster spot representing an entire team's defense and special teams, scoring on sacks, turnovers, return touchdowns, and points allowed.",
          "Defensive scoring swings hard week to week and depends heavily on the offense across from it, which is why streaming defenses by matchup usually beats holding one all season.",
        ],
      },
      {
        id: "kicker",
        term: "Kicker",
        aka: "K",
        body: [
          "A kicker scores on field goals and extra points, usually with more points awarded for longer field goals.",
          "Week-to-week kicker performance is close to unpredictable, and the honest advice has not changed in twenty years: spend your last pick here and move on.",
        ],
      },
      {
        id: "free-agent",
        term: "Free agent",
        aka: "FA",
        body: [
          "A free agent is a player nobody in your league rosters. In a player list, FA can also mean the player currently has no NFL team.",
          "Both meanings show up on the same screen, so read the context around the label.",
        ],
      },
      {
        id: "streaming",
        term: "Streaming",
        body: [
          "Streaming is picking up a different player at the same position every week based on matchup, instead of holding one starter all season.",
          "It is standard practice at defense and kicker, and it works at quarterback and tight end in leagues where the wire stays deep. The cost is a roster spot you churn constantly.",
        ],
      },
    ],
  },
  {
    id: "drafting",
    title: "Drafting",
    navLabel: "Drafting",
    intro:
      "Draft season is where most of the jargon lives. Here is what each term actually describes.",
    terms: [
      {
        id: "adp",
        term: "ADP",
        aka: "Average Draft Position",
        body: [
          "ADP stands for Average Draft Position: where a player is being taken, on average, across a large sample of real drafts.",
          "ADP measures market consensus rather than talent, which makes it useful for two separate jobs. It tells you roughly when you would have to draft someone, and it shows you the gap between where a player goes and where you have him ranked.",
        ],
      },
      {
        id: "snake-draft",
        term: "Snake draft",
        body: [
          "In a snake draft the pick order reverses every round, so picking 3rd in round one means picking 10th in round two of a 12-team league.",
          "Everyone ends up with roughly equal total draft capital, which is the entire point of the design.",
        ],
      },
      {
        id: "the-turn",
        term: "The turn",
        body: [
          "The turn is the pair of back-to-back picks a manager gets at the end of one round and the start of the next.",
          "Drafting at the turn means long waits followed by two picks at once. It rewards taking two players from the same tier rather than reaching for the one guy you had circled.",
        ],
      },
      {
        id: "third-round-reversal",
        term: "Third-round reversal",
        aka: "3RR",
        body: [
          "A third-round reversal is a snake draft variant where round three repeats round two's order instead of flipping back.",
          "It exists to soften the edge held by the first overall pick, which in a normal snake is the most valuable slot on the board by a clear margin.",
        ],
      },
      {
        id: "startup-draft",
        term: "Startup draft",
        body: [
          "A startup draft is the one-time draft that seeds a new dynasty league, covering every available NFL player.",
          "After it, the league only runs rookie drafts. It is the biggest event in a dynasty league's life, and the rosters built there tend to shape it for years.",
        ],
      },
      {
        id: "rookie-draft",
        term: "Rookie draft",
        body: [
          "A rookie draft is the annual dynasty draft covering only incoming NFL rookies, usually three to five rounds long.",
          "Pick order normally runs in reverse standings order. Because it is the only way new talent enters a dynasty league, rookie picks trade like currency all year.",
        ],
      },
      {
        id: "draft-capital",
        term: "Draft capital",
        body: [
          "Draft capital describes how highly the NFL itself invested in a player. A first-round pick carries more of it than a fifth-rounder.",
          "It matters for fantasy because teams give expensive players opportunity. A high pick who struggles early usually gets another chance. A seventh-rounder in the same spot gets cut.",
        ],
      },
      {
        id: "zero-rb",
        term: "Zero RB",
        body: [
          "Zero RB is a draft approach that skips running backs early, loads up on receivers and an elite tight end or quarterback, and takes running back swings late.",
          "It rests on two observations: running backs get hurt at high rates, and usable replacements emerge on waivers every season. It also requires you to actually work the wire, which is why it fails for managers who draft and disappear.",
        ],
      },
      {
        id: "hero-rb",
        term: "Hero RB",
        body: [
          "Hero RB takes one elite running back early, then ignores the position for many rounds while stacking receivers.",
          "It is the middle ground between Zero RB and loading up on backs, and it is the most common shape a modern draft ends up taking.",
        ],
      },
      {
        id: "robust-rb",
        term: "Robust RB",
        body: [
          "Robust RB spends the first two or three picks on running backs, betting that scarcity at the position will make them worth more as the season goes on.",
          "It is the oldest strategy in fantasy football and still perfectly viable, particularly in leagues that award no points for receptions.",
        ],
      },
      {
        id: "late-round-qb",
        term: "Late-round QB",
        body: [
          "Late-round QB means deliberately waiting on quarterback in a single-QB league and taking one near the end of the draft.",
          "It works because a single-QB league starts 12 quarterbacks out of 32, so the gap between the 5th and 15th best is small next to the same gap at running back. None of this carries over to superflex, where the opposite is true.",
        ],
      },
      {
        id: "vbd",
        term: "Value based drafting",
        aka: "VBD",
        body: [
          "Value based drafting scores a player by how far he is projected to beat a replacement-level player at his own position, rather than by his raw projected points.",
          "The idea is that 300 points from a quarterback is not comparable to 300 points from a tight end until you know what you would have gotten instead. This reasoning sits underneath almost every modern ranking, ours included.",
        ],
      },
      {
        id: "tier",
        term: "Tier",
        body: [
          "A tier is a group of players close enough in value to be roughly interchangeable, labeled T1, T2, and so on.",
          "Tiers are more useful than ranks during a live draft. If three players share a tier and two will still be there next round, take the position you cannot fill later. The gap between tiers matters far more than the gap inside one.",
        ],
        link: { href: "/rankings", label: "See tiers on the rankings board" },
      },
      {
        id: "reach",
        term: "Reach",
        body: [
          "A reach is taking a player well ahead of his ADP.",
          "It is not automatically a mistake. Going a round early on someone you rate highly is fine. Going three rounds early on a player nobody else wanted is how you end up thin everywhere.",
        ],
      },
      {
        id: "sleeper-player",
        term: "Sleeper",
        body: [
          "A sleeper is a player you expect to substantially outperform his draft cost.",
          "By August the word gets pinned on everyone, which drains it of meaning. A real sleeper has a path to volume the market has not priced in yet, not just a name you like.",
        ],
      },
      {
        id: "bust",
        term: "Bust",
        body: [
          "A bust is a player whose production falls well short of what he cost to draft.",
          "Busts come from one of three places: injury, a role that shrank, or efficiency from last season that was never going to repeat. The last one is the hardest to see coming and the easiest to check for.",
        ],
      },
      {
        id: "breakout",
        term: "Breakout",
        body: [
          "A breakout is the season a player jumps from a minor role to a genuinely startable one.",
          "Breakouts are usually opportunity stories before they are talent stories. Somebody ahead of the player left, got hurt, or lost the job.",
        ],
      },
      {
        id: "mock-draft",
        term: "Mock draft",
        body: [
          "A mock draft is a practice draft that does not count, run against other people or against a computer.",
          "The value is not the roster you end up with. It is learning where players are actually going, so nothing surprises you on the real day.",
        ],
      },
    ],
  },
  {
    id: "in-season",
    title: "In-season management",
    navLabel: "In-season",
    intro:
      "Drafts get the attention. Seasons get decided here, on the wire and in the standings.",
    terms: [
      {
        id: "waiver-wire",
        term: "Waiver wire",
        body: [
          "The waiver wire is the pool of players nobody in your league rosters, plus the process for claiming them.",
          "Rather than first-come first-served, most leagues hold claims until a set processing time (Wednesday morning is common) and settle competing claims by priority or by bid.",
        ],
      },
      {
        id: "waiver-priority",
        term: "Waiver priority",
        body: [
          "Waiver priority is a ranked order deciding who wins a contested claim, usually starting in reverse standings order.",
          "In most setups, using your priority sends you to the back of the line. So the decision is never only about the player, it is about whether he is worth your spot in the queue.",
        ],
      },
      {
        id: "faab",
        term: "FAAB",
        aka: "Free Agent Acquisition Budget",
        body: [
          "FAAB stands for Free Agent Acquisition Budget: a fixed pot of fake money, often 100 dollars, that each manager spends bidding on waiver players across an entire season.",
          "Bids are blind, so you are reading the room as much as valuing the player. FAAB hands you full control over who you win, at the cost of budgeting for a season you cannot see yet.",
        ],
        link: { href: "/tools/faab", label: "Set a bid with the FAAB Calculator" },
      },
      {
        id: "blind-bid",
        term: "Blind bid",
        body: [
          "A blind bid is a waiver claim where nobody sees anyone else's offer until claims process.",
          "It is why FAAB feels like poker. Winning by 40 dollars is still a win you overpaid for, and you only find out afterward.",
        ],
      },
      {
        id: "trade-deadline",
        term: "Trade deadline",
        body: [
          "The trade deadline is the last date your league allows trades, typically somewhere between week 10 and week 13.",
          "It concentrates activity. Contenders pay up in the final week before it, and rebuilding teams hold their maximum leverage right until it passes.",
        ],
      },
      {
        id: "veto",
        term: "Veto",
        body: [
          "A veto is the mechanism for cancelling a completed trade, either by a league vote or by the commissioner.",
          "Most leagues that use vetoes end up regretting them. A veto belongs to evidence of collusion, not to a trade that looks lopsided to someone who was not in the negotiation.",
        ],
      },
      {
        id: "collusion",
        term: "Collusion",
        body: [
          "Collusion is two managers cooperating to benefit one team, most often through a deliberately lopsided trade.",
          "It is the one thing that genuinely breaks a league. It is also the accusation most often thrown at a trade that was only ever a disagreement about player value.",
        ],
      },
      {
        id: "tanking",
        term: "Tanking",
        body: [
          "Tanking is deliberately losing games to improve your draft position.",
          "In dynasty it is a legitimate, openly discussed strategy, because a rebuilding team wants the 1.01. In redraft, where everyone starts fresh anyway, it reads as quitting and most leagues treat it that way.",
        ],
      },
      {
        id: "points-for-against",
        term: "Points for and points against",
        aka: "PF, PA",
        body: [
          "Points for is how many fantasy points your team has scored. Points against is how many your weekly opponents have scored on you.",
          "The pair explains most records that feel unfair. A team can lead the league in points for and sit at 4-6 because its opponents kept posting their best week of the season against it.",
        ],
      },
      {
        id: "roster-lock",
        term: "Lock",
        body: [
          "A lock is the moment a player can no longer be moved into or out of your lineup, normally when his game kicks off.",
          "Leagues either lock players individually at kickoff or freeze the whole lineup at the first game of the week. Which one yours uses decides how late you can react to inactives.",
        ],
      },
      {
        id: "consolation-bracket",
        term: "Consolation bracket",
        body: [
          "A consolation bracket is the side playoff for teams that missed the real one.",
          "It exists to keep eliminated managers setting lineups. In dynasty leagues it often carries a genuine prize: rookie draft position.",
        ],
      },
    ],
  },
  {
    id: "trades",
    title: "Trades and player value",
    navLabel: "Trades and value",
    intro:
      "Trade talk runs on a shared vocabulary of value. Most disagreements about a trade are really disagreements about one of these words.",
    terms: [
      {
        id: "player-value",
        term: "Player value",
        body: [
          "A player's value is a single number representing what he is worth in trades and rankings for one specific scoring format.",
          "It is a market read rather than a points projection: what the fantasy community, or a model, would pay. A value quoted without its format attached is incomplete, since the same tight end is worth two different numbers in PPR and TE Premium.",
        ],
        link: { href: "/rankings", label: "See values on the rankings board" },
      },
      {
        id: "trade-calculator",
        term: "Trade calculator",
        body: [
          "A trade calculator adds up the value on both sides of a proposed deal and reports which side comes out ahead.",
          "Treat the output as a starting point rather than a ruling. A calculator does not know you are already two starters deep at the position you are trading away.",
        ],
        link: { href: "/tools/signal-check", label: "Grade a trade with Signal Check" },
      },
      {
        id: "buy-low",
        term: "Buy low",
        body: [
          "Buying low is trading for a player while his perceived value is depressed, usually after an injury, a slow start, or a few quiet games.",
          "It only works when you have a reason to believe the drop is temporary. Buying low on a player whose role genuinely shrank is just buying.",
        ],
      },
      {
        id: "sell-high",
        term: "Sell high",
        body: [
          "Selling high is trading a player away at a peak, right after a run of production you do not believe he can sustain.",
          "The uncomfortable part is that it always feels early. If a sell-high trade feels comfortable to make, the window has usually already shut.",
        ],
      },
      {
        id: "consolidation",
        term: "Consolidation",
        aka: "2-for-1",
        body: [
          "Consolidation is trading two or more good players for one better one, shrinking your roster to raise its top end.",
          "It works because you can only start so many players. Two RB2s on your bench are worth less to you than one RB1 in your lineup, even when a calculator says the totals match.",
        ],
      },
      {
        id: "positional-scarcity",
        term: "Positional scarcity",
        body: [
          "Positional scarcity is how sharply quality drops off at a position once the top players are gone.",
          "It is why a tight end can be worth a first-round pick in one league and be droppable in another. Scarcity comes from the lineup rules, not from the players.",
        ],
      },
      {
        id: "win-now",
        term: "Win-now",
        body: [
          "A win-now move trades future value, meaning young players and rookie picks, for production this season.",
          "It is right for a roster already in contention and wrong for one that is a year away. Telling those two apart on your own team is the hardest honest read in dynasty.",
        ],
      },
      {
        id: "rebuild",
        term: "Rebuild",
        body: [
          "A rebuild is deliberately trading productive veterans for youth and picks, accepting a bad season or two to be strong later.",
          "A real rebuild has an end date. Collecting picks forever and never cashing them in is not a rebuild, it is a hobby.",
        ],
      },
      {
        id: "contending",
        term: "Contending",
        body: [
          "A contending team is one good enough to win the title this season, which is the roster that should be buying.",
          "Most managers overrate where they sit. The check is blunt: count how many of your starters would start on the best team in your league.",
        ],
      },
      {
        id: "draft-pick-value",
        term: "Draft pick value",
        body: [
          "In dynasty, future rookie picks are tradable assets with their own value, quoted by season and round.",
          "An unknown 2028 first is worth less than a known one, because a pick firms up in value as you learn which team it will come from. FF Beacon values picks by season, round, and rough slot.",
        ],
      },
      {
        id: "value-margin",
        term: "Value margin",
        body: [
          "The value margin is how lopsided a trade is, shown as the value gap between the two sides and a percentage.",
          "A small margin reads as roughly even. A large one means one side clearly came out ahead, at least according to the values doing the measuring.",
        ],
      },
      {
        id: "overpay",
        term: "Overpay",
        body: [
          "An overpay is knowingly paying above market rate to land one specific player.",
          "It is not always wrong. If a player fills the single hole between you and a title, a 10 percent overpay is cheap. Overpaying for depth you will never start is not.",
        ],
      },
    ],
  },
  {
    id: "analytics",
    title: "Stats and analytics",
    navLabel: "Stats and analytics",
    intro:
      "This is the vocabulary that turns a hunch into a read. None of it needs math beyond a percentage, and every one of these travels fine as text.",
    terms: [
      {
        id: "target-share",
        term: "Target share",
        body: [
          "Target share is the percentage of a team's passing targets that go to one player.",
          "A high, steady target share is one of the better signals that a pass catcher's production is real rather than a one-week fluke. Around 25 percent marks a clear number one option. Above 30 percent is a genuine focal point of the offense.",
        ],
      },
      {
        id: "snap-share",
        term: "Snap share",
        aka: "snap rate, snap count",
        body: [
          "Snap share is the percentage of his team's offensive plays a player is on the field for.",
          "It answers the most basic question about a player: is he actually out there. A receiver playing 85 percent of snaps has a path to production even in a quiet week. One playing 40 percent does not, whatever he did last Sunday.",
        ],
      },
      {
        id: "yards-per-route-run",
        term: "Yards per route run",
        aka: "YPRR",
        body: [
          "Yards per route run measures receiving yards gained per pass route, counting every route rather than only the plays where the player was targeted.",
          "It rewards players who are efficient on every snap, which is how it surfaces a productive receiver before the raw totals catch up. Above 2.0 is very good. Above 2.5 is elite.",
        ],
      },
      {
        id: "air-yards",
        term: "Air yards",
        body: [
          "Air yards are the distance a pass travels in the air toward a receiver, counted whether the ball is caught or not.",
          "Because they accumulate on incompletions too, air yards show intent. A receiver with high air yards and low production has been getting looked at downfield and missing, and that tends to correct.",
        ],
      },
      {
        id: "adot",
        term: "aDOT",
        aka: "average depth of target",
        body: [
          "aDOT is the average distance downfield at which a player is targeted.",
          "It sorts pass catchers into roles at a glance. A 6-yard aDOT is a checkdown and slot profile that lives on volume. A 14-yard aDOT is a deep threat whose weekly scores will swing hard in both directions.",
        ],
      },
      {
        id: "red-zone-share",
        term: "Red zone share",
        body: [
          "Red zone share is the percentage of a team's carries or targets inside the opponent's 20-yard line that go to one player.",
          "Touchdowns are the loudest and least predictable part of fantasy scoring, and red zone share is the closest thing there is to a leading indicator for them.",
        ],
      },
      {
        id: "opportunity-share",
        term: "Opportunity share",
        aka: "touch share",
        body: [
          "Opportunity share is the percentage of a team's carries plus targets that go to one player.",
          "For running backs it is the number that matters most. Talent decides what a back does with a touch. Opportunity share decides how many he gets, and that moves fantasy scores harder.",
        ],
      },
      {
        id: "expected-fantasy-points",
        term: "Expected fantasy points",
        body: [
          "Expected fantasy points estimate what a player's usage should have produced, based on the historical value of each carry and target he received rather than what actually happened.",
          "Comparing expected points to real points separates a player being used well from one who has been lucky. Large gaps in either direction usually close.",
        ],
      },
      {
        id: "floor-ceiling",
        term: "Floor and ceiling",
        body: [
          "A player's floor is his realistic bad week. His ceiling is his realistic best week.",
          "High-floor players are volume-driven and safe. High-ceiling players are big-play dependent and streaky. Which one you want this week depends entirely on whether you are favored.",
        ],
      },
      {
        id: "boom-bust",
        term: "Boom and bust",
        body: [
          "A boom week is a score far above a player's average, a bust week is far below it, and a boom-bust player produces both regularly with little in between.",
          "The label describes distribution, not quality. Two players can average identical points with completely different week-to-week shapes.",
        ],
      },
      {
        id: "regression",
        term: "Regression",
        body: [
          "Regression means an unusual result drifting back toward its normal level over time.",
          "It is the most misused word in fantasy football. It does not mean a good player is about to get worse. It means an unsustainable rate, a 15 percent touchdown rate or a 78 percent catch rate on deep targets, probably will not hold, in either direction.",
        ],
      },
      {
        id: "efficiency",
        term: "Efficiency",
        body: [
          "Efficiency is production per opportunity: yards per carry, yards per target, points per touch.",
          "Efficiency is noisy in small samples and swings hard on a couple of long plays. Volume is far more stable, which is why usage metrics predict the future better than efficiency ones do.",
        ],
      },
      {
        id: "strength-of-schedule",
        term: "Strength of schedule",
        aka: "SOS",
        body: [
          "Strength of schedule measures how difficult a player's or team's upcoming opponents are.",
          "It is worth more at some positions than others, and it matters most across the fantasy playoff weeks. A season-long SOS number averages away the three weeks you actually needed to know about.",
        ],
      },
      {
        id: "defense-vs-position",
        term: "Defense versus position",
        aka: "DVP",
        body: [
          "Defense versus position measures how many fantasy points a defense allows to one specific position rather than overall.",
          "A defense can be excellent against the run and leaky against tight ends. An overall ranking hides that. DVP is what you check before starting a matchup-dependent player.",
        ],
      },
      {
        id: "positional-finish",
        term: "Positional finish",
        body: [
          "A positional finish is where a player ended a past season within his own position, written as WR4 or RB12.",
          "Unlike a current rank it looks backward at real results. It tells you how a player has performed, not how he is projected.",
        ],
      },
      {
        id: "usage",
        term: "Usage",
        body: [
          "Usage is the umbrella term for how a player is deployed: snaps, routes, carries, targets, and where on the field they come from.",
          "When an analyst says the usage is encouraging but the production is not, they mean the opportunity is already there and the results should follow. That is usually a buy signal.",
        ],
      },
    ],
  },
  {
    id: "status",
    title: "Injuries and player status",
    navLabel: "Injuries and status",
    intro:
      "Status language comes from the NFL's own reporting rules, and it is more precise than it looks from the outside.",
    terms: [
      {
        id: "injury-designations",
        term: "Questionable, doubtful, out",
        body: [
          "These are the NFL's official game status designations. Questionable is listed as roughly a 50-50 chance to play, doubtful means unlikely, and out means the player will not play.",
          "In practice, questionable is a coin flip in name only. Beat reporters and Friday practice participation tell you far more than the label does.",
        ],
      },
      {
        id: "injured-reserve",
        term: "Injured reserve",
        aka: "IR",
        body: [
          "Injured reserve is the NFL list for players who will miss extended time. A player placed on it misses at least four games, and in some cases the rest of the season.",
          "Fantasy platforms mirror the designation with their own IR roster slot, but the eligibility rules there are set by your league, not by the NFL.",
        ],
      },
      {
        id: "pup",
        term: "PUP",
        aka: "physically unable to perform",
        body: [
          "PUP is the designation for a player who arrives at training camp still injured from a prior season.",
          "A player on the preseason PUP list can practice and come off it at any point. One who starts the regular season on PUP has to miss at least the first four games.",
        ],
      },
      {
        id: "practice-squad",
        term: "Practice squad",
        body: [
          "The practice squad is a group of players who practice with an NFL team but are not on the active roster and cannot play unless they are elevated.",
          "For fantasy purposes they matter as a signal. An elevation two weeks running usually means a real role is coming.",
        ],
      },
      {
        id: "game-time-decision",
        term: "Game-time decision",
        body: [
          "A game-time decision is a player whose availability will not be settled until pregame warmups.",
          "It is the worst thing that can happen to a lineup, because inactives post about 90 minutes before kickoff. The habit that saves you is having the replacement already rostered, not scrambling at 12:58.",
        ],
      },
      {
        id: "snap-count-report",
        term: "Snap count report",
        body: [
          "A snap count report lists how many plays each player was on the field for in a given game.",
          "It is the least glamorous and most useful thing you can read on a Tuesday. A quiet stat line paired with a jump in snaps is often the last cheap week to acquire someone.",
        ],
      },
      {
        id: "holdout",
        term: "Holdout",
        body: [
          "A holdout is a player skipping mandatory team activities, almost always over a contract.",
          "Holdouts rarely cost regular season games anymore, but a player who misses a full training camp often starts the year slowly.",
        ],
      },
      {
        id: "suspension",
        term: "Suspension",
        body: [
          "A suspension is a league-imposed ban for a set number of games.",
          "Suspensions are predictable absences, which is what makes them different from injuries. In dynasty, a suspended player is frequently the cleanest buy-low window you will get all year.",
        ],
      },
    ],
  },
  {
    id: "ff-beacon",
    title: "Terms you will only see on FF Beacon",
    navLabel: "FF Beacon terms",
    intro:
      "A few labels on this site are ours. Here is what each one means and where it shows up.",
    terms: [
      {
        id: "format-setting",
        term: "Format",
        body: [
          "Your format is the scoring and league setup the whole site uses for you, something like Dynasty PPR Superflex.",
          "Set it once from the site header and every ranking, value, and tool follows it. Inside a synced Sleeper league we ignore that setting on purpose and read the format from that league's own scoring rules instead.",
        ],
      },
      {
        id: "data-source",
        term: "Data source",
        body: [
          "A data source is where a set of rankings comes from. We publish our own FF Beacon value and also carry other trusted sources so you can compare them side by side.",
          "Different sources rank the same player differently, and the disagreement is itself information. The strip near the top of any rankings page names which source you are currently reading.",
        ],
        link: { href: "/rankings", label: "Compare sources on the rankings board" },
      },
      {
        id: "ff-beacon-value",
        term: "FF Beacon value",
        body: [
          "The FF Beacon value is our own number for what a player is worth, built from a proprietary model, AI-assisted analytics, and a human read from me and the team.",
          "It sits alongside the outside sources rather than replacing them. When ours and theirs disagree sharply on a player, that gap is worth a look before you trade him.",
        ],
      },
      {
        id: "overall-positional-rank",
        term: "Overall rank and positional rank",
        body: [
          "Overall rank is a player's spot across every position. Positional rank is his spot within his own position, written as RB1 or WR5.",
          "Both stay visible on the rankings board at the same time, so filtering down to one position never hides the other number from you.",
        ],
      },
      {
        id: "rank-7d-value-7d",
        term: "Rank 7d and Value 7d",
        body: [
          "Rank 7d is how many ranking spots a player has moved over the last seven days. Value 7d is how much his value has changed across the same window, as a percentage.",
          "A dash instead of an arrow means we do not yet have enough history at both ends of that window to measure a real move, so we say so rather than guess.",
        ],
      },
      {
        id: "power-rankings",
        term: "Power rankings",
        body: [
          "Power rankings sort the teams in a league by the total value of their rosters rather than by record.",
          "A team can be 6-2 and rank fifth because it has been winning close games with a thin roster. It is a read on who is built to win, not on who has already won.",
        ],
      },
      {
        id: "power-pulse",
        term: "Power Pulse",
        body: [
          "Power Pulse answers a different question: how many games should this team win from here. Every team in a league gets a score from 1 to 99, ranked against the other teams in that same league.",
          "It starts from weekly projections rescored under your league's own scoring settings, adjusts for the defenses each player faces, for injuries, and for whether that player tends to beat or miss his own projections, then plays the rest of the season out thousands of times. Draft picks are excluded on purpose, because a 2028 first cannot start for you in week 4.",
        ],
        link: { href: "/tools/league-pulse", label: "Read a league with League Pulse" },
      },
      {
        id: "beacon-verdict",
        term: "Beacon Verdict",
        body: [
          "The Beacon Verdict is the plain-English call our trade analyzer returns: who wins a trade, by how much, and why.",
          "It reads values for your exact scoring format rather than a generic one, and it reports its own confidence so you know when a draft pick estimate is doing the heavy lifting.",
        ],
        link: { href: "/tools/signal-check", label: "Get a verdict on your trade" },
      },
      {
        id: "signal-guide",
        term: "Signal Guide",
        body: [
          "The Signal Guide is the help panel built into the site. On any page it explains the terms and numbers on that specific page.",
          "This glossary is the long version. The Signal Guide is the version that turns up exactly where you needed it, and you can send us a question from it if something is still unclear.",
        ],
      },
      {
        id: "confidence",
        term: "Confidence",
        body: [
          "Confidence, rated high, medium, or low, tells you how sure a grade or verdict is, based on how complete the underlying value data was.",
          "Low confidence usually means a draft pick estimate or a missing value softened the result. Treat it as a flag to check the inputs, not a reason to throw the answer out.",
        ],
      },
    ],
  },
];

/** Every term across every section, flattened. */
export const ALL_TERMS: GlossaryTerm[] = GLOSSARY_SECTIONS.flatMap(
  (s) => s.terms,
);

export const TERM_COUNT = ALL_TERMS.length;

/**
 * Questions asked in the exact words people type them, answered in full.
 *
 * These render as visible copy AND as schema.org FAQPage entries. Google requires
 * FAQ markup to describe question and answer text that is actually visible on the
 * page, so the two must stay identical; that is why they share this array. Each
 * answer is written to stand alone, because a snippet or an assistant will quote
 * it without the question or anything around it.
 */
export type GlossaryFaq = { question: string; answer: string };

export const GLOSSARY_FAQS: GlossaryFaq[] = [
  {
    question: "What does PPR mean in fantasy football?",
    answer:
      "PPR stands for Points Per Reception. In a PPR league every catch is worth one fantasy point, on top of the normal points for yards and touchdowns. It raises the value of wide receivers, tight ends, and running backs who catch passes out of the backfield, and it is the most common scoring setting in fantasy football.",
  },
  {
    question: "What is the difference between PPR, half PPR, and standard scoring?",
    answer:
      "The three settings differ only in what a catch is worth. Full PPR gives one point per reception, half PPR gives half a point, and standard scoring gives nothing at all for a catch. Everything else, yardage and touchdowns, is normally identical. The further you move toward full PPR, the more valuable high-volume pass catchers become relative to touchdown-dependent runners.",
  },
  {
    question: "What is a superflex league in fantasy football?",
    answer:
      "A superflex league has a lineup slot that accepts a quarterback in addition to a running back, wide receiver, or tight end. Because nearly every manager fills that slot with a quarterback, most teams start two, and quarterback value rises sharply compared to a single-quarterback league. It is the single biggest swing in fantasy football player valuation, so it is worth confirming before you trust any ranking.",
  },
  {
    question: "What does FAAB stand for?",
    answer:
      "FAAB stands for Free Agent Acquisition Budget. It is a fixed pot of fake money, most commonly 100 dollars, that each manager spends across a whole season bidding on waiver wire players. Bids are blind, so nobody sees anyone else's offer until claims process, and the highest bid wins the player.",
  },
  {
    question: "What is the difference between dynasty and redraft fantasy football?",
    answer:
      "In redraft, every manager drafts a brand new team each season and keeps nobody from the year before. In dynasty, you keep your entire roster year to year and only draft incoming rookies each offseason. That difference changes what a player is worth: age and future production barely matter in redraft, while in dynasty a young ascending player can be worth more than an older one who will outscore him this season.",
  },
  {
    question: "What does ADP mean in fantasy football?",
    answer:
      "ADP stands for Average Draft Position, meaning where a player is being selected on average across a large sample of real drafts. ADP is a measure of market consensus rather than a ranking of talent. Managers use it to estimate when they would need to draft a player and to spot the gap between where the market takes someone and where their own rankings have him.",
  },
  {
    question: "What is a handcuff in fantasy football?",
    answer:
      "A handcuff is the backup who would inherit a starter's workload if that starter got injured, most often the running back directly behind a lead back. Managers roster their own star's handcuff to protect that investment, since one injury can otherwise wipe out a first-round pick's entire season of production.",
  },
  {
    question: "What is target share and why does it matter?",
    answer:
      "Target share is the percentage of a team's passing targets that go to one player. It matters because it measures opportunity rather than results, and opportunity is far more stable week to week than efficiency is. A receiver holding roughly 25 percent of his team's targets is a clear number one option, and a target share above 30 percent marks a genuine focal point of the offense.",
  },
  {
    question: "Do I need to know all of these terms to play fantasy football?",
    answer:
      "No. You can draft a team, set a lineup, and win a league knowing only your scoring format and your roster slots. The rest of this vocabulary exists so you can read what analysts write and understand why a ranking says what it says. Learn the scoring and format terms first, then pick up the analytics ones as they come up.",
  },
];
