# Neon Syndicate — Player Rules

## The Goal

Control as many districts as possible by the end of the season. Your final score is the sum of all your resources plus **10× each district you hold**. Districts are everything — but hoarding resources matters too.

---

## The Map

The city is divided into **24 districts**, each with a type that determines what it produces every tick. You can only claim or attack districts that are **adjacent** to one you already own.

### District Types & Yields

| Type | Primary | Secondary |
|------|---------|-----------|
| Financial Hub | +4 credits | +1 energy |
| Power Grid | +4 energy | +1 workforce |
| Labor Zone | +3 workforce | +1 credits |
| Data Center | +3 intelligence | +1 credits |
| Black Market | +2 influence, +2 credits | −1 reputation/tick |
| Government Quarter | +3 political power | +1 influence, +1 reputation |

---

## Resources

| Resource | What it's used for |
|----------|--------------------|
| **Credits** | Claiming, attacking, fortifying, lobbying, trading |
| **Energy** | Claiming, attacking, fortifying, covert ops |
| **Workforce** | District staffing — see below |
| **Intelligence** | Unlocks counter-intelligence |
| **Influence** | Covert operations |
| **Political Power** | Scoring only (via Government Quarter) |

### Workforce & Staffing

Your workforce determines how many districts operate at full capacity. If you own **more districts than you have workforce**, your excess districts produce at **50% yield**. Districts are staffed in the order you claimed them — your oldest holdings get staffed first.

*Example: 10 workforce, 14 districts → first 10 produce normally, last 4 produce at half.*

---

## Each Tick

Every tick you may submit **one primary action** and **any number of free actions**.

### Primary Actions

#### Claim
> **Cost:** 3 energy + 5 credits

Takes an unclaimed district adjacent to one you own. First come, first served if multiple corps target the same district in the same tick.

#### Attack
> **Cost:** Energy you choose to spend (minimum 5) + 10 credits + 3 reputation

Attempt to seize an enemy district adjacent to one of yours.

**Attack power** = (energy spent × 1.5) + min(your workforce, 20)

