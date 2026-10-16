# Group and topic people

On 2026-10-16 Julio said the group and topic flow was "non intuitive": "I don't see what people are in what topic, I cant add AIS or people". He had mentioned @Deepseek in the "Financial" topic of "ai test" and got no answer. The AI was in the group but not in that topic. The phone topic sheet could only list AIs, and the @ list still offered it.

He chose **"Per topic, one step"**: AIs stay per topic, but Add inside a topic shows people and AIs together, and adding an AI also adds it to the group. After one round of comments he approved the canvas: "much much much better thanks we can implement".

The canvas is https://claude.ai/artifact/UT7nHBowuCSmev1xLBdMxA. It's private, so these files are the copy workers read. They use D24 only (`docs/design/ui-style.md`) and the keys, rows and lists of `docs/design/mockups/group-info/`. Names and counts are sample data.

## The boards

| File | What it shows |
|---|---|
| `Main.dc.html` | Phone topic. **Header, two lines:** the topic name, then an avatar stack (at most 4) with "ai test · 4" (the group, then everyone in the topic, people and AIs). Tapping the header opens In this topic. **After a mention of someone who isn't in the topic,** one centred line: the AI's avatar, "Deepseek isn't in Financial", and an **Add** key. |
| `PhoneMention.dc.html` | The @ list shows **only who's in this topic** (AIs first, then people, with their @handles). There's no list of people outside the topic (Julio: "we dont need that"). |
| `PhonePeople.dc.html` | **In this topic** (the sheet from the header): the topic picture, name, public or private icon and group; a settings key; one primary **Add people or AIs** key; **AIs** (owner shown as "yours" or "Marta's", plus an options key); **People** (the topic's members); **Tools and routines** for this topic ("1 · 2"); then a **Mute** switch and a red **Leave topic** row. Julio: tools and routines can belong to one topic, "even makes more sense for private topics". General shows no Leave (leaving General is leaving the group). |
| `PhoneAdd.dc.html` | **Add to Financial:** People and AIs tabs (a segmented control) and a search. **AIs:** "In ai test" (Add, or a "Here" tick if it's already in), "Your other AIs" (each shows "+ joins ai test": one Add puts it in the group and the topic), and **New AI**. |
| `PhoneGroup.dc.html` | **Group screen:** a People and AIs row (stack and count); **Your topics**, each with its avatar stack and "4 people · Deepseek" (a lock icon for a private topic, a muted icon when muted), plus New topic; **Other topics** (public topics you're not in, "6 people · Claude", with a **Join** key; tapping the row opens it); then Shared media, Tools and routines (all topics) and Settings. |
| `PhoneJoin.dc.html` | **A topic you're not in**, opened from Other topics: its header and messages (you can read them), and a **Join Marketing** primary key where the composer would be. |
| `PhoneLeave.dc.html` | **Leave confirmation** sheet: "Leave Financial?", "You stop getting its messages. You can join again from ai test.", a red **Leave** key and **Cancel**. For a private topic the line is "Someone in it has to add you back." |
| `PhoneHeader.dc.html` | **The header while people write.** The second line swaps the stack for the writers: "Deepseek is writing…" with their avatar and a pulsing 6 px dot, "JULITO, Deepseek writing…", and "3 writing…". The topic name never moves. |
| `WebTopic.dc.html` | Web: the same two-line header; **In this topic** as a right panel (340 px) with Add, AIs, People, Tools and routines, Mute and Leave topic; the chat after the add ("Julio added Deepseek", then its reply). |
| `WebAdd.dc.html` | Web: the **Add to Financial** dialog (440 px) on the People tab. Contacts show "+ joins ai test" with Add, and **Invite with a link** has Copy. |
| `WebGroup.dc.html` | Web: the group panel (380 px) with the People and AIs row, **Your topics** with stacks (and a muted icon), and **Other topics** with Join. |

## Round 2: join, leave, mute (same evening)

Julio asked for UI to join other topics in the group, leave a topic, and mute a topic. The boards above include it: PhonePeople, PhoneGroup, PhoneJoin, PhoneLeave, WebTopic and WebGroup.

He also chose (AskUserQuestion) that **a new public topic includes nobody until people join**, instead of every group member as today:
- **Public** means any group member can see the topic under Other topics, read it and join it.
- **Private** means invite only.
- **General** stays everyone.

**The lead's default for existing public topics:** keep their current people (a backfill), so nobody loses a topic.

## Rules from the boards

- **The count in the header** is everyone in the topic: people plus AIs.
- **The writing line** replaces the stack and its text only, so the header height never changes.
- **"+ joins ai test"** marks an add that also puts the person or AI in the group. No other hint text; a status is an icon or a dot, never a word.
- **The "isn't in" line** shows only to the person who sent the mention.
