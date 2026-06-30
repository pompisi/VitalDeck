# VitalDeck — The Caveman Guide

This document explains the whole system and every single file in the simplest possible terms — no tech knowledge needed. If you can picture a butler, a filing cabinet, and a walkie-talkie, you already get it. Read the big picture first, then dip into whatever file you're curious about. This is a living document, so it may drift slightly as the code grows.

## VitalDeck, explained like you have never touched a computer

### The one-line version

You wear a smart ring to bed. It measures your body all night. VitalDeck is a little system that grabs those measurements, keeps them in **your own house** (not on some company's server), does its **own** honest math to score how rested you are, and shows it all on your phone in a retro green "Fallout Pip-Boy" video-game screen.

That's it. The rest of this is just *how* and *why*.

---

### What VitalDeck IS, and why it exists

There's a popular smart ring called the Oura Ring. You sleep in it, and it tracks your heart, your breathing, your body temperature, how well you slept. Normally, all that data lives in **Oura's** app, on **Oura's** computers, and Oura gives you a "readiness" number each morning — but it won't tell you exactly *how* it got that number. It's a black box. And you mostly rent access to your own data with a monthly subscription.

VitalDeck was built to flip that around, for three reasons:

- **You own your data.** Your body's numbers get copied to a tiny computer in *your* home and stored there. No outside account, no outside dashboard.
- **The scores are explainable.** VitalDeck doesn't just hand you a "78." It tells you *why* it's a 78 — "your heart-rate variability was low last night, and that dragged the score down." It shows its work, like a math teacher who makes you show the steps. Oura's number is a magic 8-ball; VitalDeck's is a receipt.
- **It's a portfolio / résumé piece.** The person who built this wanted something real to point at — a project that proves they can wire together hardware, a database, a little web service, custom math, and a phone app into one working thing. (Built with AI assistance, openly disclosed, but the design and decisions are the author's.)

---

### The main PARTS (each as a picture)

Think of VitalDeck as a small relay team. Here's every runner.

- **The Oura Ring — the night-shift nurse on your finger.** While you sleep, it quietly takes your vitals: heart rate, heart-rate *variability* (the tiny timing wobble between beats — more wobble usually means better recovery), skin temperature, blood-oxygen, and which sleep stage you're in. It writes it all on a clipboard.

- **Oura's cloud — the head office in another city.** In the morning, your ring hands its clipboard up to Oura's servers over the internet. This is the warehouse VitalDeck *politely asks* for copies of your own data, using a personal key (a "token" — think a library card that proves it's really you).

- **The Raspberry Pi — a tiny robot butler living in a closet.** A Raspberry Pi is a real computer the size of a deck of cards, about $50, that sits plugged in at home and never sleeps. It is the heart of VitalDeck. Twice a day, on its own, it phones Oura's head office and says "any new numbers for me? I'll take copies." Then it does all the thinking and waits for your phone to ask questions.

- **The database (SQLite) — a filing cabinet inside the butler.** Every number the butler collects gets filed into neat drawers: one drawer per day, one folder per night of sleep. SQLite is just a very tidy, very reliable single-file filing cabinet. Ask for "last Tuesday" and the right folder comes right out.

- **The "brain" — a recipe card the butler follows.** This is the custom math (it lives in files the author can read and tweak). It takes the raw numbers and cooks them into the two scores. Crucially, it also writes down *which ingredients pushed the score up or down*, so nothing is mysterious.

- **The phone app (Expo / React Native) — the green CRT television.** This is what *you* look at. It's styled like the screen of an old radioactive-era handheld computer from a video game: glowing green text, scanlines, a little boot-up animation, even a character who waves at you. Five tabs: **STATUS** (today's vitals + a live-ish heartbeat), **TRENDS** (graphs over time), **SLEEP**, **LOG** (where you jot "had coffee late" or "went to the gym"), and **SET** (settings). The app holds **no** data itself — it just asks the butler and draws the answers.

- **Tailscale — a private secret tunnel between phone and butler.** Your phone needs to reach the Pi at home, but you don't want that little home computer exposed to the whole internet for any stranger to poke. Tailscale builds a private, locked hallway that only *your* devices can walk through — so the phone reaches the butler from anywhere, but nobody else can even find the door.

---

### The JOURNEY of one night's data (finger → number on your phone)

Follow a single night, step by step:

1. **You sleep.** The ring (night-shift nurse) takes your vitals every few minutes all night and stores them on its tiny clipboard.
2. **Morning hand-off.** Your phone's normal Oura app syncs the ring, and the numbers travel up to Oura's head office in the cloud.
3. **The butler calls home office.** Twice a day (around 8am and 8pm), the Raspberry Pi wakes up on its own, shows its personal key, and pulls down copies of your sleep, recovery, blood-oxygen, and activity numbers. (You can also tap **SYNC** in the app to make it do this right now.)
4. **Filing.** The butler tidies those numbers and files them into the cabinet — one summary per day, one folder per night.
5. **Cooking the scores.** The butler runs the recipe: it compares last night to *your own normal* (your personal average over the last two weeks and month) and computes the two custom scores — writing down every reason alongside them.
6. **You open the app.** The green screen lights up, and over the private Tailscale tunnel your phone asks the butler: "what's today look like?"
7. **The butler answers**, and the app draws it: your readiness, your sleep quality, your vitals, your trends.
8. **The one live extra.** Most numbers only update once a day (your ring measures you at night, after all). But *current heart rate* is special — Oura exposes a recent-heartbeat trickle, so the app shows a "LIVE" heartbeat that refreshes about once a minute. It's not a true live wire — it's "as fresh as your ring last synced" — but it feels alive.

---

### The TWO scores VitalDeck invents itself (and why "explainable" is the whole point)

VitalDeck does **not** copy Oura's scores. It cooks up its own two, from the raw signals, with a recipe you can actually read:

- **Readiness (0–100): "how recovered are you today?"** It blends four ingredients, each weighted: your **heart-rate variability** (the biggest ingredient — higher than your normal is good), your **resting heart rate** (lower than normal is good), your **skin temperature** (a notable bump can mean you're fighting something off), and your **sleep** (enough hours, slept efficiently). Mix per the weights, and you get a number out of 100.

- **Sleep quality (0–100): "how good was last night specifically?"** A separate recipe blending how **long** you slept, how **efficiently** (asleep vs. just lying there), how **restful** (how little you tossed and turned), and your **timing** (did you go to bed around your usual hour). Deliberately kept separate from readiness so each score stays clean.

**Why "explainable" matters so much:** every score is filed *together with its reasons*. The app doesn't just say "61." It says "61 — the biggest drag was your HRV, which was below your two-week normal." Oura gives you a number and a shrug. VitalDeck gives you a number and a *because*. And on a brand-new setup with no history yet, it doesn't fake confidence — each ingredient politely defaults to "neutral, still learning your normal" until it has enough of your own days to compare against.

---

### How a change gets shipped (very briefly)

When the author improves something, there are two easy paths and no app-store wait:

- **Backend change (the butler's brain):** push the new code up to GitHub, then the Raspberry Pi pulls it down and restarts. Now it thinks with the new recipe.
- **App change (the green screen):** send an **over-the-air update**. The phone quietly downloads the new look in the background, and the next time you fully close and reopen the app, it's wearing the new design — no reinstalling, no app store.

A full reinstall is only needed for deep plumbing changes (new phone permissions, new built-in hardware features). Day to day, it's just "push, pull, done."

---

## Every file, in plain words

Now the whole repo, file by file — grouped by which part of the system it belongs to. Boring plumbing files are honestly labeled as such.

## Part 1 — 🧠 The brain at home (the Raspberry Pi backend)

### Core plumbing

#### `backend/vitaldeck/config.py`
**This is the settings sheet where every knob and file location for the app lives in one place.**

Think of it as the master settings page taped to the fridge. It says where to find the database file, where the secret Oura login token is, what time zone counts as 'a day', and how much each health signal matters when scoring how rested you are. Almost every setting can be swapped out from the outside, so the same code runs the same on the home server, a developer's laptop, and during testing, just by changing the environment around it instead of editing the code. Nothing actually happens here; it just holds numbers and paths for the rest of the app to read.

#### `backend/vitaldeck/records.py`
**This is the bouncer at the door that cleans up and checks each raw reading before it gets in.**

Raw data comes off the ring as a messy stream of text, one reading per line. This file reads each line, throws out the garbage and half-written ones, and tidies the good ones into a neat, consistent shape the rest of the app can trust. It also enforces a few house rules: every reading needs a real timestamp and a type, and it tosses known glitchy readings. It prefers the time the ring actually recorded an event over the time the phone received it, because data often arrives late. It also builds a fingerprint for each reading so the same one never gets counted twice.

#### `backend/vitaldeck/pipeline.py`
**This is the assembly line that turns the pile of raw readings into daily summaries and a rest score.**

After new data lands, something has to roll it up. This file is the shared conveyor belt that does that, and it lives apart from the web server on purpose so the command-line tools and the timed background job can all reuse it. One path rebuilds the day-by-day summaries from scratch out of the raw readings, then scores them. The other path just recomputes the rest score on summaries that are already there (used when the cloud data already arrives pre-summarized). Crucially, when it figures your baseline 'normal', it only looks at days up to and including the day being scored, so it never cheats by peeking at the future.

#### `backend/vitaldeck/scheduler.py`
**This is the alarm clock that wakes up twice a day to fetch fresh ring data on its own.**

The whole app is built around the idea that the ring quietly stores data and gets emptied a couple times a day rather than streaming live. So this little timer fires every morning and evening and runs the same fetch-and-process routine the manual button would. It's polite and careful: if there's no real data source set up (a developer's machine), it does nothing rather than inventing fake days behind your back. It also refuses to stack up duplicate alarms, and can be safely told to stop at any time without breaking anything.

#### `backend/vitaldeck/summarize.py`
**This is the accountant that adds up thousands of tiny readings into one tidy report per day and per night of sleep.**

This is the heaviest worker of the bunch. It takes the firehose of individual readings and rolls them into one summary per day plus one record per night of sleep. It handles the tricky stuff carefully: it groups readings into 'days' by your local clock, stitches scattered sleep readings into whole nights, and is smart about nights that cross midnight so they count as one night instead of getting split in two. It separates daytime numbers (steps, active minutes, awake heart rate) from sleep numbers (resting heart rate, heart-rate variability, blood oxygen, breathing, skin temperature). It's also defensive: one bad reading won't ruin a whole day or night. Most of it just calculates and hands back results; only the final step actually saves anything to storage.

#### `backend/vitaldeck/__init__.py`
**This is just a name tag that says 'this folder is one bundle of code' and stamps the version number.**

Almost nothing happens here. It's the little label that tells the computer to treat this whole folder as one package of code so other parts can pull pieces from it. It also writes down a one-line description of what the backend does and records the version number (0.1.0). That's it; pure plumbing, no real work.

### The filing cabinet (the database)

#### `backend/vitaldeck/db/schema.sql`
**The blueprint that lays out all the labeled drawers where the app stores your ring's health data.**

Think of this as the floor plan for a filing cabinet. It lists every drawer and what goes in each one. One drawer ('raw_records') is the master pile holding every raw event the ring ever spat out, and it is treated as the single source of truth. Other drawers hold neatly tidied summaries built from that pile: one night's sleep, one day's heart-rate and step totals, a daily 'readiness' score, and personal notes you tag (like 'late coffee' or 'gym'). It also adds clever rules so the same event seen twice collapses into one entry, which means re-importing yesterday's data by accident causes no harm.

#### `backend/vitaldeck/db/store.py`
**The librarian who files new health data into the right drawers and fetches it back when asked.**

This is the only worker allowed to touch the filing cabinet, so nobody else has to learn its quirks. When fresh ring data arrives it carefully checks each record, drops the broken ones with a loud note, and files the good ones, refusing to file the same thing twice. It can update a day's summary or a night's sleep in place rather than making duplicates. When something is read back, it hands over clean, easy-to-use information and quietly un-packs the bits that were stored as compact text. It also sets up the cabinet on first use and gently adds a few newer drawers to older cabinets without breaking anything.

#### `backend/vitaldeck/db/__init__.py`
**A one-line signpost that tells the computer 'this folder is a bundle of database code.'**

This is just a label, not a worker. Its only job is to mark this folder as an official code package so the rest of the app can find and use the database tools inside it. The single sentence it contains is a short human note describing what the folder is about. Nothing actually happens here when the app runs.

### The scoring recipes (the math)

#### `backend/vitaldeck/metrics/readiness.py`
**This is the recipe that turns last night's body data into one honest 'how ready am I today?' number out of 100.**

Every morning it looks at four things: heart-rate variability (a calm-nerves signal), resting heart rate, body temperature, and sleep. It compares each one to your own recent normal, not some stranger's average. Higher variability is good, a higher resting pulse is bad, and a temperature that drifts up OR down is a worry. It mixes the four into a single 0-100 score and, unlike a black-box app, it shows its work: each piece carries its number, what it was compared against, and a plain note. It also writes a one-line summary that calls out the single biggest thing dragging you down, plus a separate alarm that flags an unusual temperature night as a possible early sign of getting sick or overdoing it. If some data is missing, it just shrugs and uses a neutral middle value so you still get a number.

#### `backend/vitaldeck/metrics/baselines.py`
**This is the part that figures out 'what's normal for YOU' by averaging your recent days.**

The readiness score only makes sense if it compares today against your own history, so this file builds that history. It takes a stack of your past daily summaries, lines them up oldest to newest, and for a few key measurements (heart-rate variability, resting heart rate, temperature) it averages the most recent stretch of days. You can ask for different time windows, like the last 7 or last 14 days. It carefully skips over any day where a sensor missed a reading, so one bad night doesn't poison the average. It also defensively re-sorts the days by date in case they arrive jumbled. The result is a tidy table of 'your normal' that the readiness math leans on.

#### `backend/vitaldeck/metrics/sleep.py`
**This is the recipe that grades how good a single night's sleep was, out of 100, and explains why.**

It's the sleep-focused cousin of the readiness file. For one night it weighs four things: how long you slept versus your target, how efficiently you slept (time asleep versus time in bed), how restful it was (how much you tossed and turned or lay awake), and your timing (whether you went to bed around your usual hour). The timing part is clever: it does the math on a 24-hour clock-face so 11:50 PM and 12:10 AM count as nearly the same, and it needs a few nights before it trusts what your 'usual' bedtime even is. It blends the four into a 0-100 score, shows the reasoning behind each piece, and writes a one-line verdict naming the biggest problem. It deliberately keeps this separate from the readiness score so that score stays stable and comparable over time.

#### `backend/vitaldeck/metrics/__init__.py`
**This is just a label that tells the system 'this folder is a bundle of related code' - nothing actually runs here.**

It's a one-line signpost, not a working part. Its only job is to mark the metrics folder as an official code package so the rest of the app can find and import what's inside (the readiness, baselines, and sleep files). The single line of text it contains is just a short description of what the folder is about. Think of it as the name tag on a filing-cabinet drawer.

### Getting the data in

#### `backend/vitaldeck/ingest/oura_api.py`
**This is the polite-knock door to Oura's official cloud: it asks Oura's servers for your sleep and heart data and reshapes it to fit our own filing system.**

While your Oura ring membership is active, this file fetches your real numbers straight from Oura's official online service, no Bluetooth sniffing or debugging needed. It shows a secret password (a token) to prove it's allowed, then asks for the last 30 days of sleep, readiness, blood-oxygen, and activity. Then it carefully translates Oura's words into the exact shape our app expects, so the same health math runs no matter where the numbers came from. It's clever about sleep stages: if Oura doesn't spell out how much deep/light/REM sleep you got, it reads a minute-by-minute sleep map and counts it up itself, which fixes the bug where those numbers used to show zero. It also pulls a near-live heart rate readout and a full-day heart rate curve. Every trip to Oura's servers is wrapped in a safety net, so a failure turns into a polite error instead of crashing the app.

#### `backend/vitaldeck/ingest/decode.py`
**This hands a recorded blob of ring chatter to a specialist tool and streams back the readable health records, one line at a time.**

When we capture the raw radio conversation between a phone and the ring, this file replays that recording through a separate expert program (called open_ring) that actually understands the ring's secret language. We don't re-do that hard decoding ourselves; we just run the expert's tool and pipe its output through our parser. It reads the results line-by-line as they come, so even a giant recording never has to be loaded all at once. It's careful housekeeping: it listens to the error channel on a separate worker so a noisy program can't jam things up, and if anything goes wrong (or the reader walks away early) it cleanly shuts down the helper program instead of leaving it running like a forgotten faucet. There's also a simpler test path that decodes already-captured text without launching the expert tool.

#### `backend/vitaldeck/ingest/pull_snoop.py`
**This grabs the phone's hidden recording of all Bluetooth chatter and digs out the raw ring data buried inside it, all without needing special root access.**

If you flip on a hidden developer switch, an Android phone secretly records every Bluetooth packet that flows by. This file uses a standard phone-cable tool (adb) to ask the phone for a big diagnostic bundle, which contains that recording. The tricky part: different phones store it differently. Some drop the full recording in as a plain file; others only tuck in a squished, scrambled summary blob hidden inside a giant text report. This handles both. For the squished version, it finds the right spot in the text, un-scrambles it (base64), and unzips it back into usable bytes, trying two unzip methods so it works across phone versions. It's also smart enough to grab the freshest recording and ignore stale leftover backups. The end result is the raw ring data, ready to be handed to the decoder.

#### `backend/vitaldeck/ingest/__init__.py`
**This is just a name tag that tells the computer 'this folder is a bundle of related code.'**

Nothing really happens here. It's a nearly empty file whose only job is to mark this folder as an official code package so the rest of the app can find and use the files inside it. The one line of text it does contain is just a short note describing what this whole folder is for: grabbing a ring recording from the phone and decoding it. Think of it as the label on the outside of a drawer, not anything inside the drawer.

### The front desk (the web API)

#### `backend/vitaldeck/api/main.py`
**This is the front desk of the health app, where the phone app walks up and asks for your data.**

Think of this as a help desk that the phone app talks to. The phone app asks questions like 'how did I sleep?', 'what's my readiness score?', or 'what's my heart rate right now?', and this file answers each one. It has a separate window for each kind of question: health check, live heart rate, daily summary, trends over time, sleep, metrics, and personal tags like 'had coffee' or 'went to gym'. For every single question it opens a fresh drawer to the filing cabinet (the database), reads what it needs, then closes that drawer right away, because the cabinet gets confused if two people share one drawer at the same time. It also adds its own smart touches on the way out, like explaining the single biggest thing dragging your readiness down, or scoring your sleep quality against your usual bedtime. There's one button that actually writes new data instead of just reading, called sync, and it's clever about where the data comes from: if you have an Oura ring account it pulls from Oura's cloud, if a phone is wired up it grabs a real capture, and otherwise (in testing) it just makes up one fake day so the app still has something to show. The whole thing is wrapped in safety nets so a hiccup in any one corner reports a polite error instead of crashing.

#### `backend/vitaldeck/api/models.py`
**This is the list of forms that say exactly what each answer from the help desk should look like.**

If the main file is the help desk, this file is the stack of blank forms it must fill out. Each form spells out the shape of an answer: a health reply has a status, a yes/no on whether the database opened, and a timestamp; a sleep reply is a list of nights; a tag has an id, a time, a label, and an optional note. By promising these shapes ahead of time, the phone app always knows what to expect and never gets a surprise. The author kept these forms deliberately loose for the big bundles like daily summaries and sleep, treating them as open bags of stuff rather than itemizing every field, because the database already owns those details. The forms mainly exist to keep the answers stable and to auto-generate nice documentation.

#### `backend/vitaldeck/api/__init__.py`
**This is just a name tag on the folder that says 'the help-desk code lives here.'**

Nothing actually happens in this file. It's a one-line label that marks this folder as a proper bundle of code so the rest of the program can find it. The single line of text inside is just a short description for humans reading along. Pure plumbing, nothing to do here.

### Helper tools & fake data

#### `backend/tools/synth.py`
**This makes fake but realistic health-ring data so the whole app can be tested without owning a real ring.**

Think of it as a movie set builder for a smart ring. A real Oura-style ring records your heart rate, sleep stages, breathing, blood oxygen, and skin temperature all night. This file invents all of that from scratch: it lays out believable nights of sleep (light, deep, REM, brief wake-ups) and busy daytime hours, complete with the little sensor readings sprinkled across them. It is fully repeatable, like a recipe that always tastes the same: it uses a fixed pretend date and a fixed random seed, so it produces the exact same data every time, which makes testing reliable. It even sabotages a few specific nights on purpose (worse sleep, higher resting heart rate, lower recovery) so the app's recovery score visibly dips, proving the score reacts the way it should. It can also save all this fake data to a file.

#### `backend/tools/seed.py`
**This is the one-button demo that fills the app with fake data and proves the whole machine works end to end.**

Picture flipping the master switch on a factory and watching a product roll off the line. This script calls the fake-data generator, pours that data into the app's storage, has the app crunch it into daily summaries and sleep sessions, then calculates a daily recovery score for each recent day. Finally it prints a tidy little table of the last 7 days so a human can glance at it and confirm the deliberately bad nights actually dragged the score down. You run it from the command line and can tell it how many days to make and where to put the database. It is careful: if a piece of the app isn't built yet or one day's math fails, it reports the problem and keeps going instead of crashing.

#### `backend/tools/ingest_zip.py`
**This takes a Bluetooth recording file you copied off your phone and turns the ring's secret signals into real health data, no special cable needed.**

This is the 'I captured my own ring's chatter' path. Your phone can secretly log all the Bluetooth conversations it has, including the ones with the ring. You hand this tool that log file (or a whole Android bug-report zip, which it opens to find the log inside). It then decodes those raw radio signals into readable health records using the project's own reverse-engineered decoder. Before saving anything, it prints a tally of what it found, like 'heart_rate: 240, sleep_stage: 18', as a quick gut-check that the decoding actually worked. If it found nothing, it tells you plainly what probably went wrong. When it works, it stores the records and recomputes everything, so the day shows up in the app.

#### `backend/tools/validate.py`
**This is the courtroom proof that the team genuinely cracked the ring's code rather than just borrowing Oura's official numbers.**

It runs the same nights through two completely separate paths and compares them side by side. Path one: decode the ring's own Bluetooth recording with the home-grown decoder. Path two: ask Oura's official online service for its numbers for those same nights. Then it lines up the two answers for each metric (recovery, resting heart rate, blood oxygen, breathing, sleep length and stages) and shows the difference between them in a neat table. If the home-grown numbers closely match the official ones, that is strong evidence the decoder is the real deal. It writes this comparison into a document file as a permanent proof artifact. Skin temperature is left out on purpose because the two sources measure it differently, so comparing them would be unfair.

#### `backend/tools/__init__.py`
**This is just a name tag that tells the code 'this folder is a bundle of tools you can use together.'**

Nothing really happens here. In this programming language, a folder needs a small marker file like this so the rest of the code can treat the folder as one importable package. The only extra content is a short note explaining that these tools are for development only, they never get shipped to the little always-on computer (the Pi) that runs the real pipeline, and that loading this package is cheap. Plain plumbing, no behavior.

### The safety checks (tests)

#### `backend/tests/test_api.py`
**This test pokes the whole web service through its front door to make sure every request works.**

It spins up a pretend copy of the app with a throwaway database, then fills that database by running the fake-data 'sync' a few times so there is real-looking history to chew on. After that it knocks on each web address the app offers: a health check, today's summary, trend charts, sleep, daily scores, and adding/listing/deleting notes ('tags'). It checks good requests come back with the right shape and bad ones (a made-up chart name, a negative day count, a broken save) come back as errors instead of quietly lying.

#### `backend/tests/test_decode.py`
**This test checks the part that turns a stream of text lines into clean data records.**

The watch sends out one little record per line. This test feeds in good lines and confirms they come out as proper records, then feeds in garbage and blank lines and confirms those get quietly thrown away instead of crashing. It also runs one tougher check: it builds a fake helper program that screams a huge amount of noise out one channel while sending real records out another, and proves the reader does not freeze up when that noise pipe overflows.

#### `backend/tests/test_metrics.py`
**This test checks the math that turns your body numbers into a daily 'readiness' score.**

It builds a stretch of normal days to set your personal baseline, then checks the rules hold: missing days get skipped when averaging, the final score always stays between 0 and 100, and a rough night (low heart-rate variability, higher resting pulse, warmer skin, worse sleep) scores lower than a calm one. It also confirms the body-temperature warning flag only trips when the rise is big enough (about a third of a degree), and stays calm when there is no baseline to compare against yet.

#### `backend/tests/test_oura_api.py`
**This test checks the translator that turns Oura ring cloud data into our own tidy format.**

Oura's cloud sends a big messy bundle; this test feeds in a hand-made sample and confirms every field lands in the right slot (resting pulse, sleep minutes, temperature, blood oxygen, steps, and so on). It checks tricky cases: a real night's sleep wins over a short nap, sleep-stage minutes get rebuilt from the minute-by-minute sleep map when the totals are missing, and the staged record is preferred over a longer un-staged one. It also checks the live heart-rate summary buckets samples correctly and ignores readings taken while asleep.

#### `backend/tests/test_pipeline.py`
**This test checks the assembly line that recomputes scores after new data arrives, plus a data-comparison helper.**

First it pours in fake data, runs the recompute step, and confirms it produces daily readiness scores. Then it checks a comparison tool that lines up two versions of the same day (one from the phone capture, one from the Oura cloud) and reports the differences number by number. It confirms the differences are calculated correctly and that fields with a missing value on either side are skipped instead of producing junk comparisons.

#### `backend/tests/test_pull_snoop.py`
**This test checks the trick for pulling Bluetooth logs off the phone without special root access.**

Android tucks the Bluetooth radio log inside a 'bug report' zip, sometimes as a real file and sometimes squashed into compressed text. This test builds fake bug-report zips and proves the extractor finds the log either way, unpacks both the newer and older compressed formats correctly, and always grabs the live current log instead of a stale rotated copy. It also confirms that when there is genuinely no log to find, it raises a clear error rather than returning nothing.

#### `backend/tests/test_store.py`
**This test checks the filing cabinet code that saves and reads everything in the database.**

Using a throwaway database, it confirms the right tables get created, and that saving raw records counts them correctly and never stores the same event twice. It checks that broken or unsavable records get marked as errors instead of being mistaken for duplicates. It also runs save-then-read round trips for daily summaries, sleep sessions, scores, and notes, confirming updates overwrite cleanly, lists come back in the right order, and everything read out is safe to send over the web.

#### `backend/tests/test_summarize.py`
**This test checks the code that rolls a whole day of raw readings into one tidy daily summary.**

It hand-builds a fake day with night-time sleep readings, daytime heart rates, some activity, and a full sleep-stage map, then confirms the summary comes out right: resting pulse near the sleeping lows, correct averages, step and activity counts, and proper deep/light/REM/awake minutes. It pays special attention to a night that crosses midnight, proving the whole night gets filed under the morning date and does not accidentally create a fake extra day.

#### `backend/tests/test_synth.py`
**This test checks the fake-data generator used for development and demos.**

It confirms the generator produces every kind of reading the system expects (heart rate, sleep stages, temperature, and so on), even for a single day. It checks the data is repeatable with the same seed but different with a different seed, that timestamps never spill past the intended window, and that it deliberately sprinkles in some 'bad nights' with worse numbers so the scoring code has rough days to test against.

#### `backend/tests/__init__.py`
**This is an empty label file that just marks the folder as a group of test code.**

There is nothing happening inside it; it is blank. Its only job is to tell the tools 'this folder is a proper code package,' which helps the test runner find and organize the test files next to it. Think of it as a name tag on a folder, not actual machinery.

## Part 2 — 📟 The green screen (the phone app)

### The screens you tap through

#### `app/app/_layout.tsx`
**The app's front door and frame that wraps every screen the same way.**

Think of this as the building lobby that every visitor passes through before reaching any room. It loads the special retro typewriter fonts, makes all text glow amber by default, and lays out the bottom tab bar (STATUS, TRENDS, SLEEP, LOG, SET). It also plays a fake 'powering on' boot animation when the app first opens, and drops a fake old-TV scanline filter over everything for the look. There is a safety net so that if the boot animation crashes, the app just skips it instead of freezing. It also waits for the saved server address to load before letting any screen ask for data.

#### `app/app/index.tsx`
**The home screen showing your current health status at a glance.**

This is the main dashboard, styled like a video-game character sheet. It shows a figure with your vitals pinned around it, a big health bar with a word like OPTIMAL or CRITICAL, a scrolling ticker of numbers (heart rate, HRV, temperature), a daytime heart-rate graph, and a sleep summary. A live heart rate is fetched fresh every minute. A big 'SYNC SENSORS' button pulls the newest data. Tapping the panels jumps you to deeper detail screens. If there is no data or no connection, it shows friendly error messages instead.

#### `app/app/sleep.tsx`
**The sleep screen where you browse past nights and see how you slept.**

A night explorer. Pick a night from a row of date buttons, then see a timeline of sleep stages (deep, REM, light, awake), how long each lasted, when you went to bed and woke, and an overnight heart-rate curve. It gives that night a sleep score with a word like RESTORATIVE or POOR and explains why. It also shows that day's other vitals and a little calendar of history you can tap to revisit any day. If sleep data fails to load, it offers a retry.

#### `app/app/trends.tsx`
**The trends screen that charts one health number over the last 30 days.**

Pick a metric (readiness, HRV, resting heart rate, skin temp, sleep, blood oxygen) with toggle buttons, and it draws a glowing line graph of the last 30 days. Two dashed reference lines mark your personal 14-day and 30-day averages so you can see if today is above or below your normal. It carefully picks clean numbers for the side axis (like 20, 40, 60) and skips days with no data instead of dropping the line to zero. Skin temperature is converted from Celsius to Fahrenheit for display.

#### `app/app/tags.tsx`
**The log screen where you jot down events like caffeine or workouts.**

A simple notebook for life events that might affect your health (late coffee, gym, alcohol). You type a label and optional note and hit 'ADD ENTRY' to stamp it with the current time. Past entries appear in a list, newest activity visible, and you long-press one to delete it after a confirmation. The idea is these events get matched against your health numbers later. It is styled like a command-line terminal with a '>' prompt before each input.

#### `app/app/settings.tsx`
**The settings screen for pointing the app at its data server and tweaking looks.**

Lets you change which server (a little computer at home) the app talks to, without rebuilding the app. You can type a new address, TEST it (it pings the server and times how fast it responds), SAVE it, or RESET to the built-in default. You can also pick which character figure shows on the status screen and turn the boot sound on or off. A read-only system panel shows the app version and theme. Saving triggers all screens to refetch fresh data.

#### `app/app/readiness.tsx`
**A detail page explaining today's readiness score and what dragged it down.**

Opened by tapping the readiness panel on the home screen. It shows a big ring with today's readiness number, a condition word, and a plain-English sentence about what hurt your score most (plus a warning if your body temperature looks off). Below that, four contributors (HRV, resting heart rate, skin temp, sleep) are drawn as bars comparing today against your baseline, each with a 'why' note. All this info already comes bundled with today's data, so no extra fetching is needed. A back arrow returns to STATUS.

#### `app/app/day/[date].tsx`
**A reusable detail page for any single day, today or in the past.**

This is one shared 'zoom in on a day' screen reachable from several places (the home health bar, the sleep panel, the calendar). The date is read from the link itself, and it pulls that day's full record. It shows the readiness ring and explanation, the four contributor bars, a grid of vitals (heart rate, HRV, temp, oxygen, breathing rate, steps), and a sleep summary. If a day has no record it politely suggests picking another day from the calendar instead of uselessly retrying.

### The chart & gauge building blocks

#### `app/components/Pip.tsx`
**A small kit of reusable retro screen pieces (a title bar, a bordered box, and a fill meter) that every screen shares so they all look the same.**

Think of this as a box of LEGO bricks for the app's old-computer-terminal look. It hands out three pieces: a big screen title with an optional timestamp and a line under it, a bordered panel with a little label sitting on its top edge, and a thin meter bar that fills up to show a value. The meter is careful: if you hand it a number that is too big or too small, it squeezes it back into the safe zero-to-full range so the bar can never spill over. Nothing fancy happens here. It is just the shared furniture other screens decorate with.

#### `app/components/ReadinessRing.tsx`
**The big circular gauge that shows your readiness score from 0 to 100 with the number printed in the middle.**

This draws the round progress ring you see at the top of the readiness screen, like a battery or speedometer bent into a circle. It takes your score, fills the ring partway around to match it, and prints the number in the center. The fill starts at the top and sweeps clockwise. The color shifts along a good-to-bad scale, so a strong score and a weak score look different at a glance. If there is no score yet, it shows a dash instead of a number and leaves the ring empty. It is drawn as true vector art, so it stays sharp at any size.

#### `app/components/MetricCurve.tsx`
**A line graph that plots a health number over time, like your heart rate through the night.**

This is the squiggly time-graph used for things like overnight heart rate and heart-rate-variability, or daytime heart rate. You give it a list of timestamped readings and it draws a line across the screen with a soft glowing fill underneath. It adds faint guide lines for the highest and lowest values and prints the start and end times along the bottom. A nice honesty touch: when a reading is missing, it does not fake a zero or fudge a connection. It simply breaks the line, so a gap in the data shows as a real gap. It also includes a small helper that turns a compact 'start time plus evenly-spaced values' data block into the point-by-point list the graph needs.

#### `app/components/Hypnogram.tsx`
**The sleep timeline that shows when you were awake, in light, deep, or REM sleep through the night, like an Oura ring chart.**

This paints your night as a stack of four colored lanes (awake, REM, light, deep, top to bottom). Each stretch of sleep becomes a colored block whose width matches how long that stage lasted, so the whole night reads left to right like a strip of film. Start and end times are printed along the bottom. If movement data is also provided, it adds a fifth lane underneath that works like a tiny earthquake readout, with taller marks where you tossed and turned more. To keep that lane readable it groups the movement into columns and keeps the strongest jolt in each group so a brief spike does not get smoothed away. If there is no timeline data at all, it draws nothing and lets the screen fall back to a simpler summary bar.

#### `app/components/BarBreakdown.tsx`
**A flexible list that shows what fed into a score, one row per factor with a label, a fill bar, and a tap-to-expand 'why' note.**

This is a general-purpose scorecard. You hand it a list of contributing factors and it lays out one row each: the factor's name, an optional weight, its 0-to-100 sub-score, a colored fill bar, and a little expandable 'WHY?' explainer. The bar's color follows the same good-to-bad scale used elsewhere. Because it is generic, the same layout can be reused for any combined score later (today it explains sleep quality, but activity or vitals could plug in the same way). It leans on the shared meter bar and the explainer note rather than reinventing them.

#### `app/components/ContributorBars.tsx`
**The fixed four-row breakdown of what drives your readiness score: HRV, resting heart rate, skin temperature, and sleep.**

This is the readiness-specific cousin of the generic scorecard. It always shows the same four ingredients of readiness in order, each as a row with its label, its weight in the final score, its 0-to-100 sub-score, a colored bar, and a tap-to-expand 'why' note. One thoughtful detail: temperature is converted to Fahrenheit for display to match the rest of the app, even though the system stores and scores it in Celsius behind the scenes. It is shared by both the readiness detail screen and the combined day-detail screen, so those two always agree and never drift apart.

#### `app/components/ExplainNote.tsx`
**The small tappable 'WHY?' line that expands to explain a single metric in plain language.**

This is the little disclosure widget that sits under each metric. By default you just see a terminal-style '> WHY' prompt. Tap it and it opens a small panel with the plain-English explanation from the backend, plus the actual value, the personal baseline it is compared against, and the percentage score. Tap again to close it. If there is nothing useful to show (no note and no value), it quietly shows nothing at all rather than an empty button. Missing numbers are drawn as a dash so the panel never looks broken.

### The look-and-feel pieces

#### `app/components/BootSequence.tsx`
**The dramatic power-on screen you see when the app first wakes up.**

When the app cold-starts, this takes over the whole screen like an old computer booting. First the studio logo types itself out letter by letter with little beep sounds, then the word VITALDECK fades in and a fake startup log scrolls out line by line (each with a beep and a tiny phone buzz) while a progress bar fills. It does not auto-continue. It waits for you to press an INITIALIZE button. It also has safety timers so if something hiccups, the button still shows up and you never get stuck staring at it.

#### `app/components/CRTOverlay.tsx`
**A thin see-through filter that makes the screen look like an old tube TV.**

This is a transparent layer that sits on top of everything in the app. It draws faint horizontal scan-lines across the whole screen and darkens the four corners, the way an old cathode-ray TV looked. It is purely decorative and you can tap right through it. It never flickers or animates, just a steady vintage look.

#### `app/components/LiveBadge.tsx`
**The little status line that tells you if a heart-rate reading is live or old.**

This is the small label under the status figure. When the heart-rate data is fresh, it shows a blinking green dot plus the word LIVE, the time of the reading, and today's high-low range. When the data is stale, it stops blinking, goes dim, and says RESTING from LAST NIGHT instead. So at a glance you know whether you're seeing now or yesterday.

#### `app/components/MonthCalendar.tsx`
**A six-week grid of colored squares showing how ready your body was each day.**

This draws a calendar grid, seven days wide and six weeks tall, where each day is a small square colored by your readiness score for that day (green is good, then warning, then bad). Days with no score look dim and future days are greyed out and can't be tapped. The newest day sits in the bottom row, and tapping any real day opens that day's detail screen. It's a quick visual heatmap of your recent shape.

#### `app/components/PompisiLogo.tsx`
**The studio's signature logo drawn as a command-prompt with a blinking cursor.**

This is the Pompisi Studio brand mark, shown as "> POMPISI STUDIO" in the terminal-style font with a little blinking block cursor after it. It is built in code rather than being a picture, so it can scale to any size, take on the app's colors, and animate. On the boot screen it can type itself out one letter at a time, firing a beep per letter, and it can show an optional tagline underneath.

#### `app/components/Section.tsx`
**A plain wrapper that gives every block on a screen a matching title and spacing.**

This is simple, reusable plumbing. You hand it a title, an optional subtitle, and some content, and it stacks them with consistent header styling and spacing below. The point is that every section across the app looks the same instead of each one styling its own heading. Boring but useful glue.

#### `app/components/StatCard.tsx`
**One small boxed tile showing a single health number, like resting heart rate.**

This is the building block for the grid of stats on the Today screen. Each card shows a label, one big number, its units, and an optional small line underneath (like a 14-day average). You can tint the number a chosen color. If the value is missing, it politely shows a dash instead of a number so nothing looks broken.

#### `app/components/StatusFigure.tsx`
**The centerpiece avatar with your live vitals pinned around it.**

This shows the glowing green character you picked in settings, with four live readings arranged around it: heart rate and temperature on the left, HRV and blood-oxygen on the right, each with a little connecting dash. Temperature is converted to Fahrenheit before showing. The figure itself is a still image, no pulsing, and missing readings show as dashes.

#### `app/components/Ticker.tsx`
**A status strip that scrolls text sideways forever, like a news crawl.**

This is the thin strip under the status figure that slides text continuously from right to left. To make the loop seamless, it actually prints the same text twice in a row and slides over by exactly one copy's width, so it never visibly jumps or restarts. It measures its own width as it lays out, so the scroll speed stays readable no matter how much text you give it.

### The behind-the-scenes helpers

#### `app/lib/api.ts`
**This is the phone app's messenger that talks to the little health computer and brings answers back.**

The app's health data lives on a tiny computer at home (a Raspberry Pi). This file is the messenger that runs over there, asks for things like heart rate, sleep, or readiness, and carries the answer back. Its clever trick: if the home computer is asleep or unreachable, the messenger never panics or crashes the screen. It calmly returns a polite 'it didn't work' note so the app can show a friendly error instead of breaking. It has read errands (fetch today's stats, trends, sleep) and write errands (start a sync, add or delete a tag).

#### `app/lib/types.ts`
**This is the shared dictionary that says exactly what shape every health answer has.**

When the home computer sends back data, this file is the agreed-upon blueprint describing what each answer looks like: a daily summary has a resting heart rate here, a sleep score there, and so on. Think of it as labeled boxes both sides promise to fill the same way. Nothing happens when you run it; it's pure description. Its value is catching mistakes early: if the app ever expects a box that isn't there, this dictionary makes the error obvious before users ever see it.

#### `app/lib/settings.ts`
**This is the app's little memory drawer for your preferences, plus a bell that rings when they change.**

It remembers three choices: the address of your home health computer, which on-screen character you picked, and whether sounds play. It saves these so they survive closing the app, and loads them once at startup into quick-access memory. When you change a setting, it rings a bell so every screen instantly updates to match. It's built to never crash: if saving or loading fails, it just keeps sensible defaults so the app always opens.

#### `app/lib/characters.ts`
**This is the small list of pickable cartoon characters shown on the status screen.**

The app lets you choose a character (an 'operative' or a 'wizard') displayed on the STATUS screen. This file holds that short menu, pairing each choice with its name and its picture file. It also has a tiny helper that hands back the right picture for whichever character is chosen, and quietly falls back to the operative if something is off. It's basically a labeled photo drawer with two photos in it.

#### `app/lib/units.ts`
**This is a one-trick translator that turns body-temperature numbers from Celsius into Fahrenheit for display.**

The health computer always stores skin temperature in Celsius, but the owner is American and prefers Fahrenheit. This tiny file does only that one conversion, and only for what's shown on screen. The stored data and the score math stay in Celsius untouched. If the temperature is missing or nonsense, it politely returns nothing instead of a wrong number.

#### `app/lib/version.ts`
**This is the name tag that tells you which version of the app you're looking at.**

It holds the app's version number and builds the little label shown on the startup and settings screens. Beyond the hand-set version, it automatically adds a short code that changes every time a new update is pushed over the air, so the displayed version always reflects the latest tweak even between manual bumps. It deliberately keeps this label separate from the deeper system version, because changing that one would block over-the-air updates from reaching installed phones.

### Settings & build files

#### `app/app.config.js`
**A tiny setup helper that quietly slips the secret backend address into the app at build time so it never gets published in public code.**

Think of this as a name tag the app fills in just before it goes out the door. The real address of the home server (the Raspberry Pi the app talks to) is kept in a private, hidden note that is never uploaded to the public code library. This file reads that private note and tucks the address into the app so it knows where to call home. If the note is empty, it leaves the address blank, and the user can type one in later inside the app. It takes all the other settings from the main settings file and just adds this one extra piece.

#### `app/app.json`
**The app's main ID card and settings sheet: its name, its dark look, what permissions it needs, and where it gets over-the-air updates.**

This is the master settings sheet that describes the app to the phone and the app store. It sets the name (VitalDeck), says the screen should stay upright and use a dark theme, and picks the dark green startup screen color. It lists optional add-ons the app uses (like fonts and audio) and notes that the microphone is NOT requested. It also records the app's unique project ID and the web address it checks for updates, so the app can receive small fixes without a full reinstall. Pure settings, nothing runs here.

#### `app/eas.json`
**The recipe sheet for the cloud build service, listing three ways to package the app: a dev version, a preview version, and the final store-ready version.**

When the app needs to be turned into an actual installable file, a cloud service does that work, and this file tells it how. It defines three flavors: a developer build for testing, a preview build for sharing internally, and a production build for real release. The first two make a quick-install Android file; the production one makes the polished package the app store wants and automatically bumps the version number. Each flavor is tied to its own update channel so test users and real users get the right updates. It is just instructions for the build robot.

#### `app/babel.config.js`
**A translator setting that converts modern code into something phones understand, with one plugin that MUST be listed last or animations silently break.**

Phones do not understand the newest, fanciest code directly, so a translator step rewrites it into a form they do understand. This file picks the standard translator package for this kind of app. It also adds one special helper that powers smooth animations. There is an important catch written right in the file: that animation helper has to be the very last item in the list, or the animations quietly stop working with no error message. Small file, but that ordering rule matters.

#### `app/tsconfig.json`
**The rulebook for the app's coding language, turning on strict error-checking and a handy shortcut for pointing to files.**

The app is written in a stricter, safer dialect of its programming language, and this file sets the rules for that. It turns on strict mode, which is like a picky proofreader that catches mistakes before the app ever runs. It also sets up a shortcut symbol so the code can refer to files by a clean path instead of long messy ones. It builds on top of the standard ruleset that comes with the app's framework. Pure configuration.

#### `app/package.json`
**The app's shopping list and command menu: every outside ingredient it depends on, plus the shortcut commands to start it up.**

This is the project's ingredient list. It names every outside building block the app borrows: the charts, the fonts, the animation engine, the data-fetching helper, the storage, the sound and vibration cues, and the core app framework, each pinned to a specific version so everyone gets the same parts. It also defines short commands like start, android, and ios that launch the app in different ways. When someone sets up the project, a tool reads this list and downloads everything on it. It is a manifest, not running logic.

#### `app/.env.example`
**A blank fill-in-the-blank template showing where to write your private backend address before running the app.**

This is a sample of the private settings note the app expects, with the value left empty on purpose. The instructions at the top tell you to copy it to a real hidden file and type in the address of your own backend server. Whatever you put there becomes the app's default place to call until you change it inside the app. If you leave it blank, the app will ask you for an address the first time it runs. It is a template, safe to share, holding no real secrets.

#### `app/.npmrc`
**A one-line setting telling the parts-installer to be lenient about mismatched version requirements so installation does not fail.**

When the tool that downloads the app's building blocks runs, it sometimes gets fussy because different parts ask for slightly different versions of the same thing. This single-line file tells that tool to relax and proceed anyway instead of stopping with an error. It is a common workaround that lets a project with strict-but-harmless version disagreements install cleanly. Just one setting, nothing more.

#### `app/README.md`
**The welcome guide and instruction manual for the app: what it is, how to point it at a server, how to run it, and a tour of every screen.**

This is the human-readable handbook for the project. It explains that VitalDeck is the phone front-end that reads health data from a home server and shows it in a retro green-screen, Pip-Boy style interface. It walks through how to tell the app which server to talk to, how to install and start it, and what the animated startup screen does. It then tours all five tabs (Status, Trends, Sleep, Log, Settings) and ends with notes on how errors are handled and how the backend decides where its data comes from. It is documentation for people, not code the app runs.

## Part 3 — 📄 The paperwork (docs, config, deploy)

### Docs, license & deploy

#### `README.md`
**The front-door sign that explains what VitalDeck is, why it exists, and how to start it up.**

VitalDeck is a private dashboard for your own Oura smart-ring health data, built so the data never leaves your hands. This file is the welcome guide. It explains the two ways the app gets your numbers: the easy way (asking Oura's cloud politely with a personal key) and the harder, subscription-free way (quietly reading the Bluetooth chatter your phone already had with the ring). It lists the folders, shows how to run a fake-data demo with no ring needed, and is honest about what works today versus what still needs real hardware.

#### `CONTRACTS.md`
**The rulebook every piece of code must obey so the parts fit together.**

Think of this as the blueprint a builder hands every worker so the plumbing lines up with the walls. It spells out the exact shape of each health record, the exact names of every function, and which person (or AI agent) is allowed to touch which file. It exists so nobody changes a part in a way that breaks another part. If you want to know how the program is supposed to behave before reading the actual code, this is the spine you read first.

#### `HANDOFF.md`
**The START HERE note that catches the next person up on what is done and what is next.**

This is the running diary of the project, written so anyone picking it up can be up to speed in five minutes. It records the current status (working, live data flowing to the phone), the recent batch of new features shipped to the app, the traps already hit and solved, and a to-do list of what to build next. It is the most up-to-date, real-world snapshot of the project, including messy details the cleaner docs leave out.

#### `docs/ARCHITECTURE.md`
**The map of how data travels from your ring to a number on the screen.**

This explains the journey: where the data enters, the storage shelves (database tables) it sits on along the way, and the math that turns raw signals into a 0-to-100 readiness score. It also has a 'corrected facts' section that debunks myths that floated around during planning, so nobody builds on a wrong assumption. It is the technical overview for someone who wants to understand the whole machine without reading every line of code.

#### `docs/SETUP.md`
**The one-time instructions for getting the whole thing running the first time.**

This is the assembly manual you follow once. It walks you through setting up the always-on mini-computer (a Raspberry Pi) that runs the backend, getting your secret Oura key, pointing the phone app at the right address, and an optional path for the trickier Bluetooth-snooping setup. After this is done, day-to-day use needs almost no fuss. Most people only need the easy cloud part and can skip the rest.

#### `docs/PHASE0_RUNBOOK.md`
**The step-by-step recipe for the occasional Bluetooth-snooping data capture.**

This is the field guide for the harder, subscription-free way of getting ring data: capturing the Bluetooth traffic your phone already exchanged with the ring, then decoding it. It is not a daily chore, just an occasional task and a proof that the decoding actually works. It also explains how to cross-check the decoded numbers against Oura's official numbers, which is the evidence that this is genuine reverse-engineering and not just a wrapper around Oura's service.

#### `docs/WALKTHROUGH.md`
**The defend-it-yourself guide the author reads before an interview about the project.**

This is the deepest, most personal document, written in the author's own voice for the night before a job interview. It traces a single health reading all the way through the system, explains every code module, and most importantly lays out WHY each tricky decision was made so the author can defend it under tough questions. It even has a mock Q&A section anticipating hard questions, and it is openly honest about which parts are the author's own work versus borrowed.

#### `docs/SAMSUNG_SNOOP_FINDING.md`
**Field notes on a Samsung phone roadblock and the workaround that beats it.**

When trying to grab the ring's Bluetooth log on a newer Samsung phone, the usual method simply failed because Samsung hides that log. This note documents that dead end and the clever no-root workaround: a hidden Samsung diagnostic menu reached by dialing a secret code. It even warns about a security setting that silently blocks the trick. It is a small but real discovery saved so the author never has to rediscover it the hard way.

#### `LICENSE`
**The legal permission slip saying anyone may use this code, plus a careful note about the borrowed decoder.**

This is the standard, very permissive MIT license: anyone can use, copy, change, or sell the code for free, with no warranty. The important extra part is the note at the bottom: the Bluetooth-decoding tool (open_ring) is someone else's work under a stricter license, so VitalDeck keeps it at arm's length by running it as a separate program rather than mixing its code in. This keeps the legal lines clean.

#### `.gitignore`
**The do-not-upload list that keeps secrets and junk out of the public code repository.**

Think of this as a bouncer's list of things that must never make it into the shared online copy of the project. It blocks private secrets like the Oura key and the home network's address, blocks captured Bluetooth logs (which contain personal traffic), and blocks bulky temporary files. This is how the author keeps a public project public-safe, never leaking anything personal or sensitive.

#### `deploy/vitaldeck.service`
**The instructions that make the backend start automatically and stay running on the mini-computer.**

This is a small settings file for the Raspberry Pi's built-in launcher. It tells the Pi how to start the VitalDeck backend, where its files and secret key live, and to automatically restart it if it ever crashes. Because of this, the service quietly runs around the clock without anyone babysitting it, even surviving a power outage and reboot.

#### `scripts/deploy_pi.sh`
**The one-button setup script that prepares the mini-computer from scratch.**

This is an automation recipe you run once on the Raspberry Pi. It does all the tedious setup in order: downloads the borrowed decoder, builds the isolated workspace, installs the needed parts, runs the tests to catch a broken setup early, and proves the whole pipeline works using fake data so no real ring is needed. It is safe to run again, and it finishes by printing exactly how to start the app.

#### `backend/requirements.txt`
**The shopping list of outside code packages the backend needs to run.**

This is a short grocery list the setup uses to fetch the few helper libraries the backend depends on: the web-server framework that serves the data, the engine that runs it, a scheduler for the twice-daily auto-sync, and a couple of tools used only for testing. The list is deliberately tiny, which keeps the project light and easy to install.

---

If any of this is still fuzzy, that's totally fine — the green screen on the phone is the part that matters. Everything else just quietly feeds it.