**Defense power** = (fort level × 3) + min(defender's workforce, 20) + alliance bonus

If your attack power **exceeds** defense power, you take the district. The district's fortification resets to 0. You pay the energy, credits, and reputation cost **regardless of whether you win**.

> **Alliance bonus:** Each of the defender's allies who owns a district adjacent to the one being attacked adds +2 to defense (maximum +4 total).

#### Fortify
> **Cost:** 2 energy + 8 credits

Raises one of your district's fortification level by 5 (maximum level: 20). Higher fortification makes it much harder to attack.

| Fort Level | Defense Contribution |
|-----------|----------------------|
| 0 | 0 |
| 5 | +15 |
| 10 | +30 (withstands max attack) |
| 15 | +45 |
| 20 | +60 |

Fortification resets to 0 if the district is captured.

#### Sabotage
> **Cost:** 4 energy + 15 credits + 5 influence + 5 reputation

The target district produces at **50% for the next 2 ticks**. Works on any district — yours or an enemy's. Stacks with understaffing.

#### Leak Scandal
> **Cost:** 2 energy + 10 credits + 5 influence + 3 reputation

The target corporation loses **8 reputation** immediately.

#### Counter Intelligence
> **Cost:** 3 energy + 5 influence
> **Requires:** Intelligence ≥ 10

Protects you from all covert operations (sabotage, leak scandal, corporate assassination) targeting you **this tick**. The attackers still pay their full costs.

#### Corporate Assassination
> **Cost:** 8 energy + 15 credits
> **Requires:** Pariah status (reputation < 15)

The target corporation loses **25 reputation** immediately.

---

### Free Actions

You can submit any number of these alongside your primary action.

| Action | What it does |
|--------|-------------|
| **Message** | Send a private message to another corp. They see it in their notification panel. |
| **Propose Alliance** | Invite another corp to ally with you. They can accept or decline next tick. |
| **Accept / Decline Alliance** | Respond to a pending alliance proposal. |
| **Break Alliance** | End an existing alliance immediately. |
| **Propose Trade** | Offer a bundle of resources in exchange for a bundle you want from another corp. They can accept or decline. |
| **Accept / Decline Trade** | Respond to a pending trade offer. Accepted trades execute instantly. |
| **Lobby** | Spend credits to vote for a law in the current legislative phase (see Laws below). Minimum 10 credits per lobby action (8 if you're Trusted). |
| **Embargo** | Block a specific corp from trading with you for **3 ticks**. |

#### Trading Fees
Each completed trade costs both parties **2 credits** in broker fees — unless you're allied with the other corp, or the **Free Market Decree** law is active.

---

## Reputation

Your reputation is publicly visible and changes based on your actions.

| Tier | Range | Status |
|------|-------|--------|
| **Trusted** | 75–100 | Lobbying discount (8 credits/vote instead of 10) |
| **Neutral** | 40–74 | No special effects |
| **Notorious** | 15–39 | Can use covert ops, but no benefits |
| **Pariah** | 0–14 | See below |

### Pariah Status (< 15 reputation)

Being a Pariah is dangerous — and powerful.

- **Every non-Pariah corporation pays you 5 credits per tick** (the "feared" mechanic). If multiple Pariahs exist, each non-Pariah pays each of them up to 5 credits.
- You can use **Corporate Assassination**, which no one else can.
- You **cannot lobby** for laws.
- You **cannot use covert ops** that require influence (sabotage, leak scandal) — unless the Crackdown Order is not active, but even then it's only possible if your influence is sufficient; Pariahs have no other restrictions on influence use.

> Black Market districts cost you 1 reputation per tick — be careful about over-investing in them.

---

## Laws

Every **10 ticks**, the city council enacts a new law that affects all players until the next vote.

During each 10-tick phase, you can **lobby** (free action) by spending credits to vote for your preferred law. 1 credit = 0.1 votes (10 credits = 1 vote). If your reputation is **Trusted (75+)**, you get 1 vote per 8 credits instead.

If you control the **Government Quarter**, your votes are **doubled**.

The law with the most votes wins. If no one lobbies, a law is chosen at random.

### Current Laws

| Law | Effect |
|-----|--------|
| **Data Sovereignty Act** | Data Centers produce +20% intelligence |
| **Labor Protection Bill** | Attacking a Labor Zone costs +5 energy |
| **Free Market Decree** | Trade broker fees waived for everyone |
| **Crackdown Order** | Sabotage and Leak Scandal influence cost doubled |
| **Corporate Transparency Act** | — |
| **Infrastructure Investment** | Fortify credit cost halved (4 instead of 8) |
| **Security Lockdown** | Sabotage and Leak Scandal energy cost doubled |
| **Open Borders** | Claim energy and credit cost halved |

---

## Scoring

At the end of the season, your score is:

```
Score = credits + energy + workforce + intelligence + influence + political_power
      + (districts owned × 10)
```

Districts dominate scoring. A corp with 10 districts and modest resources will almost always beat one with 2 districts and enormous stockpiles. But in close games, resources break ties.

---

## Quick Reference

### Cost Summary

| Action | Energy | Credits | Influence | Reputation |
|--------|--------|---------|-----------|------------|
| Claim | 3 | 5 | — | — |
| Attack | min 5 (your choice) | 10 | — | −3 |
| Fortify | 2 | 8 (4 w/ law) | — | — |
| Sabotage | 4 | 15 | 5 | −5 |
| Leak Scandal | 2 | 10 | 5 | −3 |
| Counter Intelligence | 3 | — | 5 | — |
| Corporate Assassination | 8 | 15 | — | — (Pariah only) |
| Trade fee | — | 2 | — | — |
| Lobby | — | min 10 (8 if Trusted) | — | — |

### Combat at a Glance

```
You attack with:   (energy spent × 1.5) + min(workforce, 20)
They defend with:  (fort level × 3) + min(workforce, 20) + ally bonus (max +4)

If your attack > their defense → you take the district
Fort resets to 0 on capture
You pay costs win or lose
```

### Reputation Breakpoints

- **< 15** → Pariah: other corps pay you 5 credits/tick, can't lobby
- **≥ 15** → Can use covert ops
- **≥ 75** → Trusted: cheaper lobbying
