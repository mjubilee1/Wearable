# Nearby: product decisions and ICP

Last updated Fri Oct 9, 2026. Paste this into Cursor as context. It covers decisions only, not instructions to change firmware.

## What Nearby is

A wearable that helps two strangers who opted in say hello in a room they already share. The clip shows a color, never a name. A name is shared only after both people choose to say hello.

## Product locks

- **Color is permission to speak.** It is not a name, a profile, or a biography.
- **No walk-by name.** A name can be searched and used to dox someone. Nothing stores a walk-by or a place history.
- **The wearer picks a mode before leaving: dating or networking.** Both clips go green only if the people are close **and** set to the same mode. If one person forgot, both stay dark.
- **The phone may remind** (for example, "you're at a networking event, switch?"). The clip never guesses a fallback mode.
- **One room at a time.** A dating color and a networking color in the same crowd is the wrong hello.
- **The phone compares interests in the background.** The other person still only sees the color.
- **If it lights up for everyone, the clip is broken.**
- **Rejected:** walk-by profiles (the Highlight model), name-first hellos, a camera, mood or health sensing, an on-clip chatbot, a press-to-talk AI pin, a personal log, and solo features that only fake daily use.

## Architecture

- BLE clip → phone → cloud. The clip doesn't need Wi-Fi.
- Board: Seeed XIAO nRF52840 with pins already soldered (part 102010631), not the Sense. 2 units. PlatformIO env `xiaoble`.
- Firmware is locked. Don't change it until the desk demo works.
  - Advertisement: manufacturer data `FF FF | N B | 4-byte FICR id`
  - Smoothed RSSI, LED bar, idle blue heartbeat
- Stage 1: the boards only know distance (RSSI). Comparing interests happens later, on the phone.
- Phone BLE: `react-native-ble-plx` in an Expo dev build, not Expo Go.
- The phone is the only BLE scanner. The website doesn't scan radios and must not use Web Bluetooth.
- The phone matches prefix `FF FF | N B | 4-byte id`. It doesn't connect or read GATT.
- The phone POSTs the clip id, smoothed RSSI, and a timestamp. No name and no interests.
- Green only when close enough **and** similar enough.
- The debug page shows clip id and RSSI only, never names.
- Live site: https://ascend-platform-fawn.vercel.app/ The signed-in match list still shows names, which breaks the privacy lock. Don't copy it.
- Won't fit on the clip: an LLM (about 1 MB flash, 256 KB RAM), a mic, a speaker, an IMU.

## Business model

- **The SaaS is the room, not the board.** Organizers pay. The clips are the light they hand out and get back to reuse.
- Organizer value: newcomers come back because they actually talked to someone. Send a report the morning after each event with how many people opted in, how many pairs went green, and how many said hello.
- Per-device sales don't work for groups. 20 to 200 people at $25 to $100 a clip is $500 to $20,000. Price it closer to a monthly or per-event fee with reused clips.
- Wearer value: a hello with someone you'll see again next week, without a stranger getting your name first. A friendship comes from repeat meetings, and a weekly room gives you those.
- The app is free for wearers on day one. A premium tier is optional later.
- Pricing (initial): retail $49 to $79 if a small-batch build costs about $12 to $25 per clip, and $89 to $129 for a pair pack. Montrell said he wouldn't pay $49 for the light alone, so don't treat $49 as validated. Don't go under $30 until manufacturing is real.

## Why others failed (and what Nearby does differently)

1. **The app showed the person** (Highlight at SXSW 2012). Nearby shows color only.
2. **Dating took over the friend use** (Grindr and Happn survived; Glancee, Highlight, aka-aki, and Sonar shut down or sold). Nearby uses a preset mode and both people have to match.
3. **The room was empty** (Lovegety shipped 350,000 units in 1998 and still beeped twice in three hours). Nearby starts with one group that meets every week.
- **CommonTies** (CSCW 2014/2016, "One LED is Enough") is the only case that worked: a whole conference wore one LED with no profile, and 74% of the interactions it started were called novel and useful. It never became a company. The untested part is a second event and a price.

## ICP

**Not** "100 people across DC." A city is not density. A place and a time is.

**The ICP is a tight group that already meets in the same place on a repeating schedule.**

Density observation (Mon Oct 5, about 7:30am, Arlington VA): quiet streets with dog walkers around 40 to 45, runners around 25 to 35, and a few young people walking to work with headphones in. Not enough people for a walk-by hello.

Role-play failure: a 24-year-old woman, one of 100 DC wearers who aren't a group. She met one other woman at a coffee shop two months after buying it, then left the device on her dresser.

### Top 3 rooms (Montrell's picks, Oct 9 2026)

1. **BlaBla DC**: language exchange, every Tuesday 7pm, Sudhouse, 1340 U St NW, walk-in. https://www.blablacommunity.com/events/blabla-dc
   - Why: match on purpose with someone practicing the same language and go deeper. Score: ok.
   - Fix: name the pain. You walk in, sit with whoever is near the door, and end up speaking English.
2. **DC LGBT Board Gamers**: Mondays 6 to 9pm, Western Market, 2000 Pennsylvania Ave NW. https://www.meetup.com/dc-lgbt-board-gamers/
   - Why: a newcomer doesn't have their name shown and meets another gamer naturally through the green light. Score: ok.
   - Fix: add who they meet, like a gamer who wants the same game tonight.
3. **Escala DC**: climbing, third Friday 7 to 9pm, DC Bouldering Project Eckington, 1611 Eckington Pl NE #150. https://www.escalaclimbing.org/washington-dc
   - Why: people already move around and change partners every session. Score: strong on fit.
   - Fix: add the moment. What does a first-timer do today when they don't know who to ask to climb with?

### Other candidates

| Group | Where and when | Note | Source |
|---|---|---|---|
| NoMa Run Club | Mon 6:45pm and Sat 8:30am at REI, 201 M St NE. Wed and Thu 6:45pm at Lost Generation Brewing, Metropolitan Branch Trail | Drop-in, open to anyone, so a stranger could leave with your name | https://nomarunclub.com/faq/ |
| DC Central Kitchen volunteers | Weekdays from 9am and 6 to 8pm, 2121 First St SW | Weakest fit, because people are there to work | https://dccentralkitchen.org/volunteer/ |
| ARK young adults (21 to 39), St. Ann | Sunday 7pm, 4001 Yuma St NW | The third-Sunday social moves to a restaurant | https://www.stanndc.org/young-adults |

Excluded: Lucky Bar's language exchange (it uses name tags) and alumni mixers (the bar changes every time).

## Still open

- ICP paragraph for the #1 room: who they are, where they are, and the moment they feel the problem.
- What an organizer loses today when a newcomer comes once and never returns.
- A 10-second one-liner and a three-sentence "why now."
- Desk demo: flash both boards and confirm the LED bar changes as they get closer.
